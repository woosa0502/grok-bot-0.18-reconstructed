// The evaluation isolation mode of the bwrap sandbox must hide operational knowledge under $HOME from an
// eval session's shell while re-exposing only the allowed overlay, so read_file/bash cannot read the
// operational page. Runs real bwrap; skips if bwrap is unavailable.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BubblewrapBackend } from "../src/bwrap-backend.mjs";

const hasBwrap = fs.existsSync("/usr/bin/bwrap");

test("eval isolation hides operational knowledge under $HOME but re-exposes the allowed overlay", { skip: hasBwrap ? false : "bwrap not installed" }, () => {
  // Files must live UNDER the real $HOME so the tmpfs-over-$HOME actually governs them.
  const base = fs.mkdtempSync(join(os.homedir(), ".belmont-bwrap-eval-"));
  try {
    const opDir = join(base, "operational"), ovDir = join(base, "overlay"), work = join(base, "work");
    for (const d of [opDir, ovDir, work]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(join(opDir, "example.com.md"), "OPERATIONAL_CHAMPION_SECRET");
    fs.writeFileSync(join(ovDir, "example.com.md"), "OVERLAY_CANDIDATE_TOKEN");
    const backend = new BubblewrapBackend({});
    const script = `cat ${join(ovDir, "example.com.md")} 2>/dev/null || echo NO_OVERLAY; echo ---; cat ${join(opDir, "example.com.md")} 2>/dev/null || echo OP_HIDDEN`;
    const run = (opts) => {
      const args = backend.buildArgs(["/bin/sh", "-lc", script], opts);
      return spawnSync(args[0], args.slice(1), { encoding: "utf8" });
    };

    // Isolate mode: allow only the overlay (+ the eval work dir as cwd). Operational must be hidden.
    const iso = run({ isolate: { allowRoots: [ovDir] }, cwd: work });
    assert.equal(iso.status, 0, iso.stderr);
    assert.match(iso.stdout, /OVERLAY_CANDIDATE_TOKEN/, "eval session can read its allowed overlay");
    assert.doesNotMatch(iso.stdout, /OPERATIONAL_CHAMPION_SECRET/, "eval session must NOT read operational knowledge");
    assert.match(iso.stdout, /OP_HIDDEN/, "operational path resolves to the hidden tmpfs (not found)");

    // Control: the default (non-isolate) sandbox exposes the whole filesystem read-only, so operational IS
    // visible — this is exactly why the isolate mode is required for eval sessions.
    const ctl = run({ readableRoots: [base], cwd: work });
    assert.equal(ctl.status, 0, ctl.stderr);
    assert.match(ctl.stdout, /OPERATIONAL_CHAMPION_SECRET/, "default sandbox exposes operational (baseline)");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
