import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunnerUpdate, SandAgentRunnerResult } from "../../runner/sand-agent-runner.js";
import { getSandAgentsRootDir } from "../../storage/agent-paths.js";
import { isBrowseServiceError, sendBrowseFollowUp, type AsideMessage, type BrowseClient, type BrowseSessionView } from "./browse-client.js";
import { decodeAsideSuspensionAnswer, encodeAsideSuspensionAnswer, parseSuspensionAnswer, suspensionQuestions, type BrowseQuestionAnswer } from "./browse-suspension.js";

export const ASIDE_BOT_RUNTIME = "aside-browse";
const LINK_FILENAME = "browse-runtime.json";
const POLL_MS = 1_000;
// Aside filters messages with `timestamp > since`, so equal-timestamp and late-arriving messages need a
// look-back window plus identity-based dedup (seenMessageKeys) instead of a timestamp-only cursor.
const MIRROR_LOOKBACK_MS = 5 * 60_000;
const SEEN_MESSAGE_KEYS_LIMIT = 500;
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["done", "error", "stopped", "interrupted"]);
// A model unavailable before native execution may be retried once. Failures after execution starts
// require an explicit follow-up: replaying a task could repeat external actions.
const FALLBACK_MODEL = process.env.SAND_ASIDE_BROWSE_FALLBACK_MODEL?.trim() || "gpt-5.5";
const FALLBACK_THINKING = process.env.SAND_ASIDE_BROWSE_FALLBACK_THINKING?.trim() || "high";

interface BotLink {
  browseId: string;
  pendingKind: string | null;
  pendingToolCallId?: string | undefined;
  pendingRequest?: unknown;
  pendingDescription?: string | undefined;
  pendingAnswers?: BrowseQuestionAnswer[];
  ownerAgentId?: string;
  source?: "created" | "selected" | "legacy";
  /** Newest Aside message timestamp already shown in the bot chat (query hint; not the dedup key). */
  lastSeenTs?: number;
  /** Messages at or before this timestamp are never mirrored (link creation time, or the legacy cursor). */
  mirrorFloorTs?: number;
  /** Identities of Aside messages already mirrored (bounded, oldest first). Absent on legacy links. */
  seenMessageKeys?: string[];
  /** A user stop the browse service has not acknowledged yet; retried on every contact until confirmed. */
  cancelRequested?: { at: number; reason: string; attempts: number; lastError?: string };
}

