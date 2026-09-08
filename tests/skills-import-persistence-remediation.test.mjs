import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import yaml from "js-yaml";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const bundled = await build({
  absWorkingDir: repositoryRoot,
  stdin: {
    contents: 'export { FileWorkflowStore } from "./source/host/workflows/workflow-store.ts"; export { parseWorkflowFile, promptSkillsFromWorkflows, agentSkillsFromWorkflows } from "./source/shared/workflow-model.ts";',
    resolveDir: repositoryRoot,
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  packages: "external",
  write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { FileWorkflowStore, parseWorkflowFile, promptSkillsFromWorkflows, agentSkillsFromWorkflows } = module.exports;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "belmont-skills-import-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}
function legacy(root, agent, body) {
  const folder = path.join(root, agent, "workflows", "daily");
  put(path.join(folder, "workflow.md"), `---\nname: Daily\n---\n${body}\n`);
  put(path.join(folder, "scripts", "run.sh"), `echo ${body}\n`);
  return folder;
}
function open(root, agent = "agent") {
  return new FileWorkflowStore(path.join(root, agent), path.join(root, "global"));
}
function frontmatter(filePath) {
  return yaml.safeLoad(fs.readFileSync(filePath, "utf8").split(/^---\s*$/m)[1]);
}

test("legacy migration retains colliding agents' complete folders and is stable on reopen", (t) => {
  const root = fixture(t);
  const first = legacy(root, "a", "first unique instructions"), second = legacy(root, "b", "second unique instructions");
  open(root, "a");
  const store = open(root, "b");
  assert.equal(store.list().length, 2);
  for (const expected of ["first unique instructions", "second unique instructions"]) {
    const record = store.list().find((item) => item.body === expected);
    assert.ok(record);
    assert.equal(fs.readFileSync(path.join(path.dirname(record.filePath), "scripts", "run.sh"), "utf8"), `echo ${expected}\n`);
  }
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
  assert.equal(open(root, "b").list().length, 2);
});

test("migration collision bounds the new id when the legacy name is at the filesystem limit", (t) => {
  const root = fixture(t), id = "x".repeat(255);
  put(path.join(root, "global", id, "SKILL.md"), "# Existing\nKeep the existing skill.");
  const folder = path.join(root, "agent", "workflows", id);
  put(path.join(folder, "workflow.md"), "# Legacy\nKeep the colliding legacy skill.");
  put(path.join(folder, "helper.txt"), "retained helper");
  const store = open(root), migrated = store.list().find((record) => record.body.includes("colliding legacy"));
  assert.ok(migrated);
  assert.ok(Buffer.byteLength(migrated.id) < 255);
  assert.equal(store.get(id).body, "# Existing\nKeep the existing skill.");
  assert.equal(fs.readFileSync(path.join(path.dirname(migrated.filePath), "helper.txt"), "utf8"), "retained helper");
  assert.equal(fs.existsSync(folder), false);
});

test("migration retains skipped entries while moving valid entries into an absent library", (t) => {
  const root = fixture(t);
  legacy(root, "agent", "valid instructions");
  const skipped = path.join(root, "agent", "workflows", "incomplete");
  put(path.join(skipped, "workflow.md"), "");
  put(path.join(skipped, "helper.txt"), "retain this helper");
  put(path.join(root, "agent", "workflows", "handoff.txt"), "retain this root file");
  const store = open(root);
  assert.equal(store.get("daily").body, "valid instructions");
  assert.equal(fs.readFileSync(path.join(skipped, "helper.txt"), "utf8"), "retain this helper");
  assert.equal(fs.readFileSync(path.join(root, "agent", "workflows", "handoff.txt"), "utf8"), "retain this root file");
});

test("migration copies helpers when moving the legacy folder is unavailable", (t) => {
  const root = fixture(t), folder = legacy(root, "agent", "copied instructions"), originalRename = fs.renameSync;
  const mocked = t.mock.method(fs, "renameSync", (from, to) => {
    if (from === folder) throw Object.assign(new Error("cross-device fixture"), { code: "EXDEV" });
    return originalRename(from, to);
  });
  const store = open(root);
  mocked.mock.restore();
  const record = store.get("daily");
  assert.equal(record.body, "copied instructions");
  assert.equal(fs.readFileSync(path.join(path.dirname(record.filePath), "scripts/run.sh"), "utf8"), "echo copied instructions\n");
  assert.equal(fs.existsSync(folder), false);
});

test("a partial copy failure retains original instructions and helpers", (t) => {
  const root = fixture(t), folder = legacy(root, "agent", "copy must survive"), originalRename = fs.renameSync;
  const rename = t.mock.method(fs, "renameSync", (from, to) => {
    if (from === folder) throw Object.assign(new Error("cross-device fixture"), { code: "EXDEV" });
    return originalRename(from, to);
  });
  const copy = t.mock.method(fs, "cpSync", (_from, to) => {
    put(path.join(to, "partial.txt"), "partial copy");
    throw Object.assign(new Error("copy fixture failure"), { code: "EIO" });
  });
  assert.doesNotThrow(() => open(root));
  rename.mock.restore(); copy.mock.restore();
  assert.match(fs.readFileSync(path.join(folder, "workflow.md"), "utf8"), /copy must survive/);
  assert.equal(fs.readFileSync(path.join(folder, "scripts/run.sh"), "utf8"), "echo copy must survive\n");
  assert.equal(fs.existsSync(path.join(root, "global", "daily")), false);
  assert.equal(open(root).get("daily").body, "copy must survive");
});

test("a partial source cleanup failure cannot remove the completed destination", (t) => {
  const root = fixture(t), folder = legacy(root, "agent", "cleanup must survive"), originalRename = fs.renameSync, originalRemove = fs.rmSync;
  const rename = t.mock.method(fs, "renameSync", (from, to) => {
    if (from === folder) throw Object.assign(new Error("cross-device fixture"), { code: "EXDEV" });
    return originalRename(from, to);
  });
  const remove = t.mock.method(fs, "rmSync", (target, options) => {
    if (target === folder) {
      originalRemove(path.join(folder, "workflow.md"));
      throw Object.assign(new Error("cleanup fixture failure"), { code: "EIO" });
    }
    return originalRemove(target, options);
  });
  const store = open(root);
  rename.mock.restore(); remove.mock.restore();
  assert.equal(store.get("daily").body, "cleanup must survive");
  assert.equal(fs.readFileSync(path.join(root, "global/daily/scripts/run.sh"), "utf8"), "echo cleanup must survive\n");
});

test("manual-only import and local reads retain invocation metadata after edit and reopen", (t) => {
  const root = fixture(t), store = open(root);
  const input = "---\nname: Manual task\ndescription: Explicit request only\ndisable-model-invocation: true\nmetadata:\n  owner: fixture\n  labels: [manual, preserved]\n  empty: {}\n---\n# Procedure\nWait for a request.\n";
  const imported = store.importMarkdown(input);
  assert.ok(imported);
  const first = store.get(imported.id);
  assert.equal(first.disableModelInvocation, true);
  assert.equal(promptSkillsFromWorkflows(store.list()).length, 0);
  assert.equal(agentSkillsFromWorkflows(store.list()).length, 0);
  store.update(imported.id, { name: first.name, description: first.description, body: "Updated procedure", trigger: null });
  const reopened = open(root).get(imported.id);
  assert.equal(reopened.disableModelInvocation, true);
  assert.deepEqual(frontmatter(reopened.filePath).metadata, { owner: "fixture", labels: ["manual", "preserved"], empty: {} });
  assert.equal(frontmatter(reopened.filePath)["disable-model-invocation"], true);
  put(path.join(root, "global", "local", "SKILL.md"), input.replace("Manual task", "Local task"));
  assert.equal(open(root).get("local").disableModelInvocation, true);
});

test("YAML folded and literal descriptions preserve matching text and body boundaries", (t) => {
  const root = fixture(t), store = open(root);
  for (const [marker, expected] of [[">-", "Match invoices and receipts."], ["|", "Match invoices and receipts."]]) {
    const raw = `---\r\nname: Description ${marker}\r\ndescription: ${marker}\r\n  Match invoices\r\n  and receipts.\r\nmetadata:\r\n  detail: |\r\n    preserve: first\r\n    --- content\r\n---\r\n# Body\r\nKeep this.\r\n`;
    const imported = store.importMarkdown(raw), record = store.get(imported.id);
    assert.equal(record.description, expected);
    assert.equal(record.body, "# Body\r\nKeep this.");
    assert.equal(frontmatter(record.filePath).metadata.detail, "preserve: first\n--- content\n");
  }
  const long = parseWorkflowFile(`---\nname: Clamped\ndescription: >-\n  ${"a".repeat(1600)}\n---\nBody`);
  assert.equal(long.description.length, 1536);
});

test("an omitted live source is preserved and explicit null is durably cleared", (t) => {
  const root = fixture(t), store = open(root), source = path.join(root, "source.md");
  put(source, "# Source\nLive instructions.");
  const imported = store.importLiveSource(source, "Live fixture");
  const spec = { name: "Live fixture", description: "Fixture", body: "Independent instructions", trigger: null };
  assert.equal(store.update(imported.id, spec).sourceRef, source);
  assert.equal(store.update(imported.id, { ...spec, sourceRef: null }).sourceRef, null);
  const reopened = open(root).get(imported.id);
  assert.equal(reopened.sourceRef, null);
  assert.equal(frontmatter(reopened.filePath).metadata?.source, undefined);
});
