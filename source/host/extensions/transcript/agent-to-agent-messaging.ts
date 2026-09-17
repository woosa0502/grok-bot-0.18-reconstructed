import { isDedicatedBrowserBot, parseBrowserRequest, enqueueBrowserJob, deliveryIdentity, acceptDelivery } from '../../../../shared/browser-bot/host-store.mjs';
import { getSandRootDir as browserJobSandRoot } from '../../host-paths.js';
import { randomUUID } from "node:crypto";

import {
  buildAgentInboundWakePrompt,
  clampAgentMessage,
} from "../../agents/agent-messaging.js";
import { sandErrorDetail } from "../../ports/telemetry.js";
import { parseLeadingJobHeader } from "../inference/usage-ledger.js";
import { entryRaisesUserActivitySignal } from "../../../shared/transcript.js";
import { describeAgentRunError } from "./agent-run-error.js";
import { loadAgentInboundImages } from "./send-message-shaping.js";
import { nextEntryId } from "./transcript-entry-ids.js";
import { getTranscript } from "./transcript-store.js";
import { classifyAgentError } from "./turn-runtime.js";
import { runBackgroundTask } from "./background-task-continuation.js";
import { agentMessageWorkflowFields, settlePendingWakeWorkflow } from "./pending-wake-workflow.js";
import type { PendingWakeReference } from "./sand-pending-wake-store.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

export interface AgentInboundMessage {
  /** Durable identity: keys the persisted pending-wake marker (Phase B / AUDIT-5). */
  id?: string;
  from: { id: string; name: string };
  text: string;
  timestampMs: number;
  images?: readonly { url: string; alt?: string }[];
  priority?: boolean;
  isDisplayed?: boolean;
  isRedriven?: boolean;
  workflowParents?: readonly PendingWakeReference[];
  replyToWorkflow?: readonly PendingWakeReference[];
}
export function partitionAgentInbound<T extends { priority?: boolean }>(
  messages: readonly T[],
): { priority: T[]; rest: T[] } {
  const priority: T[] = [],
    rest: T[] = [];
  for (const message of messages)
    (message.priority === true ? priority : rest).push(message);
  return { priority, rest };
}
export function prioritizeAgentInbound<T extends { priority?: boolean }>(
  messages: readonly T[],
): T[] {
  const parts = partitionAgentInbound(messages);
  return [...parts.priority, ...parts.rest];
}
export function mergeAgentInboundQueue<T extends { priority?: boolean }>(
  queued: readonly T[],
  deferred: readonly T[],
): T[] {
  const newer = partitionAgentInbound(queued),
    older = partitionAgentInbound(deferred);
  return [...newer.priority, ...older.priority, ...older.rest, ...newer.rest];
}

export class AgentToAgentMessaging {
  readonly pendingAgentInbound = new Map<string, AgentInboundMessage[]>();
  readonly revivingAgentInboundIds = new Set<string>();
  constructor(readonly tm: TranscriptManagerLike) {}