/** A saved link file that cannot be read is quarantined, never silently treated as "no session". */
export class AsideLinkCorruptError extends Error {
  constructor(readonly quarantinedPath: string) {
    super(`The saved Aside session link is unreadable and was moved to ${quarantinedPath}. Reconnect with /aside link <session-id> or start fresh with /aside unlink.`);
    this.name = "AsideLinkCorruptError";
  }
}

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
function quarantineLink(file: string): never {
  const quarantined = `${file}.corrupt-${Date.now()}`;
  try { renameSync(file, quarantined); } catch { /* leave the unreadable file in place if it cannot be moved */ }
  throw new AsideLinkCorruptError(quarantined);
}
function readLink(agentId: string): BotLink | null {
  const file = linkPath(agentId);
  if (!existsSync(file)) return null;
  let link: BotLink;
  try {
    link = JSON.parse(readFileSync(file, "utf8")) as BotLink;
  } catch { return quarantineLink(file); }
  if (link === null || typeof link !== "object" || typeof link.browseId !== "string" || link.browseId.length === 0) return quarantineLink(file);
  if (link.ownerAgentId !== undefined && link.ownerAgentId !== agentId) throw new Error("The saved Aside session belongs to another bot; explicitly select a session with /aside link <session-id>.");
  return { ...link, pendingKind: link.pendingKind ?? null, ownerAgentId: agentId, source: link.source ?? "legacy" };
}
/** readLink for observers that must not fail the caller: corruption and foreign ownership read as "no link". */
function peekLink(agentId: string): BotLink | null {
  try { return readLink(agentId); } catch { return null; }
}
function writeLink(agentId: string, link: BotLink | null): void {
  const file = linkPath(agentId);
  if (link === null) { try { unlinkSync(file); } catch { /* absent */ } return; }
  // Atomic replace: a crash mid-write leaves the previous link intact instead of a truncated file.
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify({ ...link, ownerAgentId: agentId }, null, 2));
  renameSync(temporary, file);
}
function messageKey(message: AsideMessage): string {
  if (typeof message.id === "string" && message.id.length > 0) return `id:${message.id}`;
  return `fp:${message.role}:${message.timestamp}:${createHash("sha1").update(message.text).digest("hex").slice(0, 16)}`;
}
function rememberSeen(link: BotLink, keys: readonly string[], newestTs: number): void {
  const merged = [...(link.seenMessageKeys ?? []), ...keys.filter((key) => !(link.seenMessageKeys ?? []).includes(key))];
  link.seenMessageKeys = merged.length > SEEN_MESSAGE_KEYS_LIMIT ? merged.slice(merged.length - SEEN_MESSAGE_KEYS_LIMIT) : merged;
  link.lastSeenTs = Math.max(link.lastSeenTs ?? 0, newestTs);
}
/** Legacy links carry only a timestamp cursor: freeze it as the floor once so history is not replayed. */
function upgradeLegacyCursor(link: BotLink): void {
  if (link.seenMessageKeys !== undefined) return;
  link.seenMessageKeys = [];
  link.mirrorFloorTs = Math.max(link.mirrorFloorTs ?? 0, link.lastSeenTs ?? 0);
}
/** Records the session's current tail (the bot's own prompt/answer) as seen so it is not echoed back later. */
async function absorbSessionTail(link: BotLink, client: BrowseClient): Promise<void> {
  const tail = await client.asideMessages(link.browseId, 0);
  upgradeLegacyCursor(link);
  rememberSeen(link, tail.map(messageKey), tail.reduce((max, m) => Math.max(max, m.timestamp), 0));
}
function clearPending(link: BotLink): void {
  link.pendingKind = null;
  delete link.pendingToolCallId;
  delete link.pendingRequest;
  delete link.pendingDescription;
  delete link.pendingAnswers;
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

/** Aside answers carry inline citation markup (<citation refs="…">text</citation>); the bot chat shows the text only. */
export function stripAsideCitations(text: string): string {
  return text.replace(/<citation\b[^>]*>([\s\S]*?)<\/citation>/g, "$1").replace(/<citation\b[^>]*\/>/g, "").replace(/[ \t]+\n/g, "\n").trim();
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

/** A routine (automation) fires as a HIDDEN turn whose prompt embeds the saved instruction between these two
 * lines (automation.ts buildAutomationWakePrompt). The browser bot runs that instruction as a task in Aside. */
const AUTOMATION_SAVED_HEAD = "What you saved to do each time:";
const AUTOMATION_SAVED_TAIL = "Carry it out now.";
export function parseAutomationWake(prompt: string): string | null {
  const start = prompt.indexOf(AUTOMATION_SAVED_HEAD);
  if (start === -1) return null;
  const rest = prompt.slice(start + AUTOMATION_SAVED_HEAD.length);
  const end = rest.indexOf(AUTOMATION_SAVED_TAIL);
  const body = (end === -1 ? rest : rest.slice(0, end)).trim();
  return body.length > 0 ? body : null;
}

/** Mirrors messages that appeared in the linked Aside session (typed in the fork's own chat UI) into the bot
 * chat. Returns the number of lines shown; advances link.lastSeenTs. */
async function mirrorAsideMessages(agentId: string, link: BotLink, client: BrowseClient, send: (m: Record<string, unknown> & { type: string }) => void, log: (m: string) => void, stillCurrent: () => boolean = () => true): Promise<number> {
  let messages: AsideMessage[];
  try { messages = await client.asideMessages(link.browseId, Math.max(0, (link.lastSeenTs ?? 0) - MIRROR_LOOKBACK_MS)); } catch { return 0; }
  if (!stillCurrent()) return 0;
  upgradeLegacyCursor(link);
  const floor = link.mirrorFloorTs ?? 0;
  let shown = 0;
  for (const m of [...messages].sort((a, b) => a.timestamp - b.timestamp)) {
    const key = messageKey(m);
    if (m.timestamp <= floor || link.seenMessageKeys!.includes(key)) continue;
    const text = m.text.trim();
    if (text.length === 0) { rememberSeen(link, [key], m.timestamp); continue; }
    send({ type: "text", content: m.role === "user" ? `[Aside에서 입력] ${text}` : stripAsideCitations(text) });
    shown += 1;
    rememberSeen(link, [key], m.timestamp);
    // Persist each delivered identity immediately (at-least-once across a crash between send and save; a
    // duplicate is visible and harmless, a lost user message is not). A nudge must not overwrite answers
    // or a selection saved while its fetch was in flight, so merge into the latest stored link.
    const latest = peekLink(agentId);
    if (latest?.browseId === link.browseId) {
      upgradeLegacyCursor(latest);
      latest.mirrorFloorTs = Math.max(latest.mirrorFloorTs ?? 0, floor);
      rememberSeen(latest, link.seenMessageKeys!, link.lastSeenTs ?? 0);
      writeLink(agentId, latest);
    }
  }
  if (shown > 0) log(`[browse-runtime] bot ${agentId}: mirrored ${shown} Aside message(s) from ${link.browseId}`);
  return shown;
}

function suspensionWidget(link: BotLink): Record<string, unknown> & { type: string } {
  const identity = { toolCallId: link.pendingToolCallId ?? "", ...(link.pendingKind === "ask-user-question" ? { questionIndex: link.pendingAnswers?.length ?? 0 } : {}) };
  const answerValue = (answer: string) => encodeAsideSuspensionAnswer(identity, answer);
  if (link.pendingKind === "ask-user-question") {
    const questions = suspensionQuestions(link.pendingRequest);
    const index = link.pendingAnswers?.length ?? 0;
    const q = questions[index];
    const progress = questions.length > 1 ? `[${index + 1}/${questions.length}] ` : "";
    const prompt = `${progress}${q?.header ? `${q.header}: ` : ""}${q?.question || link.pendingDescription || "답변을 입력해주세요."}`;
    const options = q?.options ?? [];
    const help = questions.length > 1 ? questions.map((question, i) => `${i + 1}. ${question.header ? `${question.header}: ` : ""}${question.question}`).join("\n") : "";
    if (options.length === 0) return { type: "text", content: `${prompt}${help ? `\n\n${help}` : ""}\n\n답변을 입력해주세요.` };
    return { type: "widget", widget: { prompt, asideSuspension: identity, allowCustom: true, ...(help || options.length > 6 ? { helpText: [help, options.length > 6 ? `전체 선택지: ${options.join(" / ")}` : ""].filter(Boolean).join("\n\n") } : {}), options: options.slice(0, 6).map((label, i) => ({ label, value: answerValue(label), ...(i === 0 ? { style: "primary" } : {}) })) } };
  }
  const isConfirm = link.pendingKind === "action-confirmation";
  return {
    type: "widget",
    widget: {
      asideSuspension: identity,
      prompt: `${isConfirm ? "진행 확인" : "승인 필요"}: ${link.pendingDescription ?? ""}`.trim(),
      options: [{ label: isConfirm ? "진행" : "허용", value: answerValue(isConfirm ? "confirm" : "allow"), style: "primary" }, { label: isConfirm ? "취소" : "거절", value: answerValue(isConfirm ? "cancel" : "deny"), style: "danger" }],
    },
  };
}

/** Wraps a bot's runner so that its user turns are served by an Aside browse session; everything else delegates. */
export function wrapRunnerForAsideBot<T extends object>(runner: T, agentId: string, deps: WrapDeps): T {
  let generation = 0;
  let activity: readonly string[] = [];
  let toolCalls = 0;
  const send = (message: Record<string, unknown> & { type: string }) => deps.emitUpdate({ type: "send-message", message, timestampMs: Date.now() });
  const result = (text: string, sent: number): SandAgentRunnerResult => ({ text, sentMessageCount: sent, reacted: false, aborted: false, streamOutputProduced: false });

  /** Asks the service to stop the linked session and reports truthfully. Returns true only when the service
   * acknowledged the stop or the session is already terminal/absent; otherwise the durable cancel intent stays
   * (with the attempt count and last error) so the next contact retries. `notify` posts a user-visible notice. */
  const requestStop = async (link: BotLink, reason: string, notify: boolean): Promise<boolean> => {
    const settle = (mutate: (latest: BotLink) => void) => {
      const latest = peekLink(agentId);
      if (latest?.browseId !== link.browseId) return;
      mutate(latest);
      writeLink(agentId, latest);
    };
    const confirm = (how: string) => {
      settle((latest) => { delete latest.cancelRequested; });
      delete link.cancelRequested;
      deps.log(`[browse-runtime] bot ${agentId}: stop of ${link.browseId} confirmed (${how})`);
      return true;
    };
    let failure: unknown;
    try {
      const client = deps.client();
      try {
        await client.stop(link.browseId);
        return confirm("acknowledged");
      } catch (error) {
        if (isBrowseServiceError(error, "SESSION_NOT_FOUND")) return confirm("session absent");
        failure = error;
        try {
          const view = await client.get(link.browseId);
          if (TERMINAL_STATUSES.has(view.status)) return confirm(`already ${view.status}`);
        } catch { /* the stop failure below is the truthful state */ }
      }
    } catch (error) { failure = error; }
    const detail = failure instanceof Error ? failure.message : String(failure);
    const attempts = (link.cancelRequested?.attempts ?? 0) + 1;
    const cancelRequested = { at: link.cancelRequested?.at ?? Date.now(), reason, attempts, lastError: detail };
    link.cancelRequested = cancelRequested;
    settle((latest) => { latest.cancelRequested = cancelRequested; });
    deps.log(`[browse-runtime] bot ${agentId}: STOP_FAILED for ${link.browseId} (attempt ${attempts}): ${detail}`);
    if (notify) send({ type: "text", content: `[브라우저 봇] 중단 요청이 브라우저에 전달되지 않았습니다 (${detail}). 브라우저에서 작업이 계속되고 있을 수 있습니다. 다음 메시지에서 중단을 다시 시도합니다.` });
    return false;
  };

  const run = async (prompt: string, options?: Record<string, unknown>): Promise<SandAgentRunnerResult> => {
    const cardAnswer = options?.hidden === true ? null : decodeAsideSuspensionAnswer(prompt.trim());
    // A concrete selection is intentional UI mirroring. Account-wide recency is never ownership.
    const selection = options?.hidden !== true ? prompt.trim().match(/^\/aside\s+(link\s+([A-Za-z0-9_-]{1,128})|unlink)$/) : null;
    if (selection !== null) {
      const selectionGeneration = ++generation;
      if (selection[1] === "unlink") {
        forgetAsideBotLink(agentId);
        send({ type: "text", content: "Aside 대화 연결을 해제했습니다. 다음 메시지는 새 작업으로 시작합니다." });
        return result("", 1);
      }
      try {
        const id = selection[2]!;
        const view = await deps.client().get(id);
        if (selectionGeneration !== generation) return { text: "", sentMessageCount: 0, reacted: false, aborted: true };
        const link: BotLink = { browseId: id, pendingKind: view.suspension?.kind ?? null, pendingToolCallId: view.suspension?.toolCallId, pendingRequest: view.suspension?.request, pendingDescription: view.suspension?.description, source: "selected", lastSeenTs: 0, mirrorFloorTs: 0, seenMessageKeys: [] };
        writeLink(agentId, link);
        send({ type: "text", content: `Aside 대화 ${id}에 연결했습니다.` });
        const shown = await mirrorAsideMessages(agentId, link, deps.client(), send, deps.log, () => selectionGeneration === generation);
        if (selectionGeneration !== generation) return { text: "", sentMessageCount: 1 + shown, reacted: false, aborted: true };
        if (link.pendingKind !== null) send(suspensionWidget(link));
        return { ...result("", 1 + shown + (link.pendingKind === null ? 0 : 1)), ...(link.pendingKind === null ? {} : { awaitingUserSelection: true }) };
      } catch (error) {
        send({ type: "text", content: `[브라우저 봇 오류] ${error instanceof Error ? error.message : String(error)}` });
        return result("", 1);
      }
    }
    if (options?.hidden === true && options.upgradeResume === true) {
      // Generic hidden nudges only mirror native messages. They cannot prove
      // that an interrupted native task resumed, so keep the durable intent.
      send({ type: "text", content: "업데이트 전 Aside 작업을 자동으로 다시 시작하지 못했습니다. 브라우저의 작업 상태를 확인한 뒤 이 대화에 이어서 할 일을 알려 주세요." });
      return { text: "", sentMessageCount: 1, reacted: false, aborted: true };
    }
    const wakeInfo = options?.hidden === true ? (options as { automationWake?: { id?: string; name?: string } }).automationWake : undefined;
    const routineTask = wakeInfo === undefined ? null : parseAutomationWake(prompt);
    const inbound = options?.hidden === true && routineTask === null ? parseInboundAgentWake(prompt) : null;
    if (options?.hidden === true && inbound === null && routineTask === null) {
      // Nudges: nothing owed, but use them to surface what the user typed in the Aside browser meanwhile.
      let existing: BotLink | null;
      try { existing = readLink(agentId); } catch (error) {
        deps.log(`[browse-runtime] bot ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
        return { text: "", sentMessageCount: 0, reacted: true, aborted: false };
      }
      // A stop the service never acknowledged is retried quietly on every contact.
      if (existing?.cancelRequested !== undefined) await requestStop(existing, existing.cancelRequested.reason, false);
      const shown = existing === null ? 0 : await mirrorAsideMessages(agentId, existing, deps.client(), send, deps.log, () => peekLink(agentId)?.browseId === existing.browseId);
      return { text: "", sentMessageCount: shown, reacted: true, aborted: false };
    }
    const text = routineTask ?? (inbound === null ? cardAnswer?.answer ?? prompt.trim() : inbound.text);
    if (text.length === 0) return result("", 0);
    if (routineTask !== null) {
      deps.log(`[browse-runtime] bot ${agentId}: routine "${wakeInfo?.name ?? ""}" runs as an Aside task`);
      send({ type: "text", content: `[루틴 "${wakeInfo?.name ?? ""}" 실행] ${routineTask}` });
    }
    const replyToSender = async (message: string) => {
      if (inbound === null || deps.sendToAgent === undefined) return;
      try { await deps.sendToAgent(inbound.fromId, message); } catch (error) { deps.log(`[browse-runtime] bot ${agentId}: reply to ${inbound.fromName} failed: ${error instanceof Error ? error.message : String(error)}`); }
    };
    if (inbound !== null) deps.log(`[browse-runtime] bot ${agentId}: inbound task from ${inbound.fromName}`);
    const runGeneration = ++generation;
    const client = deps.client();
    let link: BotLink | null;
    try { link = readLink(agentId); } catch (error) {
      if (!(error instanceof AsideLinkCorruptError)) throw error;
      // Explicit recovery state: the user decides between reconnecting and starting fresh; nothing is started.
      send({ type: "text", content: `[브라우저 봇] 저장된 Aside 연결 정보를 읽을 수 없어 ${error.quarantinedPath}(으)로 옮겨 두었습니다. 새 작업을 시작하지 않았습니다. 이전 대화에 다시 연결하려면 /aside link <세션 ID>, 새로 시작하려면 /aside unlink 를 보내 주세요.` });
      await replyToSender("[error] 브라우저 봇의 저장된 연결 정보가 손상되어 작업을 시작하지 않았습니다.");
      return { ...result("", 1), awaitingUserSelection: true };
    }
    if (link?.cancelRequested !== undefined) {
      // A prior stop the service never confirmed blocks new work on that session until it is confirmed.
      const confirmed = await requestStop(link, link.cancelRequested.reason, false);
      if (runGeneration !== generation) return { text: "", sentMessageCount: 0, reacted: false, aborted: true };
      if (!confirmed) {
        const latest = peekLink(agentId);
        const message = `[브라우저 봇] 이전 중단 요청이 아직 브라우저에 전달되지 않았습니다 (${latest?.cancelRequested?.lastError ?? "unknown error"}). 브라우저에서 작업이 계속되고 있을 수 있어 새 작업을 시작하지 않았습니다. 같은 메시지를 다시 보내면 중단을 재시도하고, 연결을 끊으려면 /aside unlink 를 보내 주세요.`;
        send({ type: "text", content: message });
        await replyToSender(message);
        return { ...result("", 1), awaitingUserSelection: true };
      }
      link = peekLink(agentId) ?? link;
    }
    let mirrored = 0;
    if (link !== null) mirrored = await mirrorAsideMessages(agentId, link, client, send, deps.log, () => runGeneration === generation);
    if (runGeneration !== generation) return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
    let freshTask = false, retried = false;
    try {
      if (cardAnswer !== null && (link === null || link.pendingKind === null)) throw new Error("This Aside question is no longer pending. Its answer was not submitted as a new task.");
      if (link !== null && link.pendingKind !== null) {
        // Automation wakes and other bots are tasks, not human answers to this bot's pending card.
        if (options?.hidden === true) {
          const message = "[브라우저 봇] 사용자 답변을 기다리고 있어 자동 작업을 시작하지 않았습니다.";
          send({ type: "text", content: message });
          await replyToSender(message);
          return { ...result("", 1), awaitingUserSelection: true };
        }
        const pending = await client.get(link.browseId);
        if (runGeneration !== generation) return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
        if (pending.status !== "suspended" || pending.suspension === null) {
          clearPending(link);
          writeLink(agentId, link);
          throw new Error("The browser session no longer has this pending question. Your answer was not submitted as a new task.");
        }
        if (!pending.suspension.toolCallId) throw new Error("The Aside service did not provide an exact question identity. The answer was not submitted.");
        if (link.pendingToolCallId !== pending.suspension.toolCallId || link.pendingKind !== pending.suspension.kind || (link.pendingRequest !== undefined && JSON.stringify(link.pendingRequest) !== JSON.stringify(pending.suspension.request))) {
          link.pendingKind = pending.suspension.kind;
          link.pendingToolCallId = pending.suspension.toolCallId;
          link.pendingRequest = pending.suspension.request;
          link.pendingDescription = pending.suspension.description;
          link.pendingAnswers = [];
          writeLink(agentId, link);
          send({ type: "text", content: "Aside의 질문이 변경되어 최신 질문을 표시합니다." });
          send(suspensionWidget(link));
          return { ...result("", 2 + mirrored), awaitingUserSelection: true };
        }
        if ((cardAnswer !== null && cardAnswer.toolCallId !== link.pendingToolCallId) || (cardAnswer?.questionIndex !== undefined && cardAnswer.questionIndex !== (link.pendingAnswers?.length ?? 0))) {
          send(suspensionWidget(link));
          return { ...result("", 1 + mirrored), awaitingUserSelection: true };
        }
        link.pendingKind = pending.suspension.kind;
        link.pendingRequest = pending.suspension.request;
        link.pendingDescription = pending.suspension.description;
        let response: unknown;
        const questions = suspensionQuestions(link.pendingRequest);
        if (link.pendingKind === "ask-user-question" && questions.length > 1) {
          const index = link.pendingAnswers?.length ?? 0;
          const question = questions[index];
          if (question === undefined) throw new Error("The question set changed; select the Aside session again before answering.");
          const parsed = parseSuspensionAnswer(link.pendingKind, text, { questions: [question] }) as { answers: BrowseQuestionAnswer[] };
          const answers = [...(link.pendingAnswers ?? []), ...parsed.answers];
          if (answers.length < questions.length) {
            link.pendingAnswers = answers;
            writeLink(agentId, link);
            send(suspensionWidget(link));
            return { ...result("", 1 + mirrored), awaitingUserSelection: true };
          }
          response = { answers };
        } else response = parseSuspensionAnswer(link.pendingKind, text, link.pendingRequest);
        await client.answer(link.browseId, response, link.pendingToolCallId!);
        if (runGeneration !== generation) return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
        clearPending(link);
        writeLink(agentId, link);
        deps.log(`[browse-runtime] bot ${agentId}: answered suspension on ${link.browseId}`);
      } else if (link !== null) {
        await sendBrowseFollowUp(client, link.browseId, text);
        if (runGeneration !== generation) return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
        link.lastSeenTs = Math.max(link.lastSeenTs ?? 0, Date.now()); writeLink(agentId, link);
        deps.log(`[browse-runtime] bot ${agentId}: sent follow-up to ${link.browseId}`);
      } else {
        const created = await client.create({ task: text });
        if (runGeneration !== generation) {
          await client.stop(created.id);
          return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
        }
        link = { browseId: created.id, pendingKind: null, source: "created", lastSeenTs: Date.now(), mirrorFloorTs: Date.now(), seenMessageKeys: [] }; writeLink(agentId, link); freshTask = true;
        deps.log(`[browse-runtime] bot ${agentId}: started ${created.id}`);
      }
    } catch (error) {
      if (runGeneration !== generation) return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
      const detail = error instanceof Error ? error.message : String(error);
      try {
        // A transient/conflict error does not prove absence. An approval answer must never become a task.
        if (link === null || link.pendingKind !== null || !isBrowseServiceError(error, "SESSION_NOT_FOUND")) throw error;
        deps.log(`[browse-runtime] bot ${agentId}: ${link.browseId} missing (${detail}); starting a fresh session`);
        const created = await client.create({ task: text });
        if (runGeneration !== generation) {
          await client.stop(created.id);
          return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
        }
        link = { browseId: created.id, pendingKind: null, source: "created", lastSeenTs: Date.now(), mirrorFloorTs: Date.now(), seenMessageKeys: [] }; writeLink(agentId, link); freshTask = true;
      } catch (fresh) {
        if ((isBrowseServiceError(fresh, "SESSION_SUSPENDED") || isBrowseServiceError(fresh, "STALE_SUSPENSION")) && link !== null) {
          // A question may have appeared after the last poll or in the deliberately linked Aside UI.
          try {
            const view = await client.get(link.browseId);
            if (runGeneration !== generation) return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
            if (view.status === "suspended") {
              link.pendingKind = view.suspension?.kind ?? "approval";
              link.pendingToolCallId = view.suspension?.toolCallId;
              link.pendingRequest = view.suspension?.request;
              link.pendingDescription = view.suspension?.description;
              link.pendingAnswers = [];
              writeLink(agentId, link);
              send(suspensionWidget(link));
              await replyToSender("[waiting] 사용자 답변을 기다리고 있습니다.");
              return { ...result("", 1 + mirrored), awaitingUserSelection: true };
            }
          } catch { /* Report the original conflict while preserving the link. */ }
        }
        const message = `[브라우저 봇 오류] ${fresh instanceof Error ? fresh.message : String(fresh)}`;
        send({ type: "text", content: message });
        await replyToSender(message);
        return result("", 1);
      }
    }
    for (;;) {
      if (runGeneration !== generation) return { text: "", sentMessageCount: 0, reacted: false, aborted: true };
      const view = await client.get(link.browseId);
      if (runGeneration !== generation) return { text: "", sentMessageCount: 0, reacted: false, aborted: true };
      activity = view.activity; toolCalls = view.toolCalls;
      if (view.status === "suspended") {
        link.pendingKind = view.suspension?.kind ?? "approval";
        link.pendingToolCallId = view.suspension?.toolCallId;
        link.pendingRequest = view.suspension?.request;
        link.pendingDescription = view.suspension?.description;
        link.pendingAnswers = [];
        // Move the mirror cursor past our own prompt (stored in the Aside chat by now) so the answer turn does
        // not echo it back as "[Aside에서 입력] …".
        try { await absorbSessionTail(link, client); } catch { /* keep the cursor */ }
        if (runGeneration !== generation) return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
        writeLink(agentId, link);
        send(suspensionWidget(link));
        await replyToSender(`[waiting] 사용자 확인이 필요해서 제 대화창에 카드로 물어봤습니다: ${view.suspension?.description ?? view.suspension?.kind ?? ""}`);
        return { ...result("", 1), awaitingUserSelection: true };
      }
      if (view.status === "done") {
        const answer = view.result === null || view.result === undefined ? "(작업이 끝났지만 답 문장이 없습니다)" : stripAsideCitations(view.result);
        send({ type: "text", content: answer });
        await replyToSender(answer);
        // Keep the mirror cursor past this turn so the bot's own exchange is not echoed back later.
        try { const absorbed = { ...link }; await absorbSessionTail(absorbed, client); if (runGeneration === generation) { link = absorbed; writeLink(agentId, link); } } catch { /* mirror cursor is best effort */ }
        return result(view.result ?? "", 1 + mirrored);
      }
      if (view.status === "error") {
        const safeModelFallback = view.errorCode === "MODEL_UNAVAILABLE"
          && view.executionStarted === false
          && view.toolCalls === 0
          && view.modelCalls === 0;
        if (freshTask && !retried && FALLBACK_MODEL !== "off" && safeModelFallback) {
          retried = true;
          deps.log(`[browse-runtime] bot ${agentId}: ${link.browseId} failed (${view.error ?? "unknown"}); retrying with ${FALLBACK_MODEL}/${FALLBACK_THINKING}`);
          try {
            const created = await client.create({ task: text, model: FALLBACK_MODEL, thinking: FALLBACK_THINKING });
            if (runGeneration !== generation) {
              await client.stop(created.id);
              return { text: "", sentMessageCount: mirrored, reacted: false, aborted: true };
            }
            link = { browseId: created.id, pendingKind: null, source: "created", lastSeenTs: Date.now(), mirrorFloorTs: Date.now(), seenMessageKeys: [] }; writeLink(agentId, link);
            send({ type: "text", content: `[브라우저 봇] 기본 모델이 실패해서 ${FALLBACK_MODEL}(으)로 다시 시도합니다. (${view.error ?? "unknown error"})` });
            continue;
          } catch (error) { deps.log(`[browse-runtime] bot ${agentId}: fallback start failed: ${error instanceof Error ? error.message : String(error)}`); }
        }
        const message = `[브라우저 봇 오류] ${view.error ?? "unknown error"}\n기존 작업을 유지했습니다. 계속할 내용을 알려주세요.`;
        send({ type: "text", content: message });
        await replyToSender(message);
        return result("", 1);
      }
      if (view.status === "stopped" || view.status === "interrupted") return { text: "", sentMessageCount: 0, reacted: false, aborted: true };
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  };
  const overrides: Partial<RunnerLike> & { wouldRecoverViaPrepend: undefined } = {
    run,
    interrupt: (reason: string) => {
      generation += 1;
      let link: BotLink | null;
      try { link = readLink(agentId); } catch (error) {
        deps.log(`[browse-runtime] bot ${agentId}: interrupted (${reason}) but the link is unreadable: ${error instanceof Error ? error.message : String(error)}`);
        return true;
      }
      // Belmont interrupts the previous turn whenever a new user message arrives ("superseded by a
      // new user message"), including the answer to our own approval/question card. That must not
      // kill the Aside session: the answer resumes it. Only other interrupts (user stop, cancel) do.
      const superseded = /superseded/i.test(reason);
      if (link !== null && !superseded) {
        // The cancel intent is durable before the remote stop is attempted: a lost acknowledgement or a
        // dead service leaves it in place, and every later contact retries until the service confirms.
        link.cancelRequested = { at: Date.now(), reason, attempts: 0 };
        clearPending(link);
        writeLink(agentId, link);
        void requestStop(link, reason, true);
      }
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
