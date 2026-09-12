import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAtoms, segmentEpisodes, MemoryKernel, DreamingEngine, MemoryRetriever } from '../dist/index.js';
import { learningSetup, turn, S, T0, NOW } from './learning-helpers.mjs';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const examples=[
 ['장거리 비행은 통로석을 선호한다','preference','flight.seat','aisle'],
 ['I prefer an aisle seat on long-haul flights.','preference','flight.seat','aisle'],
 ['단거리 비행은 창가를 선호한다','preference','flight.seat','window'],
 ['장거리 비행은 가격이 조금 높아도 통로석을 선호한다','preference','flight.tradeoff','seat_over_price'],
 ['출장 호텔은 위치를 우선한다','preference','hotel.priority','location'],
 ['휴가 호텔은 조용함을 우선한다','preference','hotel.priority','quiet'],
 ['For business trips I prioritize hotel location.','preference','hotel.priority','location'],
 ['나는 개발자입니다','semantic','self.role','개발자'],
 ['민수는 내 동료야','semantic','relation.colleague','민수'],
 ['Mina is my colleague.','semantic','relation.colleague','Mina'],
 ['민수는 Belmont 프로젝트 담당자야','semantic','project.owner','민수'],
 ['Mina is the owner of Belmont.','semantic','project.owner','Mina'],
 ['프로젝트 규칙: Node 26.5.x를 쓰고 테스트를 생략하지 않는다','knowledge','knowledge.rule','Node 26.5.x를 쓰고 테스트를 생략하지 않는다'],
 ['2026-04-01에 메모리 버그를 해결했다','episodic','event.outcome','2026-04-01에 메모리 버그를 해결했다'],
 ['오후 2시 이후에는 카페인을 피해요','preference','food.caffeine_cutoff','14:00'],
];
for(const[text,type,predicate,value]of examples)test(`extract and persist: ${predicate} / ${text}`,t=>{
 const h=learningSetup(t);const report=h.dream.learn([turn(text)]);assert(report.committedIds.length>0,JSON.stringify(report));const memories=report.committedIds.map(id=>h.user.read(S,id));assert(memories.some(m=>m.type===type&&m.details?.predicate===predicate&&m.details?.value===value));
 const a=memories.find(m=>m.details?.predicate===predicate);assert.equal(a.authority,'agent_inference');assert.equal(a.details.assertion,'stated');assert.equal(h.user.evidence(S,a.evidenceIds[0]).content,text);
});
for(const text of ['오늘 커피 마셨어','안녕','고마워','I will complete the migration tomorrow.','장거리 비행 좌석은 무엇이 좋을까?'])test(`trivial/future/question is not durable: ${text}`,t=>{
 const h=learningSetup(t),r=h.dream.learn([turn(text)]);assert.equal(r.committedIds.length,0);assert.equal(h.user.list(S).length,0);assert.equal(r.capturedEvidenceIds.length,1);
});
test('episodes separate by topic, session and elapsed gap',()=>{
 const episodes=segmentEpisodes([turn('장거리 비행은 통로석을 선호한다',T0),turn('가격이 비싸도 통로석을 선호한다',T0+1000),turn('출장 호텔은 위치를 우선한다',T0+2000),turn('출장 호텔은 위치를 우선한다',T0+3600000),turn('출장 호텔은 위치를 우선한다',T0+3601000,{sessionId:'s2'})]);assert.equal(episodes.length,4);assert.equal(episodes[0].turnIds.length,2);
});
test('duplicate semantic slot does not create duplicate memories',t=>{const h=learningSetup(t);h.dream.learn([turn('장거리 비행은 통로석을 선호한다')]);const r=h.dream.learn([turn('I prefer an aisle seat on long-haul flights.',T0+1000)]);assert.equal(r.duplicateIds.length,1);assert.equal(h.user.list(S).length,1);});
test('explicit correction closes old validity instead of overwriting content',t=>{
 const h=learningSetup(t),old=h.dream.learn([turn('장거리 비행은 통로석을 선호한다')]).committedIds[0];
 const fresh=h.dream.learn([turn('이제부터 장거리 비행은 창가를 선호한다',T0+1000,{explicitMemory:true})]).committedIds[0];
 assert.equal(h.user.read(S,old).validTo,T0+1000);assert.equal(h.user.read(S,fresh).authority,'user_explicit');assert.equal(h.user.read(S,fresh).details.supersedesId,old);assert(h.user.read(S,fresh).details.contradictsIds.includes(old));assert.equal(h.user.history(S,old).length,2);
 assert.equal(h.user.search(S,'통로석',{at:T0+500}).length,1);assert.equal(h.user.search(S,'통로석',{at:NOW}).length,0);
});
test('later unconfirmed statement cannot override explicit preference',t=>{const h=learningSetup(t);h.dream.learn([turn('장거리 비행은 창가를 선호한다',T0,{explicitMemory:true})]);const r=h.dream.learn([turn('장거리 비행은 통로석을 선호한다',T0+1000)]);assert.equal(r.committedIds.length,0);assert.equal(r.deferred[0].reason,'EXPLICIT_OVERRIDES_UNCONFIRMED_CHANGE');});
test('context-specific preferences coexist',t=>{const h=learningSetup(t);h.dream.learn([turn('출장 호텔은 위치를 우선한다'),turn('휴가 호텔은 조용함을 우선한다',T0+1000)]);assert.equal(h.user.list(S).length,2);assert(h.user.list(S).every(m=>m.validTo===null));});
test('explicit source correction preserves numbers/entities/negative clause',t=>{const h=learningSetup(t),text='프로젝트 규칙: Node 26.5.x를 사용하고 Mina의 테스트 12개를 삭제하지 않는다';const r=h.dream.learn([turn(text)]);assert.equal(h.user.read(S,r.committedIds[0]).content,text);assert.equal(h.user.read(S,r.committedIds[0]).details.spans[0].quote,text);});
test('negated preference is not a positive seat preference',()=>{const a=extractAtoms('장거리 비행은 통로석을 선호하지 않는다');assert(!a.some(x=>x.predicate==='flight.seat'));assert(a.some(x=>x.predicate==='flight.avoid_seat'&&x.value==='aisle'));});
test('tampered normalized atomic value fails deterministic validation',t=>{const h=learningSetup(t),r=h.dream.learn([turn('장거리 비행은 통로석을 선호한다')]);const m=h.user.read(S,r.committedIds[0]);assert.throws(()=>h.consolidator.propose({scope:S,type:'preference',content:m.content,evidenceIds:m.evidenceIds,details:{...m.details,value:'window'},basedOn:h.user.snapshot(S),idempotencyKey:'forge'}),/UNSUPPORTED_ATOMIC_VALUE/);});
test('tampered quote and date are rejected',t=>{const h=learningSetup(t),r=h.dream.learn([turn('장거리 비행은 통로석을 선호한다')]);const m=h.user.read(S,r.committedIds[0]);for(const details of[{...m.details,observedAt:T0+1},{...m.details,spans:[{...m.details.spans[0],quote:'invented'}]}])assert.throws(()=>h.consolidator.propose({scope:S,type:m.type,content:m.content,evidenceIds:m.evidenceIds,details,basedOn:h.user.snapshot(S),idempotencyKey:JSON.stringify(details)}));});
test('late out-of-order conflicting evidence is deferred, not silently overwriting',t=>{const h=learningSetup(t);h.dream.learn([turn('장거리 비행은 창가를 선호한다',T0+10000)]);const r=h.dream.learn([turn('장거리 비행은 통로석을 선호한다',T0)]);assert.equal(r.deferred[0].reason,'OUT_OF_ORDER_OR_SIMULTANEOUS_CONFLICT');});
test('new structured metadata is erased with existing tombstone semantics',t=>{const h=learningSetup(t),r=h.dream.learn([turn('장거리 비행은 통로석을 선호한다')]);const id=r.committedIds[0];h.user.forget(S,id);assert.equal(h.user.read(S,id),null);assert.deepEqual(h.user.history(S,id),[]);});
test('next session after a physical DB reopen recalls learned memory',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'belmont-reopen-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'memory.sqlite');
 const config={path,tombstoneKey:new Uint8Array(32).fill(8)};let kernel=new MemoryKernel(config);
 const principal={id:'host-user',actor:'user',scopes:[S],capabilities:['read','capture','propose','explicit']};
 let user=kernel.session(principal);const worker=kernel.session({id:'dream',actor:'consolidator',scopes:[S],capabilities:['read','propose','consolidate']});
 new DreamingEngine(user,worker,S).learn([turn('장거리 비행은 통로석을 선호한다')]);kernel.close();kernel=new MemoryKernel(config);user=kernel.session(principal);const r=new MemoryRetriever(user);t.after(()=>{r.close();kernel.close();});
 const result=await r.retrieve({scope:S,query:'뉴욕 항공편 찾아줘',task:'flight_search',context:{distance:'long-haul'},at:NOW},{planning:true});assert(result.hits.some(h=>h.item.details?.value==='aisle'));assert(result.packet.evidence.length>0);
});
test('schema version 1 upgrades in place and retains original rows',t=>{
 const dir=mkdtempSync(join(tmpdir(),'belmont-v1-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'old.sqlite');const db=new DatabaseSync(path);db.exec(readFileSync(new URL('../fixtures/schema-v1.sql',import.meta.url),'utf8'));db.exec("INSERT INTO meta VALUES('version','1'); INSERT INTO scope_state VALUES('user:demo',0,0)");db.close();const kernel=new MemoryKernel({path,tombstoneKey:new Uint8Array(32).fill(7)});kernel.close();const verify=new DatabaseSync(path);assert.equal(verify.prepare("SELECT value FROM meta WHERE key='version'").get().value,'2');assert.equal(verify.prepare('SELECT COUNT(*) n FROM scope_state').get().n,1);verify.close();
});
test('queued pre-clear episode keeps its original deletion epoch',async t=>{
 const {createLearningRuntime,MemoryLearningHostHooks}=await import('../dist/index.js');const h=learningSetup(t);const runtime=createLearningRuntime(h.kernel,S);t.after(()=>runtime.close());const hooks=new MemoryLearningHostHooks(runtime);hooks.onAuthenticatedUserTurn({conversationId:'queued',requestId:'old',user:'장거리 비행은 통로석을 선호한다',occurredAt:T0});h.user.clear(S);assert.throws(()=>hooks.onEpisodeClosed('queued'),/STALE_EPOCH/);assert.equal(h.user.list(S).length,0);
});
test('host hook actually groups user turns and excludes assistant narration',async t=>{const {createLearningRuntime,MemoryLearningHostHooks}=await import('../dist/index.js');const h=learningSetup(t),runtime=createLearningRuntime(h.kernel,S);t.after(()=>runtime.close());const hooks=new MemoryLearningHostHooks(runtime);hooks.onAuthenticatedUserTurn({conversationId:'c',requestId:'1',user:'장거리 비행은 통로석을 선호한다',occurredAt:T0});hooks.onAuthenticatedUserTurn({conversationId:'c',requestId:'2',user:'단거리 비행은 창가를 선호한다',occurredAt:T0+1000});const r=hooks.onEpisodeClosed('c');assert.equal(r.episodes.length,1);assert.equal(r.committedIds.length,2);assert.equal(hooks.onEpisodeClosed('c'),null);});

test('independent knowledge rules accumulate without temporal supersession',t=>{
 const h=learningSetup(t);h.dream.learn([turn('프로젝트 규칙: Node 26.5.x를 사용한다'),turn('프로젝트 규칙: 재시도는 3회다',T0+1000)]);
 const items=h.user.list(S);assert.equal(items.length,2);assert(items.every(m=>m.validTo===null));
});
test('multiple colleagues accumulate instead of replacing a different person',t=>{
 const h=learningSetup(t);h.dream.learn([turn('민수는 내 동료야'),turn('지혜는 내 동료야',T0+1000)]);assert.equal(h.user.list(S).filter(m=>m.validTo===null).length,2);
});
test('repeated real-world events on different dates remain distinct episodes',t=>{
 const h=learningSetup(t);h.dream.learn([turn('회귀 테스트를 완료했다'),turn('회귀 테스트를 완료했다',T0+86400000,{sessionId:'next-day'})]);assert.equal(h.user.list(S).length,2);assert(h.user.list(S).every(m=>m.validTo===null));
});
test('newline segmentation retains every supported atomic statement',t=>{
 const h=learningSetup(t);const r=h.dream.learn([turn('출장 호텔은 위치를 우선한다\n휴가 호텔은 조용함을 우선한다')]);assert.equal(r.committedIds.length,2);
});
test('ambiguous mixed positive and negative seat clauses do not invent a preference',()=>{
 const atoms=extractAtoms('통로석은 선호하지 않지만 창가를 선호한다');assert(!atoms.some(a=>a.predicate.startsWith('flight.')));
});
