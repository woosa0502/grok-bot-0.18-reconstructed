import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";

import { ensureChrome, verifyReusableNativeChrome } from "../belmont-browse/src/chrome.mjs";
import { MiniCdp } from "../belmont-browse/src/cdp-mini.mjs";
import { attachRealExtension, verifyNativeComponentVersions } from "../belmont-browse/src/core.mjs";
import { launchChromeWithPipe } from "../belmont-browse/src/cdp-relay.mjs";

const AGENT_URL = "chrome-extension://fjdhphbdlfjogobdofoaagnlnkoibdge/background.js";
const EXPECTED_VERSION = "1.26.907.1712";
const PROFILE_ID = "6ea8efdb-6379-4a60-a7bf-3288511c2d5c";
const ROUTING_PROFILE_ID = "belmont-ui";

function nativeWorker(targetId, {
  accountId = 0,
  profileId = PROFILE_ID,
  bridgeProfileId,
  agentVersion = EXPECTED_VERSION,
  passwordManagerVersion = EXPECTED_VERSION,
  passwordManagerEnabled = true,
  exceptionDetails,
} = {}) {
  return {
    targetId,
    type: "service_worker",
    url: AGENT_URL,
    response: exceptionDetails
      ? { exceptionDetails }
      : {
          result: {
            value: {
              profile: { boundAccountId: accountId, profileId },
              ...(bridgeProfileId === undefined ? {} : { bridgeProfileId }),
              agentVersion,
              passwordManager: {
                version: passwordManagerVersion,
                enabled: passwordManagerEnabled,
              },
            },
          },
        },
  };
}

class FakeCdp {
  constructor(workers) {
    this.workers = workers;
    this.visitedTargets = [];
    this.connected = false;
  }

  async connect() {
    this.connected = true;
  }

  async send(method, params) {
    if (method === "Target.getTargets") {
      return {
        targetInfos: [
          { targetId: "ordinary-page", type: "page", url: "about:blank" },
          ...this.workers.map(({ response: _response, ...target }) => target),
        ],
      };
    }
    assert.equal(method, "Browser.getWindowForTarget");
    assert.deepEqual(params, { targetId: "ordinary-page" });
    return { windowId: 72 };
  }

  async pageTargets() {
    return [{ targetId: "ordinary-page", type: "page", url: "about:blank" }];
  }

  async withTarget(targetId, fn) {
    const worker = this.workers.find((candidate) => candidate.targetId === targetId);
    assert.ok(worker, `unknown worker ${targetId}`);
    this.visitedTargets.push(targetId);
    return fn(async (method, params) => {
      assert.equal(method, "Runtime.evaluate");
      assert.equal(params.awaitPromise, true);
      assert.equal(params.returnByValue, true);
      assert.match(params.expression, /chrome\.asideAccount\.getProfileContext/);
      assert.match(params.expression, /extensionBridgeProfileId/);
      assert.match(params.expression, /clcdgiameigmljcbkkcbjiljinmfkncl/);
      return worker.response;
    });
  }
}

function bridgeEntry(connectionId, profileId) {
  return {
    connectionId,
    accountId: 0,
    profileId,
    ws: { readyState: 1 },
  };
}

function attach(cdp, entries, overrides = {}) {
  return attachRealExtension({
    bridge: { connections: new Map(entries.map((entry) => [entry.connectionId, entry])) },
    cdp,
    accountId: 0,
    log: () => {},
    nativeComponentVersion: EXPECTED_VERSION,
    timeoutMs: 25,
    ...overrides,
  });
}

function verify(cdp, overrides = {}) {
  return verifyNativeComponentVersions({
    cdp,
    accountId: 0,
    profileId: PROFILE_ID,
    expectedVersion: EXPECTED_VERSION,
    ...overrides,
  });
}

test("native component verifier accepts an exact agent and password-manager pair", async () => {
  const cdp = new FakeCdp([nativeWorker("exact")]);
  assert.deepEqual(await verify(cdp), {
    version: EXPECTED_VERSION,
    profileId: PROFILE_ID,
    nativeProfileId: PROFILE_ID,
    accountId: 0,
  });
  assert.deepEqual(cdp.visitedTargets, ["exact"]);
});

