import type { SubagentRunOptions, SubagentRunResult, SubagentSession } from "../../runner/subagent-runtime.js";
import type { BrowseClient, BrowseSessionView } from "./browse-client.js";

const POLL_MS = 1_000;
const BOUNDARY_RE = /<subagent-boundary>[\s\S]*?<\/subagent-boundary>\s*/;

/** Parses the parent's resume prompt into an Aside suspension response for the pending kind. */
export function parseSuspensionAnswer(kind: string, prompt: string): unknown {
  const text = prompt.replace(BOUNDARY_RE, "").trim();
  const word = text.toLowerCase();
  if (kind === "approval") return { verdict: /^(allow|approve|yes|ok|y|허용|승인|응|네)\b/.test(word) ? "allow" : "deny", always: /always|항상/.test(word) };
  if (kind === "action-confirmation") return { verdict: /^(confirm|yes|ok|y|확인|진행|응|네)\b/.test(word) ? "confirm" : "cancel", ...(text.length > 0 ? { instruction: text } : {}) };
  return { answers: [{ header: "", answer: text }] };
}

function describeSuspended(view: BrowseSessionView, agentId: string): string {
  const s = view.suspension;
  const tag = s?.kind === "ask-user-question" ? "[question]" : "[approval needed]";
  return `${tag} ${s?.description ?? s?.kind ?? "the browser worker is waiting"}\n\nAsk the user, then call Task again with resume="${agentId}" and the answer as the prompt (allow / deny / confirm / cancel / free text).`;
}

/** Per-subagent link to its browse session. Belmont recreates the SubagentSession object on every
 * Task(resume=...) call (the foreground path releases it after each run), so the link must outlive
 * the object: the extension owns one registry shared by all sessions. */
export interface BrowseLink { browseId: string; pendingKind: string | null }
export type BrowseLinkRegistry = Map<string, BrowseLink>;

/** A Belmont SubagentSession whose brain is an Aside browse session behind belmont-browse/serve.mjs. */
export class BrowseSubagentSession implements SubagentSession {
  #activity: string[] = [];
  #toolCalls = 0;
  #stopped = false;

  constructor(readonly client: BrowseClient, readonly agentId: string, readonly links: BrowseLinkRegistry, readonly log: (message: string) => void) {}

  get #link(): BrowseLink | undefined { return this.links.get(this.agentId); }

  async run(prompt: string, _options?: SubagentRunOptions): Promise<SubagentRunResult> {
    this.#stopped = false;
    const text = prompt.replace(BOUNDARY_RE, "").trim();
    const link = this.#link;
    if (link !== undefined && link.pendingKind !== null) {
      await this.client.answer(link.browseId, parseSuspensionAnswer(link.pendingKind, prompt));
      link.pendingKind = null;
      this.log(`[browse-runtime] ${this.agentId}: answered ${link.pendingKind ?? "suspension"} on ${link.browseId}`);
    } else if (link !== undefined) {
      // Resume after a finished run (e.g. the worker replied "[approval needed]" as text, or the
      // parent has a follow-up): continue the same Aside conversation with the parent's message.
      await this.client.continue(link.browseId, text);
      this.log(`[browse-runtime] ${this.agentId}: continued ${link.browseId}`);
    } else {
      const created = await this.client.create({ task: text });
      this.links.set(this.agentId, { browseId: created.id, pendingKind: null });
      this.log(`[browse-runtime] ${this.agentId}: started browse session ${created.id}`);
    }
    const browseId = this.#link!.browseId;
    for (;;) {
      if (this.#stopped) return { text: "[aborted] browser worker stopped", aborted: true };
      const view = await this.client.get(browseId);
      this.#activity = [...view.activity];
      this.#toolCalls = view.toolCalls;
      if (view.status === "suspended") {
        this.#link!.pendingKind = view.suspension?.kind ?? "approval";
        return { text: describeSuspended(view, this.agentId), aborted: false };
      }
      if (view.status === "done") return { text: view.result ?? "(the browser worker finished without a final message)", aborted: false };
      if (view.status === "error") throw new Error(`browser worker failed: ${view.error ?? "unknown error"}`);
      if (view.status === "stopped") return { text: "[aborted] browser worker stopped", aborted: true };
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  interrupt(reason: string): void {
    this.#stopped = true;
    const link = this.#link;
    if (link !== undefined) void this.client.stop(link.browseId).catch(() => undefined);
    this.log(`[browse-runtime] ${this.agentId}: interrupted (${reason})`);
  }

  async getResolvedOutline(): Promise<readonly unknown[]> { return []; }
  getObservedToolCallCount(): number { return this.#toolCalls; }
  getActivitySnapshot(): readonly string[] { return this.#activity.slice(-12); }
  getTranscriptPath(): string | null { return null; }
  async dispose(): Promise<void> { /* the browse session lives in the service; nothing to release here */ }
}
