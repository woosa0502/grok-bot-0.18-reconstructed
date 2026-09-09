import { createHash } from "node:crypto";

export const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
export const sha256Value = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const matchesTextHash = (value, expected) => typeof value === "string" && sha256Value(expected) && hash(value) === expected;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const inWindow = (value, start, end) => Number.isFinite(value) && value >= start && value <= end;
const result = (issues) => ({ valid: issues.length === 0, issues });

export function validateRunWindow(run) {
  const issues = [];
  if (!object(run) || run.schemaVersion !== 2 || run.accepted !== true) issues.push("accepted-v2-run-required");
  if (!nonempty(run?.agent) || !nonempty(run?.clientNonce) || !sha256Value(run?.taskSha256)) issues.push("missing-run-identity");
  if (object(run)) {
    if (Object.hasOwn(run, "task") && !matchesTextHash(run.task, run.taskSha256)) issues.push("task-text-hash-mismatch");
    if (Object.hasOwn(run, "final") && !matchesTextHash(run.final, run.finalSha256)) issues.push("final-text-hash-mismatch");
  }
  if (!Number.isFinite(run?.startedAtEpochMs) || !Number.isFinite(run?.endedAtEpochMs)
      || run.startedAtEpochMs <= 0 || run.endedAtEpochMs <= run.startedAtEpochMs) issues.push("invalid-run-window");
  return result(issues);
}

export function validateSelectedFingerprint(value) {
  const issues = [];
  if (!object(value) || value.schemaVersion !== 1 || value.scope !== "selected-files-and-driver-environment") return result(["unsupported-fingerprint-contract"]);
  for (const field of ["code", "build"]) {
    const entries = value[field];
    if (!Array.isArray(entries) || entries.some((entry) => !object(entry) || !nonempty(entry.path) || !sha256Value(entry.sha256))
        || new Set(entries.map((entry) => entry?.path)).size !== entries.length) issues.push(`malformed-selected-${field}-hashes`);
  }
  const environment = value.driverEnvironment;
  if (!object(environment) || !nonempty(environment.node) || !nonempty(environment.platform) || !nonempty(environment.arch)
      || value.driverEnvironmentSha256 !== hash(JSON.stringify([environment?.node, environment?.platform, environment?.arch]))) {
    issues.push("malformed-driver-environment-hash");
  }
  if (value.declaredModelLabel !== null && !nonempty(value.declaredModelLabel)) issues.push("invalid-declared-model-label");
  // This implementation has no runtime/process/model attestation reader. Arbitrary
  // selected files (including README.md) cannot become verified executed artifacts.
  if (value.runtimeIdentity?.status !== "UNVERIFIED") issues.push("unsupported-runtime-identity-claim");
  return result(issues);
}

export function validateProvenance(value) {
  if (!object(value) || value.schemaVersion !== 1 || value.scope !== "selected-file-hashes-only") {
    return { ...result(["unsupported-provenance-contract"]), runtimeIdentityVerified: false };
  }
  const before = validateSelectedFingerprint(value.before), after = validateSelectedFingerprint(value.after);
  const issues = [...before.issues, ...after.issues];
  return {
    ...result(issues), runtimeIdentityVerified: false,
    selectedFilesUnchanged: issues.length === 0 && JSON.stringify([value.before.code, value.before.build]) === JSON.stringify([value.after.code, value.after.build]),
    declaredEnvironmentUnchanged: issues.length === 0 && value.before.driverEnvironmentSha256 === value.after.driverEnvironmentSha256
      && value.before.declaredModelLabel === value.after.declaredModelLabel,
  };
}

