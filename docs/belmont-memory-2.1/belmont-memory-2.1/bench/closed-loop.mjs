import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {MemoryKernel,createLearningRuntime,allMemories,planQuery,groundAction,HttpEmbeddingAdapter,VectorIndex,MemoryRetriever} from '../dist/index.js';
import {OriginalFtsBaseline} from './original-fts.mjs';
import {aggregate,score} from './metrics.mjs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/conversations.json',import.meta.url),'utf8')),scope='user:benchmark-only',now=Date.parse('2026-09-11T00:00:00Z');
const kernel=new MemoryKernel({path:':memory:',tombstoneKey:new Uint8Array(32).fill(12)}),runtime=createLearningRuntime(kernel,scope);
const turns=fixture.turns.map(t=>({...t,at:Date.parse(t.at)}));
const learning=runtime.recordClosedEpisode(turns);
// Long evidence fixture demonstrates navigation -> exact original span, without fabricating a summary as truth.
const longText=('오늘 회의에서 잡담을 나눴다.\n'.repeat(140))+'프로젝트 규칙: 재시도 횟수는 3회이며 실패 원인을 숨기지 않는다';runtime.recordClosedEpisode([{id:'long-turn',sessionId:'long-session',at:Date.parse('2026-07-03T00:00:00Z'),text:longText}]);
const spec={domain:'booking.example',task:'hotel_search',environment:'ui-v1',preconditions:{login:'yes'},steps:[{operation:'navigate',target:'https://booking.example/search'},{operation:'fill',target:'#city',value:'${destination}'},{operation:'click',target:'#submit'}],shortcuts:['direct search'],failureConditions:[]};
const at=Date.parse('2026-04-01T00:00:00Z'),outcome={success:true,criticalFailure:false,latencyMs:100,tokens:20,at,environment:'ui-v1'};
const ingested=runtime.reportAsideExperience({eventId:'bench-browser',domain:spec.domain,task:spec.task,environment:spec.environment,at,trajectory:[{operation:'navigate',target:'/search',result:'ok'}],outcome,candidate:spec});
// Evaluation fixtures, NOT claims about live browser measurements. The actual runner has separate tests.
const trials=(tokens)=>Array.from({length:200},(_,i)=>({scenarioId:`s${i}`,environment:'ui-v1',success:true,criticalFailure:false,latencyMs:100,tokens}));
const promoted=runtime.experience.promote(ingested.candidateEvidenceId,trials(100),trials(70),at+1000);if(promoted.status!=='committed')throw Error(JSON.stringify(promoted));
const session=runtime.self.session,items=allMemories(session,scope),original=new OriginalFtsBaseline(items.map(m=>({id:m.id,title:m.title,content:m.content})));
let vector,modelState='not_configured';
if(process.env.BELMONT_EMBED_URL){try{const identity={model:process.env.BELMONT_EMBED_MODEL??'intfloat/multilingual-e5-small',revision:process.env.BELMONT_EMBED_REVISION??'',dimension:Number(process.env.BELMONT_EMBED_DIM??384),recipe:'e5-prefix-mean-l2-512-v1'};vector=new VectorIndex(':memory:',new HttpEmbeddingAdapter(identity,process.env.BELMONT_EMBED_URL,process.env.BELMONT_EMBED_TOKEN));await vector.rebuild(session,scope);modelState='executed';}catch(e){vector?.close();vector=undefined;modelState='failed: '+e;}}
if(process.env.BELMONT_REQUIRE_DENSE==='1'&&modelState!=='executed')throw new Error('REAL_DENSE_NOT_EXECUTED: configure a pinned embedding service; sparse fallback is not a dense benchmark');
const retriever=vector?new MemoryRetriever(session,vector):runtime.retrieval;
const modes=[['A_original_Belmont_FTS',null],['A1_kernel_FTS',{planning:false}],['B_query_planning',{planning:true}],['C_plus_dense',{planning:true,dense:true}],['D_plus_hierarchy',{planning:true,dense:true,hierarchy:true}],['E_plus_graph',{planning:true,dense:true,hierarchy:true,graph:true}]];
const result={dataset:'authored-multisession-closed-loop',modelState,model:vector?.adapter.identity??null,learning:{...learning,committedCount:learning.committedIds.length,episodeCount:learning.episodes.length},modes:{},actions:[],limitations:['Authored scenarios, not personal production logs','200 paired procedure inputs here are deterministic evaluator fixtures; live browser execution not claimed','Dense scores absent unless the pinned real model service was available','Token costs estimated as UTF-8 bytes/4; metadata/evidence format equal across modes']};
for(const[name,options]of modes){const rows=[];for(const q of fixture.queries){const truthAt=q.truthAt?Date.parse(q.truthAt):now;const relevant=q.absent?[]:q.procedure?[promoted.id]:items.filter(m=>m.validFrom<=truthAt&&(m.validTo==null||m.validTo>truthAt)&&m.details?.kind==='atomic'&&(q.target??[]).some(t=>m.details.predicate===t.predicate&&(!t.value||m.details.value===t.value)&&Object.entries(t.context??{}).every(([k,v])=>m.details.context[k]===v))).map(m=>m.id);if(!q.absent&&!relevant.length)throw Error('Missing gold memory '+q.id);
 const request={scope,query:q.query,at:q.id==='c3'?truthAt:now,...(q.task?{task:q.task}:{}),...(q.context?{context:q.context}:{})};let returned=[],packet,bytes=0,estimatedTokens=0,denseState='unused';const latencies=[];
 for(let i=0;i<4;i++){const start=performance.now();if(options===null){returned=original.search(q.query,10).map(x=>x.id);const hits=returned.map(id=>({item:session.read(scope,id),score:1,channels:['original-fts']}));packet=retriever.packet(planQuery(request,false),hits,4096,s=>Math.ceil(Buffer.byteLength(s)/4),false);bytes=Buffer.byteLength(JSON.stringify(packet));estimatedTokens=Math.ceil(bytes/4);}else{const r=await retriever.retrieve(request,{...options,limit:10,budget:4096});returned=r.hits.map(h=>h.item.id);packet=r.packet;bytes=r.cost.utf8Bytes;estimatedTokens=r.cost.estimatedTokens;denseState=r.denseState;}if(i)latencies.push(performance.now()-start);}
 const ids=packet.memories.map(m=>m.id);rows.push({...q,relevant,returned,at5:score(returned,relevant,5),at10:score(returned,relevant,10),evidencePrecision:ids.length?ids.filter(id=>relevant.includes(id)).length/ids.length:0,latencies,bytes,estimatedTokens,denseState});}
 result.modes[name]={summary:aggregate(rows),byCategory:Object.fromEntries([...new Set(rows.map(r=>r.category))].map(c=>[c,aggregate(rows.filter(r=>r.category===c))])),rows};}
