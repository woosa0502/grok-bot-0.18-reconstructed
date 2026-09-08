import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  absWorkingDir: repoRoot,
  stdin: {
    contents: [
      "export * from './source/host/extensions/mcp/plugin-skills.ts';",
      "export * from './source/host/extensions/mcp/plugin-skills-cache.ts';",
      "export * from './source/host/extensions/mcp/skill-publish.ts';",
      "export * from './source/host/workflows/workflow-library.ts';",
    ].join("\n"),
    resolveDir: repoRoot,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
  logLevel: "silent",
});
const compiled = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { createSharedInstalledPluginsLoader, SandPluginSkillsService, writePluginSkillsCache, getPluginSkillsDir, SandSkillPublishService, GlobalWorkflowLibrary, getGlobalWorkflowsDir } = compiled.exports;

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "belmont-skills-persistence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function seedPlugin(root, relativeDir = "report") {
  const installPath = join(root, "plugins", "cache", "fixture-team", "fixture-plugin", "v1");
  const filePath = join(installPath, "skills", relativeDir, "SKILL.md");
  mkdirSync(join(dirname(filePath), "assets"), { recursive: true });
  const content = "---\nname: Report\ndescription: Prepare the published report.\n---\nPublished report procedure.\n";
  writeFileSync(filePath, content);
  writeFileSync(join(dirname(filePath), "assets", "helper.txt"), "published helper content\n");
  const record = { id: "plugin-39-report", pluginId: "39", pluginName: "Reports", name: "Report", description: "Prepare the report", filePath, pluginVersion: "v1", installPath, skillRelativePath: `skills/${relativeDir}/SKILL.md`, publisherUserId: 11, marketplaceTeamId: 22 };
  writePluginSkillsCache(getPluginSkillsDir(root), { currentUserId: 11, skills: [record] });
  return { record, content };
}

function loader(root, dashboard) {
  return createSharedInstalledPluginsLoader({
    sandRootDir: root,
    auth: {
      getAccessToken: async () => assert.fail("fixture must not request credentials"),
      getMachineId: async () => assert.fail("fixture must not request machine identity"),
      peekAccessToken: () => null,
    },
    dashboardForTesting: dashboard,
    isSparsePluginClonesEnabled: () => false,
    log: () => {},
  });
}

function emptyLoader(root, getMe = async () => ({ userId: 11 })) {
  return loader(root, { getEffectiveUserPlugins: async () => ({ plugins: [] }), getMe });
}

test("plugin list outage keeps both index bytes and installed files; confirmed empty list still prunes", async (t) => {
  const root = temporaryRoot(t);
  const { record, content } = seedPlugin(root);
  const cachePath = join(getPluginSkillsDir(root), "cache.json");
  const before = readFileSync(cachePath, "utf8");
  const events = [];
  const failed = new SandPluginSkillsService({
    sandRootDir: root,
    load: loader(root, {
      getEffectiveUserPlugins: async () => { throw new Error("fixture transport outage"); },
      getMe: async () => assert.fail("identity lookup follows a successful listing"),
    }),
    reportSync: (event) => events.push(event),
  });
  await assert.rejects(failed.sync("refresh"), /marketplace is unavailable/);
  assert.equal(readFileSync(cachePath, "utf8"), before);
  assert.equal(readFileSync(record.filePath, "utf8"), content);
  assert.equal(readFileSync(join(dirname(record.filePath), "assets/helper.txt"), "utf8"), "published helper content\n");
  assert.equal(events.at(-1).outcome, "failed");
  failed.dispose();
  const successful = new SandPluginSkillsService({ sandRootDir: root, load: emptyLoader(root) });
  assert.deepEqual(await successful.sync("uninstall"), []);
  assert.equal(existsSync(record.filePath), false);
  assert.deepEqual(successful.current(), []);
  successful.dispose();
});