export function validateRunRecord(run) {
  const issues = [...validateRunWindow(run).issues];
  if (!object(run)) return result(issues);
  const provenance = validateProvenance(run.provenance);
  issues.push(...provenance.issues);
  if (!Array.isArray(run.gaps) || run.gaps.some((gap) => !nonempty(gap))) issues.push("invalid-gap-record");
  const timing = run.timing;
  if (!object(timing) || timing.unit !== "milliseconds" || !Number.isFinite(timing.driverExitMs) || timing.driverExitMs <= 0
      || Math.abs(run.endedAtEpochMs - run.startedAtEpochMs - timing.driverExitMs) > 5) {
    issues.push("invalid-driver-timing");
  }
  const duration = timing?.driverExitMs;
  const events = run.events;
  if (!Array.isArray(events) || events.some((event, index) => !object(event) || !inWindow(event.atMs, 0, duration)
      || index > 0 && event.atMs < events[index - 1].atMs)) {
    issues.push("invalid-event-window");
  }
  const admissions = Array.isArray(events) ? events.filter((event) => object(event) && event.kind === "prompt-accepted"
    && event.agent === run.agent && event.clientNonce === run.clientNonce && event.taskSha256 === run.taskSha256) : [];
  if (admissions.length !== 1) issues.push("matching-acceptance-observation-required");
  const states = run.taskStates;
  if (!Array.isArray(states) || states.some((state, index) => !object(state) || !inWindow(state.observedAtMs, 0, duration)
      || index > 0 && state.observedAtMs < states[index - 1].observedAtMs)) issues.push("invalid-task-state-window");
  if (!["COMPLETED", "QUIET", "TIMEOUT", "ERROR", "FAILED", "STOPPED"].includes(run.execution?.status)) issues.push("invalid-execution-status");
  if (["COMPLETED", "QUIET"].includes(run.execution?.status)) {
    if (!inWindow(timing?.firstAnswerMs, 0, duration) || !inWindow(timing?.lastAnswerMs, timing?.firstAnswerMs, duration)
        || !inWindow(timing?.quietObservedMs, timing?.lastAnswerMs, duration)) issues.push("invalid-answer-or-quiet-window");
    const answers = Array.isArray(events) ? events.filter((event) => object(event) && event.kind === "assistant-text" && nonempty(event.entryId) && sha256Value(event.sha256)) : [];
    if (!answers.length || Math.abs(answers[0].atMs - timing?.firstAnswerMs) > 5
        || Math.abs(answers.at(-1).atMs - timing?.lastAnswerMs) > 5
        || run.finalSha256 !== answers.at(-1)?.sha256 || admissions[0]?.atMs > timing?.firstAnswerMs) issues.push("answer-observations-do-not-match-timing");
    if (run.lastHealth?.ok !== true || run.lastHealth?.isBusy !== false || !inWindow(run.lastHealth?.observedAtMs, timing?.lastAnswerMs, duration)) issues.push("final-idle-observation-required");
  }
  if (run.execution?.status === "COMPLETED") {
    if (!nonempty(run.taskId)) issues.push("completed-task-identity-required");
    const matching = Array.isArray(states) ? states.filter((state) => object(state) && state.taskId === run.taskId && state.agent === run.agent
      && state.clientNonce === run.clientNonce && nonempty(state.taskId) && nonempty(state.agent) && nonempty(state.clientNonce)) : [];
    const terminal = matching.at(-1);
    if (terminal?.status !== "done" || !inWindow(timing?.terminalObservedMs, admissions[0]?.atMs, timing?.quietObservedMs)
        || Math.abs(terminal.observedAtMs - timing.terminalObservedMs) > 5) issues.push("matching-terminal-observation-required");
    if (!Object.hasOwn(run, "initialTaskState") || run.initialTaskState !== null && (!object(run.initialTaskState)
      || !nonempty(run.initialTaskState.taskId) || !Number.isFinite(run.initialTaskState.observedAtMs)
      || run.initialTaskState.observedAtMs > 0 || !["queued", "running", "suspended", "done", "error", "stopped", "interrupted"].includes(run.initialTaskState.status))) {
      issues.push("baseline-task-observation-required");
    }
    const alreadyDone = run.initialTaskState?.taskId === run.taskId && run.initialTaskState?.status === "done";
    if (alreadyDone && !matching.some((state) => ["queued", "running", "suspended"].includes(state.status)
      && state.observedAtMs >= admissions[0]?.atMs && state.observedAtMs < terminal?.observedAtMs)) issues.push("stale-terminal-observation");
  }
  return { ...result(issues), provenance };
}
