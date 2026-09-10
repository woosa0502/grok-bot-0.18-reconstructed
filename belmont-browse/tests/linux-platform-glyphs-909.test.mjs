// The 909 settings/platform assets get Windows-style shortcut glyphs and File Explorer wording on
// Linux (tools/patch-linux-platform-glyphs.py). Pinned raw -> patched hashes, idempotent second run.
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const browse = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const campaign = path.resolve(browse, "../data/artifacts/aside-909-20260909");
const original = ["AsideAgentManager/1.26.909.1820/assets", "AsideAgentManager/assets"]
  .map((relative) => path.join(campaign, relative))
  .find((candidate) => spawnSync("test", ["-f", path.join(candidate, "platform-CH1yjH9T.js")]).status === 0);
assert.ok(original, `no 909 agent-manager assets under ${campaign}`);
const names = ["appearance-BlPq6qs7.js", "platform-CH1yjH9T.js"];
const pins = {
  "appearance-BlPq6qs7.js": ["5ec1cf571e9f0e20f6f72c0957ddd0fa9589b84f0d2402e1d28f3740abc9d5ae", "844716d502c33ed042c39efe88ee2c0eba06850984841a87a7ac9466bc94634a"],
  "platform-CH1yjH9T.js": ["9db39c7e24ea6274c10c4768e92a8fbcb8b332d3fc0ca5b55e1bf0c33bd46338", "79f6f9b0961c02c29f592a8414d8d5c656d6e27224ac6f6174dfbf7ad0ba2bc2"],
};
const patcher = path.join(browse, "tools/patch-linux-platform-glyphs.py");
const directory = mkdtempSync(path.join(tmpdir(), "aside-glyphs-909-"));
for (const name of names) copyFileSync(path.join(original, name), path.join(directory, name));
test.after(() => rmSync(directory, { recursive: true, force: true }));
const sha = (file) => new Promise((resolve) => { const h = createHash("sha256"); createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))); });
const run = () => spawnSync("python3", [patcher, "--assets", directory], { encoding: "utf8" });

test("909 platform glyph assets: raw pins, patched pins, idempotent", async () => {
  for (const name of names) assert.equal(await sha(path.join(directory, name)), pins[name][0], `${name} raw`);
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  for (const name of names) assert.equal(await sha(path.join(directory, name)), pins[name][1], `${name} patched`);
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.ok(JSON.parse(second.stdout).every((row) => row.status === "already patched"));
  for (const name of names) assert.equal(await sha(path.join(directory, name)), pins[name][1]);
});
