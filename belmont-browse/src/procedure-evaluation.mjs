// Evaluation changes no canonical memory schema. Only a verified, completed trial can publish.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const TERMINAL = new Set(["done", "error", "stopped", "interrupted"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const problem = (code, message = code) => Object.assign(new Error(message), { code });
const check = (value, code) => { if (!value) throw problem(code); };
const within = (root, file) => { const r = path.relative(root, file); return r === "" || (!path.isAbsolute(r) && r !== ".." && !r.startsWith(`..${path.sep}`)); };
const optionalRead = (file) => { try { return fs.readFileSync(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const identical = (a, b) => a === null || b === null ? a === b : a.equals(b);
const median = (values) => { const x = [...values].sort((a, b) => a - b), n = x.length; check(n > 0, "EMPTY_TRIALS"); return n % 2 ? x[n >> 1] : (x[n / 2 - 1] + x[n / 2]) / 2; };
const nonnegativeInteger = (x) => Number.isSafeInteger(x) && x >= 0;

/** Marker matching is only a diagnostic of response text, never an external-success oracle. */
export function responseMarker(result, marker) {
  return typeof marker === "string" && marker.trim().length > 0 && typeof result === "string" && result.toLowerCase().includes(marker.trim().toLowerCase());
}
export function validateOptions(options) {
  check(typeof options.domain === "string" && options.domain.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(options.domain), "INVALID_DOMAIN");
  check(typeof options.task === "string" && options.task.trim().length > 0 && options.task.length <= 16000, "INVALID_TASK");
  check(Number.isSafeInteger(options.runs) && options.runs >= 1 && options.runs <= 50, "INVALID_RUNS");
  check(Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 3600000, "INVALID_TIMEOUT");
  check(options.goal === undefined || typeof options.goal === "string" && options.goal.trim().length > 0, "EMPTY_GOAL");
  if (options.publish) check(options.verifier && typeof options.verifier.verify === "function" &&
    typeof options.verifier.id === "string" && options.verifier.id.length > 0 &&
    ["read-only", "resettable"].includes(options.verifier.isolation), "PUBLISH_REQUIRES_OBSERVER");
  if (options.verifier?.isolation === "resettable") check(typeof options.verifier.beforeTrial === "function", "RESET_REQUIRED");
}

/** An existing lock, including an incomplete/dead-owner lock, is never stolen automatically.
 * Complete metadata becomes visible atomically via link(); PID reuse and stale-owner races cannot steal it.
 * After a crash the operator must drain evaluator sessions before removing the retained lock.
 */
export function acquireEvaluationLock(root) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(fs.realpathSync(root), ".learn-measure.lock");
  const token = randomUUID(), temp = `${file}.${token}.owner`;
  const owner = { pid: process.pid, token, at: Date.now(), purpose: "procedure-evaluation" };
  fs.writeFileSync(temp, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
  try { fs.linkSync(temp, file); } catch (error) {
    if (error.code === "EEXIST") throw problem("EVALUATION_LOCKED", "Evaluation lock exists. Refusing concurrent measurement; inspect/drain retained sessions before recovery.");
    throw error;
  } finally { fs.unlinkSync(temp); }
  return { file, release() {
    let current;
    try { current = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return; }
    if (current.token === token) fs.unlinkSync(file);
  } };
}

export function createEvaluationApi({ port, token }, { fetchImpl = fetch, requestTimeoutMs = 15000 } = {}) {
  check(Number.isSafeInteger(port) && port > 0 && port <= 65535 && typeof token === "string" && token.length > 0, "INVALID_SERVICE_STATE");
  return async (method, route, body, signal) => {
    const deadline = AbortSignal.timeout(requestTimeoutMs);
    const response = await fetchImpl(`http://127.0.0.1:${port}${route}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
    });
    check(response.ok, `HTTP_${response.status}`);
    const text = await response.text();
    check(text.length <= 1000000, "OVERSIZED_RESPONSE");
    try { return JSON.parse(text); } catch { throw problem("INVALID_RESPONSE_JSON"); }
  };
}

/** Even an environment flag is not runtime forwarding proof. The service owns this attestation. */
export function assertOverlayCapability(health) {
  const proof = health?.sitesOverlayProof;
  check(health?.ok === true && health.sitesOverlay === true && proof?.contract === "session-sites-v1" &&
    proof.instanceId === health.instanceId && typeof health.instanceId === "string" && health.instanceId.length > 0 &&
    proof.engine === health.engine && typeof health.engine === "string" && health.engine.length > 0 &&
    /^[a-f0-9]{64}$/.test(proof.bundleSha256 ?? "") && proof.workerForwarding === true &&
    proof.readIsolation === true && proof.extractionDisabled === true, "OVERLAY_NOT_PROVEN");
}

export function decideAdoption(control, candidate) {
  check(Array.isArray(control) && Array.isArray(candidate) && control.length === candidate.length && candidate.length > 0, "UNPAIRED_TRIALS");
  const valid = (row) => row && TERMINAL.has(row.status) && nonnegativeInteger(row.toolCalls) &&
    nonnegativeInteger(row.modelCalls) && nonnegativeInteger(row.errors) && Number.isFinite(row.ms) && row.ms >= 0;
  check(control.every(valid) && candidate.every(valid), "INVALID_METRICS");
  const metrics = { control: { tools: median(control.map(r => r.toolCalls)), errors: median(control.map(r => r.errors)), ms: median(control.map(r => r.ms)) },
    candidate: { tools: median(candidate.map(r => r.toolCalls)), errors: median(candidate.map(r => r.errors)), ms: median(candidate.map(r => r.ms)) } };
  // A stopped/error run cannot be rescued by a marker or even a mistaken success grade.
  if (candidate.some(r => r.status !== "done" || r.grade?.verdict !== "succeeded" || r.grade.criticalFailure !== false || !r.grade.evidence?.length))
    return { accept: false, reason: "goal not reached in all runs (failed/unknown)", metrics };
  // One failure must not disappear in a median; each paired trial is independently constrained.
  if (candidate.some((r, i) => r.errors > control[i].errors)) return { accept: false, reason: "errors worse", metrics };
  const cheaper = metrics.candidate.tools < metrics.control.tools ||
    (metrics.candidate.tools === metrics.control.tools && metrics.candidate.errors < metrics.control.errors);
  // Latency is reported, not used as a noisy single-second tie breaker.
  return { accept: cheaper, reason: cheaper ? "verified lower cost" : "not cheaper than current bar", metrics };
}

async function bounded(call, signal) {
  signal.throwIfAborted();
  let stop;
  const cancelled = new Promise((_, reject) => { stop = () => reject(signal.reason ?? problem("ABORTED")); signal.addEventListener("abort", stop, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(call), cancelled]); }
  finally { signal.removeEventListener("abort", stop); }
}

/** Uses the existing HTTP session API. The observer is an operator-selected local module, not model output. */
export async function evaluateProcedure(raw) {
  const options = { runs: 3, timeoutMs: 480000, pollMs: 1000, publish: false, ...raw };
  validateOptions(options);
  const { api, verifier, signal, domain, task, runs, timeoutMs, publish } = options;
  check(typeof api === "function", "API_REQUIRED");
  const knowledge = fs.realpathSync(options.knowledgeDir);
  const state = path.resolve(options.stateDir);
  check(!within(knowledge, state), "EVAL_ROOT_INSIDE_KNOWLEDGE");
  const draftPath = path.join(knowledge, "drafts", `${domain}.md`), opPath = path.join(knowledge, "sites", `${domain}.md`);
  const ensurePath = (file, expectedParent) => {
    check(fs.realpathSync(path.dirname(file)) === expectedParent, "CHANGED_PARENT");
    if (fs.existsSync(file)) check(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), "NONREGULAR_PAGE");
  };
  const draftsDir = fs.realpathSync(path.join(knowledge, "drafts")), sitesDir = fs.realpathSync(path.join(knowledge, "sites"));
  check(within(knowledge, draftsDir) && within(knowledge, sitesDir), "OUTSIDE_KNOWLEDGE");
  ensurePath(draftPath, draftsDir); ensurePath(opPath, sitesDir);
  const lock = acquireEvaluationLock(knowledge);
  let runDir, preserve = false, unknownCreation = false;
  const active = new Set(), rows = { current: [], draft: [], "no-page": [] };
  const fsOps = options.fsOps ?? fs; // IO fault injection seam; not a CLI option.
  const sleepFor = options.sleepFor ?? ((ms, s) => sleep(ms, undefined, { signal: s }));
  const now = options.now ?? (() => performance.now());
  const journal = (extra = {}) => {
    if (runDir) fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ domain, active: [...active], unknownCreation, ...extra }, null, 2), { mode: 0o600 });
  };
  async function stopKnown(id) {
    const cleanup = AbortSignal.timeout(options.cleanupTimeoutMs ?? 5000);
    const result = await bounded(() => api("POST", `/sessions/${encodeURIComponent(id)}/stop`, {}, cleanup), cleanup);
    if (TERMINAL.has(result?.status)) { active.delete(id); return; }
    for (let i = 0; i < 10; i++) {
      const v = await bounded(() => api("GET", `/sessions/${encodeURIComponent(id)}`, undefined, cleanup), cleanup);
      if (TERMINAL.has(v?.status)) { active.delete(id); return; }
      await sleepFor(Math.min(options.pollMs, 100), cleanup);
    }
    throw problem("STOP_UNCONFIRMED");
  }
  try {
    const health = await api("GET", "/health", undefined, signal);
    assertOverlayCapability(health);
    const candidateBytes = fs.readFileSync(draftPath), championBytes = optionalRead(opPath);
    check(candidateBytes.length > 0 && candidateBytes.length <= 1000000, "INVALID_DRAFT_SIZE");
    const candidateSha256 = sha(candidateBytes), championSha256 = championBytes === null ? null : sha(championBytes);
    fs.mkdirSync(path.join(state, "learn-eval"), { recursive: true });
    const realEvalRoot = fs.realpathSync(path.join(state, "learn-eval"));
    check(!within(knowledge, realEvalRoot), "EVAL_ROOT_INSIDE_KNOWLEDGE");
    runDir = fs.mkdtempSync(path.join(realEvalRoot, `${domain}-`));
    const overlays = {};
    for (const arm of ["current", "draft", "no-page"]) {
      overlays[arm] = path.join(runDir, arm, "sites"); fs.mkdirSync(overlays[arm], { recursive: true });
      const bytes = arm === "draft" ? candidateBytes : arm === "current" ? championBytes : null;
      if (bytes !== null) fs.writeFileSync(path.join(overlays[arm], `${domain}.md`), bytes, { mode: 0o400, flag: "wx" });
    }
    journal({ phase: "measuring", candidateSha256, championSha256 });
    async function trial(arm, round) {
      const deadline = AbortSignal.timeout(timeoutMs), trialSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const context = { task, domain, round, arm, signal: trialSignal };
      await bounded(() => verifier?.beforeTrial?.(context), trialSignal);
      const started = now(); let id, view;
      // No automatic retry of POST: a lost response can conceal a live side-effecting session.
      unknownCreation = true; journal({ phase: "creating", arm, round });
      const created = await bounded(() => api("POST", "/sessions", { task, model: options.model, thinking: options.thinking,
        mode: "guard", autoApprove: false, sitesDir: overlays[arm] }, trialSignal), trialSignal);
      check(typeof created?.id === "string" && created.id.length > 0 && created.id.length <= 256, "MISSING_SESSION_ID");
      id = created.id; active.add(id); unknownCreation = false; journal({ phase: "waiting", arm, round });
      try {
        view = created;
        while (!TERMINAL.has(view?.status)) {
          check(view?.status !== "suspended", "EVALUATION_SUSPENDED");
          check(now() - started < timeoutMs, "TRIAL_TIMEOUT");
          await sleepFor(options.pollMs, trialSignal);
          view = await bounded(() => api("GET", `/sessions/${encodeURIComponent(id)}`, undefined, trialSignal), trialSignal);
          check(view?.id === undefined || view.id === id, "SESSION_ID_MISMATCH");
        }
        active.delete(id); journal({ phase: "verifying", arm, round });
        const errors = (view.activity ?? []).filter(line => typeof line === "string" && /\bERROR\b/.test(line)).length;
        check(nonnegativeInteger(view.toolCalls) && nonnegativeInteger(view.modelCalls), "INVALID_METRICS");
        let grade = { verdict: view.status === "done" ? "unknown" : "failed", criticalFailure: view.status !== "done", evidence: [] };
        if (view.status === "done" && verifier) {
          grade = await bounded(() => verifier.verify({ ...context, sessionId: id, view, goal: options.goal }), trialSignal);
          check(grade && ["succeeded", "failed", "unknown"].includes(grade.verdict) && typeof grade.criticalFailure === "boolean" &&
            Array.isArray(grade.evidence) && grade.evidence.every(e => typeof e === "string" && e.length > 0), "INVALID_GRADE");
        }
        const row = { id, round, status: view.status, toolCalls: view.toolCalls, modelCalls: view.modelCalls, errors,
          ms: Math.max(0, now() - started), marker: responseMarker(view.result, options.goal), grade,
          // No full account/credential-bearing result is written to the audit log.
          resultSha256: sha(String(view.result ?? "")) };
        rows[arm].push(row); return row;
      } catch (error) {
        if (active.has(id)) { try { await stopKnown(id); } catch { preserve = true; } }
        throw error;
      }
    }
    const barName = championBytes === null ? "no-page" : "current";
    for (let i = 0; i < runs; i++) for (const arm of i % 2 ? ["draft", barName] : [barName, "draft"]) await trial(arm, i);
    // Optional diagnostic only: not the adoption bar when a champion exists.
    if (championBytes !== null && options.noPageDiagnostic !== false) for (let i = 0; i < runs; i++) await trial("no-page", i);
    const decision = decideAdoption(rows[barName], rows.draft);
    const report = { contract: "procedure-evaluation-v2", domain, barName, candidateSha256, championSha256,
      verifier: verifier?.id ?? null, ...decision, rows, published: false, runDir };
    const assertUnchanged = () => {
      signal?.throwIfAborted(); ensurePath(draftPath, draftsDir); ensurePath(opPath, sitesDir);
      check(identical(optionalRead(draftPath), candidateBytes), "DRAFT_CHANGED");
      check(identical(optionalRead(opPath), championBytes), "CHAMPION_CHANGED");
      for (const [arm, dir] of Object.entries(overlays)) {
        const expected = arm === "draft" ? candidateBytes : arm === "current" ? championBytes : null;
        check(identical(optionalRead(path.join(dir, `${domain}.md`)), expected), "OVERLAY_CHANGED");
      }
    };
    assertUnchanged();
    // A prepared audit is not an ADOPTED verdict. Publishing is never done in finally/catch.
    fsOps.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
    if (publish && decision.accept) {
      const temp = `${opPath}.tmp-${randomUUID()}`;
      try {
        const fd = fsOps.openSync(temp, "wx", 0o600);
        try { fsOps.writeFileSync(fd, candidateBytes); fsOps.fsyncSync(fd); } finally { fsOps.closeSync(fd); }
        assertUnchanged();
        fsOps.renameSync(temp, opPath); // Commit point: exactly the bytes that were evaluated.
        report.published = true;
        preserve = true; // Retain the prepared receipt until every post-commit report is written.
      } finally { try { fsOps.unlinkSync(temp); } catch (e) { if (e.code !== "ENOENT") throw e; } }
      // Keep the original draft: consuming it introduces another data-loss race with an editor.
    }
    const verdict = `${new Date().toISOString()} ${domain} [bar=${barName}] tools ${report.metrics.control.tools.toFixed(1)} → ${report.metrics.candidate.tools.toFixed(1)}, errors ${report.metrics.control.errors.toFixed(1)} → ${report.metrics.candidate.errors.toFixed(1)} ⇒ ${report.published ? "ADOPTED" : `REJECTED (${decision.accept ? "diagnostic only; --publish not set" : decision.reason})`}`;
    try {
      fsOps.appendFileSync(path.join(knowledge, "lessons", "measurements.log"), verdict + "\n");
      fsOps.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
    } catch {
      // A post-commit audit error cannot undo/lie about an already successful rename.
      preserve = true; report.auditWarning = true; journal({ phase: report.published ? "published-audit-incomplete" : "audit-incomplete", candidateSha256 });
    }
    options.log?.(verdict);
    // Retain the small content-free report outside memory retrieval; remove overlays after confirmed drain.
    const reportDir = path.join(state, "learn-reports"); fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, `${path.basename(runDir)}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
    preserve = Boolean(report.auditWarning);
    return report;
  } finally {
    for (const id of [...active]) { try { await stopKnown(id); } catch { preserve = true; } }
    preserve ||= unknownCreation || active.size > 0;
    try {
      if (preserve) journal({ phase: "inspection-required" });
      else if (runDir) fs.rmSync(runDir, { recursive: true, force: true });
    } finally {
      // Unknown POST/failed stop: retain lock and immutable overlays; do not let a new evaluation overtake it.
      if (!preserve) lock.release();
    }
  }
}
