import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sitesOverlayHealth, validateSitesOverlayRequest } from "../src/sites-overlay-capability.mjs";
import { memoryOverlayRoots } from "../src/memory-sites-overlay.mjs";
import { assertOverlayCapability } from "../src/procedure-evaluation.mjs";
function setup(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),"overlay-contract-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root; }
const identity = { instanceId:"test-host" };
const proof = {contract:"session-sites-v1",engine:"fixture",bundleSha256:"a".repeat(64),workerForwarding:true,readIsolation:true,extractionDisabled:true};
test("operator flag does not turn an unimplemented engine into a supported engine",()=>{
  assert.equal(sitesOverlayHealth({version:"fixture"},identity,true).sitesOverlay,false);
});
test("complete engine proof is bound to this service identity",()=>{
  const engine={version:"fixture",evaluationCapabilities:()=>proof};const s=sitesOverlayHealth(engine,identity,true);
  assert.equal(s.sitesOverlay,true);assertOverlayCapability({ok:true,engine:engine.version,...identity,...s});
  assert.equal(sitesOverlayHealth(engine,identity,false).sitesOverlay,false);
});
test("wrong bundle, engine, missing read isolation or extraction proof stays disabled",()=>{
  for(const patch of [{engine:"old"},{bundleSha256:""},{readIsolation:false},{extractionDisabled:false},{workerForwarding:false}])
    assert.equal(sitesOverlayHealth({version:"fixture",evaluationCapabilities:()=>({...proof,...patch})},identity,true).sitesOverlay,false);
});
test("POST sitesDir is rejected while unsupported, even if health checking is bypassed", t=>{
  const root=setup(t);assert.throws(()=>validateSitesOverlayRequest(root,root,{sitesOverlay:false}),e=>e.statusCode===409);
  assert.doesNotThrow(()=>validateSitesOverlayRequest(undefined,root,{sitesOverlay:false}));
});
test("overlay root allows isolated service directories and rejects escaping symlinks",t=>{
  const root=setup(t),allowed=path.join(root,"learn-eval/x/sites"),outside=path.join(root,"outside");fs.mkdirSync(allowed,{recursive:true});fs.mkdirSync(outside);
  assert.doesNotThrow(()=>validateSitesOverlayRequest(allowed,root,{sitesOverlay:true}));
  fs.symlinkSync(outside,path.join(root,"learn-eval/escape"));
  assert.throws(()=>validateSitesOverlayRequest(path.join(root,"learn-eval/escape"),root,{sitesOverlay:true}));
});
test("physical operational sites are explicitly excluded without hiding profile memory",t=>{
  const root=setup(t),account=path.join(root,"account"),sites=path.join(account,"memory/sites"),overlay=path.join(root,"eval/sites");
  fs.mkdirSync(sites,{recursive:true});fs.mkdirSync(overlay,{recursive:true});
  const plan=memoryOverlayRoots(account,overlay);assert.deepEqual(plan.excluded,[sites]);assert.ok(plan.walkRoots.includes(path.join(account,"memory")));
});
test("symlink aliases cannot escape operational-site exclusion",t=>{
  const root=setup(t),account=path.join(root,"account"),sites=path.join(root,"knowledge/sites"),overlay=path.join(root,"eval/sites");
  fs.mkdirSync(path.join(account,"memory"),{recursive:true});fs.mkdirSync(sites,{recursive:true});fs.mkdirSync(overlay,{recursive:true});
  fs.symlinkSync(sites,path.join(account,"memory/sites"));const plan=memoryOverlayRoots(account,overlay,[path.join(root,"knowledge")]);assert.deepEqual(plan.excluded,[sites]);
});
test("normal retrieval keeps existing allowed roots and no extra exclusions",t=>{
  const root=setup(t),account=path.join(root,"account"),knowledge=path.join(root,"knowledge");
  const plan=memoryOverlayRoots(account,undefined,[knowledge]);assert.deepEqual(plan.excluded,[]);assert.ok(plan.allowed.includes(knowledge));
});
test("candidate inside the operational search tree is refused",t=>{
  const root=setup(t),account=path.join(root,"account");assert.throws(()=>memoryOverlayRoots(account,path.join(account,"memory/drafts")),/OVERLAY_INSIDE/);
});
