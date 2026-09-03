import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunnerUpdate, SandAgentRunnerResult } from "../../runner/sand-agent-runner.js";
import { getSandAgentsRootDir } from "../../storage/agent-paths.js";
import type { BrowseClient, BrowseSessionView } from "./browse-client.js";
import { parseSuspensionAnswer } from "./browse-subagent-session.js";

export const ASIDE_BOT_RUNTIME = "aside-browse";
const LINK_FILENAME = "browse-runtime.json";
const POLL_MS = 1_000;
// The service runs the cheap default model (luna). When a fresh task fails outright, retry it once with the
// strong model instead of handing the user an error. SAND_ASIDE_BROWSE_FALLBACK_MODEL=off disables the retry.
const FALLBACK_MODEL = process.env.SAND_ASIDE_BROWSE_FALLBACK_MODEL?.trim() || "gpt-5.5";
const FALLBACK_THINKING = process.env.SAND_ASIDE_BROWSE_FALLBACK_THINKING?.trim() || "high";

interface BotLink { browseId: string; pendingKind: string | null }

/** A roster bot opts in by carrying `"runtime": "aside-browse"` in its profile.json. */
export function isAsideBotAgent(agentId: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(getSandAgentsRootDir(), agentId, "profile.json"), "utf8")) as { runtime?: unknown };
    return raw.runtime === ASIDE_BOT_RUNTIME;
  } catch {
    return false;
  }
}

function linkPath(agentId: string): string { return join(getSandAgentsRootDir(), agentId, LINK_FILENAME); }
function readLink(agentId: string): BotLink | null {
  try { return existsSync(linkPath(agentId)) ? JSON.parse(readFileSync(linkPath(agentId), "utf8")) as BotLink : null; } catch { return null; }
}
function writeLink(agentId: string, link: BotLink | null): void {
  if (link === null) { try { unlinkSync(linkPath(agentId)); } catch { /* absent */ } return; }
  writeFileSync(linkPath(agentId), JSON.stringify(link, null, 2));
}
/** Called when the user clears the bot's conversation: the next message starts a fresh Aside session. */
export function forgetAsideBotLink(agentId: string): void { writeLink(agentId, null); }

interface RunnerLike {
  run(prompt: string, options?: Record<string, unknown>): Promise<unknown>;
  interrupt(reason: string): unknown;
  getObservedToolCallCount(): number;
  getActivitySnapshot(): readonly string[];
}
interface WrapDeps {
  readonly client: () => BrowseClient;
  readonly emitUpdate: (update: RunnerUpdate) => void;
  readonly log: (message: string) => void;
  /** Belmont's bot-to-bot delivery (transcript.sendToAgent); undefined when the transcript API is unavailable. */
  readonly sendToAgent?: (toAgentId: string, text: string) => Promise<unknown> | unknown;
}

const AGENT_WAKE_CUE = "[agent]";
/** Belmont wakes a bot for an inbound bot-to-bot message with a HIDDEN turn whose prompt starts with "[agent]" and
 * carries the sender's id and the text (agent-messaging.ts buildAgentInboundWakePrompt). */
export function parseInboundAgentWake(prompt: string): { fromId: string; fromName: string; text: string } | null {
  if (!prompt.startsWith(AGENT_WAKE_CUE)) return null;
  const head = prompt.match(/agents: (.+?) \(id: ([0-9a-fA-F-]{8,})\)\./);
  const fromName = head?.[1] ?? "";
  const fromId = head?.[2] ?? "";
  if (fromName.length === 0 || fromId.length === 0) return null;
  const lines = prompt.split("\n");
  const blank = lines.indexOf("");
  const body = (blank === -1 ? lines.slice(1) : lines.slice(blank + 1)).join("\n").trim();
  const text = body.startsWith(`${fromName}: `) ? body.slice(fromName.length + 2) : body;
  return { fromId, fromName, text: text.trim() };
}

function suspensionWidget(view: BrowseSessionView): Record<string, unknown> & { type: string } {
  const s = view.suspension;
  const request = (s?.request ?? {}) as { questions?: { question?: string; header?: string; options?: ({ label?: string } | string)[] }[] };
  if (s?.kind === "ask-user-question") {
    const q = request.questions?.[0];
    const options = (q?.options ?? []).map((o) => (typeof o === "string" ? o : o.label ?? "")).filter((label) => label.length > 0).slice(0, 6);
    return { type: "widget", widget: { prompt: q?.question ?? s.description, options: options.map((label, i) => ({ label, value: label, ...(i === 0 ? { style: "primary" } : {}) })) } };
  }
  const isConfirm = s?.kind === "action-confirmation";
  return {
    type: "widget",
    widget: {
      prompt: `${isConfirm ? "진행 확인" : "승인 필요"}: ${s?.description ?? ""}`.trim(),
      options: [{ label: isConfirm ? "진행" : "허용", value: isConfirm ? "confirm" : "allow", style: "primary" }, { label: isConfirm ? "취소" : "거절", value: isConfirm ? "cancel" : "deny", style: "danger" }],
    },
  };
}