test("native component verifier rejects an agent version mismatch", async () => {
  const cdp = new FakeCdp([nativeWorker("agent-mismatch", {
    agentVersion: "1.26.908.1846",
  })]);
  await assert.rejects(() => verify(cdp), /engine 1\.26\.907\.1712, agent 1\.26\.908\.1846/);
});

test("native component verifier rejects a password-manager version mismatch", async () => {
  const cdp = new FakeCdp([nativeWorker("password-mismatch", {
    passwordManagerVersion: "1.26.908.1846",
  })]);
  await assert.rejects(() => verify(cdp), /password manager 1\.26\.908\.1846/);
});

test("native component verifier rejects a disabled password manager", async () => {
  const cdp = new FakeCdp([nativeWorker("password-disabled", {
    passwordManagerEnabled: false,
  })]);
  await assert.rejects(() => verify(cdp), /Aside component\/engine mismatch/);
});

test("native component verifier does not accept a matching pair from the wrong profile", async () => {
  const cdp = new FakeCdp([nativeWorker("wrong-profile", {
    profileId: "other-profile",
  })]);
  await assert.rejects(() => verify(cdp), /Could not verify native Aside component versions for the bound profile/);
});

test("native component verifier finds the matching bound profile among multiple workers", async () => {
  const cdp = new FakeCdp([
    nativeWorker("wrong-profile", {
      profileId: "other-profile",
      agentVersion: "0.0.0.0",
      passwordManagerVersion: "0.0.0.0",
      passwordManagerEnabled: false,
    }),
    nativeWorker("matching-profile"),
  ]);
  assert.deepEqual(await verify(cdp), {
    version: EXPECTED_VERSION,
    profileId: PROFILE_ID,
    nativeProfileId: PROFILE_ID,
    accountId: 0,
  });
  assert.deepEqual(cdp.visitedTargets, ["wrong-profile", "matching-profile"]);
});

test("real extension binding waits for a verified native profile", { timeout: 5000 }, async (t) => {
  await t.test("accepts a persisted bridge id that differs from the native profile id", async () => {
    const cdp = new FakeCdp([nativeWorker("native-worker", {
      bridgeProfileId: ROUTING_PROFILE_ID,
    })]);
    assert.deepEqual(await verify(cdp, { profileId: ROUTING_PROFILE_ID }), {
      version: EXPECTED_VERSION,
      profileId: ROUTING_PROFILE_ID,
      nativeProfileId: PROFILE_ID,
      accountId: 0,
    });
  });

  await t.test("rejects the native profile id when storage names a different bridge route", async () => {
    const cdp = new FakeCdp([nativeWorker("native-worker", {
      bridgeProfileId: ROUTING_PROFILE_ID,
    })]);
    await assert.rejects(
      () => verify(cdp, { profileId: PROFILE_ID }),
      /Could not verify native Aside component versions for the bound profile/,
    );
  });

  await t.test("skips a stale matching-account route and binds the later persisted native route", async () => {
    const cdp = new FakeCdp([nativeWorker("native-worker", {
      bridgeProfileId: ROUTING_PROFILE_ID,
    })]);
    const shim = bridgeEntry("legacy-shim", "unrelated-stale-route");
    const native = bridgeEntry("native-907", ROUTING_PROFILE_ID);

    const attached = await attach(cdp, [shim, native]);

    assert.equal(cdp.connected, true);
    assert.equal(attached.real, true);
    assert.equal(attached.profileId, ROUTING_PROFILE_ID);
    assert.equal(attached.nativeProfileId, PROFILE_ID);
    assert.equal(attached.windowId, 72);
    assert.equal(attached.entry, native);
  });

  await t.test("keeps an exact-profile agent version mismatch fatal", async () => {
    const cdp = new FakeCdp([nativeWorker("native-worker", {
      bridgeProfileId: ROUTING_PROFILE_ID,
      agentVersion: "1.26.908.1846",
    })]);
    await assert.rejects(
      () => attach(cdp, [
        bridgeEntry("legacy-shim", "unrelated-stale-route"),
        bridgeEntry("native-mismatch", ROUTING_PROFILE_ID),
      ]),
      /engine 1\.26\.907\.1712, agent 1\.26\.908\.1846/,
    );
  });

  await t.test("keeps a disabled exact-profile password manager fatal", async () => {
    const cdp = new FakeCdp([nativeWorker("native-worker", {
      bridgeProfileId: ROUTING_PROFILE_ID,
      passwordManagerEnabled: false,
    })]);
    await assert.rejects(
      () => attach(cdp, [bridgeEntry("native-disabled", ROUTING_PROFILE_ID)]),
      /Aside component\/engine mismatch/,
    );
  });

  await t.test("fails at the startup deadline when no native profile appears", async () => {
    const cdp = new FakeCdp([]);
    await assert.rejects(
      () => attach(cdp, [bridgeEntry("legacy-shim", ROUTING_PROFILE_ID)]),
      /Aside extension did not register|Could not verify native Aside component versions/,
    );
  });
});