const cases=[
 {name:'latest explicit long-haul seat',task:'flight_search',query:'뉴욕 항공편 찾아줘',context:{distance:'long-haul'},arguments:{destination:'NYC'},expect:{seatPreference:'window',pricePriority:null}},
 {name:'short-haul context',task:'flight_search',query:'항공편 찾아줘',context:{distance:'short-haul'},arguments:{destination:'fixture'},expect:{seatPreference:'window'}},
 {name:'current turn beats memory',task:'flight_search',query:'항공편 찾아줘',context:{distance:'long-haul'},arguments:{destination:'NYC',seatPreference:'aisle'},expect:{seatPreference:'aisle'}},
 {name:'unknown context abstains',task:'flight_search',query:'항공편 찾아줘',context:{},arguments:{destination:'unknown'},expect:{seatPreference:null}},
 {name:'business hotel context',task:'hotel_search',query:'호텔 찾아줘',context:{purpose:'business'},arguments:{city:'Seoul'},expect:{priority:'location'}},
 {name:'leisure hotel context',task:'hotel_search',query:'호텔 찾아줘',context:{purpose:'leisure'},arguments:{city:'Seoul'},expect:{priority:'quiet'}},
 {name:'relationship continuity',task:'draft_message',query:'Belmont 프로젝트 담당자에게 메모 작성',context:{project:'Belmont'},arguments:{project:'Belmont'},expect:{recipientName:'민수'}},
 {name:'measured procedure reuse',task:'browser_procedure',query:'booking.example hotel_search',context:{environment:'ui-v1',login:'yes'},arguments:{domain:'booking.example',procedureTask:'hotel_search'},expect:{procedureId:promoted.id}},
];
const check=(args,expected)=>Object.entries(expected).every(([k,v])=>v===null?args[k]===undefined:args[k]===v);
for(const c of cases){const request={...c,scope,at:now};const prepared=await runtime.self.prepare(request);result.actions.push({name:c.name,expected:c.expect,withoutMemory:c.arguments,withMemory:prepared.action.arguments,bindings:prepared.action.memoryBindings,baselinePass:check(c.arguments,c.expect),memoryPass:!prepared.action.blocked&&check(prepared.action.arguments,c.expect)});}
result.actionAblation={};
for(const[name,options]of modes){const rows=[];for(const c of cases){const request={...c,scope,at:now};let r;
 if(options===null){const hits=original.search(c.query,10).map(x=>({item:session.read(scope,x.id),score:1,channels:['original-fts']}));const plan=planQuery(request,false);r={plan,hits,packet:retriever.packet(plan,hits,2048,s=>Math.ceil(Buffer.byteLength(s)/4),false)};}
 else r=await retriever.retrieve(request,{...options,budget:2048});
 const action=groundAction(session,request,r);rows.push({name:c.name,pass:!action.blocked&&check(action.arguments,c.expect),arguments:action.arguments});}
 result.actionAblation[name]={passed:rows.filter(r=>r.pass).length,total:rows.length,rows};}
