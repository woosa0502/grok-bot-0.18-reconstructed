#!/usr/bin/env node
// Belmont manager bootstrap (B-1, reproducible): run against a STARTED app
// (`npm run wsl:start`), it makes the manager configuration durable for the
// current profile instead of a hand-built runtime fixture (external review #2):
//   1. ensures a persistent "Belmont" manager bot exists (creates it if absent)
//   2. installs the job-ledger hook (.cursor/h-jobs.sh + hooks.json SendToAgent entries)
//   3. ensures the job-sweeper cron routine on the manager
//   4. writes sand-data/manager.json so wsl:start designates the manager
//      automatically (SAND_DEFAULT_AGENT_ID env still overrides)
// Idempotent: safe to re-run; existing bot/hooks/routine are kept.
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.BELMONT_WSL_PROFILE?.trim() || path.join(repoRoot, ".cache", "belmont-wsl-profile");
const dataRoot = path.join(profileDir, "sand-data");
const managerName = process.env.BELMONT_MANAGER_NAME?.trim() || "Belmont";

const MANAGER_PERSONA = `You are ${managerName}, the user's MANAGER agent and their single point of contact. You plan, delegate, review, and report — you do not silently do everything yourself.

Operating rules:
1. For each non-trivial request decide: handle it directly; delegate to an existing worker (check ListAgents); create a focused new worker with CreateAgent (give it a tight persona and a fitting reasoning effort — low for mechanical work, high for analysis); or run a temporary Task subagent for one-shot work.
2. Every delegation you send with SendToAgent MUST start with a job tag [job:<short-id>] (e.g. [job:a3f9]). State: the task, constraints, expected output, and required evidence. Always end with: "When done, reply to me with SendToAgent (my id is in your teammates list), starting your reply with the same [job:<id>] tag."
3. When a [job:] reply arrives, REVIEW it before believing it: does it satisfy the task and constraints? Is the evidence concrete (command output, file paths, numbers)? If insufficient, send a follow-up with the SAME job tag saying exactly what is missing. Only after your review do you report to the user.
4. Track open jobs in your memory via update_state: job id, worker id, task summary, status (open/returned/approved). Update it when a job is issued, returned, and approved.
5. Report to the user concisely: what was done, by whom, the key evidence, and anything that needs their decision. Answer in the user's language (respond in Korean if they write Korean).
6. Never fabricate or embellish worker results. If a worker has not replied yet, say exactly that. If a routine wakes you to sweep jobs, re-nudge silently and only message the user when something completed or is stuck.`;

const SWEEPER_PROMPT = `[Job sweeper] Maintenance wake — do not message the user unless something completed or is stuck.
1. Run Shell: tail -n 200 .jobs/ledger.jsonl 2>/dev/null (empty is fine).
2. Reconstruct open jobs: a [job:X] you delegated (tool_input.from_agent_id = you) with no later reply carrying the same [job:X] from that worker. Cross-check your memory's job table.
3. For each open job with no reply for over 15 minutes: re-nudge that worker once via SendToAgent, reusing the exact [job:X] tag, asking for status or the result.
4. If a job returned earlier, you reviewed it, but the user was never told: report it to the user now.
5. Keep your memory job table in sync (update_state). If nothing is open, end quietly.`;

const HOOK_SCRIPT = `#!/bin/sh
# Job ledger (Belmont B-1): append every SendToAgent hook event as one JSONL
# line, rotating at ~1 MB. Never blocks the send — always exits 0, no stdout.
mkdir -p .jobs 2>/dev/null
if [ -f .jobs/ledger.jsonl ] && [ "$(wc -c < .jobs/ledger.jsonl 2>/dev/null || echo 0)" -gt 1048576 ]; then
  mv .jobs/ledger.jsonl .jobs/ledger.jsonl.1 2>/dev/null
fi
input=$(cat)
printf '{"ts":"%s","event":%s}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$input" >> .jobs/ledger.jsonl 2>/dev/null
exit 0
`;