async function createFakeChrome(directory) {
  const executable = path.join(directory, "fake-chrome.mjs");
  const wsModule = path.resolve(import.meta.dirname, "../node_modules/ws/wrapper.mjs");
  await writeFile(executable, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import http from "node:http";
import { WebSocketServer } from ${JSON.stringify(wsModule)};

writeFileSync(process.env.BELMONT_TEST_CHROME_ARGV_FILE, JSON.stringify(process.argv.slice(2)));
if (process.env.BELMONT_TEST_CHROME_HOME_FILE) {
  writeFileSync(process.env.BELMONT_TEST_CHROME_HOME_FILE, JSON.stringify(process.env.ASIDE_HOME ?? null));
}
const portArgument = process.argv.find((argument) => argument.startsWith("--remote-debugging-port="));
const port = portArgument ? Number(portArgument.split("=")[1]) : null;
const webSockets = new WebSocketServer({ noServer: true });
const server = port == null ? null : http.createServer((request, response) => {
  if (request.url === "/json/version") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/browser/fake" }));
    return;
  }
  response.statusCode = 404;
  response.end();
});
server?.on("upgrade", (request, socket, head) => {
  webSockets.handleUpgrade(request, socket, head, (client) => webSockets.emit("connection", client));
});
webSockets.on("connection", (client) => client.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  const result = message.method === "SystemInfo.getProcessInfo"
    ? { processInfo: [{ type: "browser", id: process.pid }] }
    : {};
  client.send(JSON.stringify({ id: message.id, result }));
}));
server?.listen(port, "127.0.0.1");
const shutdown = () => {
  for (const client of webSockets.clients) client.terminate();
  webSockets.close();
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
};
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1000);
`);
  await chmod(executable, 0o755);
  return executable;
}

async function waitForJson(file, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  try { await exited; }
  finally { clearTimeout(timer); }
}

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function withEnvironment(changes, fn) {
  const previous = new Map(Object.keys(changes).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await fn(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("pipe launch passes the selected engine version and overrides an inherited wrong Aside home", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "belmont-native-pipe-"));
  const argvFile = path.join(directory, "argv.json");
  const homeFile = path.join(directory, "aside-home.json");
  const selectedHome = path.join(directory, "selected-aside-home");
  const fakeChrome = await createFakeChrome(directory);
  let child;
  try {
    await withEnvironment({
      ASIDE_HOME: path.join(directory, "wrong-inherited-home"),
      BELMONT_TEST_CHROME_ARGV_FILE: argvFile,
      BELMONT_TEST_CHROME_HOME_FILE: homeFile,
    }, async () => {
      child = launchChromeWithPipe({
        profileDir: path.join(directory, "profile"),
        chromeBinary: fakeChrome,
        nativeComponentVersion: EXPECTED_VERSION,
        asideHome: selectedHome,
        log: () => {},
      });
      const argv = await waitForJson(argvFile);
      const observedHome = await waitForJson(homeFile);
      assert.ok(argv.includes("--remote-debugging-pipe"));
      assert.ok(argv.includes(`--aside-component-version=${EXPECTED_VERSION}`));
      assert.ok(argv.indexOf(`--aside-component-version=${EXPECTED_VERSION}`) < argv.indexOf("about:blank"));
      assert.equal(observedHome, path.resolve(selectedHome));
    });
  } finally {
    await terminate(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test("port launch keeps the selected pin, overrides the inherited Aside home, and guards reuse", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "belmont-native-port-"));
  const argvFile = path.join(directory, "argv.json");
  const homeFile = path.join(directory, "aside-home.json");
  const profileDir = path.join(directory, "profile");
  const selectedHome = path.join(directory, "selected-aside-home");
  const fakeChrome = await createFakeChrome(directory);
  const port = await unusedPort();
  let chrome;
  try {
    await withEnvironment({
      ASIDE_HOME: path.join(directory, "wrong-inherited-home"),
      BELMONT_TEST_CHROME_ARGV_FILE: argvFile,
      BELMONT_TEST_CHROME_HOME_FILE: homeFile,
      BELMONT_BROWSE_CHROME_ARGS: "--enable-logging=stderr --v=2",
    }, async () => {
      chrome = await ensureChrome({
        port,
        profileDir,
        chromeBinary: fakeChrome,
        nativeComponentVersion: EXPECTED_VERSION,
        asideHome: selectedHome,
        startupTimeoutMs: 3000,
        pollIntervalMs: 20,
        log: () => {},
      });
      const argv = await waitForJson(argvFile);
      const observedHome = await waitForJson(homeFile);
      const userFlag = argv.indexOf("--v=2");
      const pin = argv.indexOf(`--aside-component-version=${EXPECTED_VERSION}`);
      const startUrl = argv.indexOf("about:blank");
      assert.ok(userFlag >= 0 && userFlag < pin && pin < startUrl, JSON.stringify(argv));
      assert.equal(observedHome, path.resolve(selectedHome));
      assert.deepEqual(await verifyReusableNativeChrome({
        baseUrl: chrome.baseUrl,
        profileDir,
        nativeComponentVersion: EXPECTED_VERSION,
        asideHome: selectedHome,
      }), {
        pid: chrome.child.pid,
        version: EXPECTED_VERSION,
        profileDir: path.resolve(profileDir),
        asideHome: path.resolve(selectedHome),
      });
      await assert.rejects(() => verifyReusableNativeChrome({
        baseUrl: chrome.baseUrl,
        profileDir,
        nativeComponentVersion: EXPECTED_VERSION,
        asideHome: path.join(directory, "different-selected-home"),
      }), /different or missing Aside account home/);
    });
  } finally {
    await terminate(chrome?.child);
    await rm(directory, { recursive: true, force: true });
  }
});

test("native port launch rejects an end-of-options marker before spawning Chrome", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "belmont-native-option-end-"));
  const argvFile = path.join(directory, "argv.json");
  const fakeChrome = await createFakeChrome(directory);
  const port = await unusedPort();
  try {
    await withEnvironment({
      BELMONT_TEST_CHROME_ARGV_FILE: argvFile,
      BELMONT_BROWSE_CHROME_ARGS: "--enable-logging=stderr --",
    }, async () => {
      await assert.rejects(() => ensureChrome({
        port,
        profileDir: path.join(directory, "profile"),
        chromeBinary: fakeChrome,
        nativeComponentVersion: EXPECTED_VERSION,
        startupTimeoutMs: 300,
        pollIntervalMs: 20,
        log: () => {},
      }), /does not accept an end-of-options marker/);
      await assert.rejects(() => readFile(argvFile, "utf8"), { code: "ENOENT" });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const liveFixtureEnabled = process.env.BELMONT_NATIVE_VERSION_LIVE === "1";

test("live fixture rejects engine 907 against the installed 908 pair and unpinned reuse without stopping its owners", {
  skip: liveFixtureEnabled ? false : "set BELMONT_NATIVE_VERSION_LIVE=1 for the preserved local fixture",
}, async () => {
  const daemonPid = Number(process.env.BELMONT_NATIVE_VERSION_DAEMON_PID ?? 213007);
  const chromePid = Number(process.env.BELMONT_NATIVE_VERSION_CHROME_PID ?? 213027);
  const endpoint = process.env.BELMONT_NATIVE_VERSION_CDP ?? "http://127.0.0.1:9333";
  const expectedProfilePath = process.env.BELMONT_NATIVE_VERSION_PROFILE_PATH
    ?? "/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside-remaining-closure-20260908/final-default-account0-fixture/chrome-profile";
  const alive = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch { return false; }
  };
  assert.ok(alive(daemonPid), `fixture daemon ${daemonPid} is not alive`);
  assert.ok(alive(chromePid), `fixture Chrome ${chromePid} is not alive`);
  const beforeCmdline = readFileSync(`/proc/${chromePid}/cmdline`, "utf8");
  assert.match(beforeCmdline, new RegExp(`--user-data-dir=${expectedProfilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\0|$)`));

  await assert.rejects(() => verifyReusableNativeChrome({
    baseUrl: endpoint,
    profileDir: expectedProfilePath,
    nativeComponentVersion: EXPECTED_VERSION,
  }), /different profile or no matching component-version pin/);

  const cdp = new MiniCdp(endpoint);
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    assert.equal(processInfo.find((entry) => entry.type === "browser")?.id, chromePid);
    await assert.rejects(() => verify(cdp), (error) => {
      assert.match(error.message, /engine 1\.26\.907\.1712/);
      assert.match(error.message, /agent 1\.26\.908\.1846/);
      assert.match(error.message, /password manager 1\.26\.908\.1846/);
      return true;
    });
    await cdp.send("Browser.getVersion");
  } finally {
    await cdp.close();
  }

  assert.ok(alive(daemonPid), `fixture daemon ${daemonPid} stopped during verification`);
  assert.ok(alive(chromePid), `fixture Chrome ${chromePid} stopped during verification`);
  assert.equal(readFileSync(`/proc/${chromePid}/cmdline`, "utf8"), beforeCmdline);
});

const liveHomeFixtureEnabled = process.env.BELMONT_NATIVE_HOME_LIVE === "1";

test("live pinned fixture rejects reuse when the selected Aside account home is missing without stopping its owners", {
  skip: liveHomeFixtureEnabled ? false : "set BELMONT_NATIVE_HOME_LIVE=1 for the preserved current fixture",
}, async () => {
  const daemonPid = Number(process.env.BELMONT_NATIVE_HOME_DAEMON_PID ?? 278082);
  const chromePid = Number(process.env.BELMONT_NATIVE_HOME_CHROME_PID ?? 278129);
  const endpoint = process.env.BELMONT_NATIVE_HOME_CDP ?? "http://127.0.0.1:9333";
  const profileDir = process.env.BELMONT_NATIVE_HOME_PROFILE
    ?? "/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside-remaining-closure-20260908/final-default-account0-fixture/chrome-profile";
  const asideHome = process.env.BELMONT_NATIVE_HOME_EXPECTED
    ?? "/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside-remaining-closure-20260908/final-default-account0-fixture/aside-home-907";
  const alive = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch { return false; }
  };
  assert.ok(alive(daemonPid), `fixture daemon ${daemonPid} is not alive`);
  assert.ok(alive(chromePid), `fixture Chrome ${chromePid} is not alive`);
  const beforeCmdline = readFileSync(`/proc/${chromePid}/cmdline`, "utf8");
  const beforeEnviron = readFileSync(`/proc/${chromePid}/environ`, "utf8");
  assert.equal(beforeEnviron.split("\0").some((entry) => entry.startsWith("ASIDE_HOME=")), false);

  await assert.rejects(() => verifyReusableNativeChrome({
    baseUrl: endpoint,
    profileDir,
    nativeComponentVersion: EXPECTED_VERSION,
    asideHome,
  }), /different or missing Aside account home/);

  const cdp = new MiniCdp(endpoint);
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    assert.equal(processInfo.find((entry) => entry.type === "browser")?.id, chromePid);
    await cdp.send("Browser.getVersion");
  } finally {
    await cdp.close();
  }
  assert.ok(alive(daemonPid), `fixture daemon ${daemonPid} stopped during verification`);
  assert.ok(alive(chromePid), `fixture Chrome ${chromePid} stopped during verification`);
  assert.equal(readFileSync(`/proc/${chromePid}/cmdline`, "utf8"), beforeCmdline);
  assert.equal(readFileSync(`/proc/${chromePid}/environ`, "utf8"), beforeEnviron);
});