/** Wraps a bot's runner so that its user turns are served by an Aside browse session; everything else delegates. */
export function wrapRunnerForAsideBot<T extends object>(runner: T, agentId: string, deps: WrapDeps): T {
  let stopped = false;
  let activity: readonly string[] = [];
  let toolCalls = 0;
  const send = (message: Record<string, unknown> & { type: string }) => deps.emitUpdate({ type: "send-message", message, timestampMs: Date.now() });
  const result = (text: string, sent: number): SandAgentRunnerResult => ({ text, sentMessageCount: sent, reacted: false, aborted: false, streamOutputProduced: false });

  const run = async (prompt: string, options?: Record<string, unknown>): Promise<SandAgentRunnerResult> => {
    const inbound = options?.hidden === true ? parseInboundAgentWake(prompt) : null;
    if (options?.hidden === true && inbound === null) return { text: "", sentMessageCount: 0, reacted: true, aborted: false }; // nudges: nothing owed
    const text = inbound === null ? prompt.trim() : inbound.text;
    if (text.length === 0) return result("", 0);
    const replyToSender = async (message: string) => {
      if (inbound === null || deps.sendToAgent === undefined) return;
      try { await deps.sendToAgent(inbound.fromId, message); } catch (error) { deps.log(`[browse-runtime] bot ${agentId}: reply to ${inbound.fromName} failed: ${error instanceof Error ? error.message : String(error)}`); }
    };
    if (inbound !== null) deps.log(`[browse-runtime] bot ${agentId}: inbound task from ${inbound.fromName}`);
    stopped = false;
    const client = deps.client();
    let link = readLink(agentId);
    let freshTask = false, retried = false;
    try {
      if (link !== null && link.pendingKind !== null) {
        await client.answer(link.browseId, parseSuspensionAnswer(link.pendingKind, text));
        link.pendingKind = null; writeLink(agentId, link);
        deps.log(`[browse-runtime] bot ${agentId}: answered suspension on ${link.browseId}`);
      } else if (link !== null) {
        await client.continue(link.browseId, text);
        deps.log(`[browse-runtime] bot ${agentId}: continued ${link.browseId}`);
      } else {
        const created = await client.create({ task: text });
        link = { browseId: created.id, pendingKind: null }; writeLink(agentId, link); freshTask = true;
        deps.log(`[browse-runtime] bot ${agentId}: started ${created.id}`);
      }
    } catch (error) {
      if (link !== null) { writeLink(agentId, null); } // a stale session (service restarted): start over next time
      const message = `[브라우저 봇 오류] ${error instanceof Error ? error.message : String(error)}`;
      send({ type: "text", content: message });
      await replyToSender(message);
      return result("", 1);
    }
    for (;;) {
      if (stopped) return { text: "", sentMessageCount: 0, reacted: false, aborted: true };
      const view = await client.get(link.browseId);
      activity = view.activity; toolCalls = view.toolCalls;
      if (view.status === "suspended") {
        link.pendingKind = view.suspension?.kind ?? "approval"; writeLink(agentId, link);
        send(suspensionWidget(view));
        await replyToSender(`[waiting] 사용자 확인이 필요해서 제 대화창에 카드로 물어봤습니다: ${view.suspension?.description ?? view.suspension?.kind ?? ""}`);
        return { ...result("", 1), awaitingUserSelection: true };
      }
      if (view.status === "done") {
        const answer = view.result ?? "(작업이 끝났지만 답 문장이 없습니다)";
        send({ type: "text", content: answer });
        await replyToSender(answer);
        return result(view.result ?? "", 1);
      }
      if (view.status === "error") {
        if (freshTask && !retried && FALLBACK_MODEL !== "off") {
          retried = true;
          deps.log(`[browse-runtime] bot ${agentId}: ${link.browseId} failed (${view.error ?? "unknown"}); retrying with ${FALLBACK_MODEL}/${FALLBACK_THINKING}`);
          try {
            const created = await client.create({ task: text, model: FALLBACK_MODEL, thinking: FALLBACK_THINKING });
            link = { browseId: created.id, pendingKind: null }; writeLink(agentId, link);
            send({ type: "text", content: `[브라우저 봇] 기본 모델이 실패해서 ${FALLBACK_MODEL}(으)로 다시 시도합니다. (${view.error ?? "unknown error"})` });
            continue;
          } catch (error) { deps.log(`[browse-runtime] bot ${agentId}: fallback start failed: ${error instanceof Error ? error.message : String(error)}`); }
        }
        const message = `[브라우저 봇 오류] ${view.error ?? "unknown error"}`;
        send({ type: "text", content: message });
        await replyToSender(message);
        return result("", 1);
      }
      if (view.status === "stopped") return { text: "", sentMessageCount: 0, reacted: false, aborted: true };
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  };
  const overrides: Partial<RunnerLike> & { wouldRecoverViaPrepend: undefined } = {
    run,
    interrupt: (reason: string) => {
      stopped = true;
      const link = readLink(agentId);
      // Belmont interrupts the previous turn whenever a new user message arrives ("superseded by a
      // new user message"), including the answer to our own approval/question card. That must not
      // kill the Aside session: the answer resumes it. Only other interrupts (user stop, cancel) do.
      const superseded = /superseded/i.test(reason);
      if (link !== null && !superseded && link.pendingKind === null) void deps.client().stop(link.browseId).catch(() => undefined);
      deps.log(`[browse-runtime] bot ${agentId}: interrupted (${reason})${superseded ? " — session kept" : ""}`);
      return true;
    },
    getObservedToolCallCount: () => toolCalls,
    getActivitySnapshot: () => activity.slice(-12),
    wouldRecoverViaPrepend: undefined,
  };
  return new Proxy(runner, {
    get(target, prop, receiver) {
      if (prop in overrides) return (overrides as Record<PropertyKey, unknown>)[prop];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
