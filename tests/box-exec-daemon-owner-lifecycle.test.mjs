import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function accepts(port) {
  return await new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function eventually(predicate, description) {
  const deadline = Date.now() + 8000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, description);
    await pause(20);
  }
}

async function setup(t) {
  const cache = path.join(root, "node_modules/.cache/belmont-tests");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(path.join(cache, "daemon-owner-"));
  const daemon = path.join(directory, "daemon.cjs");
  const owner = path.join(directory, "owner.cjs");
  const compile = (outfile, contents) => build({
    stdin: { contents, resolveDir: root, loader: "ts" }, outfile,
    bundle: true, platform: "node", format: "cjs", packages: "external",
    supported: { using: false },
  });
  await compile(daemon, `import { runBoxExecDaemonEntrypoint } from "./source/box-exec-daemon/main.js";
    runBoxExecDaemonEntrypoint().catch(error => { console.error(error); process.exitCode = 1; });`);
  await compile(owner, `
    import { startBoxExecDaemonProcess } from "./source/host/box/exec-daemon-process.js";
    import { createConnectTransport } from "@connectrpc/connect-node";
    import { createPromiseClient } from "@connectrpc/connect";
    import { ControlService } from "./source/packages/proto/generated/agent/v1/control_service_connect.js";
    import { ExecService } from "./source/packages/proto/generated/agent/v1/exec_service_connect.js";
    import { ExecServerMessage } from "./source/packages/proto/generated/agent/v1/exec_pb.js";
    import { BackgroundShellSpawnArgs } from "./source/packages/proto/generated/agent/v1/background_shell_exec_pb.js";
    startBoxExecDaemonProcess({ entryPath: process.argv[2], port: Number(process.env.SAND_BOX_EXEC_DAEMON_PORT),
      workspaceRoot: process.env.SAND_BOX_WORKSPACE_ROOT, terminalsDirectory: process.env.SAND_BOX_TERMINALS_DIRECTORY,
      generated: { createTransport: createConnectTransport, createControlClient: transport => ({
        ping: (_ctx, request, options) => createPromiseClient(ControlService, transport).ping(request, options),
      }) },
    }).then(async handle => {
      let shellPid;
      if (process.argv[3]) {
        const transport = createConnectTransport({ httpVersion: "1.1", baseUrl: "http://127.0.0.1:" + process.env.SAND_BOX_EXEC_DAEMON_PORT });
        for await (const item of createPromiseClient(ExecService, transport).exec(new ExecServerMessage({
          id: 1, execId: "owner-lifecycle-background", message: { case: "backgroundShellSpawnArgs", value: new BackgroundShellSpawnArgs({ command: process.argv[3] }) },
        }), { headers: { authorization: "Bearer local" } })) {
          if (item.element.case === "execClientMessage" && item.element.value.message.case === "backgroundShellSpawnResult") {
            const result = item.element.value.message.value.result;
            if (result.case !== "success") throw new Error(JSON.stringify(result));
            shellPid = result.value.pid;
          }
        }
      }
      process.send({ ready: true, pid: handle.pid, shellPid });
    }).catch(error => {
      console.error(error); process.exit(1);
    });
  `);
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, SAND_BOX_EXEC_DAEMON_PORT: String(port),
    SAND_BOX_WORKSPACE_ROOT: path.join(directory, "workspace"),
    SAND_BOX_TERMINALS_DIRECTORY: path.join(directory, "terminals") };
  const children = [];
  const daemonPids = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    for (const pid of daemonPids) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await rm(directory, { recursive: true, force: true });
  });
  const launch = (entry, args = [], ipc = true) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env, stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    child.output = "";
    child.stdout.on("data", data => { child.output += data; });
    child.stderr.on("data", data => { child.output += data; });
    return child;
  };
  return { daemon, owner, port, launch, daemonPids, directory };
}

test("host SIGKILL releases its real daemon port and permits a fresh owned startup", { timeout: 30000 }, async t => {
  const fixture = await setup(t);
  for (let cycle = 0; cycle < 2; cycle++) {
    const owner = fixture.launch(fixture.owner, [fixture.daemon]);
    const [ready] = await Promise.race([
      once(owner, "message"),
      once(owner, "exit").then(status => { throw new Error(`owner failed ${status}: ${owner.output}`); }),
    ]);
    assert.equal(ready.ready, true);
    fixture.daemonPids.push(ready.pid);
    assert.equal(await accepts(fixture.port), true);
    const exited = once(owner, "exit");
    owner.kill("SIGKILL");
    await exited;
    await eventually(async () => !await accepts(fixture.port), `orphan daemon kept port after cycle ${cycle}`);
  }
});

