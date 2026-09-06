#!/usr/bin/env node
// Import a public Grok Bot marketplace bot (or a share link) into the running Belmont host.
//
//   node scripts/import-grok-bot.mjs tech-demos                      # marketplace slug
//   node scripts/import-grok-bot.mjs https://x.ai/bot/marketplace/bots/tech-demos
//   node scripts/import-grok-bot.mjs https://x.ai/bot/zvkkoHMbclsUBWX8MRGpU   # share link: name + description only
//   options: --dry-run   --skill "<skill name>=<raw SKILL.md url or file>"  (full body for a named skill)
//            --available "gmail-imap, google-calendar, browser"            (what this host actually has)
//
// The marketplace page publishes the bot's memories (its operating rules), skill names/descriptions,
// routine names/summaries and integration names — not skill bodies or routine prompts. The bot is
// created with those rules as its persona; skills land as notes (or full bodies when --skill supplies
// one); routines land paused with a best-effort schedule. Nothing runs until the user enables it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBotDescription, buildRoutineSpec, buildSkillMarkdown, parseMarketplaceBot, parseSharePage, slugFromUrl, AVATAR_SHAPES } from "./lib/grok-bot-template.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const skillSources = new Map();
const available = args.includes("--available") ? args[args.indexOf("--available") + 1] : "gmail-imap (Gmail), google-calendar, a browser bot, shell on a Linux box";
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--skill") {
    const [name, ...rest] = String(args[i + 1] ?? "").split("=");
    if (name && rest.length > 0) skillSources.set(name.trim().toLowerCase(), rest.join("=").trim());
  }
}
if (!target) { console.error("usage: import-grok-bot.mjs <slug | marketplace url | share url> [--dry-run] [--skill name=url]"); process.exit(2); }
const ref = slugFromUrl(target);
if (ref === null) { console.error(`not a marketplace slug/url or share link: ${target}`); process.exit(2); }

const ua = { headers: { "user-agent": "Mozilla/5.0 (Belmont import-grok-bot)" } };
async function fetchText(url) { const r = await fetch(url, ua); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.text(); }
async function readSource(source) {
  if (/^https?:/i.test(source)) return fetchText(source);
  return readFileSync(path.resolve(source), "utf8");
}

let record;
if (ref.kind === "marketplace") {
  record = parseMarketplaceBot(await fetchText(`https://x.ai/bot/marketplace/bots/${ref.slug}`));
  if (record === null) { console.error("could not find the bot record on that page"); process.exit(1); }
} else {
  record = parseSharePage(await fetchText(`https://x.ai/bot/${ref.id}`));
  if (!record.name) { console.error("could not read the share page"); process.exit(1); }
}

const description = buildBotDescription(record, { availableIntegrations: available });
const skills = (record.skills ?? []).map((skill) => ({ skill, source: skillSources.get(String(skill.name ?? "").toLowerCase()) }));
const routines = (record.routines ?? []).map(buildRoutineSpec);
const avatar = {
  ...(record.color ? { avatarColor: String(record.color) } : {}),
  ...(record.shape && AVATAR_SHAPES.has(String(record.shape)) ? { avatarShape: String(record.shape) } : {}),
};

console.log(`Bot: ${record.name}${record.creatorName ? ` (by ${record.creatorName})` : ""}`);
console.log(`Persona: ${description.length} chars, ${(record.memories ?? []).length} rule(s)`);
console.log(`Skills: ${skills.length} (${skills.filter((s) => s.source).length} with full bodies)`);
console.log(`Routines: ${routines.length} (paused): ${routines.map((r) => `${r.name} @ ${r.trigger.schedule}`).join("; ")}`);
console.log(`Integrations: ${(record.integrations ?? []).map((i) => i.name).join(", ") || "-"}`);
if (dryRun) { console.log("\n--- persona ---\n" + description); process.exit(0); }

const profileDir = process.env.BELMONT_PROFILE_DIR ?? path.join(repoRoot, ".cache", "belmont-wsl-profile", "sand-data");
const gateway = JSON.parse(readFileSync(path.join(profileDir, "gateway.json"), "utf8"));
const base = `http://${gateway.host ?? "127.0.0.1"}:${gateway.port}`;
async function call(method, body) {
  const r = await fetch(`${base}/api/${method}`, { method: "POST", headers: { authorization: `Bearer ${gateway.token}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} -> ${r.status}: ${text.slice(0, 200)}`);
  return text.length > 0 ? JSON.parse(text) : null;
}

const created = await call("createAgent", { name: record.name, description, ...avatar, clientNonce: `import-grok-bot:${ref.slug ?? ref.id}:${Date.now()}` });
const agentId = created?.agent?.id ?? created?.id;
if (!agentId) throw new Error(`createAgent returned no id: ${JSON.stringify(created).slice(0, 200)}`);
console.log(`\nCreated bot ${agentId}`);
for (const { skill, source } of skills) {
  const body = source ? await readSource(source) : undefined;
  const markdown = buildSkillMarkdown(skill, body);
  const result = await call("importAgentWorkflowText", { id: agentId, markdown, name: skill.name });
  const outcome = result?.result?.imported?.length ? "imported" : `skipped (${JSON.stringify(result?.result?.skipped ?? result).slice(0, 80)})`;
  console.log(`  skill "${skill.name}": ${outcome}${body ? " [full body]" : " [note]"}`);
}
for (const spec of routines) {
  await call("createAgentAutomation", { id: agentId, spec });
  console.log(`  routine "${spec.name}": created paused (${spec.trigger.schedule})`);
}
console.log("\nDone. Open the bot, read its persona, enable routines when the schedule looks right.");
