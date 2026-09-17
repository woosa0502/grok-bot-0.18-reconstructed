import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { evaluateProcedure, decideAdoption, responseMarker, assertOverlayCapability, acquireEvaluationLock, createEvaluationApi, validateOptions } from "../src/procedure-evaluation.mjs";

const hash = b => createHash("sha256").update(b).digest("hex");
const health = () => ({ ok: true, sitesOverlay: true, instanceId: "fixture-instance", engine: "fixture-not-aside",
  sitesOverlayProof: { contract: "session-sites-v1", instanceId: "fixture-instance", engine: "fixture-not-aside", bundleSha256: "a".repeat(64), workerForwarding: true, readIsolation: true, extractionDisabled: true } });
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "belmont-evaluate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const knowledge = path.join(root, "knowledge"), state = path.join(root, "state"), world = path.join(root, "world");
  for (const d of ["sites", "drafts", "lessons"]) fs.mkdirSync(path.join(knowledge, d), { recursive: true });
  fs.mkdirSync(state); fs.mkdirSync(world);
  const op = path.join(knowledge, "sites/example.com.md"), draft = path.join(knowledge, "drafts/example.com.md");
  if (!options.noChampion) fs.writeFileSync(op, "CHAMPION"); fs.writeFileSync(draft, "DRAFT");
  const sessions = new Map(), seen = [], calls = [], files = [];
  let seq = 0, clock = 0;
  const api = async (method, url, body, signal) => {
    calls.push({ method, url, body });
    if (url === "/health") return options.health ?? health();
    if (url === "/sessions" && method === "POST") {
      if (options.unknownCreate) throw new Error("response lost after creation");
      const id = `s${++seq}`, file = path.join(body.sitesDir, "example.com.md");
      const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "NONE";
      files.push(file); seen.push({ content, op: fs.existsSync(op) ? fs.readFileSync(op, "utf8") : null, sitesDir: body.sitesDir, autoApprove: body.autoApprove });
      sessions.set(id, { id, status: "running", content, queries: 0 });
      return { id, status: "queued" };
    }
    const id = url.split("/")[2], s = sessions.get(id); assert.ok(s);
    if (method === "POST" && url.endsWith("/stop")) {
      if (options.stopFails) throw new Error("stop unconfirmed");
      s.status = "stopped"; return { id, status: "stopped" };
    }
    s.queries++;
    if (s.status === "stopped") return { id, status: s.status };
    if (options.onRead) options.onRead({ s, op, draft, files, clock });
    if (options.throwRead && s.content === "DRAFT") throw new Error("read transport failed");
    const candidate = s.content === "DRAFT";
    const status = candidate ? options.candidateStatus ?? "done" : "done";
    s.status = status;
    const actuallyCompleted = !(candidate && options.worldFailed);
    // Independent observed state. The model's final text never changes this artifact.
    if (status === "done" && actuallyCompleted) fs.writeFileSync(path.join(world, `${id}.json`), JSON.stringify({ delivered: true, id }));
    const errors = candidate ? options.errors ?? 0 : 0;
    return { id, status, toolCalls: candidate ? options.candidateTools ?? 1 : s.content === "CHAMPION" ? 2 : 10,
      modelCalls: 1, activity: Array.from({ length: errors }, () => "ERROR occurred"),
      result: candidate ? options.result ?? "Goal achieved" : "Goal achieved" };
  };
  const verifier = { id: "actual-local-artifact-observer", isolation: "read-only", async verify({ sessionId }) {
    const file = path.join(world, `${sessionId}.json`);
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
    return { verdict: bytes && JSON.parse(bytes).delivered === true ? "succeeded" : "unknown", criticalFailure: false,
      evidence: bytes ? [`file:${file}#sha256=${hash(bytes)}`] : [] };
  } };
  const base = { domain: "example.com", task: "Read-only fixture", runs: 2, timeoutMs: 30, pollMs: 0,
    knowledgeDir: knowledge, stateDir: state, api, verifier, publish: true,
    now: () => clock, sleepFor: async () => { clock += 10; } };
  return { root, knowledge, state, op, draft, sessions, seen, calls, files, verifier, api,
    run: (overrides = {}) => evaluateProcedure({ ...base, ...overrides }),
    lock: () => fs.existsSync(path.join(knowledge, ".learn-measure.lock")),
    log: () => { const f = path.join(knowledge, "lessons/measurements.log"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; },
  };
}