  async sendToAgent(
    fromAgentId: string,
    toAgentId: string,
    text: string,
    images: readonly { url: string; alt?: string }[] = [],
    priority = false,
  ): Promise<string> {
    const browserDelivery = deliveryIdentity(browserJobSandRoot(), fromAgentId, toAgentId, text);
    if (browserDelivery?.accepted) return 'Sent to ' + toAgentId + ' (event already accepted)';

    const wasStopped = this.tm.captureAgentStopGuard?.(toAgentId) as (() => boolean) | undefined;
    const isStopped = (): boolean => wasStopped?.() === true || this.tm.isAgentUserStopped?.(toAgentId) === true;
    if (isStopped()) return "That agent was stopped by the user; the message was not accepted.";
    const message = clampAgentMessage(text);
    if (message.length === 0) return "Message was empty; nothing was sent.";
    if (toAgentId === fromAgentId) return "An agent can't message itself.";
    if (this.tm.sessions.isAgentGone(toAgentId))
      return "That agent no longer exists.";
    if (this.tm.groupChat.isRemoteRoomAgentId(toAgentId))
      return "That is a shared chat hosted by another user; agents can't message it directly.";
    const roster = await this.tm.sessionStore.listAgents();
    if (isStopped()) return "That agent was stopped by the user; the message was not accepted.";
    const target = roster.find((agent: any) => agent.id === toAgentId);
    if (target == null) return `No agent found with id ${toAgentId}.`;
    if (target.isGroup) {
      const ack = await this.tm.postToGroup(
        fromAgentId,
        toAgentId,
        message,
        priority,
      );
      const notes: string[] = [];
      if (images.length > 0)
        notes.push(
          `Note: the attached image${images.length === 1 ? " was" : "s were"} NOT delivered — group messages are text-only for now; send images to an agent directly.`,
        );
      if (priority)
        notes.push(
          "Note: priority is 1:1 only — this post did not interrupt members.",
        );
      return notes.length === 0 ? ack : `${ack} ${notes.join(" ")}`;
    }
    this.tm.productAnalytics.trackEvent("sand.agent_message.sent", {
      from_agent_id: fromAgentId,
      to_agent_id: toAgentId,
      is_group_target: false,
      is_priority: priority,
    });
    const sender = roster.find((agent: any) => agent.id === fromAgentId);
    this.tm.sessions.liveSessions
      .get(fromAgentId)
      ?.db.addConversationPartner(toAgentId);
    this.appendAgentOutboundEntry(
      fromAgentId,
      { id: toAgentId, name: target.name, kind: "agent" },
      message,
      Date.now(),
      images,
    );
    const inbound: AgentInboundMessage = {
      id: browserDelivery?.id ?? (randomUUID()),
      from: { id: fromAgentId, name: sender?.name ?? "An agent" },
      text: message,
      timestampMs: Date.now(),
      ...(images.length === 0 ? {} : { images }),
      ...(priority ? { priority: true } : {}),
      ...agentMessageWorkflowFields(fromAgentId, toAgentId),
    };
    // Durable delivery (Phase B / AUDIT-5): the message is persisted as a
    // pending-wake marker before anything is delivered, and only cleared after
    // the recipient's wake turn actually ran. A host crash between enqueue and
    // delivery re-arms it at the next start (at-least-once). A persistence
    // failure must not masquerade as a durable send (external review r3 #1):
    // the sender's ack says so, and telemetry records it.
    if (isDedicatedBrowserBot(browserJobSandRoot(), toAgentId)) {
      if (process.env.SAND_ASIDE_BROWSE !== '1') throw new Error('Dedicated browser runtime is disabled');
      const admitted = enqueueBrowserJob(browserJobSandRoot(), {
        ...parseBrowserRequest(inbound.text, { requestId: inbound.id }),
        botId: toAgentId, requesterAgentId: fromAgentId, replyTarget: fromAgentId, receivedAt: inbound.timestampMs,
      });
      return 'Sent to ' + toAgentId + ': browser job ' + admitted.payload.jobId + ' accepted / queued (execution result will be delivered separately).';
    }
    const persisted = this.persistInboundMarker(toAgentId, inbound);
    if (browserDelivery) {
      if (!persisted) throw new Error('Browser event was not durably queued');
      acceptDelivery(browserJobSandRoot(), browserDelivery);
    }

    if (!persisted) {
      this.tm.telemetry.reportPendingWake({
        conversationId: toAgentId,
        outcome: "persist_failed",
        kind: "agent-message",
        workId: inbound.id ?? "",
      });
    }
    const durabilityNote = persisted
      ? ""
      : " (warning: the message could not be saved for restart-safe delivery — if the app restarts before the recipient wakes, this message is lost)";
    const queued = this.pendingAgentInbound.get(toAgentId) ?? [];
    if (priority) {
      this.pendingAgentInbound.set(toAgentId, [inbound, ...queued]);
      this.steerRecipientForPriorityPeer(toAgentId);
    } else {
      queued.push(inbound);
      this.pendingAgentInbound.set(toAgentId, queued);
    }
    void this.reviveForAgentInbound(toAgentId);
    return priority
      ? `Sent to ${target.name} as a priority message — it will interrupt their current non-user work and wake them now. This is asynchronous — if they reply, it'll arrive later as a new message that wakes you; don't wait on it now.${durabilityNote}`
      : `Sent to ${target.name}. This is asynchronous — if they reply, it'll arrive later as a new message that wakes you; don't wait on it now.${durabilityNote}`;
  }

