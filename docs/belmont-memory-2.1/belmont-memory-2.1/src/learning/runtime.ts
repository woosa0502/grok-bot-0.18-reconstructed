import { MemoryKernel } from "../repository.js";
import { DreamingEngine } from "./dreaming.js";
import { DigitalSelf } from "./action.js";
import type { ActionRequest } from "./action.js";
import type { CapturedTurn } from "./contracts.js";
import { MemoryRetriever } from "../semantic/retriever.js";
import type { RetrievalOptions } from "../semantic/retriever.js";
import { VectorIndex } from "../semantic/vector-index.js";
import type { EmbeddingAdapter } from "../semantic/embedding.js";
import { ExperienceLoop,measure } from "../experience/loop.js";
import type { ExperienceEnvelope,MeasuredExecutor } from "../experience/loop.js";
/** Host composition root. The scope comes from authenticated Belmont identity/project membership. */
export function createLearningRuntime(kernel:MemoryKernel,scope:string,options:{embedding?:EmbeddingAdapter;vectorPath?:string}={}){
  const user=kernel.session({id:"host:authenticated-user",actor:"user",scopes:[scope],capabilities:["read","capture","propose","explicit","forget","index"]});
  const worker=kernel.session({id:"host:memory-consolidator",actor:"consolidator",scopes:[scope],capabilities:["read","propose","consolidate","evaluate","index"]});
  const aside=kernel.session({id:"host:aside-experience",actor:"aside",scopes:[scope],capabilities:["read","capture","propose"]});
  const outcomes=kernel.session({id:"host:measured-outcomes",actor:"agent",scopes:[scope],capabilities:["read","capture","propose"]});
  const vector=options.embedding?new VectorIndex(options.vectorPath??":memory:",options.embedding):undefined;
  const retrieval=new MemoryRetriever(user,vector),dreaming=new DreamingEngine(user,worker,scope),self=new DigitalSelf(user,retrieval),experience=new ExperienceLoop(aside,outcomes,worker,scope);
  return{
    dreaming,retrieval,self,experience,
    epoch:()=>user.snapshot(scope).epoch,
    recordClosedEpisode:(turns:CapturedTurn[])=>dreaming.learn(turns),
    beforeToolAction:(request:Omit<ActionRequest,"scope">,config?:RetrievalOptions)=>self.prepare({...request,scope},config),
    reportAsideExperience:(input:ExperienceEnvelope)=>experience.ingest(input),
    async measureAndPromote(candidateEvidenceId:string,control:MeasuredExecutor,candidate:MeasuredExecutor,scenarios:string[],environment:string,at:number){const samples=await measure(control,candidate,scenarios,environment);return experience.promote(candidateEvidenceId,samples.control,samples.candidate,at);},
    async rebuildVectors(){return vector?vector.rebuild(user,scope):0;},
    async drainIndexOutbox(){return vector?vector.synchronize(user,scope):0;},
    close(){retrieval.close();vector?.close();},
  };
}