const failReq={scope,at:now,task:'browser_procedure',query:'booking.example hotel_search',context:{environment:'ui-v1',login:'yes'},arguments:{domain:'booking.example',procedureTask:'hotel_search'},conditions:['selector_missing']};const beforeFailure=await runtime.self.prepare(failReq);
runtime.experience.feedback(promoted.id,'observed_failure',{success:false,criticalFailure:false,latencyMs:250,tokens:100,at:now-1000,environment:'ui-v1',condition:'selector_missing'});const afterFailure=await runtime.self.prepare(failReq);
result.failureLearning={beforeBlocked:beforeFailure.action.blocked,afterBlocked:afterFailure.action.blocked,failedProcedureNotReplayed:!beforeFailure.action.blocked&&afterFailure.action.blocked,meaning:'Known failure condition blocks reuse; successful autonomous repair is NOT asserted.'};
const longRequest={scope,query:'재시도 횟수',at:now};const full=await retriever.retrieve(longRequest,{hierarchy:false,budget:20000}),span=await retriever.retrieve(longRequest,{hierarchy:true,budget:20000});result.longEpisodeContext={fullBytes:full.cost.utf8Bytes,spanBytes:span.cost.utf8Bytes,reduction:1-span.cost.utf8Bytes/full.cost.utf8Bytes,fullMemoryIds:full.packet.memories.map(m=>m.id),spanMemoryIds:span.packet.memories.map(m=>m.id)};
result.actionSummary={cases:result.actions.length,baselinePassed:result.actions.filter(a=>a.baselinePass).length,memoryPassed:result.actions.filter(a=>a.memoryPass).length};
if(process.env.BELMONT_REQUIRE_DENSE==='1'&&Object.values(result.modes).flatMap(m=>m.rows).some(r=>['failed','unavailable'].includes(r.denseState)))throw new Error('DENSE_QUERY_FAILED: strict benchmark disallows fallback');
writeFileSync(new URL('../results/closed-loop-ablation.json',import.meta.url),JSON.stringify(result,null,2));console.table(Object.fromEntries(Object.entries(result.modes).map(([k,v])=>[k,v.summary])));console.log(JSON.stringify({actions:result.actionSummary,failureLearning:result.failureLearning,longEpisode:result.longEpisodeContext,modelState},null,2));original.close();if(vector){retriever.close();vector.close();}runtime.close();kernel.close();
