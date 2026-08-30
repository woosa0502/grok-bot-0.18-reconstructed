// Persistent foreground-shell state for the box exec daemon (cwd + exported env
// survive between Shell calls, as the tool result promises).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

async function loadShellState() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/box-exec-daemon/shell-state.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function runSh(script, cwd) {
  return execFileAsync("/bin/sh", ["-lc", script], { cwd });
}

test("wrapped commands persist cwd and exported env across separate sh invocations", async () => {
  const { buildShellStateWrappedCommand, SHELL_STATE_CWD_FILE, SHELL_STATE_ENV_FILE } = await loadShellState();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-shell-state-"));
  try {
    const workspace = path.join(root, "workspace");
    const stateDir = path.join(root, "state");
    await mkdir(path.join(workspace, "sub"), { recursive: true });

    await runSh(buildShellStateWrappedCommand(stateDir, "cd sub && export FOO=\"b a'r\" && echo first"), workspace);
    const savedCwd = (await readFile(path.join(stateDir, SHELL_STATE_CWD_FILE), "utf8")).trim();
    assert.equal(savedCwd, path.join(workspace, "sub"));
    const env = await readFile(path.join(stateDir, SHELL_STATE_ENV_FILE), "utf8");
    assert.match(env, /FOO=/);
    assert.doesNotMatch(env, /^(export |declare -x )(PWD|OLDPWD|SHLVL)(=|$)/m, "volatile shell vars are not restored");

    // Second call: the daemon starts the shell in the saved cwd and the wrapper restores the env.
    const second = await runSh(buildShellStateWrappedCommand(stateDir, "pwd -P; printf '%s\\n' \"$FOO\""), savedCwd);
    assert.deepEqual(second.stdout.trim().split("\n"), [path.join(workspace, "sub"), "b a'r"]);

    // A command that fails still snapshots the state, and the exit code is preserved.
    await assert.rejects(runSh(buildShellStateWrappedCommand(stateDir, "cd .. && exit 3"), savedCwd), (error) => error.code === 3);
    assert.equal((await readFile(path.join(stateDir, SHELL_STATE_CWD_FILE), "utf8")).trim(), workspace);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("logical path mapping and quoting", async () => {
  const { toLogicalWorkspacePath, isInsideWorkspace, posixQuote } = await loadShellState();
  assert.equal(toLogicalWorkspacePath("/tmp/ws", "/tmp/ws"), "/workspace");
  assert.equal(toLogicalWorkspacePath("/tmp/ws", "/tmp/ws/a/b"), "/workspace/a/b");
  assert.equal(toLogicalWorkspacePath("/tmp/ws", "/etc"), "/etc");
  assert.equal(isInsideWorkspace("/tmp/ws", "/tmp/ws/a"), true);
  assert.equal(isInsideWorkspace("/tmp/ws", "/tmp/wsx"), false);
  assert.equal(posixQuote("it's"), `'it'\\''s'`);
});

test("daemon shell routes start from the saved cwd, wrap the command, and report the cwd after the command", async () => {
  const server = await readFile(path.join(repoRoot, "source/box-exec-daemon/server.ts"), "utf8");
  // The non-streaming route serves internal probes (browser/computer tools); it must
  // not read or write the agent shell's persisted state.
  const shell = server.slice(server.indexOf("  async shell(args: ShellArgs"), server.indexOf("  async *shellStream("));
  assert.match(shell, /cwd = this\.resolvePath\(args\.workingDirectory\)/);
  assert.doesNotMatch(shell, /#withShellState|#startingCwd|#savedCwdLogical|#resetShellState/);
  const stream = server.slice(server.indexOf("  async *shellStream("), server.indexOf("  async *shellStream(") + 14_000);
  assert.match(stream, /const cwd = await this\.#startingCwd\(args\.workingDirectory\)/);
  assert.match(stream, /this\.spawnShell\(this\.#withShellState\(args\.command\), cwd\)/);
  assert.match(stream, /cwd: signal\.aborted \? args\.workingDirectory : \(await this\.#savedCwdLogical\(\)\) \?\? args\.workingDirectory/);
  const shellTool = await readFile(path.join(repoRoot, "source/packages/agent/tools/core/shell/create-shell-tool.ts"), "utf8");
  assert.match(shellTool, /workingDirectory: value\.cwd\.length > 0 \? value\.cwd : workingDirectory/);
});