test("plugin identity refreshes for each pass and unknown identity does not reuse the old account", async (t) => {
  const root = temporaryRoot(t);
  let userId = 11;
  let calls = 0;
  const service = new SandPluginSkillsService({
    sandRootDir: root,
    load: emptyLoader(root, async () => {
      calls++;
      if (userId === null) throw new Error("identity temporarily unavailable");
      return { userId };
    }),
  });
  await service.sync("startup");
  assert.equal(service.currentIndex().currentUserId, 11);
  userId = 77;
  await service.sync("auth_change");
  assert.equal(service.currentIndex().currentUserId, 77);
  userId = null;
  await service.sync("auth_change");
  assert.equal(service.currentIndex().currentUserId, null);
  assert.equal(calls, 3);
  service.dispose();
});

for (const collision of [false, true]) {
  test(`unpublish restores complete skill in a readable unique directory (collision=${collision})`, async (t) => {
    const root = temporaryRoot(t);
    const { record, content } = seedPlugin(root);
    const library = new GlobalWorkflowLibrary(getGlobalWorkflowsDir(root));
    if (collision) library.create({ name: "Report", description: "Unrelated", body: "Unrelated local procedure.", trigger: null });
    const pluginSkills = new SandPluginSkillsService({ sandRootDir: root, load: emptyLoader(root) });
    let calls = 0;
    const publish = new SandSkillPublishService({
      sandRootDir: root,
      pluginSkills,
      client: {
        getTeams: async () => ({ teams: [] }),
        publishPlugin: async () => assert.fail("only unpublish is under test"),
        unpublishPlugin: async () => { calls++; return {}; },
      },
    });
    const result = await publish.unpublish({ workflowId: record.id });
    assert.equal(result.restoredWorkflowId, collision ? "report-2" : "report");
    const restored = library.get(result.restoredWorkflowId);
    assert.equal(restored.body, "Published report procedure.");
    assert.equal(readFileSync(restored.filePath, "utf8"), content);
    assert.equal(readFileSync(join(dirname(restored.filePath), "assets/helper.txt"), "utf8"), "published helper content\n");
    if (collision) assert.equal(library.get("report").body, "Unrelated local procedure.");
    assert.equal(calls, 1);
    assert.equal(existsSync(record.filePath), false);
    pluginSkills.dispose();
  });
}

test("nested plugin skill is restored at a top-level library ID", async (t) => {
  const root = temporaryRoot(t);
  const { record } = seedPlugin(root, "group/report");
  const service = new SandSkillPublishService({
    sandRootDir: root,
    pluginSkills: { currentIndex: () => null, sync: async () => {} },
    client: { getTeams: async () => ({ teams: [] }), publishPlugin: async () => assert.fail(), unpublishPlugin: async () => assert.fail() },
  });
  const id = await service.restoreToLibrary(record);
  assert.equal(id, "report");
  assert.equal(service.library.get(id).body, "Published report procedure.");
  assert.equal(readFileSync(join(getGlobalWorkflowsDir(root), id, "assets/helper.txt"), "utf8"), "published helper content\n");
});

test("a failed complete restore keeps the plugin published and removes its partial destination", async (t) => {
  const root = temporaryRoot(t);
  const { record } = seedPlugin(root);
  symlinkSync(join(root, "missing-asset"), join(dirname(record.filePath), "broken-helper"));
  const pluginSkills = new SandPluginSkillsService({ sandRootDir: root, load: emptyLoader(root) });
  let calls = 0;
  const service = new SandSkillPublishService({
    sandRootDir: root,
    pluginSkills,
    client: { getTeams: async () => ({ teams: [] }), publishPlugin: async () => assert.fail(), unpublishPlugin: async () => { calls++; } },
  });
  await assert.rejects(service.unpublish({ workflowId: record.id }));
  assert.equal(calls, 0);
  assert.equal(existsSync(record.filePath), true);
  assert.deepEqual(readdirSync(getGlobalWorkflowsDir(root)), []);
  pluginSkills.dispose();
});
