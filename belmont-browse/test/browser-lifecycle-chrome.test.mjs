import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { ensureChrome } from "../src/chrome.mjs";
import { createCdpRelay, startPipedChrome } from "../src/cdp-relay.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const quiet = () => {};
async function freePort() {
  const server = http.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "browser-lifecycle-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = path.join(dir, "fake-chrome.mjs");
  writeFileSync(binary, `#!${process.execPath}
import {createReadStream,createWriteStream,appendFileSync,writeFileSync} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {WebSocketServer} from ${JSON.stringify(pathToFileURL(path.join(ROOT, "node_modules/ws/wrapper.mjs")).href)};
const args=process.argv.slice(2), profile=args.find(x=>x.startsWith('--user-data-dir=')).split('=').slice(1).join('='), mode=args.at(-1);
const record=(entry)=>appendFileSync(profile+'/observed.jsonl',JSON.stringify(entry)+'\\n');
writeFileSync(profile+'/pid',String(process.pid));
process.on('SIGTERM',()=>{record({signal:'SIGTERM'});if(mode!=='ignore-close')process.exit(0)});
function command(message,reply){record({method:message.method});if(message.method==='Browser.getVersion'&&mode==='no-start')return;
if(message.method==='Browser.close'){if(mode==='ignore-close')return;reply({id:message.id,result:{}});setTimeout(()=>process.exit(0),20);return}
if(message.method==='SystemInfo.getProcessInfo'){reply({id:message.id,result:{processInfo:[{type:'browser',id:mode==='foreign-cdp'?1:process.pid}]}});return}
reply({id:message.id,result:{product:'FakeChrome'}})}
if(args.includes('--remote-debugging-pipe')){const input=new net.Socket({fd:3,readable:true,writable:false}),output=new net.Socket({fd:4,readable:false,writable:true});let buffer='';input.on('data',data=>{buffer+=data;let cut;while((cut=buffer.indexOf('\\0'))>=0){let raw=buffer.slice(0,cut);buffer=buffer.slice(cut+1);if(raw)command(JSON.parse(raw),value=>output.write(JSON.stringify(value)+'\\0'))}})}
else {const port=Number(args.find(x=>x.startsWith('--remote-debugging-port=')).split('=')[1]);const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://127.0.0.1:'+port+'/cdp'}))});const ws=new WebSocketServer({server});ws.on('connection',socket=>socket.on('message',raw=>command(JSON.parse(raw),value=>socket.send(JSON.stringify(value)))));server.listen(port,'127.0.0.1')}
`);
  chmodSync(binary, 0o700);
  return { dir, binary, observations: () => existsSync(path.join(dir, "observed.jsonl")) ? readFileSync(path.join(dir, "observed.jsonl"), "utf8").trim().split("\n").map(JSON.parse) : [] };
}
function assertDead(pid) { assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }); }

test("reused CDP endpoint is untouched by stop", async (t) => {
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; res.end(JSON.stringify({ Browser: "Existing browser" })); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const chrome = await ensureChrome({ port: server.address().port, profileDir: "/does-not-need-to-exist", log: quiet });
  assert.equal(chrome.child, null); await chrome.stop();
  assert.equal(requests, 1); assert.equal(server.listening, true);
});

test("owned TCP Chrome closes via verified CDP Browser.close and exits without signals", async (t) => {
  const f = fixture(t);
  const chrome = await ensureChrome({ port: await freePort(), profileDir: f.dir, chromeBinary: f.binary, startUrl: "normal", pollIntervalMs: 10, startupTimeoutMs: 1000, shutdownTimeoutMs: 1000, log: quiet });
  t.after(() => { if (chrome.child.exitCode === null && chrome.child.signalCode === null) chrome.child.kill("SIGKILL"); });
  const pid = chrome.child.pid; await chrome.detach(); assert.equal(chrome.child.exitCode, null); process.kill(pid, 0); await chrome.stop(); await chrome.stop();
  assertDead(pid);
  assert.ok(f.observations().some((item) => item.method === "Browser.close"));
  assert.ok(!f.observations().some((item) => item.signal));
});

test("unproven CDP process never receives Browser.close; only owned child gets SIGTERM", async (t) => {
  const f = fixture(t);
  const chrome = await ensureChrome({ port: await freePort(), profileDir: f.dir, chromeBinary: f.binary, startUrl: "foreign-cdp", pollIntervalMs: 10, startupTimeoutMs: 1000, shutdownTimeoutMs: 1000, log: quiet });
  t.after(() => { if (chrome.child.exitCode === null && chrome.child.signalCode === null) chrome.child.kill("SIGKILL"); });
  await chrome.stop();
  assert.ok(f.observations().some((item) => item.signal === "SIGTERM"));
  assert.ok(!f.observations().some((item) => item.method === "Browser.close"));
});

