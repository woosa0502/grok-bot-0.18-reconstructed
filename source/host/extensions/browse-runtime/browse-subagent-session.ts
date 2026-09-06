import type { SubagentRunOptions, SubagentRunResult, SubagentSession } from "../../runner/subagent-runtime.js";
import { isBrowseServiceError, sendBrowseFollowUp, type BrowseClient, type BrowseSessionView } from "./browse-client.js";
import { decodeAsideSuspensionAnswer, encodeAsideSuspensionAnswer, parseSuspensionAnswer, suspensionQuestions } from "./browse-suspension.js";

export { parseSuspensionAnswer } from "./browse-suspension.js";

const POLL_MS = 1_000;
const BOUNDARY_RE = /<subagent-boundary>[\s\S]*?<\/subagent-boundary>\s*/;

function describeSuspended(view: BrowseSessionView, agentId: string): string {
  const s = view.suspension;
  const tag = s?.kind === "ask-user-question" ? "[question]" : "[approval needed]";
  const questions = suspensionQuestions(s?.request);
  const details = questions.map((q, i) => `${i + 1}. ${q.header ? `${q.header}: ` : ""}${q.question}${q.options.length > 0 ? `\n   Options: ${q.options.join(" / ")}` : ""}`).join("\n");
  const format = questions.length > 1 ? `Use one "header: answer" line per question, or JSON {"answers":[${questions.map((q) => JSON.stringify({ header: q.header, answer: "your answer" })).join(",")}]}, preserving every header in order.` : "Use allow / deny / confirm / cancel / free text.";
  const identity = s?.toolCallId ? ` Wrap the answer in this exact request identity: ${encodeAsideSuspensionAnswer({ toolCallId: s.toolCallId }, "REPLACE_WITH_ANSWER")}. Keep toolCallId unchanged; replace only answer.` : " The service did not provide a question identity; do not answer until it does.";
  return `${tag} ${s?.description ?? s?.kind ?? "the browser worker is waiting"}${details ? `\n\n${details}` : ""}\n\nAsk the user, then call Task again with resume="${agentId}" and the answer as the prompt. ${format}${identity}`;
}

/** Per-subagent link to its browse session. Belmont recreates the SubagentSession object on every
 * Task(resume=...) call (the foreground path releases it after each run), so the link must outlive
 * the object: the extension owns one registry shared by all sessions. */
export interface BrowseLink { browseId: string; pendingKind: string | null; pendingToolCallId?: string | undefined; pendingRequest?: unknown }
export type BrowseLinkRegistry = Map<string, BrowseLink>;

/** A Belmont SubagentSession whose brain is an Aside browse session behind belmont-browse/serve.mjs. */
export class BrowseSubagentSession implements SubagentSession {
  #activity: string[] = [];
  #toolCalls = 0;
  #generation = 0;

  constructor(readonly client: BrowseClient, readonly agentId: string, readonly links: BrowseLinkRegistry, readonly log: (message: string) => void) {}

  get #link(): BrowseLink | undefined { return this.links.get(this.agentId); }

