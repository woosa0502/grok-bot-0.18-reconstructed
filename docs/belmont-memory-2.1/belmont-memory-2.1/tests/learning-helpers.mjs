import { setup, NOW } from './helpers.mjs';
import { DreamingEngine, MemoryRetriever, ExperienceLoop, DigitalSelf } from '../dist/index.js';
export { NOW };
export const S='user:demo';
export const T0=Date.parse('2026-04-01T09:00:00Z');
let counter=0;
export const turn=(text,at=T0,extra={})=>({id:`t${++counter}`,sessionId:'s1',text,at,...extra});
export function learningSetup(t,options={}){
  const base=setup(options);
  const common={scopes:[S,'project:belmont'],capabilities:['read','propose','index','consolidate','evaluate']};
  const consolidator=base.kernel.session({...common,id:'host:dreamer',actor:'consolidator'});
  const outcomes=base.kernel.session({id:'host:evaluator-outcomes',actor:'agent',scopes:common.scopes,capabilities:['read','capture','propose']});
  const dream=new DreamingEngine(base.user,consolidator,S),retriever=new MemoryRetriever(base.user);
  t.after(()=>{retriever.close();base.kernel.close();});
  return {...base,consolidator,outcomes,dream,retriever,self:new DigitalSelf(base.user,retriever),loop:new ExperienceLoop(base.aside,outcomes,consolidator,S)};
}
export const spec=(extra={})=>({domain:'booking.example',task:'hotel_search',environment:'ui-v1',preconditions:{login:'yes'},steps:[{operation:'navigate',target:'https://booking.example/search'},{operation:'fill',target:'#destination',value:'${destination}'},{operation:'click',target:'#submit'}],shortcuts:['direct search URL'],failureConditions:[],...extra});
export const experience=(extra={})=>({eventId:`browser-${++counter}`,domain:'booking.example',task:'hotel_search',environment:'ui-v1',at:T0,
 trajectory:[{operation:'navigate',target:'/search',result:'loaded'}],outcome:{success:true,criticalFailure:false,latencyMs:100,tokens:20,at:T0,environment:'ui-v1'},candidate:spec(),...extra});
export const trials=(n=200,extra={})=>Array.from({length:n},(_,i)=>({scenarioId:`s${i}`,environment:'ui-v1',success:true,criticalFailure:false,latencyMs:100,tokens:100,...extra}));
export function accepted(h){const e=h.loop.ingest(experience());const r=h.loop.promote(e.candidateEvidenceId,trials(),trials(200,{latencyMs:70,tokens:70}),T0+1000);if(r.status!=='committed')throw new Error(JSON.stringify(r));return r.id;}
