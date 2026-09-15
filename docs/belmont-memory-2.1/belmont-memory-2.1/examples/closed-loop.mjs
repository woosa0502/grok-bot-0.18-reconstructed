import { MemoryKernel, createLearningRuntime } from '../dist/index.js';
const scope='user:demo-only';
const kernel=new MemoryKernel({path:':memory:',tombstoneKey:new Uint8Array(32).fill(7)});
const runtime=createLearningRuntime(kernel,scope);
try {
  const first=runtime.recordClosedEpisode([{id:'1',sessionId:'april',at:Date.parse('2026-04-01T00:00:00Z'),text:'장거리 비행은 가격이 조금 높아도 통로석을 선호한다'}]);
  const request={query:'뉴욕 항공편 찾아줘',task:'flight_search',at:Date.parse('2026-05-01T00:00:00Z'),context:{distance:'long-haul'},arguments:{destination:'NYC'}};
  const nextSession=await runtime.beforeToolAction(request);
  const correction=runtime.recordClosedEpisode([{id:'2',sessionId:'june',at:Date.parse('2026-06-01T00:00:00Z'),text:'이제부터 장거리 비행은 창가를 선호한다',explicitMemory:true}]);
  const updated=await runtime.beforeToolAction({...request,at:Date.parse('2026-09-11T00:00:00Z')});
  console.log(JSON.stringify({kind:'local-reference-loop-not-live-flight-search',learned:first.committedIds.length,nextSession:nextSession.action,explicitCorrection:correction.committedIds.length,afterCorrection:updated.action,dense:nextSession.retrieval.denseState},null,2));
} finally {runtime.close();kernel.close();}
