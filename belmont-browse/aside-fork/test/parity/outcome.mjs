// Pure grading: observation, lifecycle, and correctness are deliberately separate.
import { nonempty, validateRunRecord } from "./evidence-contract.mjs";
export function transcriptMessage(entry) {
  // createSendMessageEntry is the local bot-output contract. Shared-room messages can
  // use the same kind with an explicit remote author; those are not this bot's answer.
  const localOutput = entry.kind === "send-message" && entry.author == null && entry.fromUser == null;
  const role = localOutput ? "assistant" : entry.role ?? "unknown";
  const message = entry.message ?? (typeof entry.content === "string" ? { type: "text", content: entry.content } : {});
  return { role, message };
}

export function verdictFor(run, verification) {
  const execution = run.execution;
  if (["TIMEOUT", "ERROR", "FAILED", "STOPPED"].includes(execution.status)) return execution.status;
  const contract = validateRunRecord(run);
  if (!contract.valid) return "UNVERIFIED";
  if (verification.status === "FAIL") return "FAIL";
  if (verification.status === "ERROR") return "ERROR";
  return execution.status === "COMPLETED" && verification.status === "PASS"
    && contract.provenance.runtimeIdentityVerified === true && contract.provenance.selectedFilesUnchanged
    && contract.provenance.declaredEnvironmentUnchanged && run.gaps.length === 0
    ? "PASS" : "UNVERIFIED";
}

export function timingSummary(start, end, firstAnswer, lastAnswer, terminal, quiet) {
  const elapsed = (value) => value === null ? null : value - start;
  return {
    unit: "milliseconds", basis: "prompt dispatch to driver observation on monotonic clock; baseline collection excluded",
    firstAnswerMs: elapsed(firstAnswer), lastAnswerMs: elapsed(lastAnswer),
    terminalObservedMs: elapsed(terminal), quietObservedMs: elapsed(quiet),
    driverExitMs: end - start,
  };
}

export function summarizeTaskState(value, nonce, observedAtMs, agent) {
  if (value == null) return null;
  const statuses = new Set(["queued", "running", "suspended", "done", "error", "stopped", "interrupted"]);
  return {
    observedAtMs, taskId: typeof value.taskId === "string" ? value.taskId : null,
    clientNonce: nonempty(value.clientNonce) ? value.clientNonce : null,
    agent: nonempty(value.agent) ? value.agent : null,
    status: statuses.has(value.status) ? value.status : "unknown",
    source: value.source === "aside-session-get" ? "aside-session-get" : "injected-or-observer-task-state",
    // A global idle flag or somebody else's session cannot prove this task ended.
    bound: nonempty(nonce) && nonempty(agent) && nonempty(value.taskId) && value.clientNonce === nonce && value.agent === agent,
  };
}
