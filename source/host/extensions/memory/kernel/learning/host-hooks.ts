import type { createLearningRuntime } from "./runtime.js";
import type { CapturedTurn } from "./contracts.js";
/** Concrete lifecycle hook for the host. Existing synthesis must be shadow-only for scopes this hook owns. */
export class MemoryLearningHostHooks {
  private pending=new Map<string,CapturedTurn[]>();
  constructor(readonly runtime:ReturnType<typeof createLearningRuntime>){}
  onAuthenticatedUserTurn(input:{conversationId:string;requestId:string;user:string;occurredAt:number},userConfirmedMemory=false):void{
    const turns=this.pending.get(input.conversationId)??[];
    if(turns.length>=128)throw new Error("EPISODE_BUFFER_FULL");
    turns.push({id:input.requestId,sessionId:input.conversationId,text:input.user,at:input.occurredAt,explicitMemory:userConfirmedMemory,expectedEpoch:this.runtime.epoch()});
    this.pending.set(input.conversationId,turns);
  }
  onEpisodeClosed(conversationId:string){
    const turns=this.pending.get(conversationId)??[];
    if(!turns.length)return null;
    const result=this.runtime.recordClosedEpisode(turns);this.pending.delete(conversationId);return result;
  }
  discardPending(conversationId:string){this.pending.delete(conversationId);}
}