test("owner disconnect before daemon readiness does not leave a listener", { timeout: 15000 }, async t => {
  const fixture = await setup(t);
  const child = fixture.launch(fixture.daemon);
  const exited = once(child, "exit");
  child.disconnect();
  const [code, signal] = await exited;
  assert.equal(code, 0, child.output);
  assert.equal(signal, null, child.output);
  assert.equal(await accepts(fixture.port), false);
});

test("standalone daemon without IPC stays available until explicitly stopped", { timeout: 15000 }, async t => {
  const fixture = await setup(t);
  const child = fixture.launch(fixture.daemon, [], false);
  await eventually(() => child.output.includes("box-exec-daemon-ready"), child.output);
  await pause(100);
  assert.equal(await accepts(fixture.port), true);
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const [code, signal] = await exited;
  assert.equal(code, 0, child.output);
  assert.equal(signal, null, child.output);
  assert.equal(await accepts(fixture.port), false);
});

test("owner death terminates its TERM-ignoring descendant and closes an unfinished HTTP request", { timeout: 20000, skip: process.platform !== "linux" }, async t => {
  const fixture = await setup(t);
  const identityFile = path.join(fixture.directory, "descendant.json");
  const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
  const python = `import json,os,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); open(${JSON.stringify(identityFile)},"w").write(json.dumps({"pid":os.getpid(),"pgid":os.getpgrp()})); os.close(0); os.close(1); os.close(2); time.sleep(60)`;
  const owner = fixture.launch(fixture.owner, [fixture.daemon, `python3 -c ${quote(python)} & wait`]);
  const [ready] = await Promise.race([
    once(owner, "message"),
    once(owner, "exit").then(status => { throw new Error(`owner failed ${status}: ${owner.output}`); }),
  ]);
  fixture.daemonPids.push(ready.pid);
  await eventually(() => readFile(identityFile).then(() => true, () => false), "descendant identity was not written");
  const identity = JSON.parse(await readFile(identityFile, "utf8"));
  assert.equal(identity.pgid, ready.shellPid);
  const snapshot = async pid => {
    try {
      const raw = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
      return { pid, state: fields[0], starttime: fields[19] };
    } catch { return { pid, state: "gone" }; }
  };
  const before = await snapshot(identity.pid);
  assert.notEqual(before.state, "gone");
  t.after(async () => {
    const current = await snapshot(identity.pid);
    if (current.starttime === before.starttime && !["gone", "Z"].includes(current.state)) process.kill(identity.pid, "SIGKILL");
  });
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => { sentinel.kill("SIGKILL"); });
  const socket = createConnection({ host: "127.0.0.1", port: fixture.port });
  socket.on("error", () => {});
  t.after(() => socket.destroy());
  await once(socket, "connect");
  socket.write("POST /agent.v1.ControlService/Ping HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer local\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\n\r\n{");
  const socketClosed = once(socket, "close");
  const exited = once(owner, "exit");
  const started = Date.now();
  owner.kill("SIGKILL");
  await exited;
  await eventually(async () => ["gone", "Z"].includes((await snapshot(identity.pid)).state), "owned descendant survived owner death");
  await socketClosed;
  await eventually(async () => !await accepts(fixture.port), "daemon listener remained bound");
  assert.equal(sentinel.exitCode, null);
  assert.equal(sentinel.signalCode, null);
  t.diagnostic(JSON.stringify({ before, after: await snapshot(identity.pid), shellPid: ready.shellPid, daemonPid: ready.pid, elapsedMs: Date.now() - started, sentinelPid: sentinel.pid, sentinelAlive: true }));
  const restarted = fixture.launch(fixture.daemon, [], false);
  await eventually(() => restarted.output.includes("box-exec-daemon-ready"), "fresh daemon could not listen");
  const restartedExit = once(restarted, "exit");
  restarted.kill("SIGTERM");
  assert.equal((await restartedExit)[0], 0);
});
