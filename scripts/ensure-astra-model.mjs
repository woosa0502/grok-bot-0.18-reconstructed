#!/usr/bin/env node
// Ensure gpt-6-astra is present in every pi-ai openai-codex catalog (source node_modules + built runtime).
// The pi-ai package ships a static catalog that tops out at gpt-5.6; astra is added here by cloning the
// gpt-5.6-sol entry (same api/provider/baseUrl/thinkingLevelMap). Idempotent — safe to re-run after
// `npm install` / `npm run wsl:setup` (both of which restore the stock catalog). After running, restart the
// gateway (npm run wsl:start) so the host reloads the catalog.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const repoRoot = process.cwd();
let paths = [];
try {
  paths = execSync(
    `find "${repoRoot}/node_modules" "${repoRoot}/.build" -name openai-codex.json -path '*pi-ai*' 2>/dev/null`,
    { encoding: "utf8" },
  ).split("\n").map(s => s.trim()).filter(Boolean);
} catch { /* find returns non-zero if a root is missing; ignore */ }

if (paths.length === 0) { console.log("No pi-ai openai-codex.json catalogs found."); process.exit(0); }

let changed = 0, already = 0;
for (const p of paths) {
  if (!existsSync(p)) continue;
  const d = JSON.parse(readFileSync(p, "utf8"));
  const prov = d["openai-codex-responses"];
  if (prov == null || typeof prov !== "object") { console.log(`skip (unexpected shape): ${p}`); continue; }
  if (prov["gpt-6-astra"] != null) { already++; continue; }
  const base = prov["gpt-5.6-sol"] ?? prov["gpt-5.6-terra"] ?? Object.values(prov)[0];
  if (base == null) { console.log(`skip (no base model to clone): ${p}`); continue; }
  const astra = JSON.parse(JSON.stringify(base));
  astra.id = "gpt-6-astra";
  astra.name = "GPT-6 Astra";
  d["openai-codex-responses"] = { "gpt-6-astra": astra, ...prov };
  writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
  changed++;
  console.log(`added gpt-6-astra -> ${p}`);
}
console.log(`Done. added=${changed}, already-present=${already}, catalogs=${paths.length}`);