async function api(gateway, method, body) {
  const response = await fetch(`http://127.0.0.1:${gateway.port}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${gateway.token}` },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status}`);
  return await response.json();
}

const gatewayPath = path.join(dataRoot, "gateway.json");
if (!existsSync(gatewayPath)) {
  console.error(`No running Belmont app for this profile (missing ${gatewayPath}). Start it first: npm run wsl:start`);
  process.exit(1);
}
const gateway = JSON.parse(readFileSync(gatewayPath, "utf8"));

// 1. Manager bot: create when absent; when present, RECONCILE the persona so a
//    pre-existing bot that merely shares the name still becomes a real manager
//    (external review r3 #5 — adopt-without-update was not a recovery).
const agents = await api(gateway, "listAgents");
let manager = (Array.isArray(agents) ? agents : []).find((agent) => agent?.name === managerName && agent?.isGroup !== true);
if (manager == null) {
  const created = await api(gateway, "createAgent", { name: managerName, description: MANAGER_PERSONA });
  manager = created.agent ?? created;
  console.log(`created manager bot "${managerName}" (${manager.id})`);
} else if (manager.description === MANAGER_PERSONA) {
  console.log(`manager bot "${managerName}" already up to date (${manager.id})`);
} else {
  await api(gateway, "updateAgent", { id: manager.id, profile: { name: managerName, description: MANAGER_PERSONA } });
  console.log(`manager bot "${managerName}" persona reconciled (${manager.id})`);
}

// 2. Job-ledger hook in the box workspace.
const cursorDir = path.join(dataRoot, "box-workspace", ".cursor");
mkdirSync(cursorDir, { recursive: true });
writeFileSync(path.join(cursorDir, "h-jobs.sh"), HOOK_SCRIPT);
chmodSync(path.join(cursorDir, "h-jobs.sh"), 0o755);
const hooksPath = path.join(cursorDir, "hooks.json");
let hooksConfig = { version: 1, hooks: {} };
try { hooksConfig = JSON.parse(readFileSync(hooksPath, "utf8")); } catch {}
hooksConfig.hooks ??= {};
for (const step of ["preToolUse", "postToolUse"]) {
  const entries = Array.isArray(hooksConfig.hooks[step]) ? hooksConfig.hooks[step] : [];
  if (!entries.some((entry) => entry?.command === "sh .cursor/h-jobs.sh")) {
    entries.push({ command: "sh .cursor/h-jobs.sh", matcher: "SendToAgent" });
  }
  hooksConfig.hooks[step] = entries;
}
writeFileSync(hooksPath, `${JSON.stringify(hooksConfig, null, 2)}\n`);
console.log("job-ledger hook installed (box-workspace/.cursor)");

// 3. Sweeper routine on the manager: create when absent, RECONCILE when its
//    prompt/schedule/enabled state drifted (external review r3 #5).
const sweeperSpec = { name: "Job sweeper", prompt: SWEEPER_PROMPT, trigger: { type: "cron", schedule: "@every 15m" }, isEnabled: true };
const automations = await api(gateway, "getAgentAutomations", { id: manager.id });
const sweeper = (Array.isArray(automations) ? automations : []).find((automation) => automation?.name === "Job sweeper");
if (sweeper == null) {
  await api(gateway, "createAgentAutomation", { id: manager.id, spec: sweeperSpec });
  console.log("job-sweeper routine created (@every 15m)");
} else if (
  sweeper.prompt === sweeperSpec.prompt &&
  sweeper.isEnabled === true &&
  sweeper.trigger?.type === "cron" &&
  sweeper.trigger?.schedule === sweeperSpec.trigger.schedule
) {
  console.log("job-sweeper routine already up to date");
} else {
  await api(gateway, "updateAgentAutomation", { id: manager.id, automationId: sweeper.id, spec: sweeperSpec });
  console.log("job-sweeper routine reconciled (prompt/schedule/enabled)");
}

// 4. Durable designation: wsl:start reads this and sets SAND_DEFAULT_AGENT_ID.
writeFileSync(path.join(dataRoot, "manager.json"), `${JSON.stringify({ managerAgentId: manager.id }, null, 2)}\n`);
console.log(`manager designated in ${path.join(dataRoot, "manager.json")}`);
console.log("done. Restart the app (npm run wsl:start) to apply the default-conversation designation.");
