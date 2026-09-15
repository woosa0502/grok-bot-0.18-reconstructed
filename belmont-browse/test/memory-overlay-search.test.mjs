import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMemorySearch } from "../src/memory-search.mjs";

for(const form of ["physical","symlink","alias"]) test(`actual FTS overlay excludes operational sites: ${form}`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"fts-overlay-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const account=path.join(root,"account"), memory=path.join(account,"memory"), overlay=path.join(root,"eval/sites"), knowledge=path.join(root,"knowledge");
 for(const d of [memory,overlay,knowledge])fs.mkdirSync(d,{recursive:true});
 const sites=form==="physical"?path.join(memory,"sites"):path.join(knowledge,"sites");fs.mkdirSync(sites);
 if(form!=="physical")fs.symlinkSync(sites,path.join(memory,"sites"));if(form==="alias")fs.symlinkSync(sites,path.join(memory,"other-name"));
 fs.writeFileSync(path.join(sites,"example.com.md"),"# Route\nchampiontoken 통로석 기존절차");
 fs.writeFileSync(path.join(overlay,"example.com.md"),"# Route\ndrafttoken 창가석 후보절차");
 fs.writeFileSync(path.join(memory,"profile.md"),"# Profile\nprofiletoken 사용자의 선호");
 const search=createMemorySearch({allowedRoots:[knowledge]});t.after(()=>search.close());
 const run=sitesRoot=>search.searchMany({accountRoot:account,sitesRoot,queries:["championtoken","drafttoken","profiletoken"],maxResults:10});
 const has=(rows,x)=>rows.some(r=>r.excerpt.includes(x));
 const original=await run(undefined),trial=await run(overlay),again=await run(undefined);
 assert.ok(has(original,"championtoken"));assert.ok(!has(original,"drafttoken"));
 assert.ok(!has(trial,"championtoken"));assert.ok(has(trial,"drafttoken"));assert.ok(has(trial,"profiletoken"));
 assert.deepEqual(again,original);
});
test("original Korean/English FTS exact behavior is retained after overlay searches",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"fts-regression-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,"memory"));fs.writeFileSync(path.join(root,"memory/profile.md"),"# Travel\n장거리 항공편에서는 통로석을 선호합니다.\nBelmont project CODE-731.");
 const s=createMemorySearch();t.after(()=>s.close());
 for(const q of ["통로석","장거리","항공편","Belmont","CODE-731"]){const hits=await s.searchMany({accountRoot:root,queries:[q]});assert.ok(hits.length>0,q);}
});
test("overlay FTS document statistics cannot change normal-session rankings",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"fts-stat-isolation-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const account=path.join(root,"account"),overlay=path.join(root,"overlay");fs.mkdirSync(path.join(account,"memory"),{recursive:true});fs.mkdirSync(overlay);
 fs.writeFileSync(path.join(account,"memory/a.md"),"# Match\nalpha alpha alpha alpha");fs.writeFileSync(path.join(account,"memory/b.md"),"# Match\nbeta beta");
 for(let i=0;i<30;i++)fs.writeFileSync(path.join(overlay,`${i}.md`),"# Other\nalpha gamma filler");
 const s=createMemorySearch();t.after(()=>s.close());const q=()=>s.searchMany({accountRoot:account,queries:["alpha beta"],maxResults:2});
 const before=await q();await s.searchMany({accountRoot:account,sitesRoot:overlay,queries:["alpha"],maxResults:2});assert.deepEqual(await q(),before);
});
test("shared semantic fallback state is reported and the backend is closed only once",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"fts-close-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,"account/memory"),{recursive:true});fs.mkdirSync(path.join(root,"overlay"));fs.writeFileSync(path.join(root,"account/memory/x.md"),"hello alpha");
 let closes=0;const s=createMemorySearch({semanticAdapter:{capabilities:()=>({state:"available"}),rank:async()=>{throw new Error("offline")},close:()=>closes++}});
 await s.searchMany({accountRoot:path.join(root,"account"),queries:["alpha"]});await s.searchMany({accountRoot:path.join(root,"account"),sitesRoot:path.join(root,"overlay"),queries:["alpha"]});
 assert.equal(s.capabilities().mode,"lexical");await s.close();await s.close();assert.equal(closes,1);
});
