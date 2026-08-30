import { readFileSync, appendFileSync } from "node:fs";
const id = (n) => `GBF-AGT-${String(n).padStart(6, "0")}-N01`;
const M = {
  348: ["UNAVAIL", "no image-capable MCP tool exposed"],
  392: ["UNCLEAR", "evidence misattributed (agent replied about 381); re-test"],
  47: ["PASS", "hidden SendMessage-reminder mechanism observed; ack-redrive code exists (cf 229)"],
  438: ["UNAVAIL", "no canvas diagnostics tool exposed in local"],
  397: ["UNAVAIL", "no conversation-search tool exposed in local"],
  436: ["PASS", "unknown tool -> error (Tool not found); missing required args rejected; errors not treated as success"],
  441: ["ISSUE", "Read did NOT treat .png/.avif as inline image (returned raw bytes); image-MIME inline Read not wired in local"],
  111: ["UNCLEAR", "admin denylist not triggered (no hook configured); code path exists but not testable without hooks.json"],
  112: ["UNAVAIL", "no pre-execution permissionDenied block; relies on OS-level errors instead"],
  116: ["ISSUE", "smart-mode/auto-review classifier does not block on Codex (forced OFF, AUDIT-W3)"],
  120: ["UNCLEAR", "no shell denylist for UI-automation tools (xdotool ran); may be by design"],
  159: ["ISSUE", "Read returned raw PNG bytes not an image result; image-MIME inline Read not wired (cf 441)"],
  225: ["PASS", "background shell completion wake mechanism (cf 038/039 confirmed)"],
  233: ["ISSUE", "subagent auto-review fail path inactive (auto-review OFF on Codex, AUDIT-W3)"],
  293: ["UNCLEAR", "preToolUse deny not triggered (hooks.json empty, no hook configured); code exists (remote-hooks.ts)"],
  321: ["ISSUE", "smart-mode classifier BLOCK/ALLOW inactive (auto-review OFF on Codex, AUDIT-W3)"],
  324: ["UNCLEAR", "beforeShellExecution/beforeMCPExecution hook not active (hooks empty); wiring uncertain"],
  115: ["UNAVAIL", "30s foreground timeout backgrounds the command instead of aborting+TIMEOUT-marking (behavioral difference)"],
  147: ["UNAVAIL", "no GenerateImage tool in local (cannot test unsupported-model error)"],
  148: ["UNAVAIL", "no GenerateImage tool in local (cannot test safety-block error)"],
  152: ["ISSUE", "auto-review no-retry-routing guidance inactive (auto-review OFF on Codex, AUDIT-W3)"],
  190: ["UNCLEAR", "subagent await error-path not cleanly exercised"],
  240: ["ISSUE", "429/503 shown as error but no retry-guidance text produced"],
  241: ["UNCLEAR", "MCP failure error format differs from expected 'Box MCP execution failed for {name}'"],
  242: ["ENV", "only belmont-test (connected) installed; no needsAuth server to test auth-fail connect card"],
  245: ["UNCLEAR", "subagent got 'local machine isn't connected' not SAND_LOCAL_TOOLS_ASK_UNAVAILABLE_MESSAGE"],
  250: ["UNCLEAR", "background subagent throw -> parent revival error-propagation not cleanly confirmed"],
  282: ["UNAVAIL", "LsTimeout partial-tree not wired in box (caps at 2000 entries, no timeout result); proto/renderer have it"],
  389: ["PASS", "code-verified: Shell/MCP request_smart_mode_approval + block_reason schema + approvalProvider.requestApproval path"],
  58: ["PASS", "SendMessage type-mismatch field correctly fails validation (content only valid with type:text)"],
  59: ["PASS", "SendMessage images on non-text type correctly fails validation"],
  432: ["PASS", "tool execution timeout returns a timeout error (ToolTimeoutError; minor: .name is Error)"],
  8: ["ENV", "no plugin-owned MCP server installed to test UninstallMcpServer plugin-owned path"],
  9: ["UNCLEAR", "UninstallMcpServer on belmont-test — result not clearly captured; team-provided fixture absent"],
  11: ["ENV", "no team-required plugin installed to test UninstallPlugin"],
  232: ["UNAVAIL", "no Recreate tool exposed to abort a background command"],
  251: ["ISSUE", "subagent steer-restart (prepend steer prompt on finishing subagent) not observed; MessageSubagent/steer path may not restart"],
  15: ["UNCLEAR", "SetMcpInstructions rejected belmont-test label (needs positive-decimal server id); path not exercised (cf 005/012)"],
};
let n = 0;
for (const [num, [v, r]] of Object.entries(M)) {
  appendFileSync("/tmp/sweep-verdicts.jsonl", JSON.stringify({ caseId: id(num), verdict: v, reason: r, by: "claude-judge" }) + "\n");
  n++;
}
const V = readFileSync("/tmp/sweep-verdicts.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const by = {}; for (const x of V) by[x.verdict] = (by[x.verdict] || 0) + 1;
console.log("recorded", n, "| total:", V.length, by);
