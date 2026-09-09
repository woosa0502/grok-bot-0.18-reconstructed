import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, access, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareNativeComponents, COMPONENTS, DEFAULT_VERSION } from "../tools/prepare-native-components.mjs";

// Original public manifest keys; fixture payloads contain no private installation state.
const keys = {"agent-manager": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqhv+iJq51KjdvWXOROTWwPgHEtYt3yabPtUyTnj3iT6vtqJw8LjxiA8Usq79PmKb77f8NANCbeupfrz0uaLIFkFTbgJnGasO3bBZQKvfPiThfhJsNGpNtYwdfTpoYK9Nitzr9TwJ0vgvbNIkp8kG/A1x3XpUrGMEeqpbep+XWLkWN3MgAsC3p1HpXLrVVOHyF45vZMqsmrjoXWJELlRLVZl2XVA+Yk+tZL1zoOoSL19y7L4pjM/N4ZmbfUO8hdC2dh7FhdJrPWR9lRaxoM8x3fngDPyX/BPFOzO4yDIB8La7KNiwrineyOpT8DBxkSK4GVm/oD6kPfaOGR2cZ92bRQIDAQAB", "password-manager": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv5bFp2VSxFQsS+ZjZNIRWsL/wowXacewSIvimS2/MFN0xCQAgWE7nSHSBG6B+OECPYm6R185KVeKDzzUd45NXs+1/b/PL5Uqymr+qXQu/N7+IL6kqNPqeCrb8dYn+cgGQ1SPl8dhi1xqMdylFIshXLDsUBYqyJRCgsU0E1bC1PxwcbbnVABsUy6gmJa7o3mApneXYR+9ge6rDLMAKhhNEgi5KoX4T5DX0UW5gt5+AZW1yCdVUUtQeCa8Z+Z5Lb20YvdNcvVWR9lhlqbv3G3q9fH2ZlbEvNNy5TqzM236HUrgYh9zEuQgWTAsolgIyL2aKHrC8K82kg848VNHztmLJQIDAQAB"};
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aside-components-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source"), profileDir = path.join(root, "profile");
  for (const { token } of COMPONENTS) {
    const directory = path.join(sourceRoot, token, DEFAULT_VERSION);
    await mkdir(path.join(directory, "nested"), { recursive: true });
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ manifest_version: 3, version: DEFAULT_VERSION, key: keys[token], name: token, permissions: ["aside", "tabs"] }));
    await writeFile(path.join(directory, "nested", "main.js"), `// ${token} payload`);
  }
  return { root, sourceRoot, profileDir };
}

test("copies full payloads without rewriting manifest; repeated install is unchanged", async (t) => {
  const options = await fixture(t);
  const first = await prepareNativeComponents(options);
  assert.equal(first.components.length, 2);
  for (const entry of first.components) {
    assert.equal(entry.status, "installed"); assert.equal(entry.fileCount, 2);
    assert.deepEqual(await readFile(path.join(entry.path, "manifest.json")), await readFile(path.join(options.sourceRoot, entry.token, DEFAULT_VERSION, "manifest.json")));
    assert.equal((await readdir(path.dirname(entry.path))).length, 1);
  }
  const second = await prepareNativeComponents(options);
  assert.ok(second.components.every((entry) => entry.status === "unchanged"));
});

test("different existing version fails preserving both installed payload and user storage", async (t) => {
  const options = await fixture(t);
  const initial = await prepareNativeComponents(options);
  const file = path.join(initial.components[1].path, "nested/main.js");
  await writeFile(file, "existing payload");
  const userFile = path.join(options.profileDir, "user-storage"); await writeFile(userFile, "keep");
  await assert.rejects(prepareNativeComponents(options), /Existing version differs/);
  assert.equal(await readFile(file, "utf8"), "existing payload");
  assert.equal(await readFile(userFile, "utf8"), "keep");
  assert.equal((await readdir(path.dirname(initial.components[1].path))).length, 1);
});

test("reports and preserves higher installed version", async (t) => {
  const options = await fixture(t);
  const higher = path.join(options.profileDir, "aside_component", "agent-manager", "1.26.999.1");
  await mkdir(higher, { recursive: true }); await writeFile(path.join(higher, "keep"), "higher");
  const result = await prepareNativeComponents(options);
  assert.deepEqual(result.components[0].higherVersions, ["1.26.999.1"]);
  assert.equal(await readFile(path.join(higher, "keep"), "utf8"), "higher");
});

test("wrong key or version fails before profile is created", async (t) => {
  const options = await fixture(t);
  const manifestFile = path.join(options.sourceRoot, "password-manager", DEFAULT_VERSION, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  await writeFile(manifestFile, JSON.stringify({ ...manifest, key: keys["agent-manager"] }));
  await assert.rejects(prepareNativeComponents(options), /identity mismatch/);
  await assert.rejects(access(options.profileDir), { code: "ENOENT" });
  await writeFile(manifestFile, JSON.stringify({ ...manifest, version: "1.2.3" }));
  await assert.rejects(prepareNativeComponents(options), /version mismatch/);
  await assert.rejects(prepareNativeComponents({ ...options, version: "../escape" }), /Invalid component version/);
});

test("rejects payload symlinks without copying outside files", async (t) => {
  const options = await fixture(t);
  await symlink("/etc/hostname", path.join(options.sourceRoot, "agent-manager", DEFAULT_VERSION, "external"));
  await assert.rejects(prepareNativeComponents(options), /Symlink/);
  await assert.rejects(access(options.profileDir), { code: "ENOENT" });
});
