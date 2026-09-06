export interface BrowseQuestion {
  readonly header: string;
  readonly question: string;
  readonly options: readonly string[];
}

export interface BrowseQuestionAnswer {
  readonly header: string;
  readonly answer: string;
}

export interface AsideSuspensionIdentity {
  readonly toolCallId: string;
  readonly questionIndex?: number;
}

const ASIDE_ANSWER_PREFIX = "[aside-answer]";

/** Carries the identity of the displayed card, including when an older card is clicked later. */
export function encodeAsideSuspensionAnswer(identity: AsideSuspensionIdentity, answer: string): string {
  return `${ASIDE_ANSWER_PREFIX}${JSON.stringify({ ...identity, answer })}`;
}

export function decodeAsideSuspensionAnswer(text: string): (AsideSuspensionIdentity & { readonly answer: string }) | null {
  if (!text.startsWith(ASIDE_ANSWER_PREFIX)) return null;
  const value = JSON.parse(text.slice(ASIDE_ANSWER_PREFIX.length)) as Record<string, unknown>;
  if (typeof value.toolCallId !== "string" || value.toolCallId.length === 0 || typeof value.answer !== "string" || (value.questionIndex !== undefined && (!Number.isInteger(value.questionIndex) || (value.questionIndex as number) < 0))) throw new Error("Invalid Aside question response identity.");
  return { toolCallId: value.toolCallId, answer: value.answer, ...(typeof value.questionIndex === "number" ? { questionIndex: value.questionIndex } : {}) };
}

const BOUNDARY_RE = /<subagent-boundary>[\s\S]*?<\/subagent-boundary>\s*/;
// JavaScript \b only recognizes ASCII word characters; Korean labels need Unicode boundaries.
const ALLOW_RE = /^(?:allow|approve|yes|ok|y|허용|승인|응|네)(?=$|[^\p{L}\p{N}_])/u;
const CONFIRM_RE = /^(?:confirm|yes|ok|y|확인|진행|응|네)(?=$|[^\p{L}\p{N}_])/u;

export function suspensionQuestions(request: unknown): BrowseQuestion[] {
  if (request === null || typeof request !== "object") return [];
  const raw = (request as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return [];
  return raw.map((value): BrowseQuestion => {
    const q = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      header: typeof q.header === "string" ? q.header : "",
      question: typeof q.question === "string" ? q.question : "",
      options: Array.isArray(q.options) ? q.options.map((option) => typeof option === "string" ? option : typeof option?.label === "string" ? option.label as string : "").filter(Boolean) : [],
    };
  });
}

function structuredAnswers(text: string): BrowseQuestionAnswer[] | null {
  if (!text.startsWith("{")) return null;
  try {
    const raw = (JSON.parse(text) as { answers?: unknown }).answers;
    if (!Array.isArray(raw)) return null;
    if (!raw.every((a) => a !== null && typeof a === "object" && typeof a.header === "string" && typeof a.answer === "string")) throw new Error("Every question answer must include a string header and answer.");
    return raw as BrowseQuestionAnswer[];
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Keep every original question header; never repeat one answer across unrelated questions. */
export function parseSuspensionAnswer(kind: string, prompt: string, request?: unknown): unknown {
  const text = prompt.replace(BOUNDARY_RE, "").trim();
  const word = text.toLowerCase();
  if (kind === "approval") return { verdict: ALLOW_RE.test(word) ? "allow" : "deny", always: /(?:^|[^\p{L}\p{N}_])(?:always|항상)(?=$|[^\p{L}\p{N}_])/u.test(word) };
  if (kind === "action-confirmation") return { verdict: CONFIRM_RE.test(word) ? "confirm" : "cancel", ...(text.length > 0 ? { instruction: text } : {}) };
  const questions = suspensionQuestions(request);
  let answers = structuredAnswers(text);
  if (answers === null && questions.length > 1) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    answers = questions.map((q) => {
      const prefix = `${q.header}:`;
      const matches = lines.filter((line) => q.header.length > 0 && line.startsWith(prefix));
      if (matches.length !== 1) throw new Error(`Answer every question using its header (missing or duplicate: ${q.header || "unnamed question"}), or provide {"answers":[{"header":"...","answer":"..."}]}.`);
      return { header: q.header, answer: matches[0]!.slice(prefix.length).trim() };
    });
    if (lines.length !== questions.length) throw new Error("Provide exactly one answer for each question header.");
  }
  answers ??= [{ header: questions[0]?.header ?? "", answer: text }];
  if (questions.length > 0 && (answers.length !== questions.length || answers.some((answer, index) => answer.header !== questions[index]!.header))) {
    throw new Error("Question answers must include every original header in question order.");
  }
  if (answers.length === 0 || answers.some((answer) => answer.answer.trim().length === 0)) throw new Error("Question answers must not be empty.");
  return { answers };
}