  persistInboundMarker(toAgentId: string, inbound: AgentInboundMessage): boolean {
    if (this.tm.isAgentUserStopped?.(toAgentId) === true) return false;
    if (inbound.id == null) return false;
    return this.tm.pendingWakeStore?.markPending({
      agentId: toAgentId,
      kind: "agent-message",
      workId: inbound.id,
      markedAtMs: inbound.timestampMs,
      title: `Message from ${inbound.from.name}`,
      ...(inbound.workflowParents == null ? {} : { workflowParents: inbound.workflowParents }),
      ...(inbound.replyToWorkflow == null ? {} : { replyToWorkflow: inbound.replyToWorkflow }),
      agentMessage: {
        from: inbound.from,
        text: inbound.text,
        ...(inbound.images?.length ? { images: inbound.images } : {}),
        ...(inbound.priority === true ? { priority: true } : {}),
        ...(inbound.isDisplayed === true ? { displayed: true } : {}),
      },
    }) ?? false;
  }

  clearInboundMarker(toAgentId: string, inbound: AgentInboundMessage): void {
    if (inbound.id == null) return;
    settlePendingWakeWorkflow(this.tm, {
      agentId: toAgentId,
      kind: "agent-message",
      workId: inbound.id,
    });
  }

  steerRecipientForPriorityPeer(agentId: string): void {
    const scheduler = this.tm.runLifecycle.runScheduler;
    if (scheduler == null || scheduler.getActiveLane(agentId) === "user")
      return;
    const reason = "superseded by a priority agent message";
    const wasInFlight = this.tm.runLifecycle.runningAgentIds().has(agentId);
    const hadGroupRun =
      this.tm.runnerRegistry.activeGroupMemberRunners
        .get(agentId)
        ?.interrupt(reason) ?? false;
    if (hadGroupRun) this.tm.groupChat.dmPreemptedGroupMemberIds.add(agentId);
    const hadDirectRun =
      this.tm.runnerRegistry.runners.get(agentId)?.interrupt(reason) ?? false;
    if (hadDirectRun)
      this.tm.backgroundWakes.dmPreemptedWakeAgentIds.add(agentId);
    if (hadDirectRun || hadGroupRun || wasInFlight)
      this.tm.telemetry.reportTurnInterrupt({
        conversationId: agentId,
        reason: "agent_steer",
        hadActiveRun: hadDirectRun || hadGroupRun,
        wasInFlight,
      });
  }

  async reviveForAgentInbound(agentId: string): Promise<void> {
    if (
      !this.tm.execution.canExecute ||
      this.tm.isAgentUserStopped?.(agentId) === true ||
      this.revivingAgentInboundIds.has(agentId)
    )
      return;
    this.revivingAgentInboundIds.add(agentId);
    try {
      while ((this.pendingAgentInbound.get(agentId)?.length ?? 0) > 0) {
        const messages = prioritizeAgentInbound(
          this.pendingAgentInbound.get(agentId) ?? [],
        );
        this.pendingAgentInbound.delete(agentId);
        await this.runAgentInboundWake(agentId, messages);
      }
    } finally {
      this.revivingAgentInboundIds.delete(agentId);
    }
  }

