import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gb-core-001-"));
  const output = path.join(temporary, "module.mjs");
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("GB-CORE-001: routed (non-cursor) turns and transcript reads fall through to the host runner", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/inference-router.ts");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "gb-core-001-codex-"));
  try {
    await writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ inferenceProvider: "codex" }));
    let remoteCalls = 0;
    const router = loaded.module.createCoordinatorInferenceRouter({
      dataDir,
      postEvent: () => {},
      dispatchRemote: async () => { remoteCalls += 1; return { entries: [] }; },
    });
    // In codex (local) mode the coordinator must NOT handle the turn or transcript reads
    // itself — it lets them fall through so the host runner (full built-in toolset) runs.
    for (const method of ["sendPrompt", "getAgentTranscriptTail", "openAgentTail", "getAgentTranscriptWindow"]) {
      const result = await router.dispatch(method, { agentId: "a", id: "a", prompt: "hi" });
      assert.deepEqual(result, { handled: false }, `${method} must fall through in local mode`);
    }
    // The coordinator's minimal local turn loop and its JSON-transcript merge must not run.
    assert.equal(remoteCalls, 0, "no local transcript merge / execute should touch the remote");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await loaded.dispose();
  }
});

test("GB-CORE-001: cursor mode keeps the existing coordinator fall-through behavior", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/inference-router.ts");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "gb-core-001-cursor-"));
  try {
    await writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ inferenceProvider: "cursor" }));
    const router = loaded.module.createCoordinatorInferenceRouter({
      dataDir,
      postEvent: () => {},
      dispatchRemote: async () => ({ entries: [] }),
    });
    const result = await router.dispatch("sendPrompt", { agentId: "a", prompt: "hi" });
    assert.deepEqual(result, { handled: false }, "cursor sendPrompt keeps falling through to the gateway");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await loaded.dispose();
  }
});

test("GB-CORE-001: a disabled auto-review setting turns off every tool-surface classifier", async () => {
  const loaded = await loadModule("source/host/runner/sand-auto-review.ts");
  try {
    // The local build ships auto-review off via the persisted setting (settingsEnabled:false),
    // not a hard-coded host override, so every surface falls to the local tool-permission gate.
    const off = loaded.module.resolveSandAutoReviewModes({ settingsEnabled: false, enforceEnabled: true });
    for (const surface of ["hostShell", "boxShell", "mcp", "computer", "cloudAgent", "subagentLaunch"]) {
      assert.equal(off[surface], "off", `${surface} must be off so it falls to the local tool-permission gate`);
    }
    // With the setting re-enabled an enabled gate still enforces (unchanged upstream behavior),
    // so turning review back on in Settings restores the original Cursor-mode behavior.
    const enforce = loaded.module.resolveSandAutoReviewModes({ settingsEnabled: true, enforceEnabled: true });
    assert.equal(enforce.hostShell, "enforce");
  } finally {
    await loaded.dispose();
  }
});

test("GB-CORE-001: the local first-run seed pre-configures auto-review off but never overrides the user", async () => {
  const { initialLocalSettingsUpdate } = await import("../scripts/lib/wsl-runtime.mjs");
  // A fresh profile is seeded with auto-review disabled (and codex inference) up front.
  const fresh = initialLocalSettingsUpdate(null);
  assert.equal(fresh.inferenceProvider, "codex");
  assert.equal(fresh.autoReviewInstructions.isEnabled, false, "fresh local profiles start with auto-review off");
  // A profile where the user already chose an auto-review setting is left untouched.
  const chosen = initialLocalSettingsUpdate({ autoReviewInstructions: { isEnabled: true, allowInstructions: [], blockInstructions: [] } });
  assert.equal("autoReviewInstructions" in chosen, false, "an existing auto-review choice must win over the seed");
});

test("GB-CORE-001: a disabled journal ignores a stale claim marker and stays on the legacy store", async () => {
  const loaded = await loadModule("source/host/transcript-mirror/transcript-mirror-router.ts");
  try {
    const journal = {
      ownsConversation: async () => true, // stale `.journal-mode` marker present
      claimConversation: async () => { throw new Error("must not claim when the journal is disabled"); },
    };
    const mirror = new loaded.module.RoutedTranscriptMirror(journal, {}, async () => false);
    assert.equal(await mirror.route("agent"), "legacy");
  } finally {
    await loaded.dispose();
  }
});