test("completed, independently observed cheaper candidate publishes exactly measured bytes", async t => {
  const f = fixture(t); const r = await f.run();
  assert.equal(r.published, true); assert.equal(fs.readFileSync(f.op, "utf8"), "DRAFT");
  assert.equal(fs.readFileSync(f.draft, "utf8"), "DRAFT", "draft is retained, not raced with an editor");
  assert.equal(r.candidateSha256, hash("DRAFT")); assert.match(f.log(), /ADOPTED/); assert.equal(f.lock(), false);
});
test("a worse candidate cannot replace the current champion", async t => {
  const f = fixture(t, { candidateTools: 6 }); const r = await f.run(); assert.equal(r.published, false);
  assert.equal(fs.readFileSync(f.op, "utf8"), "CHAMPION");
});
test("no champion uses no-page as the bar", async t => {
  const f = fixture(t, { noChampion: true }); const r = await f.run(); assert.equal(r.barName, "no-page"); assert.equal(r.published, true);
});
for (const status of ["error", "stopped", "interrupted"]) test(`terminal ${status} cannot promote a success marker`, async t => {
  const f = fixture(t, { candidateStatus: status }); const r = await f.run(); assert.equal(r.published, false); assert.equal(fs.readFileSync(f.op, "utf8"), "CHAMPION");
});
test("running with a success marker times out and is stopped before overlay cleanup", async t => {
  const f = fixture(t, { candidateStatus: "running" }); await assert.rejects(f.run(), /TRIAL_TIMEOUT/);
  assert.ok(f.calls.some(c => c.url.endsWith("/stop"))); assert.equal(f.lock(), false); assert.doesNotMatch(f.log(), /ADOPTED/);
});
test("suspended approval is not automatically accepted", async t => {
  const f = fixture(t, { candidateStatus: "suspended" }); await assert.rejects(f.run(), /EVALUATION_SUSPENDED/);
  assert.ok(f.seen.every(s => s.autoApprove === false)); assert.ok(f.calls.some(c => c.url.endsWith("/stop")));
});
test("lost read response triggers stop; operational state remains intact", async t => {
  const f = fixture(t, { throwRead: true }); await assert.rejects(f.run(), /read transport/); assert.equal(f.lock(), false);
  assert.ok(f.calls.some(c => c.url.endsWith("/stop"))); assert.equal(fs.readFileSync(f.op, "utf8"), "CHAMPION");
});
test("unconfirmed stop retains overlay and lock instead of permitting another evaluation", async t => {
  const f = fixture(t, { throwRead: true, stopFails: true }); await assert.rejects(f.run());
  assert.equal(f.lock(), true); assert.ok(f.files.some(file => fs.existsSync(file)));
});
test("ambiguous POST is never retried and retains inspection state", async t => {
  const f = fixture(t, { unknownCreate: true }); await assert.rejects(f.run()); assert.equal(f.lock(), true);
  assert.equal(f.calls.filter(c => c.method === "POST" && c.url === "/sessions").length, 1);
});
for (const result of ["Goal achieved is only the criterion; booking remains pending.", "x".repeat(200)+"Goal achieved", "예약 완료는 예시 문구이며 실제 예약은 미완료입니다."]) test(`response text cannot fabricate world success: ${result.slice(0,32)}`, async t => {
  const f = fixture(t, { result, worldFailed: true }); const r = await f.run({ goal: "Goal achieved" }); assert.equal(r.published, false);
});
test("no independent observer means no automatic promotion", async t => {
  const f = fixture(t); await assert.rejects(f.run({ verifier: undefined }), /PUBLISH_REQUIRES_OBSERVER/);
  assert.equal(f.calls.length, 0); assert.equal(f.lock(), false);
});
test("diagnostic mode never publishes even a successfully measured candidate", async t => {
  const f = fixture(t); const r = await f.run({ publish: false }); assert.equal(r.accept, true); assert.equal(r.published, false);
});
test("increased candidate errors cannot be hidden by lower cost", async t => {
  const f = fixture(t, { errors: 2 }); const r = await f.run(); assert.equal(r.reason, "errors worse"); assert.equal(r.published, false);
});
test("median cannot hide one bad paired error trial", () => {
  const row = e => ({ status: "done", toolCalls: 1, modelCalls: 1, errors: e, ms: 1, grade: { verdict: "succeeded", criticalFailure: false, evidence: ["observed"] } });
  const c = Array.from({ length: 3 }, () => ({ ...row(0), toolCalls: 2 })); assert.equal(decideAdoption(c, [row(0), row(0), row(1)]).accept, false);
});
test("latency noise alone cannot cause promotion", () => {
  const row = ms => ({ status: "done", toolCalls: 2, modelCalls: 1, errors: 0, ms, grade: { verdict: "succeeded", criticalFailure: false, evidence: ["observed"] } });
  assert.equal(decideAdoption([row(100)], [row(1)]).accept, false);
});
for (const target of ["draft", "op"]) test(`concurrent ${target} edit aborts publication without deleting the edit`, async t => {
  const f = fixture(t, { onRead({s, draft, op}) { if (s.content === "NONE") fs.writeFileSync(target === "draft" ? draft : op, "NEW_EDIT"); } });
  await assert.rejects(f.run(), target === "draft" ? /DRAFT_CHANGED/ : /CHAMPION_CHANGED/);
  assert.equal(fs.readFileSync(target === "draft" ? f.draft : f.op, "utf8"), "NEW_EDIT"); assert.doesNotMatch(f.log(), /ADOPTED/);
});
test("overlay changes are detected instead of publishing an unmeasured artifact", async t => {
  const f = fixture(t, { onRead({s, files}) { if (s.content === "NONE") { const d = files.find(p => p.includes('/draft/')); if (d) { fs.chmodSync(d, 0o600); fs.writeFileSync(d, "CHANGED_OVERLAY"); } } } });
  await assert.rejects(f.run(), /OVERLAY_CHANGED/); assert.doesNotMatch(f.log(), /ADOPTED/);
});
test("separate immutable arm paths and alternating order; live reader always sees champion", async t => {
  const f = fixture(t); await f.run();
  assert.deepEqual(f.seen.slice(0,4).map(s => s.content), ["CHAMPION", "DRAFT", "DRAFT", "CHAMPION"]);
  assert.equal(new Set(f.seen.map(s => s.sitesDir)).size, 3); assert.ok(f.seen.every(s => s.op === "CHAMPION"));
});
test("failure before publication cannot publish from finally", async t => {
  const f = fixture(t); const ops = { ...fs, writeFileSync(file, ...rest) { if (String(file).endsWith("report.json")) throw new Error("injected prepared audit failure"); return fs.writeFileSync(file, ...rest); } };
  await assert.rejects(f.run({ fsOps: ops }), /prepared audit/); assert.equal(fs.readFileSync(f.op, "utf8"), "CHAMPION"); assert.doesNotMatch(f.log(), /ADOPTED/);
});
test("rename failure cannot record ADOPTED", async t => {
  const f = fixture(t); const ops = { ...fs, renameSync() { throw new Error("injected rename failure"); } };
  await assert.rejects(f.run({ fsOps: ops }), /rename failure/); assert.equal(fs.readFileSync(f.op, "utf8"), "CHAMPION"); assert.doesNotMatch(f.log(), /ADOPTED/);
});
test("post-commit log failure is reported as published with audit warning, not rollback", async t => {
  const f = fixture(t); const ops = { ...fs, appendFileSync() { throw new Error("audit device failed"); } };
  const r = await f.run({ fsOps: ops }); assert.equal(r.published, true); assert.equal(r.auditWarning, true);
  assert.equal(fs.readFileSync(f.op, "utf8"), "DRAFT"); assert.ok(fs.existsSync(path.join(r.runDir, "run.json"))); assert.equal(f.lock(), true);
});
test("unsupported overlay is a normal error and releases the acquired lock", async t => {
  const f = fixture(t, { health: { ok: true, sitesOverlay: false } }); await assert.rejects(f.run(), /OVERLAY_NOT_PROVEN/); assert.equal(f.lock(), false); assert.equal(f.calls.length, 1);
});
test("environment boolean alone is not a worker proof", () => assert.throws(() => assertOverlayCapability({ ok:true, sitesOverlay:true }), /OVERLAY_NOT_PROVEN/));
for (const field of ["instanceId", "engine", "workerForwarding", "readIsolation", "extractionDisabled", "bundleSha256"]) test(`overlay proof validates ${field}`, () => {
  const h = health(); h.sitesOverlayProof[field] = null; assert.throws(() => assertOverlayCapability(h), /OVERLAY_NOT_PROVEN/);
});
test("traversal domain and nonfinite/fractional runs fail before any API call", async t => {
  const f = fixture(t); for (const args of [{ domain:"../outside" }, { runs:0 }, { runs:NaN }, { runs:1.5 }, { runs:Infinity }, { goal:" " }]) await assert.rejects(f.run(args)); assert.equal(f.calls.length, 0);
});
test("negative or missing metrics cannot promote", async t => {
  const f = fixture(t, { candidateTools: -1 }); await assert.rejects(f.run(), /INVALID_METRICS/); assert.doesNotMatch(f.log(), /ADOPTED/);
});
test("resettable observers must implement reset", async t => {
  const f = fixture(t); await assert.rejects(f.run({ verifier: { ...f.verifier, isolation:"resettable" } }), /RESET_REQUIRED/);
});
test("an incomplete lock is refused rather than stolen", t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.knowledge,".learn-measure.lock"), ""); assert.throws(() => acquireEvaluationLock(f.knowledge), /Refusing concurrent/); assert.equal(f.lock(), true);
});
test("a live owner is not stolen by a different process", t => {
  const f = fixture(t); const lock = acquireEvaluationLock(f.knowledge);
  const module = new URL("../src/procedure-evaluation.mjs",import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import {acquireEvaluationLock} from ${JSON.stringify(module)};try{acquireEvaluationLock(process.argv[1]);process.exitCode=8}catch(e){console.log(e.code)}`, f.knowledge], {encoding:"utf8"});
  assert.equal(child.status,0); assert.match(child.stdout,/EVALUATION_LOCKED/); lock.release(); assert.equal(f.lock(), false);
});
test("lock release never removes a replacement owner's lock", t => {
  const f=fixture(t), lock=acquireEvaluationLock(f.knowledge); fs.unlinkSync(lock.file); fs.writeFileSync(lock.file, JSON.stringify({token:"replacement",pid:process.pid})); lock.release(); assert.equal(f.lock(),true);
});
test("candidate symlink is rejected", async t => {
  const f=fixture(t); fs.unlinkSync(f.draft); fs.symlinkSync(f.op,f.draft); await assert.rejects(f.run(),/NONREGULAR_PAGE/); assert.equal(f.calls.length,0);
});
test("actual loopback HTTP adapter drives evaluation and an independent file observer", async t => {
  const f=fixture(t); const server=http.createServer(async(req,res)=>{
    let text=""; for await(const c of req)text+=c;
    if(req.headers.authorization!=="Bearer test-only") {res.writeHead(401);res.end("{}");return;}
    try { const body=await f.api(req.method,req.url,text?JSON.parse(text):undefined);res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(body)); }
    catch {res.writeHead(500);res.end("{}");}
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  try { const r=await f.run({ api:createEvaluationApi({port:server.address().port,token:"test-only"}), timeoutMs:5000 });assert.equal(r.published,true); }
  finally {await new Promise(r=>server.close(r));}
});
test("HTTP errors cannot be mistaken for valid JSON session views", async () => {
  const api=createEvaluationApi({port:1,token:"not-secret"},{fetchImpl:async()=>({ok:false,status:500})}); await assert.rejects(api("POST","/sessions",{}),/HTTP_500/);
});
test("external cancellation stops active work before releasing overlay", async t => {
  const controller=new AbortController();const f=fixture(t,{candidateStatus:"running",onRead({s}){if(s.content==="DRAFT")controller.abort(new Error("operator stop"));}});
  await assert.rejects(f.run({signal:controller.signal}),/operator stop/);assert.ok(f.calls.some(c=>c.url.endsWith("/stop")));assert.equal(f.lock(),false);
});
test("SIGKILL cannot change champion; the next evaluator refuses retained ownership", t => {
  const f=fixture(t);const module=new URL("../src/procedure-evaluation.mjs",import.meta.url).href;
  const script=`import fs from 'node:fs';import {evaluateProcedure} from ${JSON.stringify(module)};
const root=process.argv[1];let seq=0;const views=new Map();
await evaluateProcedure({domain:'example.com',task:'Read fixture',runs:1,timeoutMs:1000,pollMs:0,publish:false,
knowledgeDir:root+'/knowledge',stateDir:root+'/state',sleepFor:async()=>{},
api:async(m,u,b)=>{if(u==='/health')return ${JSON.stringify(health())};if(u==='/sessions'){const id='s'+(++seq),p=b.sitesDir+'/example.com.md';views.set(id,fs.existsSync(p)?fs.readFileSync(p,'utf8'):'NONE');return{id,status:'queued'}};
const content=views.get(u.split('/')[2]);if(content==='DRAFT')process.kill(process.pid,'SIGKILL');return{status:'done',toolCalls:2,modelCalls:1,activity:[],result:'done'};}});`;
  const child=spawnSync(process.execPath,["--input-type=module","-e",script,f.root],{encoding:"utf8",timeout:5000});
  assert.equal(child.signal,"SIGKILL",child.stderr);assert.equal(fs.readFileSync(f.op,"utf8"),"CHAMPION");
  assert.equal(f.lock(),true);assert.throws(()=>acquireEvaluationLock(f.knowledge),/Refusing concurrent/);
});
test("decision revalidates terminal status independently of a mistaken observer grade", () => {
 const good={status:"done",toolCalls:2,modelCalls:1,errors:0,ms:1,grade:{verdict:"succeeded",criticalFailure:false,evidence:["observed"]}};
 for(const status of ["error","stopped","interrupted"])assert.equal(decideAdoption([good],[{...good,status,toolCalls:1}]).accept,false);
});
test("critical failure cannot be rescued by a success verdict and low cost", () => {
 const good={status:"done",toolCalls:2,modelCalls:1,errors:0,ms:1,grade:{verdict:"succeeded",criticalFailure:false,evidence:["observed"]}};
 assert.equal(decideAdoption([good],[{...good,toolCalls:1,grade:{...good.grade,criticalFailure:true}}]).accept,false);
});
