import type { MemorySession } from "../repository.js";
import type { MemoryItem, SearchHit } from "../types.js";
import { assert } from "../types.js";
import { reciprocalRankFusion } from "../text.js";
import type { RankedChannel } from "../text.js";
import { VectorIndex } from "./vector-index.js";
import { withDeadline } from "./embedding.js";
import { planQuery,meaningfulTerms } from "./planner.js";
import type { QueryPlan,QueryRequest } from "./planner.js";
import { NavigationIndex,validAt } from "./navigation.js";
export interface ContextPacket { role:"untrusted_memory_data"; memories:{id:string;version:number;type:string;content:string;authority:string;details?:MemoryItem["details"];evidenceIds:string[]}[]; evidence:{id:string;source:string;quote:string}[] }
export interface RetrievalOptions { planning?:boolean; dense?:boolean; hierarchy?:boolean; graph?:boolean; limit?:number; timeoutMs?:number; minDenseCosine?:number; budget?:number; countTokens?:(s:string)=>number }
export interface RetrievalResult {plan:QueryPlan;hits:SearchHit[];packet:ContextPacket;denseState:"unused"|"used"|"failed"|"unavailable";cost:{utf8Bytes:number;estimatedTokens:number;tokenizer:string};}
export class MemoryRetriever {
  readonly navigation=new NavigationIndex();
  constructor(readonly session:MemorySession,readonly vector?:VectorIndex){}
  close(){this.navigation.close();}
  async retrieve(input:QueryRequest,options:RetrievalOptions={}):Promise<RetrievalResult>{
    const limit=options.limit??10;assert(Number.isInteger(limit)&&limit>0&&limit<=100,"INVALID_LIMIT");
    const plan=planQuery(input,options.planning??true),count=Math.min(200,Math.max(40,limit*4));
    const sparse=plan.queries.map(q=>this.session.search(plan.scope,q,{at:plan.at,limit:count,...(plan.types?{types:plan.types}:{})}));
    const channels:RankedChannel[]=sparse.map((hits,i)=>({name:i?"cue":"sparse",weight:i?0.3:1,candidates:hits.map(h=>({id:h.item.id,version:h.item.version}))}));
    let denseState:RetrievalResult["denseState"]="unused";
    const cosine=new Map<string,number>();
    if(options.dense){
      if(!this.vector)denseState="unavailable";
      else try {
        const dense=await withDeadline(signal=>this.vector!.search({scope:plan.scope,query:plan.query,at:plan.at,limit:count,signal,...(plan.types?{types:plan.types}:{})}),options.timeoutMs??1000);
        const eligible=dense.filter(d=>d.cosine>=(options.minDenseCosine??0.86));
        for(const d of eligible)cosine.set(d.id,d.cosine);
        channels.push({name:"dense",weight:1,candidates:eligible});denseState="used";
      }catch{denseState="failed";}
    }
    const episodeIds=new Set<string>();
    if(options.hierarchy){
      const candidates=this.navigation.episodeCandidates(this.session,plan,3);for(const m of candidates)episodeIds.add(m.id);
      channels.push({name:"hierarchy",weight:0.4,candidates:candidates.map(m=>({id:m.id,version:m.version}))});
    }
    const graphIds=new Set<string>();
    if(options.graph){const candidates=this.navigation.graphCandidates(this.session,plan);for(const m of candidates)graphIds.add(m.id);channels.push({name:"graph",weight:0.8,candidates:candidates.map(m=>({id:m.id,version:m.version}))});}
    const terms=meaningfulTerms(plan.query);
    const identifiers=terms.filter(t=>/[._/\d-]/.test(t)||t.length>=8);
    const candidates=reciprocalRankFusion(channels).flatMap(c=>{
      const item=this.session.read(plan.scope,c.id);if(!item||item.version!==c.version||!validAt(item,plan))return[];
      const text=`${item.title} ${item.content}`.toLowerCase();
      const exact=plan.query.normalize("NFKC").trim().toLowerCase();
      const pin=(exact.length>=2&&text.includes(exact))||identifiers.some(t=>text.includes(t));
      const coverage=terms.length?terms.filter(t=>text.includes(t)).length/terms.length:0;
      const relevantTask=item.details?.kind==="atomic"&&Boolean(plan.task&&item.details.predicate.startsWith(plan.task.split("_")[0]+"."));
      // Re-rank by observable compatibility, never by generated facts or untrusted instruction content.
      const cueSupport=plan.queries.slice(1).some(cue=>{
        const cueTerms=meaningfulTerms(cue);return cueTerms.length>0&&cueTerms.filter(t=>text.includes(t)).length>=Math.min(2,cueTerms.length);
      });
      const supported=pin||coverage>=0.25||cueSupport||cosine.has(item.id)||graphIds.has(item.id)||relevantTask||c.channels.includes("sparse")&&!options.planning;
      if(!supported)return[];
      return[{item,score:c.score+(pin?1:0)+Math.min(coverage,1)*0.005,channels:c.channels,pin}];
    }).sort((a,b)=>{
      if(a.pin&&b.pin){const ar=sparse[0]!.findIndex(h=>h.item.id===a.item.id),br=sparse[0]!.findIndex(h=>h.item.id===b.item.id);if(ar!==br)return(ar<0?count:ar)-(br<0?count:br);}
      return b.score-a.score||a.item.content.localeCompare(b.item.content)||a.item.id.localeCompare(b.item.id);
    });
    let selected=candidates;
    if(options.hierarchy&&episodeIds.size){
      // Hierarchy only narrows episodic queries; never sacrifices exact-identifier or personal-constraint matches.
      if(plan.types?.length===1&&plan.types[0]==="episodic")selected=candidates.filter(c=>c.pin||episodeIds.has(c.item.id));
    }
    const hits=selected.slice(0,limit).map(({pin:_pin,...h})=>h);
    const countTokens=options.countTokens??((s:string)=>Math.ceil(Buffer.byteLength(s,"utf8")/4));
    const packet=this.packet(plan,hits,options.budget??2048,countTokens,options.hierarchy??false);
    const text=JSON.stringify(packet),bytes=Buffer.byteLength(text,"utf8");
    return{plan,hits,packet,denseState,cost:{utf8Bytes:bytes,estimatedTokens:countTokens(text),tokenizer:options.countTokens?"host-supplied":"utf8-bytes/4-estimate"}};
  }
  packet(plan:QueryPlan,hits:SearchHit[],budget:number,countTokens:(s:string)=>number,spanOnly:boolean):ContextPacket{
    const packet:ContextPacket={role:"untrusted_memory_data",memories:[],evidence:[]};
    assert(countTokens(JSON.stringify(packet))<=budget,"BUDGET_TOO_SMALL");
    for(const hit of hits){
      const m=this.session.read(plan.scope,hit.item.id);if(!m||m.version!==hit.item.version||!validAt(m,plan))continue;
      const evidence=m.evidenceIds.map(id=>this.session.evidence(plan.scope,id));if(evidence.some(e=>!e?.content))continue;
      const staged={...packet,memories:[...packet.memories],evidence:[...packet.evidence]};
      for(const e of evidence){
        if(!e?.content)continue;
        const spans=m.details?.kind==="atomic"?m.details.spans.filter(s=>s.evidenceId===e.id):[];
        let quote=spanOnly&&spans.length?spans.map(s=>{assert(e.content!.slice(s.start,s.end)===s.quote,"SPAN_CHANGED");return s.quote;}).join("\n"):e.content;
        if(m.details?.kind==="procedure" && e.id===m.details.evaluationEvidenceId){
          const evaluation=JSON.parse(e.content) as {spec:unknown};
          const specQuote=JSON.stringify(evaluation.spec);
          assert(e.content.includes(specQuote),"MEASUREMENT_SPEC_NOT_EXTRACTIVE");
          quote=specQuote; // Full measured runs remain available via this evidence ID, not repeated in every prompt.
        }
        if(!staged.evidence.some(old=>old.id===e.id&&old.quote===quote))staged.evidence.push({id:e.id,source:e.source,quote});
      }
      staged.memories.push({id:m.id,version:m.version,type:m.type,content:m.content,authority:m.authority,...(m.details?{details:m.details}:{}),evidenceIds:m.evidenceIds});
      if(countTokens(JSON.stringify(staged))<=budget){packet.memories=staged.memories;packet.evidence=staged.evidence;}
    }
    return packet;
  }
}
