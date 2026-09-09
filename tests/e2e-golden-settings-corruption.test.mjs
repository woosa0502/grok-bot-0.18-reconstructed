// Golden E2E E15 (settings part): a corrupt settings file is quarantined and reported, never silently replaced.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ absWorkingDir: repoRoot, stdin: { contents: "export * from './source/shared/node/settings/sand-settings-store.ts';", resolveDir: repoRoot }, bundle: true, format: "esm", platform: "node", target: "node22", write: false });
const { SandSettingsStore } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "settings-corruption-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "settings.json");
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  t.after(() => { console.error = original; });
  return { dir, file, errors, store: new SandSettingsStore(file) };
}

test("E15: truncated settings JSON is quarantined with a reason and defaults are used, not silently overwritten", (t) => {
  const f = fixture(t);
  writeFileSync(f.file, '{"inferenceProvider": "openrouter", "hasSeenOnboarding": tr');
  const loaded = f.store.load();
  assert.equal(loaded.hasSeenOnboarding, undefined);
  assert.equal(existsSync(f.file), false, "the unreadable file is moved out of the way");
  const quarantined = readdirSync(f.dir).filter((name) => name.startsWith("settings.json.corrupt-"));
  assert.equal(quarantined.length, 1);
  assert.match(readFileSync(path.join(f.dir, quarantined[0]), "utf8"), /openrouter/, "the user's bytes are preserved for recovery");
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0], /unreadable \(not valid JSON/);
  // A later save writes a fresh file; the quarantined copy stays.
  f.store.setHasSeenOnboarding(true);
  assert.equal(f.store.load().hasSeenOnboarding, true);
  assert.equal(readdirSync(f.dir).filter((name) => name.startsWith("settings.json.corrupt-")).length, 1);
});

test("E15: a JSON file that is not a settings object is quarantined too; valid settings load unchanged", (t) => {
  const f = fixture(t);
  writeFileSync(f.file, "[1,2,3]");
  f.store.load();
  assert.equal(existsSync(f.file), false);
  assert.match(f.errors.at(-1), /not a settings object/);
  f.store.setHasSeenOnboarding(true);
  const before = f.errors.length;
  assert.equal(f.store.load().hasSeenOnboarding, true);
  assert.equal(f.errors.length, before, "valid settings produce no quarantine");
  assert.equal(readdirSync(f.dir).filter((name) => name.startsWith("settings.json.corrupt-")).length, 1);
});
