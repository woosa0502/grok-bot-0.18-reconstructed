// The browser driver's local execution base. The shipped driver expects a
// container box: a `box-chrome` command, a desktop per agent window, and
// playwright-core inside /workspace. None of those exist in the WSL build, so
// the launcher provisions a shim and a module link and the host gates the tools
// on both being present.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  BOX_CDP_PORT_BASE,
  boxChromeShimScript,
  DRIVER_BOX_DIR,
  ensureLocalBrowserRuntime,
  linkWorkspaceModules,
  LOCAL_BROWSER_WINDOW_SIZE,
  prependPath,
} from "../scripts/lib/local-browser-runtime.mjs";
import { wslHostEnvironment } from "../scripts/lib/wsl-runtime.mjs";

const execFileAsync = promisify(execFile);
const workdir = () => mkdtemp(path.join(tmpdir(), "belmont-local-browser-"));

test("the shim derives the CDP port from DISPLAY so the two cannot disagree", async () => {
  const root = await workdir();
  const shimPath = path.join(root, "box-chrome");
  // /bin/echo stands in for Chrome: running the shim prints the flags it would
  // have launched with, so the port arithmetic is checked, not assumed.
  await writeFile(shimPath, boxChromeShimScript({ chromeBinary: "/bin/echo", profileDir: path.join(root, "profile") }), { mode: 0o755 });

  for (const display of [":99", ":1", ":7.0"]) {
    const window = Number.parseInt(display.replace(/^:/u, "").split(".")[0], 10);
    const { stdout } = await execFileAsync(shimPath, ["--new-window"], { env: { ...process.env, DISPLAY: display } });
    assert.match(stdout, new RegExp(`--remote-debugging-port=${BOX_CDP_PORT_BASE + window}\\b`), `DISPLAY ${display}`);
    assert.match(stdout, /--remote-debugging-address=127\.0\.0\.1/);
    assert.match(stdout, /--new-window/);
  }
});

test("the shim pins the window size and the profile directory", async () => {
  const root = await workdir();
  const profileDir = path.join(root, "profile");
  const shimPath = path.join(root, "box-chrome");
  await writeFile(shimPath, boxChromeShimScript({ chromeBinary: "/bin/echo", profileDir }), { mode: 0o755 });

  const { stdout } = await execFileAsync(shimPath, [], { env: { ...process.env, DISPLAY: ":99" } });
  // Element boxes are reported in viewport coordinates and screenshots feed
  // auto-review, so a size that varies with the window manager would make both
  // irreproducible.
  assert.match(stdout, new RegExp(`--window-size=${LOCAL_BROWSER_WINDOW_SIZE.width},${LOCAL_BROWSER_WINDOW_SIZE.height}\\b`));
  assert.match(stdout, new RegExp(`--user-data-dir=${profileDir.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`));
  // The profile is what keeps the user's logins; it must be created, not assumed.
  assert.ok((await stat(profileDir)).isDirectory());
});

test("a DISPLAY the shim cannot parse falls back to window 0 rather than a bad port", async () => {
  const root = await workdir();
  const shimPath = path.join(root, "box-chrome");
  await writeFile(shimPath, boxChromeShimScript({ chromeBinary: "/bin/echo", profileDir: path.join(root, "profile") }), { mode: 0o755 });

  for (const display of ["", "localhost:10.0"]) {
    const { stdout } = await execFileAsync(shimPath, [], { env: { ...process.env, DISPLAY: display } });
    assert.match(stdout, new RegExp(`--remote-debugging-port=${BOX_CDP_PORT_BASE}\\b`), `DISPLAY ${JSON.stringify(display)}`);
  }
});

test("the shim generator refuses to write a half-configured launcher", () => {
  assert.throws(() => boxChromeShimScript({ profileDir: "/p" }), /chromeBinary/);
  assert.throws(() => boxChromeShimScript({ chromeBinary: "/c" }), /profileDir/);
});

test("provisioning links node_modules next to the driver, not into the workspace", async () => {
  const root = await workdir();
  const workspaceDir = path.join(root, "box-workspace");
  const driverDir = path.join(root, "driver");
  await mkdir(path.join(workspaceDir, "node_modules", "playwright-core"), { recursive: true });
  await writeFile(path.join(workspaceDir, "node_modules", "playwright-core", "package.json"), "{}");

  const result = await ensureLocalBrowserRuntime({
    binDir: path.join(root, "bin"),
    profileDir: path.join(root, "profile"),
    workspaceDir,
    driverDir,
    chromeBinary: "/bin/echo",
  });

  // ESM resolves bare specifiers from the importing FILE's directory, so a
  // package sitting in the workspace is invisible to a driver in /tmp.
  assert.equal(await readlink(path.join(driverDir, "node_modules")), path.join(workspaceDir, "node_modules"));
  assert.deepEqual([...result.missing], []);
  assert.equal(result.chromeBinary, "/bin/echo");
  assert.ok((await readFile(path.join(root, "bin", "box-chrome"), "utf8")).includes("--remote-debugging-port"));
});