test("piped Chrome probe and graceful close remove relay listeners and listening port", async (t) => {
  const f = fixture(t);
  const chrome = await startPipedChrome({ profileDir: f.dir, chromeBinary: f.binary, startUrl: "normal", port: 0, startupTimeoutMs: 1000, shutdownTimeoutMs: 1000, log: quiet });
  t.after(() => { if (chrome.child.exitCode === null && chrome.child.signalCode === null) chrome.child.kill("SIGKILL"); });
  assert.notEqual(chrome.relay.port, 0);
  const ws = new WebSocket(chrome.wsUrl); await once(ws, "open");
  const port = chrome.relay.port; const socketClosed = once(ws, "close"); await chrome.stop(); await socketClosed;
  assertDead(chrome.child.pid); assert.equal(ws.readyState, WebSocket.CLOSED);
  assert.equal(chrome.child.stdio[4].listenerCount("data"), 0);
  assert.equal(chrome.relay.clientCount(), 0);
  const server = http.createServer(); server.listen(port, "127.0.0.1"); await once(server, "listening"); await new Promise((resolve) => server.close(resolve));
  assert.ok(f.observations().some((item) => item.method === "Browser.close"));
  assert.ok(!f.observations().some((item) => item.signal));
});

test("relay bind failure gracefully cleans only the newly launched child", async (t) => {
  const f = fixture(t);
  const server = http.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(startPipedChrome({ profileDir: f.dir, chromeBinary: f.binary, startUrl: "normal", port: server.address().port, startupTimeoutMs: 1000, shutdownTimeoutMs: 1000, log: quiet }), { code: "EADDRINUSE" });
  assert.equal(server.listening, true);
  assertDead(Number(readFileSync(path.join(f.dir, "pid"), "utf8")));
  assert.ok(f.observations().some((item) => item.method === "Browser.close"));
});

test("startup probe timeout closes owned child and relay gracefully", async (t) => {
  const f = fixture(t); const port = await freePort();
  await assert.rejects(startPipedChrome({ profileDir: f.dir, chromeBinary: f.binary, startUrl: "no-start", port, startupTimeoutMs: 60, shutdownTimeoutMs: 1000, log: quiet }), /Chrome pipe timeout/);
  assertDead(Number(readFileSync(path.join(f.dir, "pid"), "utf8")));
  const server = http.createServer(); server.listen(port, "127.0.0.1"); await once(server, "listening"); await new Promise((resolve) => server.close(resolve));
});

test("graceful shutdown timeout preserves owned process/profile and reports recoverable error", async (t) => {
  const f = fixture(t);
  const chrome = await startPipedChrome({ profileDir: f.dir, chromeBinary: f.binary, startUrl: "ignore-close", port: 0, startupTimeoutMs: 1000, shutdownTimeoutMs: 80, log: quiet });
  t.after(async () => { if (chrome.child.exitCode === null && chrome.child.signalCode === null) { const exited = once(chrome.child, "exit"); chrome.child.kill("SIGKILL"); await exited; } });
  await assert.rejects(chrome.stop(), (error) => error.code === "BROWSER_SHUTDOWN_TIMEOUT" && error.recoverable && error.pid === chrome.child.pid);
  assert.equal(chrome.child.exitCode, null); assert.equal(chrome.child.signalCode, null);
  assert.equal(existsSync(path.join(f.dir, "pid")), true);
  assert.ok(!f.observations().some((item) => item.signal === "SIGKILL"));
  assert.equal(chrome.relay.clientCount(), 0);
});

test("spawn errors reject cleanly without unhandled child/pipe errors", async (t) => {
  const f = fixture(t);
  await assert.rejects(startPipedChrome({ profileDir: f.dir, chromeBinary: path.join(f.dir, "missing"), port: 0, shutdownTimeoutMs: 200, log: quiet }), /ENOENT/);
  await assert.rejects(ensureChrome({ profileDir: f.dir, chromeBinary: path.join(f.dir, "missing"), port: await freePort(), startupTimeoutMs: 200, shutdownTimeoutMs: 200, pollIntervalMs: 5, log: quiet }), /ENOENT/);
});

test("relay preserves CDP response sessionId/error fields and rejects pending probes on close", async (t) => {
  const child = new EventEmitter(); child.stdio = [null, null, null, new PassThrough(), new PassThrough()];
  const relay = createCdpRelay({ child, port: 0, drainTimeoutMs: 100, log: quiet });
  t.after(async () => { await relay.close(); child.stdio[3].destroy(); child.stdio[4].destroy(); });
  await relay.ready;
  const ws = new WebSocket(relay.wsUrl); await once(ws, "open");
  for (const invalid of ["null", "false", "[]", "0", "\"text\""]) { ws.send(invalid); child.stdio[4].write(invalid + "\0"); }
  const written = once(child.stdio[3], "data"); ws.send(JSON.stringify({ id: 7, method: "Target.test", sessionId: "session-A" }));
  const [data] = await written; const forwarded = JSON.parse(data.toString().slice(0, -1));
  const received = once(ws, "message");
  child.stdio[4].write(JSON.stringify({ id: forwarded.id, sessionId: "session-A", error: { code: -32602, message: "bad params", data: "detail" } }) + "\0");
  assert.deepEqual(JSON.parse((await received)[0].toString()), { id: 7, sessionId: "session-A", error: { code: -32602, message: "bad params", data: "detail" } });
  const pending = relay.request("Browser.pending", {}, { timeoutMs: 60000 });
  const rejection = assert.rejects(pending, /relay is closing/);
  const socketClosed = once(ws, "close");
  await relay.close(); await rejection; await socketClosed;
  assert.equal(ws.readyState, WebSocket.CLOSED);
});
