import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  absWorkingDir: repositoryRoot,
  stdin: {
    contents: [
      "export * from './source/shared/workflow-model.ts';",
      "export * from './source/shared/workflow-scope.ts';",
      "export * from './source/host/workflows/workflow-store.ts';",
      "export * from './source/host/extensions/managed-setup/managed-skills-cache.ts';",
      "export * from './source/host/extensions/managed-setup/sand-managed-skills.ts';",
      "export * from './source/host/extensions/mcp/plugin-skills-cache.ts';",
    ].join("\n"),
    resolveDir: repositoryRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
});
const compiled = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const {
  FileWorkflowStore, parseWorkflowFile, serializeWorkflowFile, workflowSpecFromMarkdown,
  readWorkflowScopeFields, promptSkillsFromWorkflows, agentSkillsFromWorkflows,
  renderWorkflowsSystemPrompt, readPluginSkillFileFacts,
  fetchedManagedSkillToSandSkill, writeManagedSkillsCache, readManagedSkillsCache,
  getManagedSkillsCachePath, getManagedSkillFilePath, getManagedSkillsDir,
  writePluginSkillsCache, getPluginSkillsDir,
} = compiled.exports;

const scope = { globs: ["*coupang*", "쿠팡*"], environments: ["not-this-box"], scoped_to: ["another-agent"] };
const spec = { name: "Shopping procedure", description: "Use for shopping", body: "Read product facts first.", trigger: null };
const markdown = `---\nname: Shopping procedure\ndescription: Use for shopping\nglobs: ["*coupang*", "쿠팡*"]\nenvironments: ["not-this-box"]\nscoped_to: ["another-agent"]\nmetadata:\n  owner: fixture\n---\nRead product facts first.\n`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "belmont-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function open(root, agent = "agent-a") {
  return new FileWorkflowStore(join(root, agent), join(root, "global"));
}
function assertScope(record, expected = scope) {
  assert.ok(record);
  assert.deepEqual(readWorkflowScopeFields(record), expected);
}
function seedPlugin(root, { owner = 11, manual = false } = {}) {
  const installPath = join(root, "plugins", "cache", "fixture", "v1");
  const filePath = join(installPath, "skills", "shopping", "SKILL.md");
  const raw = manual ? markdown.replace("metadata:", "disable-model-invocation: true\nmetadata:") : markdown;
  put(filePath, raw);
  const record = {
    id: "plugin-39-shopping", pluginId: "39", pluginName: "Fixture", name: spec.name,
    description: spec.description, filePath, pluginVersion: "v1", installPath,
    skillRelativePath: "skills/shopping/SKILL.md", publisherUserId: owner, marketplaceTeamId: 22,
  };
  writePluginSkillsCache(getPluginSkillsDir(root), { currentUserId: 11, skills: [record] });
  return record;
}

for (const newline of ["\n", "\r\n"]) {
  test(`frontmatter scope parsing supports ${JSON.stringify(newline)} newlines`, () => {
    assertScope(parseWorkflowFile(markdown.replaceAll("\n", newline)));
  });
}

test("legacy documents have no new own scope properties", () => {
  const parsed = parseWorkflowFile("---\nname: Legacy\n---\nKeep old behavior.");
  for (const key of ["globs", "environments", "scoped_to"]) assert.equal(Object.hasOwn(parsed, key), false);
  assert.equal(parseWorkflowFile(""), null);
});

test("malformed scope values are ignored and original parsed.data is retained", () => {
  const parsed = parseWorkflowFile('---\nname: Mixed\nglobs: [" *.ts ", 7, null, "*.ts"]\nenvironments: false\nscoped_to: {agent: a}\n---\nBody');
  assertScope(parsed, { globs: ["*.ts"] });
  assert.deepEqual(parsed.data.globs, [" *.ts ", 7, null, "*.ts"]);
  assert.equal(parsed.data.environments, false);
  assert.deepEqual(parsed.data.scoped_to, { agent: "a" });
});

test("bad YAML retains the existing fallback instead of introducing a new rejection", () => {
  const raw = "---\nname: Broken\nglobs: [\n---\nProcedure";
  const parsed = parseWorkflowFile(raw);
  assert.equal(parsed.body, raw);
  assertScope(parsed, {});
});

test("scope fields survive markdown-to-spec and creation serialization", () => {
  assertScope(workflowSpecFromMarkdown(markdown));
  assertScope(parseWorkflowFile(serializeWorkflowFile({ ...spec, ...scope })));
});

test("serialization preserves omitted scope and unrelated frontmatter without mutating it", () => {
  const original = parseWorkflowFile(markdown).data;
  original.disabled_environments = ["future-box"];
  original["disable-model-invocation"] = true;
  const before = structuredClone(original);
  const after = parseWorkflowFile(serializeWorkflowFile({ ...spec, body: "Updated." }, original));
  assertScope(after);
  assert.deepEqual(after.data.metadata, { owner: "fixture" });
  assert.deepEqual(after.data.disabled_environments, ["future-box"]);
  assert.equal(after.data["disable-model-invocation"], true);
  assert.deepEqual(original, before);
});