test("provisioning reports what is missing instead of throwing", async () => {
  const root = await workdir();
  const result = await ensureLocalBrowserRuntime({
    binDir: path.join(root, "bin"),
    profileDir: path.join(root, "profile"),
    workspaceDir: path.join(root, "absent-workspace"),
    driverDir: path.join(root, "driver"),
    chromeBinary: "/bin/echo",
  });
  // A launcher that died because Chrome was absent would take the whole app down.
  assert.deepEqual([...result.missing], ["playwright-core"]);
});

test("relinking is idempotent and never replaces a real directory", async () => {
  const root = await workdir();
  const target = path.join(root, "modules");
  const other = path.join(root, "other-modules");
  await mkdir(target, { recursive: true });
  await mkdir(other, { recursive: true });

  const linkPath = path.join(root, "link");
  assert.equal(await linkWorkspaceModules(linkPath, target), "linked");
  assert.equal(await linkWorkspaceModules(linkPath, target), "already-linked");

  // A stale link is repointed rather than left aiming at a dead workspace.
  await linkWorkspaceModules(linkPath, other);
  assert.equal(await readlink(linkPath), other);

  const realDir = path.join(root, "real");
  await mkdir(path.join(realDir, "node_modules"), { recursive: true });
  assert.equal(await linkWorkspaceModules(path.join(realDir, "node_modules"), target), "kept-directory");
  assert.ok((await stat(path.join(realDir, "node_modules"))).isDirectory());
});

test("the driver directory constant matches the host's upload path", async () => {
  const source = await readFile(
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "source/host/runner/tools/sand-browser-driver-source.ts"),
    "utf8",
  );
  assert.ok(
    source.includes(`SAND_BROWSER_DRIVER_BOX_DIR = "${DRIVER_BOX_DIR}"`),
    "the launcher cannot import host TypeScript, so this constant is duplicated and must be kept in step",
  );
});

test("the launcher puts the provisioned bin dir ahead of the system PATH", () => {
  const env = { PATH: "/usr/bin:/bin", SAND_DEFAULT_AGENT_ID: "agent" };
  const withBin = wslHostEnvironment({ profileDir: "/tmp/does-not-exist", env, localBinDir: "/opt/belmont/bin" });
  // The driver spawns the bare name "box-chrome"; the shim only wins if it is first.
  assert.equal(withBin.PATH, "/opt/belmont/bin:/usr/bin:/bin");

  const withoutBin = wslHostEnvironment({ profileDir: "/tmp/does-not-exist", env });
  assert.equal(withoutBin.PATH, env.PATH, "no bin dir means the host's PATH passes through unchanged");

  assert.equal(prependPath("/a:/b", "/a"), "/a:/b", "an entry already first is not duplicated");
  assert.equal(prependPath("/a:/b", "/b"), "/b:/a", "an entry further down is promoted, not duplicated");
  assert.equal(prependPath(undefined, "/a"), "/a");
});

test("the idle reaper closes the box browser by host policy, not model memory", async () => {
  // Live 2026-09-01: a ~2GB Chrome idled 16h after a browser test — no driver
  // op closes the browser, agents have no close tool, and Chrome outlives app
  // shutdown. The host must reap it after the idle timeout.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(path.join(repoRoot, "source/host/box/local-browser-use.ts"), "utf8");
  // every driver op refreshes the idle clock
  assert.match(source, /async execute\(_context, args\) \{\s*\/\/[^]*?noteLocalBrowserUse\(\);/);
  // the kill is scoped to OUR chrome profile only
  assert.match(source, /execFile\("pkill", \["-TERM", "-f", profileDir\]/);
  // a leftover from a previous run is armed at boot
  assert.match(source, /armReaperForLeftoverChrome/);
  // and the timeout knob parses safely
  const { build } = await import("esbuild");
  const result = await build({
    stdin: { resolveDir: repoRoot, loader: "ts", sourcefile: "reaper-entry.ts",
      contents: 'export { localBrowserIdleTimeoutMs, LOCAL_BROWSER_IDLE_TIMEOUT_ENV } from "./source/host/box/local-browser-use.js";' },
    bundle: true, format: "esm", platform: "node", write: false, supported: { using: false },
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  });
  // createRequire needs a real file URL, so the bundle lands in a temp file.
  const dir = await workdir();
  const bundlePath = path.join(dir, "reaper-bundle.mjs");
  await writeFile(bundlePath, result.outputFiles[0].text);
  const mod = await import(`file://${bundlePath}`);
  assert.equal(mod.localBrowserIdleTimeoutMs({}), 600_000);
  assert.equal(mod.localBrowserIdleTimeoutMs({ SAND_BROWSER_IDLE_TIMEOUT_SECONDS: "60" }), 60_000);
  assert.equal(mod.localBrowserIdleTimeoutMs({ SAND_BROWSER_IDLE_TIMEOUT_SECONDS: "0" }), 0);
  assert.equal(mod.localBrowserIdleTimeoutMs({ SAND_BROWSER_IDLE_TIMEOUT_SECONDS: "banana" }), 600_000);
});
