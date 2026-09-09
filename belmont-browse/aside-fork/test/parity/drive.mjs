// Explicitly target a task-owned gateway. Importing this module performs no I/O.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, createReadStream, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { timingSummary, summarizeTaskState, transcriptMessage, verdictFor } from "./outcome.mjs";
import { evaluateFixture, FIXTURE_SCENARIOS } from "./fixture-oracles.mjs";
import { createAsideStateReader } from "./task-state.mjs";
import { nonempty, validateRunRecord, validateProvenance } from "./evidence-contract.mjs";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
const defaultClock = { now: () => performance.now(), epoch: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
const noOracle = () => ({ status: "UNVERIFIED", reason: "No independent result oracle supplied", checks: [] });

export async function runParity({ agent, task, api, health, clock = defaultClock, readTaskState,
  oracle = noOracle, fingerprint = createFingerprint({}), clientNonce = randomUUID(),
  answer = "none", quietMs = 45_000, maxMs = 900_000, pollMs = 2_000, includeContent = false,
  output = () => {}, reference = null }) {
  if (!nonempty(agent) || !nonempty(task) || !nonempty(clientNonce) || typeof api !== "function" || typeof health !== "function") throw new Error("Agent, task, nonce and gateway functions required");
  for (const value of [quietMs, maxMs, pollMs]) if (!Number.isFinite(value) || value <= 0) throw new Error("Timing options must be positive finite numbers");
  const before = await fingerprint();
  let start = clock.now(), startedAtEpochMs = clock.epoch();
  let firstAnswer = null, lastAnswer = null, lastActivity = start, terminalAt = null, quietAt = null;
  let finalText = null, execution = { status: "TIMEOUT", reason: "Observation deadline reached; task was not stopped" };
  let accepted = false, assistantTexts = 0, textRevisions = 0, widgets = 0;
  const observed = new Map(), answeredWidgets = new Set(), pendingWidgets = new Set();
  const observedExternalResponses = new Set();
  const events = [], states = [], gaps = [], interventions = [];
  let lastHealth = null, failure = null, initialState = null, observedActive = false, boundTaskId = null, latestBoundStatus = null;
  const event = (kind, data = {}) => {
    const entry = { atMs: clock.now() - start, kind, ...data };
    events.push(entry); output(entry);
  };
  const tailEntries = (tail) => {
    if (!Array.isArray(tail?.entries)) throw new Error("Malformed transcript response");
    return tail.entries;
  };
  const entryHash = (entry) => digest(JSON.stringify({ ...transcriptMessage(entry),
    respondedValue: entry.respondedValue, widgetDismissed: entry.widgetDismissed, widgetSkipped: entry.widgetSkipped }));
  try {
    const baseline = tailEntries(await api("getAgentTranscriptTail", { id: agent, limit: 200 }));
    for (const entry of baseline) observed.set(entry.id, entryHash(entry));
    if (readTaskState) initialState = summarizeTaskState(await readTaskState({ clientNonce, task, agent }), clientNonce, clock.now() - start, agent);
    // Exclude baseline collection from prompt-to-answer timing.
    start = clock.now(); startedAtEpochMs = clock.epoch(); lastActivity = start;
    if (initialState) initialState.observedAtMs = 0;
    const reply = await api("sendPrompt", { agentId: agent, prompt: task, clientNonce });
    if (reply?.accepted !== true) throw new Error("Prompt was not accepted");
    accepted = true; event("prompt-accepted", { clientNonce, agent, taskSha256: digest(task) });
    while (clock.now() - start < maxMs) {
      await clock.sleep(Math.min(pollMs, maxMs - (clock.now() - start)));
      const entries = tailEntries(await api("getAgentTranscriptTail", { id: agent, limit: 200 }));
      if (entries.length >= 200 && !entries.some((entry) => observed.has(entry.id))) {
        if (!gaps.includes("transcript-tail-overflow")) gaps.push("transcript-tail-overflow");
      }
      for (const entry of entries) {
        if (typeof entry.id !== "string") throw new Error("Transcript entry lacks identity");
        const { role, message } = transcriptMessage(entry), hash = entryHash(entry);
        if (observed.get(entry.id) === hash) continue;
        const revision = observed.has(entry.id);
        observed.set(entry.id, hash); lastActivity = clock.now();
        // User echoes and system notices are not answers. Preserve unknown-role gaps.
        if (message.type === "text" && role === "assistant" && typeof message.content === "string" && message.content.trim()) {
          if (revision) textRevisions += 1; else assistantTexts += 1;
          finalText = message.content; firstAnswer ??= clock.now(); lastAnswer = clock.now();
          event("assistant-text", { entryId: entry.id, sha256: digest(message.content), revision,
            ...(includeContent ? { content: message.content } : {}) });
        } else if (message.type === "text" && role === "unknown") {
          if (!gaps.includes("text-without-author-role")) gaps.push("text-without-author-role");
        } else if (message.type === "widget" && role === "assistant") {
          if (!revision) widgets += 1;
          if (entry.respondedValue != null || entry.widgetDismissed === true || entry.widgetSkipped === true) {
            pendingWidgets.delete(entry.id);
            if (!answeredWidgets.has(entry.id) && !observedExternalResponses.has(entry.id)) {
              observedExternalResponses.add(entry.id);
              interventions.push({ entryId: entry.id, atMs: clock.now() - start, type: "external-widget-response-or-dismissal", status: "observed" });
            }
            continue;
          }
          if (!answeredWidgets.has(entry.id)) pendingWidgets.add(entry.id);
          event("widget", { entryId: entry.id });
          if (answer !== "none" && !answeredWidgets.has(entry.id)) {
            const options = Array.isArray(message.widget?.options) ? message.widget.options : [];
            const selected = options.find((option) => option.label === answer || option.value === answer);
            if (!selected || typeof selected.value !== "string") {
              event("widget-unanswered", { entryId: entry.id, reason: "Configured answer did not match an offered option" });
              continue;
            }
            const intervention = { entryId: entry.id, atMs: clock.now() - start, type: "automatic-widget-response",
              valueSha256: digest(selected.value), status: "attempted" };
            interventions.push(intervention);
            const response = await api("respondToWidget", { entryId: entry.id, value: selected.value, agentId: agent });
            if (response?.accepted !== true) { intervention.status = "rejected"; throw new Error("Widget response was not accepted"); }
            intervention.status = "sent"; answeredWidgets.add(entry.id); pendingWidgets.delete(entry.id);
            event("widget-response", { entryId: entry.id });
          }
        }
      }
      const h = await health();
      if (h?.ok !== true || typeof h.isBusy !== "boolean") throw new Error("Health unavailable or malformed; idle cannot be inferred");
      lastHealth = { ok: true, isBusy: h.isBusy, activeAgentMatches: h.activeAgentId === agent, observedAtMs: clock.now() - start };
      if (readTaskState) {
        const state = summarizeTaskState(await readTaskState({ clientNonce, task, agent }), clientNonce, clock.now() - start, agent);
        if (state && (!states.length || ["status", "bound", "taskId", "agent", "clientNonce"].some((key) => states.at(-1)[key] !== state[key]))) states.push(state);
        if (state?.bound) {
          boundTaskId ??= state.taskId;
          if (state.taskId !== boundTaskId && !gaps.includes("task-identity-changed")) gaps.push("task-identity-changed");
          latestBoundStatus = state.status;
          if (["queued", "running", "suspended"].includes(state.status)) { observedActive = true; terminalAt = null; }
          // An already-finished session with the same prompt is not this run.
          const fresh = initialState?.taskId !== state.taskId || initialState?.status !== state.status || observedActive;
          if (fresh && ["error", "stopped", "interrupted"].includes(state.status)) {
            terminalAt ??= clock.now();
            execution = { status: state.status === "error" ? "FAILED" : "STOPPED", reason: `Bound task reported ${state.status}` };
            break;
          }
          if (fresh && state.status === "done") terminalAt ??= clock.now();
        }
      }
      if (clock.now() - start >= maxMs) break;
      if (clock.now() - lastActivity >= quietMs && lastAnswer !== null && h.isBusy === false && pendingWidgets.size === 0) {
        quietAt = clock.now();
        execution = terminalAt === null || latestBoundStatus !== "done"
          ? { status: "QUIET", reason: "Assistant output quiet and host idle; task completion unverified" }
          : { status: "COMPLETED", reason: "Bound task terminal state observed, followed by quiet transcript" };
        break;
      }
    }
  } catch (error) {
    execution = { status: "ERROR", reason: "Observation or gateway request failed; see error type" };
    // Server bodies and exception messages may contain credentials or private content.
    failure = { name: error?.name ?? "Error", code: typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : null };
    event("observation-error", failure);
  }
  const endedAtEpochMs = clock.epoch(), end = clock.now();
  event("observation-finished", { atMs: end - start, clientNonce, endedAtEpochMs, execution: execution.status });
  let provenance;
  try {
    const after = await fingerprint();
    provenance = { schemaVersion: 1, scope: "selected-file-hashes-only", before, after };
  } catch { provenance = { schemaVersion: 1, scope: "selected-file-hashes-only", before, after: null }; gaps.push("provenance-recheck-failed"); }
  provenance.assessment = validateProvenance(provenance);
  const summary = {
    schemaVersion: 2, clientNonce, agent, taskId: boundTaskId, taskSha256: digest(task), startedAtEpochMs, endedAtEpochMs,
    accepted, execution, failure,
    timing: timingSummary(start, end, firstAnswer, lastAnswer, terminalAt, quietAt),
    assistantTexts, textRevisions, widgets,
    interventions: { automaticResponses: interventions.filter((item) => item.status === "sent").length,
      attemptedResponses: interventions.filter((item) => item.type === "automatic-widget-response").length,
      observedExternalResponses: observedExternalResponses.size, otherHumanInterventions: "not-observed", entries: interventions },
    lastHealth, initialTaskState: initialState, taskStates: states, gaps, provenance,
    finalSha256: finalText === null ? null : digest(finalText), ...(includeContent ? { task, final: finalText } : {}),
    originalReference: reference === null ? null : { reportedSeconds: reference, comparability: "UNCONTROLLED_REFERENCE",
      reason: "No matched original build/model/task/clock; no speed ratio or parity PASS computed" }, events,
  };
  const contract = validateRunRecord(summary);
  let verification = { status: "UNVERIFIED", reason: "Invalid run evidence contract", issues: contract.issues, checks: [] };
  if (contract.valid) {
    try { verification = await oracle({ ...summary, finalText }); }
    catch { verification = { status: "ERROR", reason: "Independent oracle failed", checks: [] }; }
    if (!["PASS", "FAIL", "UNVERIFIED", "ERROR"].includes(verification?.status)) verification = noOracle();
  }
  summary.contract = contract;
  summary.verification = verification;
  summary.verdict = verdictFor(summary, verification);
  summary.verdictScope = "Aggregate runtime verification; selected files and declared model labels do not establish executed runtime identity";
  output({ kind: "driver-exit", verdict: summary.verdict, execution: execution.status });
  return summary;
}

export async function hashFile(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export function createFingerprint({ files = [], buildFiles = [], model = null, environment = process }) {
  return async () => {
    const hashPaths = async (paths) => Promise.all(paths.map(async (filename) => ({ path: path.resolve(filename), sha256: await hashFile(filename) })));
    const runtime = { node: environment.version, platform: environment.platform, arch: environment.arch };
    return { schemaVersion: 1, scope: "selected-files-and-driver-environment", code: await hashPaths(files), build: await hashPaths(buildFiles),
      driverEnvironment: runtime, driverEnvironmentSha256: digest(JSON.stringify([runtime.node, runtime.platform, runtime.arch])),
      declaredModelLabel: model, runtimeIdentity: { status: "UNVERIFIED", reason: "Selected file hashes and operator model labels are not executed-runtime evidence" } };
  };
}

export function createGateway(gateway, fetchImpl = fetch) {
  if (!Number.isInteger(gateway.port) || gateway.port <= 0 || gateway.port > 65535 || typeof gateway.token !== "string" || !gateway.token) throw new Error("Invalid gateway config");
  const base = `http://127.0.0.1:${gateway.port}`;
  const request = async (suffix, options = {}) => {
    const response = await fetchImpl(base + suffix, { ...options, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { const error = new Error("Gateway HTTP error"); error.code = `HTTP_${response.status}`; throw error; }
    return response.json();
  };
  return {
    api: (method, body) => request(`/api/${method}`, { method: "POST", headers: { authorization: `Bearer ${gateway.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    health: () => request("/health"),
  };
}

export async function main(args) {
  const positional = [], options = {}, pins = [], builds = [];
  const allowed = new Set(["gateway-file", "task-state-file", "aside-config-file", "aside-session-id", "answer", "quiet", "max", "poll", "out", "oracle", "evidence-file", "include-content", "model-label", "reference-seconds", "nonce"]);
  for (const argument of args) {
    if (!argument.startsWith("--")) { positional.push(argument); continue; }
    const i = argument.indexOf("=");
    if (i < 0) throw new Error("Options require --name=value");
    const key = argument.slice(2, i), value = argument.slice(i + 1);
    if (key === "pin-file") pins.push(value);
    else if (key === "build-file") builds.push(value);
    else if (allowed.has(key)) options[key] = value;
    else throw new Error(`Unknown option: ${key}`);
  }
  if (positional.length !== 2 || !options["gateway-file"] || !options.out) {
    throw new Error("Usage: drive.mjs AGENT PROMPT --gateway-file=TASK_OWNED_GATEWAY.json --out=NEW_RESULT.json");
  }
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const gateway = createGateway(JSON.parse(readFileSync(options["gateway-file"], "utf8")));
  const scenario = FIXTURE_SCENARIOS[options.oracle];
  if (options.oracle && !scenario) throw new Error("Unknown oracle");
  if (scenario && !options["evidence-file"]) throw new Error("Oracle needs an independent evidence file");
  const fixturePath = scenario ? path.resolve(directory, scenario.fixtureFile) : null;
  const fixtureHash = fixturePath ? await hashFile(fixturePath) : null;
  if (Boolean(options["aside-config-file"]) !== Boolean(options["aside-session-id"]) || options["task-state-file"] && options["aside-config-file"]) {
    throw new Error("Choose either explicit Aside config plus session id, or a task-state observer file");
  }
  const readTaskState = options["aside-config-file"]
    ? createAsideStateReader(JSON.parse(readFileSync(options["aside-config-file"], "utf8")), options["aside-session-id"])
    : options["task-state-file"] ? async () => {
      try { return JSON.parse(readFileSync(options["task-state-file"], "utf8")); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    } : undefined;
  // Reserve the new artifact before sending anything. Existing historical files are never overwritten.
  const outputFd = openSync(options.out, "wx", 0o600);
  try {
  const summary = await runParity({ agent: positional[0], task: positional[1], ...gateway,
    clientNonce: options.nonce || randomUUID(), answer: options.answer ?? "none",
    quietMs: Number(options.quiet ?? 45) * 1000, maxMs: Number(options.max ?? 900) * 1000,
    pollMs: Number(options.poll ?? 2) * 1000, includeContent: options["include-content"] === "true",
    // An independent observer publishes nonce + exact session id + actual service status.
    readTaskState,
    fingerprint: createFingerprint({ files: [fileURLToPath(import.meta.url), path.join(directory, "outcome.mjs"), path.join(directory, "fixture-oracles.mjs"), path.join(directory, "task-state.mjs"), path.join(directory, "evidence-contract.mjs"), ...(fixturePath ? [fixturePath] : []), ...pins], buildFiles: builds, model: options["model-label"] ?? null }),
    oracle: scenario ? async (run) => {
      const raw = readFileSync(options["evidence-file"]);
      return { ...evaluateFixture(options.oracle, JSON.parse(raw.toString("utf8")), run, fixtureHash), evidenceSha256: digest(raw) };
    } : undefined,
    reference: options["reference-seconds"] ? Number(options["reference-seconds"]) : null,
    output: (entry) => console.log(JSON.stringify(entry)),
  });
  writeFileSync(outputFd, JSON.stringify(summary, null, 2) + "\n");
  process.exitCode = summary.verdict === "PASS" ? 0 : summary.verdict === "UNVERIFIED" ? 2 : 1;
  return summary;
  } finally { closeSync(outputFd); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => { console.error("Parity driver failed before producing a result; check explicit paths/options (details suppressed to protect local credentials)."); process.exitCode = 1; });
}