test("serialization distinguishes omitted values from explicit empty arrays", () => {
  const original = parseWorkflowFile(markdown).data;
  assertScope(parseWorkflowFile(serializeWorkflowFile({ ...spec, globs: undefined }, original)));
  assertScope(parseWorkflowFile(serializeWorkflowFile({ ...spec, globs: [] }, original)), { ...scope, globs: [] });
});

test("create, list, get, and reopen propagate scope through the global library", (t) => {
  const root = fixture(t), store = open(root);
  const record = store.create({ ...spec, ...scope });
  assertScope(record);
  assertScope(store.library.get(record.id));
  assertScope(store.list().find((item) => item.id === record.id));
  assertScope(open(root).get(record.id));
  assertScope(parseWorkflowFile(readFileSync(record.filePath, "utf8")));
});

test("import and ordinary edit retain scope and unrelated metadata after reopen", (t) => {
  const root = fixture(t), store = open(root), imported = store.importMarkdown(markdown);
  assert.ok(imported);
  assertScope(store.update(imported.id, { ...spec, body: "Edited procedure." }));
  const reopened = open(root).get(imported.id);
  assertScope(reopened);
  assert.deepEqual(parseWorkflowFile(readFileSync(reopened.filePath, "utf8")).data.metadata, { owner: "fixture" });
});

test("explicit scope edits persist, clear with [], and do not clear omitted siblings", (t) => {
  const root = fixture(t), store = open(root), created = store.create({ ...spec, ...scope });
  assertScope(store.update(created.id, { ...spec, globs: ["**/*.ts"] }), { ...scope, globs: ["**/*.ts"] });
  assertScope(store.update(created.id, { ...spec, environments: [], scoped_to: [] }), {
    globs: ["**/*.ts"], environments: [], scoped_to: [],
  });
  assertScope(open(root).get(created.id), { globs: ["**/*.ts"], environments: [], scoped_to: [] });
});

test("local SKILL.md edits are reflected by the existing stat-keyed parse cache", (t) => {
  const root = fixture(t), store = open(root), created = store.create({ ...spec, ...scope });
  const changed = { ...scope, globs: ["**/changed-file-name/*.tsx"] };
  put(created.filePath, serializeWorkflowFile({ ...spec, ...changed }));
  assertScope(store.get(created.id), changed);
});

test("scoped_to stays passive and cannot override per-agent disabled state", (t) => {
  const root = fixture(t), a = open(root, "agent-a"), b = open(root, "agent-b");
  const created = a.create({ ...spec, ...scope, scoped_to: ["agent-a"] });
  assert.equal(a.get(created.id).isEnabledForAgent, true);
  assert.equal(b.get(created.id).isEnabledForAgent, true, "scoped_to is not enforced in Phase 1");
  a.setEnabledForAgent(created.id, false);
  assert.equal(a.get(created.id).isEnabledForAgent, false);
  assert.equal(a.list().some((item) => item.id === created.id), false);
  assert.equal(open(root, "agent-a").get(created.id).isEnabledForAgent, false);
  assert.equal(b.get(created.id).isEnabledForAgent, true);
});

test("manual-only skills remain omitted from both automatic model-visible lists", (t) => {
  const root = fixture(t), store = open(root);
  const imported = store.importMarkdown(markdown.replace("metadata:", "disable-model-invocation: true\nmetadata:"));
  store.update(imported.id, { ...spec, body: "Manual-only edited procedure." });
  const reopened = open(root);
  assertScope(reopened.get(imported.id));
  assert.equal(reopened.get(imported.id).disableModelInvocation, true);
  assert.deepEqual(promptSkillsFromWorkflows(reopened.list()), []);
  assert.deepEqual(agentSkillsFromWorkflows(reopened.list()), []);
});

test("scope metadata leaves both selectors and the rendered system prompt unchanged", () => {
  const record = (id, overrides = {}) => ({
    id, name: id, description: id, body: "Body", trigger: null, source: "workflow", sourceRef: null,
    isEnabledForAgent: true, createdAt: 1, helperScripts: [], filePath: `/workflows/${id}/SKILL.md`, ...overrides,
  });
  const plain = [
    record("managed", { source: "managed" }), record("plugin", { source: "plugin" }),
    record("off", { isEnabledForAgent: false }), record("manual", { disableModelInvocation: true }),
    record("nofile", { filePath: "" }), record("auto", { trigger: { schedule: "0 9 * * *", isEnabled: true }, source: "automation" }),
    ...Array.from({ length: 110 }, (_, i) => record(`user-${i}`)),
  ];
  const scoped = plain.map((item) => ({ ...item, ...scope }));
  assert.deepEqual(promptSkillsFromWorkflows(scoped), promptSkillsFromWorkflows(plain));
  assert.deepEqual(agentSkillsFromWorkflows(scoped), agentSkillsFromWorkflows(plain));
  assert.equal(renderWorkflowsSystemPrompt("/workflows", promptSkillsFromWorkflows(scoped)),
    renderWorkflowsSystemPrompt("/workflows", promptSkillsFromWorkflows(plain)));
});

