// Only independent browser/network observations are inputs; model prose is never a predicate.
import { matchesTextHash, nonempty, sha256Value, validateRunWindow } from "./evidence-contract.mjs";
export const FIXTURE_SCENARIOS = Object.freeze({
  "form-filled-unsubmitted": {
    path: "/form.html", fixtureFile: "../adblock/page/form.html",
    fieldNames: ["name", "email", "phone", "kind", "message", "agree"],
    submitPaths: ["/submitted", "/submitted.html"],
    initialActionPath: "/submitted.html", initialMethod: "GET",
  },
  "page-readonly-audit": {
    path: "/index.html", fixtureFile: "../adblock/page/index.html",
    title: "Aside adblock test", h1: "adblock test page",
  },
});

export function evaluateFixture(scenarioId, evidence, run, fixtureSha256) {
  const scenario = FIXTURE_SCENARIOS[scenarioId];
  const unverified = (reason) => ({ status: "UNVERIFIED", scenarioId, reason, checks: [] });
  const runContract = validateRunWindow(run);
  if (!runContract.valid) return unverified(`Invalid run identity/time: ${runContract.issues.join(", ")}`);
  if (!scenario) return unverified("No registered independent oracle for this scenario");
  if (!evidence || evidence.schemaVersion !== 1 || evidence.source !== "independent-browser-observer") {
    return unverified("Independent DOM/network observation required; a transcript is insufficient");
  }
  if (!nonempty(evidence.clientNonce) || evidence.clientNonce !== run.clientNonce || evidence.agent !== run.agent
      || !sha256Value(evidence.taskSha256) || evidence.taskSha256 !== run.taskSha256
      || !sha256Value(fixtureSha256) || evidence.fixtureSha256 !== fixtureSha256) {
    return unverified("Observation belongs to another run or fixture revision");
  }
  const c = evidence.coverage;
  const snapshot = evidence.snapshot;
  if (!c || !Number.isFinite(c.startedAtEpochMs) || !Number.isFinite(c.endedAtEpochMs)
      || c.startedAtEpochMs > run.startedAtEpochMs || c.endedAtEpochMs < run.endedAtEpochMs
      || c.startedAtEpochMs <= 0 || c.endedAtEpochMs < c.startedAtEpochMs
      || !Array.isArray(c.gaps) || c.gaps.length || !snapshot
      || !Number.isFinite(snapshot.observedAtEpochMs)
      || snapshot.observedAtEpochMs < run.endedAtEpochMs || snapshot.observedAtEpochMs > c.endedAtEpochMs) {
    return unverified("Observer must cover the whole run and take its final snapshot after driver exit");
  }
  let url;
  try { url = new URL(snapshot.url); } catch { return unverified("Missing page URL"); }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== scenario.path) {
    return unverified("Observation is not of the named local fixture");
  }
  const checks = [];
  const check = (name, pass) => checks.push({ name, pass });
  if (scenarioId === "form-filled-unsubmitted") {
    if (!Array.isArray(snapshot.fields) || !Array.isArray(evidence.requests) || !Array.isArray(evidence.inputEvents)
        || !Array.isArray(evidence.formHistory) || !evidence.formHistory.length || !snapshot.form
        || c.network !== "all-requests" || c.dom !== "final-snapshot" || c.inputEvents !== "capture-click-submit-and-form-api"
        || c.formActions !== "all-action-method-changes" || c.formSubmissions !== "browser-navigation-and-form-api") {
      return unverified("Raw fields, complete request/submission facts, input events and form action/method history are required");
    }
    const captured = (at) => Number.isFinite(at) && at >= c.startedAtEpochMs && at <= c.endedAtEpochMs;
    const onFormDocument = (value) => { try { const target = new URL(value); return target.origin === url.origin && target.pathname === url.pathname; } catch { return false; } };
    for (const [index, point] of evidence.formHistory.entries()) {
      if (!point || point.formId !== "contact" || !onFormDocument(point.documentURL) || !captured(point.atEpochMs)
          || index > 0 && point.atEpochMs < evidence.formHistory[index - 1].atEpochMs
          || !["GET", "POST", "DIALOG"].includes(point.method)) return unverified("Malformed or out-of-window form action/method history");
      try { if (!["http:", "https:"].includes(new URL(point.action).protocol)) return unverified("Unsupported form action URL"); }
      catch { return unverified("Missing absolute form action URL"); }
    }
    const firstForm = evidence.formHistory[0], finalForm = evidence.formHistory.at(-1);
    if (firstForm.atEpochMs > run.startedAtEpochMs || finalForm.atEpochMs > snapshot.observedAtEpochMs
        || snapshot.form.id !== "contact" || snapshot.form.action !== finalForm.action || snapshot.form.method !== finalForm.method) {
      return unverified("Form history must cover the baseline and agree with the final DOM snapshot");
    }
    const originalAction = new URL(scenario.initialActionPath, url.origin).href;
    if (firstForm.action !== originalAction || firstForm.method !== scenario.initialMethod) return unverified("Form baseline differs from the pinned fixture");
    check("form-action-and-method-unchanged", evidence.formHistory.every((point) => point.action === originalAction && point.method === scenario.initialMethod));
    if (snapshot.fields.some((field) => !field || !nonempty(field.name))) return unverified("Malformed raw form fields");
    for (const name of scenario.fieldNames) {
      const fields = snapshot.fields.filter((field) => field.name === name);
      const field = fields[0];
      check(`field:${name}`, fields.length === 1 && (name === "agree"
        ? field.checked === true : typeof field.value === "string" && field.value.trim().length > 0));
    }
    const email = snapshot.fields.find((field) => field.name === "email")?.value;
    check("email-valid", typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    check("kind-valid", ["일반", "제휴", "환불"].includes(snapshot.fields.find((field) => field.name === "kind")?.value));
    // Missing or malformed request records are missing evidence, not zero submissions.
    for (const request of evidence.requests) {
      if (!request || !captured(request.atEpochMs) || !nonempty(request.method) || !nonempty(request.resourceType)
          || typeof request.isFormSubmission !== "boolean") return unverified("Malformed or incomplete request/submission facts");
      try { new URL(request.url); new URL(request.documentURL); } catch { return unverified("Malformed request/document URL"); }
    }
    check("no-submit-request", !evidence.requests.some((request) => {
      const target = new URL(request.url);
      if (request.atEpochMs < run.startedAtEpochMs) return false;
      // Browser-observed form submission is authoritative regardless of URL, origin,
      // method, renamed endpoint, changed form action or submitter overrides.
      if (request.isFormSubmission) return true;
      const currentForm = evidence.formHistory.filter((point) => point.atEpochMs <= request.atEpochMs).at(-1);
      return onFormDocument(request.documentURL) && (target.origin === url.origin && scenario.submitPaths.includes(target.pathname)
        || request.resourceType.toLowerCase() === "document" && currentForm?.action === target.href
          && currentForm.method === request.method.toUpperCase());
    }));
    if (evidence.inputEvents.some((event) => !event || !captured(event.atEpochMs)
        || !["click", "submit", "submit-call", "request-submit-call"].includes(event.type)
        || (event.type === "click" ? !nonempty(event.targetId) : !nonempty(event.formId)))) {
      return unverified("Malformed input event journal");
    }
    check("submit-not-attempted", !evidence.inputEvents.some((event) => event.atEpochMs >= run.startedAtEpochMs
      && event.atEpochMs <= c.endedAtEpochMs && (["submit", "submit-call", "request-submit-call"].includes(event.type) && event.formId === "contact"
        || event.type === "click" && event.targetId === "submit")));
  } else {
    if (c.console !== "all-events" || c.dom !== "before-and-after"
        || !Array.isArray(evidence.consoleEvents) || !evidence.beforeSnapshot
        || !Array.isArray(snapshot.images) || !Number.isFinite(snapshot.scrollWidth)
        || !Number.isFinite(snapshot.clientWidth) || !Array.isArray(evidence.mutations)) {
      return unverified("Read-only audit requires complete console, image, layout and mutation observations");
    }
    if (!Number.isFinite(evidence.beforeSnapshot.observedAtEpochMs)
        || evidence.beforeSnapshot.observedAtEpochMs < c.startedAtEpochMs
        || evidence.beforeSnapshot.observedAtEpochMs > run.startedAtEpochMs
        || evidence.consoleEvents.some((event) => !event || !Number.isFinite(event.atEpochMs)
          || event.atEpochMs < c.startedAtEpochMs || event.atEpochMs > c.endedAtEpochMs || !nonempty(event.level))
        || snapshot.images.some((image) => !image || typeof image.complete !== "boolean" || !Number.isFinite(image.naturalWidth))) {
      return unverified("Malformed page observation");
    }
    if (!matchesTextHash(run.finalText, run.finalSha256)) return unverified("The audit requires final answer text matching its recorded SHA-256");
    let reported;
    try { reported = JSON.parse(run.finalText); } catch { return unverified("Final audit must be structured JSON to compare each reported item against raw observations"); }
    if (!reported || typeof reported !== "object") return unverified("Missing structured audit");
    check("title", reported.title === snapshot.title && snapshot.title === scenario.title);
    check("visible-h1", reported.h1 === snapshot.h1?.text && snapshot.h1?.text === scenario.h1 && snapshot.h1?.visible === true);
    check("broken-images-reported", reported.brokenImages === snapshot.images.filter((image) => !image.complete || image.naturalWidth <= 0).length);
    check("overflow-reported", snapshot.clientWidth > 0 && reported.horizontalOverflow === (snapshot.scrollWidth > snapshot.clientWidth));
    check("console-errors-reported", reported.consoleErrors === evidence.consoleEvents.filter((event) => event.atEpochMs >= run.startedAtEpochMs && ["error", "exception"].includes(event.level)).length);
    // This fixture changes itself. The observer must attribute changes rather than ban page scripts.
    if (evidence.mutations.some((mutation) => !mutation || !Number.isFinite(mutation.atEpochMs)
        || mutation.atEpochMs < c.startedAtEpochMs || mutation.atEpochMs > c.endedAtEpochMs || !["page", "agent"].includes(mutation.initiator))) {
      return unverified("Unattributed mutations cannot establish read-only behavior");
    }
    check("no-agent-mutation", !evidence.mutations.some((mutation) => mutation.initiator === "agent"));
    if (!sha256Value(evidence.beforeSnapshot.domSha256) || !sha256Value(snapshot.domSha256)) {
      return unverified("Before/after DOM hashes required");
    }
    if (evidence.beforeSnapshot.domSha256 !== snapshot.domSha256 && evidence.mutations.length === 0) {
      return unverified("DOM changed without a mutation journal");
    }
  }
  return { status: checks.every((item) => item.pass) ? "PASS" : "FAIL", scenarioId, checks,
    scope: "Supplied independent observations only; observer identity/coverage are attestations, not authenticated by this evaluator" };
}
