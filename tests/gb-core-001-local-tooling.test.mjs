import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    // version:1 is required — the settings parser rejects a file without it and falls back
    // to the default "cursor" provider, which would silently exercise the wrong path.
    await writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ version: 1, inferenceProvider: "codex" }));
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
    await writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ version: 1, inferenceProvider: "cursor" }));
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

test("GB-CORE-001: re-enabling auto-review survives a restart (real settings-store round-trip)", async () => {
  const { initialLocalSettingsUpdate, LOCAL_AUTO_REVIEW_SEED_MARKER } = await import("../scripts/lib/wsl-runtime.mjs");
  const loaded = await loadModule("source/shared/node/settings/sand-settings-store.ts");
  const dir = await mkdtemp(path.join(os.tmpdir(), "gb-core-001-settings-"));
  const settingsPath = path.join(dir, "settings.json");
  const markerPath = path.join(dir, LOCAL_AUTO_REVIEW_SEED_MARKER);
  // Mimic run-wsl.mjs exactly: read the persisted file, gate the auto-review seed on the
  // on-disk marker, apply the delta through the setters setHostSettings uses, then drop the
  // marker — the full round-trip the earlier object-only tests skipped.
  const applyStartupSeed = async () => {
    const raw = await readFile(settingsPath, "utf8").then(JSON.parse).catch(() => null);
    const seeded = await access(markerPath).then(() => true).catch(() => false);
    const delta = initialLocalSettingsUpdate(raw, { seedAutoReviewOff: !seeded });
    const store = new loaded.module.SandSettingsStore(settingsPath);
    if (delta.inferenceProvider !== undefined) store.setInferenceProvider(delta.inferenceProvider);
    if (delta.hasSeenOnboarding !== undefined) store.setHasSeenOnboarding(delta.hasSeenOnboarding);
    if (delta.autoReviewInstructions !== undefined) store.setAutoReviewInstructions(delta.autoReviewInstructions);
    if (!seeded) await writeFile(markerPath, "");
    return store;
  };
  try {
    // First launch on a fresh profile: seed leaves auto-review off.
    let store = await applyStartupSeed();
    assert.equal(store.getInferenceProvider(), "codex");
    assert.equal(store.getAutoReviewInstructions().isEnabled, false, "fresh local profiles start with review off");

    // The user turns review back on. The store persists an enabled+empty review as the
    // default by dropping the field entirely — there is no "on" marker left on disk.
    store.setAutoReviewInstructions({ isEnabled: true, allowInstructions: [], blockInstructions: [] });
    assert.equal(store.getAutoReviewInstructions().isEnabled, true);

    // Restart: the seed runs again against the persisted file. It must NOT re-disable the
    // user's choice (the bug: an absent field was treated as "unset" and re-seeded off).
    store = await applyStartupSeed();
    assert.equal(store.getAutoReviewInstructions().isEnabled, true, "re-enabled review must survive the restart seed");

    // Turning it off persists explicitly and also survives a restart.
    store.setAutoReviewInstructions({ isEnabled: false, allowInstructions: [], blockInstructions: [] });
    store = await applyStartupSeed();
    assert.equal(store.getAutoReviewInstructions().isEnabled, false, "an explicit off must persist across restart");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await loaded.dispose();
  }
});

test("GB-CORE-001: a disabled journal migrates a stale claim marker to the legacy store", async () => {
  const loaded = await loadModule("source/host/transcript-mirror/transcript-mirror-router.ts");
  try {
    let released = 0;
    const journal = {
      ownsConversation: async () => true, // stale `.journal-mode` marker present
      claimConversation: async () => { throw new Error("must not claim when the journal is disabled"); },
      releaseConversation: async () => { released += 1; }, // explicit migration to legacy (F-002)
    };
    const mirror = new loaded.module.RoutedTranscriptMirror(journal, {}, async () => false);
    assert.equal(await mirror.route("agent"), "legacy");
    assert.equal(released, 1, "a disabled owned conversation is released (migrated), not left claimed");
  } finally {
    await loaded.dispose();
  }
});

test("GB-CORE-001: an enabled journal that owns a conversation stays on the journal (ownership-first)", async () => {
  const loaded = await loadModule("source/host/transcript-mirror/transcript-mirror-router.ts");
  try {
    const journal = {
      ownsConversation: async () => true,
      claimConversation: async () => { throw new Error("must not re-claim an already owned conversation"); },
      releaseConversation: async () => { throw new Error("must not release an owned conversation while enabled"); },
    };
    const mirror = new loaded.module.RoutedTranscriptMirror(journal, {}, async () => true);
    assert.equal(await mirror.route("agent"), "journal", "ownership is honoured before the enable gate");
  } finally {
    await loaded.dispose();
  }
});

test("GB-CORE-001: skipCheckpoint agrees with route() regardless of call order", async () => {
  const loaded = await loadModule("source/host/transcript-mirror/transcript-mirror-router.ts");
  try {
    // Disabled journal, stale marker present, skipCheckpoint reached BEFORE any route() call
    // (so the route cache is empty and the selected==null branch runs). It must not recover
    // or skip through the journal it has disowned.
    const disabledCalls = [];
    let released = 0;
    const disabledJournal = {
      ownsConversation: async () => true,
      claimConversation: async () => { throw new Error("must not claim when the journal is disabled"); },
      releaseConversation: async () => { released += 1; },
      recover: async () => { disabledCalls.push("recover"); },
      skipCheckpoint: async () => { disabledCalls.push("skip"); },
    };
    const disabledMirror = new loaded.module.RoutedTranscriptMirror(disabledJournal, {}, async () => false);
    await disabledMirror.skipCheckpoint({}, "agent", {}, {});
    assert.deepEqual(disabledCalls, [], "a disabled journal must not recover/skip via the journal");
    assert.equal(released, 1, "and it migrates the stale marker to legacy rather than leaving it claimed");
    assert.equal(await disabledMirror.route("agent"), "legacy", "and route() must still agree it is legacy");

    // Positive control: an enabled journal that owns the conversation still recovers then skips.
    const enabledCalls = [];
    const enabledJournal = {
      ownsConversation: async () => true,
      claimConversation: async () => {},
      recover: async () => { enabledCalls.push("recover"); },
      skipCheckpoint: async () => { enabledCalls.push("skip"); },
    };
    const enabledMirror = new loaded.module.RoutedTranscriptMirror(enabledJournal, {}, async () => true);
    await enabledMirror.skipCheckpoint({}, "agent", {}, {});
    assert.deepEqual(enabledCalls, ["recover", "skip"], "an enabled owning journal recovers then skips");
  } finally {
    await loaded.dispose();
  }
});
