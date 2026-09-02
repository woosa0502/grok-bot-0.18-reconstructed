import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunnerUpdate, SandAgentRunnerResult } from "../../runner/sand-agent-runner.js";
import { getSandAgentsRootDir } from "../../storage/agent-paths.js";
import type { BrowseClient, BrowseSessionView } from "./browse-client.js";
import { parseSuspensionAnswer } from "./browse-subagent-session.js";

export const ASIDE_BOT_RUNTIME = "aside-browse";
const LINK_FILENAME = "browse-runtime.json";
const POLL_MS = 1_000;

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
    if (options?.hidden === true) return { text: "", sentMessageCount: 0, reacted: true, aborted: false }; // nudges: nothing owed
    const text = prompt.trim();
    if (text.length === 0) return result("", 0);
    stopped = false;
    const client = deps.client();
    let link = readLink(agentId);
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
        link = { browseId: created.id, pendingKind: null }; writeLink(agentId, link);
        deps.log(`[browse-runtime] bot ${agentId}: started ${created.id}`);
      }
    } catch (error) {
      if (link !== null) { writeLink(agentId, null); } // a stale session (service restarted): start over next time
      send({ type: "text", content: `[브라우저 봇 오류] ${error instanceof Error ? error.message : String(error)}` });
      return result("", 1);
    }
    for (;;) {
      if (stopped) return { text: "", sentMessageCount: 0, reacted: false, aborted: true };
      const view = await client.get(link.browseId);
      activity = view.activity; toolCalls = view.toolCalls;
      if (view.status === "suspended") {
        link.pendingKind = view.suspension?.kind ?? "approval"; writeLink(agentId, link);
        send(suspensionWidget(view));
        return { ...result("", 1), awaitingUserSelection: true };
      }
      if (view.status === "done") { send({ type: "text", content: view.result ?? "(작업이 끝났지만 답 문장이 없습니다)" }); return result(view.result ?? "", 1); }
      if (view.status === "error") { send({ type: "text", content: `[브라우저 봇 오류] ${view.error ?? "unknown error"}` }); return result("", 1); }
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