  async runAgentInboundWake(
    agentId: string,
    messages: readonly AgentInboundMessage[],
  ): Promise<void> {
    const wasStopped = this.tm.captureAgentStopGuard?.(agentId) as (() => boolean) | undefined;
    if (messages.length === 0 || !this.tm.execution.canExecute || this.tm.isAgentUserStopped?.(agentId) === true) return;
    let session: any;
    try {
      session = await this.tm.sessions.resolveBackgroundSession(agentId);
    } catch {
      return;
    }
    if (wasStopped?.() === true || this.tm.isAgentUserStopped?.(agentId) === true) return;
    if (
      this.tm.groupChat.isGroupSession(session) ||
      this.tm.groupChat.isRemoteRoomSession(session)
    )
      return;
    this.appendAgentInboundEntries(
      session,
      messages.filter((message) => message.isDisplayed !== true),
    );
    // The transcript entry is in: if a crash interrupts delivery from here on,
    // the re-armed message must not append a duplicate entry.
    for (const message of messages)
      if (message.isDisplayed !== true)
        this.persistInboundMarker(agentId, { ...message, isDisplayed: true });
    const runner = this.tm.runnerRegistry.getRunner(session);
    this.tm.runLifecycle.beginSessionRun(session);
    await this.tm.runLifecycle.enqueueExclusiveRun(
      session.id,
      async () => {
        if (wasStopped?.() === true || this.tm.isAgentUserStopped?.(agentId) === true) {
          this.tm.runLifecycle.endSessionRun(session);
          return;
        }
        this.tm.turnRuntime.activeRequestPrompts.delete(session.id);
        this.tm.turnRuntime.activeRequestSources.set(session.id, "agent");
        this.tm.backgroundWakes.dmPreemptedWakeAgentIds.delete(session.id);
        try {
          for (const [index, message] of messages.entries()) {
            if (
              index > 0 &&
              (this.pendingAgentInbound.get(agentId) ?? []).some(
                (pending) => pending.priority === true,
              )
            ) {
              const deferred = messages
                .slice(index)
                .map((remaining) => ({ ...remaining, isDisplayed: true }));
              this.pendingAgentInbound.set(
                agentId,
                mergeAgentInboundQueue(
                  this.pendingAgentInbound.get(agentId) ?? [],
                  deferred,
                ),
              );
              return;
            }
            const selectedImages = await loadAgentInboundImages(message.images);
            const settled = await runBackgroundTask(
              this.tm,
              session,
              runner,
              buildAgentInboundWakePrompt(message),
              {
                hidden: true,
                isSilenceAllowed: true,
                // Belmont v4 job-id: parse [job:] tags from the ORIGINAL sender text,
                // before buildAgentInboundWakePrompt wraps it with the [agent] header.
                jobAttribution: parseLeadingJobHeader(message.text),
                browserInbound: { fromAgentId: message.from.id, requestId: message.id, text: message.text, receivedAt: message.timestampMs },
                ...(selectedImages.length === 0 ? {} : { selectedImages }),
              },
              () => wasStopped?.() !== true,
              message.id == null ? [] : [{ agentId, kind: "agent-message", workId: message.id }],
            );
            const result = settled.result;
            const preempted =
              this.tm.backgroundWakes.dmPreemptedWakeAgentIds.delete(
                session.id,
              );
            if (result.aborted && result.quiescedForUpgrade !== true) {
              if (!preempted || this.tm.sessions.isAgentGone(agentId)
                || wasStopped?.() === true || this.tm.isAgentUserStopped?.(agentId) === true) return;
              const redrivable = messages
                .slice(index)
                .filter((remaining) => remaining.isRedriven !== true)
                .map((remaining) => ({
                  ...remaining,
                  isDisplayed: true,
                  isRedriven: true,
                }));
              if (redrivable.length > 0)
                this.pendingAgentInbound.set(
                  agentId,
                  mergeAgentInboundQueue(
                    this.pendingAgentInbound.get(agentId) ?? [],
                    redrivable,
                  ),
                );
              return;
            }
            if (!settled.completed) {
              // This run consumed only the current message. Preserve the unstarted tail in the
              // in-memory queue so a wait on its child cannot strand later accepted messages until
              // restart. The waiting message itself stays durable and is not immediately replayed.
              const tail = messages.slice(index + 1).map((remaining) => ({ ...remaining, isDisplayed: true }));
              if (tail.length > 0) this.pendingAgentInbound.set(agentId, mergeAgentInboundQueue(
                this.pendingAgentInbound.get(agentId) ?? [], tail,
              ));
              // Keep the current payload for a linked completion or later explicit resume;
              // immediately replaying that idle/pending message would create an unbounded loop.
              this.tm.telemetry.reportPendingWake({
                conversationId: agentId, outcome: "deferred", kind: "agent-message",
                workId: message.id ?? "", reason: settled.reason,
              });
              return;
            }
            // Completed: only now does the durable marker settle (AUDIT-5).
            this.clearInboundMarker(agentId, message);
          }
          await this.tm.roster.emitAgentUpdate(session.id);
        } catch (error) {
          this.tm.telemetry.reportAgentError({
            source: "agent",
            conversationId: session.id,
            requestId: this.tm.runLifecycle.lastRequestIdBySession.get(
              session.id,
            ),
            error: classifyAgentError(error),
            detail: sandErrorDetail(error),
          });
          this.tm.trayErrors.pushError({
            agentId: session.id,
            title: "Message from another agent failed",
            ...describeAgentRunError(error),
          });
        } finally {
          this.tm.runLifecycle.endSessionRun(session);
        }
      },
      { lane: "agent", source: "agent" },
    );
  }

