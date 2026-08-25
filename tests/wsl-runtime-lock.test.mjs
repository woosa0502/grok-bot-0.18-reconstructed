import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireBelmontRuntimeLock } from "../scripts/lib/wsl-runtime-lock.mjs";

test("Belmont runtime lock allows one product owner and recovers stale state", async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), "belmont-runtime-lock-"));
  try {
    const first = await acquireBelmontRuntimeLock({ profileDir, pid: 101, isProcessAlive: pid => pid === 101 });
    await assert.rejects(
      acquireBelmontRuntimeLock({ profileDir, pid: 202, isProcessAlive: pid => pid === 101 }),
      /already running/,
    );
    await first.release();
    await writeFile(first.lockPath, `${JSON.stringify({ schemaVersion: 1, pid: 303, token: "stale" })}\n`);
    const recovered = await acquireBelmontRuntimeLock({ profileDir, pid: 404, isProcessAlive: () => false });
    await recovered.release();
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});
