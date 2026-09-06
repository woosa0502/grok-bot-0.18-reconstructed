// Skills in the system prompt (2026-09-05): the prompt used to point at the library folder only, so
// a bot asked to "follow the briefing skill" listed the folder, read enabled-workflows.json, listed
// the skill folder and sed'ed SKILL.md — ten tool calls before its first real step. The enabled skills
// are now listed by name with the file to Read.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function load(entry) {
  const result = await build({ absWorkingDir: repoRoot, bundle: true, entryPoints: [entry], format: "esm", platform: "node", target: "node22", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const workflow = (id, over = {}) => ({
  id, name: id, description: `use for ${id}`, body: "# x", trigger: null, source: "workflow", sourceRef: null,
  isEnabledForAgent: true, createdAt: 1, helperScripts: [], filePath: `/root/workflows/${id}/SKILL.md`, ...over,
});

test("promptSkillsFromWorkflows keeps only enabled, model-invocable skills that live in a file", async () => {
  const { promptSkillsFromWorkflows } = await load("source/shared/workflow-model.ts");
  const skills = promptSkillsFromWorkflows([
    workflow("gmail", { name: "Gmail 정리", description: "받은편지함 정리" }),
    workflow("off", { isEnabledForAgent: false }),
    workflow("sweeper", { trigger: { type: "cron", schedule: "@every 15m" }, source: "automation" }),
    workflow("hidden", { disableModelInvocation: true }),
    workflow("nofile", { filePath: "" }),
  ]);
  assert.deepEqual(skills, [{ name: "Gmail 정리", description: "받은편지함 정리", filePath: "/root/workflows/gmail/SKILL.md" }]);
});

test("renderWorkflowsSystemPrompt lists the enabled skills with their files after the library pointer", async () => {
  const { renderWorkflowsSystemPrompt } = await load("source/shared/workflow-model.ts");
  const pointerOnly = renderWorkflowsSystemPrompt("/root/workflows");
  assert.match(pointerOnly, /GLOBAL, shared library/);
  assert.doesNotMatch(pointerOnly, /Skills enabled for you/);
  assert.equal(renderWorkflowsSystemPrompt("/root/workflows", []), pointerOnly, "an empty list renders the pointer alone");
  assert.equal(renderWorkflowsSystemPrompt(null, [{ name: "a", description: "b", filePath: "/x" }]), "", "no library, no section");
  const listed = renderWorkflowsSystemPrompt("/root/workflows", [
    { name: "Briefing — 아침 브리핑", description: "평일 아침 5줄 브리핑", filePath: "/root/workflows/briefing/SKILL.md" },
    { name: "Gmail 정리", description: "받은편지함 정리", filePath: "/root/workflows/gmail/SKILL.md" },
  ]);
  assert.ok(listed.startsWith(pointerOnly));
  assert.match(listed, /Skills enabled for you \(2\)\. When a task matches one, Read its SKILL\.md first and follow it:/);
  assert.match(listed, /- Briefing — 아침 브리핑: 평일 아침 5줄 브리핑 — file: \/root\/workflows\/briefing\/SKILL\.md/);
  assert.match(listed, /- Gmail 정리: 받은편지함 정리 — file: \/root\/workflows\/gmail\/SKILL\.md/);
});

test("wiring: the system prompt assembly lists the store's skills through the model-visible path", () => {
  const assembly = readFileSync(path.join(repoRoot, "source/host/runner/system-prompt-assembly.ts"), "utf8");
  assert.match(assembly, /const skills = promptSkillsFromWorkflows\(store\.list\?\.\(\) \?\? \[\]\)\.map\(\(skill\) => \(\{ \.\.\.skill, filePath: modelVisibleLocation\(skill\.filePath\) \?\? skill\.filePath \}\)\);/);
  assert.match(assembly, /renderWorkflowsSystemPrompt\(modelVisibleLocation\(store\.getLocation\(\)\), skills\)/);
  assert.match(assembly, /list\?\(\): readonly WorkflowRecord\[\] \} \| null;/);
});