  appendAgentInboundEntries(
    session: any,
    messages: readonly AgentInboundMessage[],
  ): void {
    const isActive = session.id === this.tm.sessions.activeSession?.id;
    let raisesActivity = false;
    for (const message of messages) {
      session.db.addConversationPartner(message.from.id);
      const entries = isActive
        ? getTranscript()
        : session.db.getTranscriptEntries();
      // Crash-window dedupe (r3 #2 follow-up): the durable marker id is stamped
      // onto the entry, so a redelivery whose entry already landed before a
      // crash (append happened, displayed-flag write did not) appends nothing.
      if (
        message.id != null &&
        entries.slice(-80).some((existing: { agentMessageId?: string }) => existing?.agentMessageId === message.id)
      )
        continue;
      const entry = {
        kind: "message",
        id: nextEntryId(entries, "user-message"),
        role: "user",
        content: message.text,
        isStreaming: false,
        timestampMs: message.timestampMs,
        fromAgent: message.from,
        ...(message.id == null ? {} : { agentMessageId: message.id }),
        ...(message.images?.length ? { images: message.images } : {}),
      };
      raisesActivity ||= entryRaisesUserActivitySignal(entry);
      if (isActive) this.tm.appendEntry(entry);
      else session.db.appendTranscriptEntry(entry);
    }
    if (!isActive) {
      if (raisesActivity) this.tm.sessionStore.markSessionActivity(session);
      void this.tm.roster.emitAgentUpdate(session.id);
    }
  }
  appendAgentOutboundEntry(
    fromAgentId: string,
    toAgent: { readonly kind?: string; readonly [key: string]: unknown },
    text: string,
    timestampMs: number,
    images: readonly { url: string; alt?: string }[] = [],
  ): void {
    const session = this.tm.sessions.liveSessions.get(fromAgentId);
    if (session == null) return;
    const isActive = session.id === this.tm.sessions.activeSession?.id;
    const entry = {
      kind: "message",
      id: nextEntryId(
        isActive ? getTranscript() : session.db.getTranscriptEntries(),
        "assistant-message",
      ),
      role: "assistant",
      content: text,
      isStreaming: false,
      timestampMs,
      toAgent,
      ...(images.length === 0 ? {} : { images }),
    };
    if (isActive) this.tm.appendEntry(entry);
    else {
      session.db.appendTranscriptEntry(entry);
      if (entryRaisesUserActivitySignal(entry))
        this.tm.sessionStore.markSessionActivity(session);
      void this.tm.roster.emitAgentUpdate(session.id);
    }
  }
}