  async run(prompt: string, _options?: SubagentRunOptions): Promise<SubagentRunResult> {
    const generation = ++this.#generation;
    const text = prompt.replace(BOUNDARY_RE, "").trim();
    const suppliedAnswer = decodeAsideSuspensionAnswer(text);
    const link = this.#link;
    if (suppliedAnswer !== null && (link === undefined || link.pendingKind === null)) throw new Error("This browser question is no longer pending; its answer was not submitted as a new task.");
    if (link !== undefined && link.pendingKind !== null) {
      const pending = await this.client.get(link.browseId);
      if (generation !== this.#generation) return { text: "[aborted] browser worker stopped", aborted: true };
      if (pending.status !== "suspended" || pending.suspension === null) {
        link.pendingKind = null;
        delete link.pendingToolCallId;
        delete link.pendingRequest;
        throw new Error("The browser worker no longer has a pending question; the answer was not submitted.");
      }
      if (!pending.suspension.toolCallId) throw new Error("The Aside service did not provide an exact question identity; the answer was not submitted.");
      const changed = link.pendingToolCallId !== pending.suspension.toolCallId || link.pendingKind !== pending.suspension.kind || (link.pendingRequest !== undefined && JSON.stringify(link.pendingRequest) !== JSON.stringify(pending.suspension.request));
      link.pendingKind = pending.suspension.kind;
      link.pendingToolCallId = pending.suspension.toolCallId;
      link.pendingRequest = pending.suspension.request;
      if (changed || suppliedAnswer === null || suppliedAnswer.toolCallId !== link.pendingToolCallId) return { text: describeSuspended(pending, this.agentId), aborted: false };
      try { await this.client.answer(link.browseId, parseSuspensionAnswer(link.pendingKind, suppliedAnswer.answer, link.pendingRequest), link.pendingToolCallId); } catch (error) {
        if (!isBrowseServiceError(error, "STALE_SUSPENSION")) throw error;
        const latest = await this.client.get(link.browseId);
        if (latest.status !== "suspended") throw error;
        link.pendingKind = latest.suspension?.kind ?? "approval";
        link.pendingToolCallId = latest.suspension?.toolCallId;
        link.pendingRequest = latest.suspension?.request;
        return { text: describeSuspended(latest, this.agentId), aborted: false };
      }
      link.pendingKind = null;
      delete link.pendingToolCallId;
      delete link.pendingRequest;
      this.log(`[browse-runtime] ${this.agentId}: answered ${link.pendingKind ?? "suspension"} on ${link.browseId}`);
    } else if (link !== undefined) {
      // Resume after a finished run (e.g. the worker replied "[approval needed]" as text, or the
      // parent has a follow-up): continue the same Aside conversation with the parent's message.
      try { await sendBrowseFollowUp(this.client, link.browseId, text); } catch (error) {
        if (!isBrowseServiceError(error, "SESSION_SUSPENDED")) throw error;
        const view = await this.client.get(link.browseId);
        if (view.status !== "suspended") throw error;
        link.pendingKind = view.suspension?.kind ?? "approval";
        link.pendingToolCallId = view.suspension?.toolCallId;
        link.pendingRequest = view.suspension?.request;
        return { text: describeSuspended(view, this.agentId), aborted: false };
      }
      this.log(`[browse-runtime] ${this.agentId}: continued ${link.browseId}`);
    } else {
      const created = await this.client.create({ task: text });
      if (generation !== this.#generation) {
        await this.client.stop(created.id);
        return { text: "[aborted] browser worker stopped", aborted: true };
      }
      this.links.set(this.agentId, { browseId: created.id, pendingKind: null });
      this.log(`[browse-runtime] ${this.agentId}: started browse session ${created.id}`);
    }
    const browseId = this.#link!.browseId;
    for (;;) {
      if (generation !== this.#generation) return { text: "[aborted] browser worker stopped", aborted: true };
      const view = await this.client.get(browseId);
      if (generation !== this.#generation) return { text: "[aborted] browser worker stopped", aborted: true };
      this.#activity = [...view.activity];
      this.#toolCalls = view.toolCalls;
      if (view.status === "suspended") {
        this.#link!.pendingKind = view.suspension?.kind ?? "approval";
        this.#link!.pendingToolCallId = view.suspension?.toolCallId;
        this.#link!.pendingRequest = view.suspension?.request;
        return { text: describeSuspended(view, this.agentId), aborted: false };
      }
      if (view.status === "done") return { text: view.result ?? "(the browser worker finished without a final message)", aborted: false };
      if (view.status === "error") throw new Error(`browser worker failed: ${view.error ?? "unknown error"}`);
      if (view.status === "stopped" || view.status === "interrupted") return { text: "[aborted] browser worker stopped", aborted: true };
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  interrupt(reason: string): void {
    this.#generation += 1;
    const link = this.#link;
    if (link !== undefined) {
      void this.client.stop(link.browseId).catch(() => undefined);
      link.pendingKind = null;
      delete link.pendingToolCallId;
      delete link.pendingRequest;
    }
    this.log(`[browse-runtime] ${this.agentId}: interrupted (${reason})`);
  }

  async getResolvedOutline(): Promise<readonly unknown[]> { return []; }
  getObservedToolCallCount(): number { return this.#toolCalls; }
  getActivitySnapshot(): readonly string[] { return this.#activity.slice(-12); }
  getTranscriptPath(): string | null { return null; }
  async dispose(): Promise<void> { /* the browse session lives in the service; nothing to release here */ }
}
