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

/** A Belmont SubagentSession whose brain is an Aside browse session behind belmont-browse/serve.mjs. */
export class BrowseSubagentSession implements SubagentSession {
  #browseId: string | null = null;
  #pendingKind: string | null = null;
  #activity: string[] = [];
  #toolCalls = 0;
  #stopped = false;

  constructor(readonly client: BrowseClient, readonly agentId: string, readonly log: (message: string) => void) {}

  async run(prompt: string, _options?: SubagentRunOptions): Promise<SubagentRunResult> {
    this.#stopped = false;
    if (this.#browseId !== null && this.#pendingKind !== null) {
      await this.client.answer(this.#browseId, parseSuspensionAnswer(this.#pendingKind, prompt));
      this.#pendingKind = null;
      this.log(`[browse-runtime] ${this.agentId}: resumed ${this.#browseId}`);
    } else {
      const created = await this.client.create({ task: prompt.replace(BOUNDARY_RE, "").trim() });
      this.#browseId = created.id;
      this.log(`[browse-runtime] ${this.agentId}: started browse session ${created.id}`);
    }
    for (;;) {
      if (this.#stopped) return { text: "[aborted] browser worker stopped", aborted: true };
      const view = await this.client.get(this.#browseId);
      this.#activity = [...view.activity];
      this.#toolCalls = view.toolCalls;
      if (view.status === "suspended") {
        this.#pendingKind = view.suspension?.kind ?? "approval";
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
    if (this.#browseId !== null) void this.client.stop(this.#browseId).catch(() => undefined);
    this.log(`[browse-runtime] ${this.agentId}: interrupted (${reason})`);
  }

  async getResolvedOutline(): Promise<readonly unknown[]> { return []; }
  getObservedToolCallCount(): number { return this.#toolCalls; }
  getActivitySnapshot(): readonly string[] { return this.#activity.slice(-12); }
  getTranscriptPath(): string | null { return null; }
  async dispose(): Promise<void> { /* the browse session lives in the service; nothing to release here */ }
}