test("managed fetch -> cache JSON -> generated SKILL.md -> workflow retains scope", (t) => {
  const root = fixture(t), dir = getManagedSkillsDir(root);
  const skill = fetchedManagedSkillToSandSkill({ id: "managed-shopping", description: "Fallback", content: markdown, enabled: true });
  assertScope(skill);
  writeManagedSkillsCache(dir, [skill], () => 123);
  assertScope(readManagedSkillsCache(dir).skills[0]);
  assertScope(JSON.parse(readFileSync(getManagedSkillsCachePath(dir), "utf8")).skills[0]);
  assertScope(parseWorkflowFile(readFileSync(getManagedSkillFilePath(dir, skill.id), "utf8")));
  const store = open(root);
  assertScope(store.get(skill.id));
  assertScope(store.list().find((item) => item.id === skill.id));
  assert.equal(store.get(skill.id).isEnabledForAgent, true);
  store.setEnabledForAgent(skill.id, false);
  assert.equal(store.get(skill.id).isEnabledForAgent, true, "preserve the existing managed enablement policy");
});

test("managed cache-only fallback retains metadata before materialization", (t) => {
  const root = fixture(t), dir = getManagedSkillsDir(root);
  const skill = { id: "cache-only", name: "Cached", description: "Cached description", body: "Cached body", ...scope };
  put(getManagedSkillsCachePath(dir), JSON.stringify({ fetchedAt: 123, skills: [skill] }));
  const record = open(root).get(skill.id);
  assertScope(record);
  assert.equal(record.filePath, getManagedSkillsCachePath(dir));
});

test("legacy managed cache remains readable and generates unscoped skill files", (t) => {
  const root = fixture(t), dir = getManagedSkillsDir(root);
  const skill = { id: "legacy-managed", name: "Legacy", description: "Old", body: "Procedure" };
  writeManagedSkillsCache(dir, [skill], () => 99);
  assert.deepEqual(readManagedSkillsCache(dir), { fetchedAt: 99, skills: [skill] });
  assert.equal(readFileSync(getManagedSkillFilePath(dir, skill.id), "utf8"),
    serializeWorkflowFile({ name: skill.name, description: skill.description, body: skill.body, trigger: null }));
  assertScope(open(root).get(skill.id), {});
});

test("malformed passive scope does not invalidate an otherwise valid managed cache", (t) => {
  const root = fixture(t), dir = getManagedSkillsDir(root);
  const skill = { id: "mixed-managed", name: "Mixed", description: "Old", body: "Procedure",
    globs: "*.ts", environments: ["wsl", 7], scoped_to: false, custom: "preserve" };
  put(getManagedSkillsCachePath(dir), JSON.stringify({ fetchedAt: 99, skills: [skill] }));
  const cache = readManagedSkillsCache(dir);
  assert.ok(cache);
  assertScope(cache.skills[0], { environments: ["wsl"] });
  assert.equal(Object.hasOwn(cache.skills[0], "globs"), false);
  assert.equal(Object.hasOwn(cache.skills[0], "scoped_to"), false);
  assert.equal(cache.skills[0].custom, "preserve");
  assertScope(open(root).get(skill.id), { environments: ["wsl"] });
});

test("disabled managed fetches stay excluded irrespective of scope metadata", () => {
  assert.equal(fetchedManagedSkillToSandSkill({ id: "managed-shopping", description: "", content: markdown, enabled: false }), null);
});

test("plugin file facts and workflow projection retain scope across edits and reopen", (t) => {
  const root = fixture(t), plugin = seedPlugin(root), store = open(root);
  assertScope(readPluginSkillFileFacts(plugin.filePath));
  assertScope(store.get(plugin.id));
  assertScope(store.list().find((item) => item.id === plugin.id));
  assertScope(store.update(plugin.id, { ...spec, body: "Owner edit." }));
  assertScope(open(root).get(plugin.id));
  assertScope(store.update(plugin.id, { ...spec, globs: [] }), { ...scope, globs: [] });
  store.setEnabledForAgent(plugin.id, false);
  assert.equal(store.get(plugin.id).isEnabledForAgent, true, "preserve the existing plugin enablement policy");
});

test("scope edits do not bypass plugin ownership checks", (t) => {
  const root = fixture(t), plugin = seedPlugin(root, { owner: 77 }), store = open(root);
  const before = readFileSync(plugin.filePath, "utf8");
  assert.equal(store.update(plugin.id, { ...spec, globs: [] }), null);
  assert.equal(readFileSync(plugin.filePath, "utf8"), before);
  assertScope(store.get(plugin.id));
});

test("manual-only plugin stays excluded from automatic lists while retaining scope", (t) => {
  const root = fixture(t), plugin = seedPlugin(root, { manual: true }), store = open(root);
  assertScope(store.get(plugin.id));
  assert.deepEqual(promptSkillsFromWorkflows(store.list()), []);
  assert.deepEqual(agentSkillsFromWorkflows(store.list()), []);
});
