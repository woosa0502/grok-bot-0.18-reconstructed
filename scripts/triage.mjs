// First-pass classifier built from patterns I (Claude) observed in real evidence.
// High-confidence buckets are auto-recorded (by:"claude-triage"); everything that
// does NOT fit a clean pattern is printed in full as an EXCEPTION for me to hand-judge.
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const EVID = "/tmp/sweep-evidence.jsonl";
const VERD = "/tmp/sweep-verdicts.jsonl";

const judged = new Set();
if (existsSync(VERD)) for (const l of readFileSync(VERD, "utf8").split("\n").filter(Boolean)) { try { judged.add(JSON.parse(l).caseId); } catch {} }
const evid = readFileSync(EVID, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  .map((r) => ({ ...r, msgs: r.msgs ?? [], tools: r.tools ?? [], texts: r.texts ?? [] }))
  .filter((r) => !judged.has(r.caseId));

const RESULT = (r) => { const m = [...(r.msgs.join("\n").matchAll(/RESULT=(PASS|FAIL|UIONLY)/g))].pop(); return m ? m[1] : null; };
const blob = (r) => (r.msgs.join("\n") + "\n" + r.texts.join("\n")).toLowerCase();
// Any non-SendMessage tool call counts as the agent actually doing something.
// (SendMessage is the reply channel, already captured in r.msgs, not in r.tools.)
const hasRealTool = (r) => r.tools.length > 0;

// "feature genuinely absent in local mode" phrases -> UNAVAIL (by design, not a defect)
const UNAVAIL_RE = /no cloudagent|cloudagent tool|no computer tool|no generateimage|image generation tool|no image (generation|tool)|not available in this (build|toolset)|no such (subagent|tool)|not exposed|no `?required_permissions|toolset has no|no tool is exposed|binary pdf|not wired|isn.?t available|no .* tool (is )?available/;
const CHANNEL_RE = /no (connected )?messaging channel|channel address|no channel|wake context/;

const buckets = { PASS: [], UNAVAIL: [], ENV: [], UIONLY: [], EXCEPTION: [] };
for (const r of evid) {
  const res = RESULT(r);
  const b = blob(r);
  if (r.timedOut && r.msgs.length === 0) { buckets.EXCEPTION.push([r, "timeout,no-msg"]); continue; }
  if (res === "UIONLY") { buckets.UIONLY.push([r, "self UIONLY"]); continue; }
  if (CHANNEL_RE.test(b) && res !== "PASS") { buckets.ENV.push([r, "no messaging channel (headless)"]); continue; }
  if (res === "PASS" && hasRealTool(r)) { buckets.PASS.push([r, "RESULT=PASS + real tool call"]); continue; }
  if (res === "FAIL" && UNAVAIL_RE.test(b)) { buckets.UNAVAIL.push([r, "feature absent in local mode"]); continue; }
  if (res === "FAIL" && /internal (recovery|auto-review)|internal .*behavior|not an exposed agent tool|not agent-triggerable|no .*(exposed to me|control is exposed)|can.?t (trigger|inspect|simulate)|only .*internal/.test(b)) { buckets.EXCEPTION.push([r, "INTERNAL host behavior — code-verify existence"]); continue; }
  if (res === "PASS" && !hasRealTool(r)) { buckets.EXCEPTION.push([r, "PASS but NO tool call — verify claim"]); continue; }
  if (res === "FAIL" && !UNAVAIL_RE.test(b)) { buckets.EXCEPTION.push([r, "FAIL with no 'unavailable' reason — possible REAL defect"]); continue; }
  if (res === null) { buckets.EXCEPTION.push([r, "no RESULT= token"]); continue; }
  buckets.EXCEPTION.push([r, "unclassified"]);
}

console.log("=== TRIAGE (unjudged=" + evid.length + ") ===");
for (const k of ["PASS", "UNAVAIL", "ENV", "UIONLY"]) console.log(`${k}: ${buckets[k].length}`);
console.log(`EXCEPTION (hand-judge): ${buckets.EXCEPTION.length}`);

if (process.env.RECORD === "1") {
  for (const k of ["PASS", "UNAVAIL", "ENV", "UIONLY"]) for (const [r, reason] of buckets[k])
    appendFileSync(VERD, JSON.stringify({ caseId: r.caseId, verdict: k === "UIONLY" ? "UI_ONLY" : k, reason, by: "claude-triage" }) + "\n");
  console.log("recorded high-confidence buckets.");
}

console.log("\n===== EXCEPTIONS =====");
for (const [r, why] of buckets.EXCEPTION) {
  console.log(`\n## ${r.caseId} [${r.area}] <${why}>`);
  console.log("EXPECT: " + r.expected.slice(0, 150));
  r.tools.slice(0, 4).forEach((t) => console.log("  TOOL> " + t.slice(0, 160)));
  r.msgs.forEach((m) => console.log("  MSG>  " + m.replace(/\n/g, " | ").slice(0, 260)));
  if (r.timedOut) console.log("  (TIMEOUT)");
}
