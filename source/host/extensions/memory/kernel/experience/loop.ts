import { performance } from "node:perf_hooks";
import type { MemorySession } from "../repository.js";
import type { MemoryItem } from "../types.js";
import { assert } from "../types.js";
import { evaluateProcedure } from "../procedures.js";
import type { ProcedureTrial } from "../procedures.js";
import type { ProcedureDetails, ProcedureSpec, ProcedureEvaluation } from "../learning/contracts.js";
import { allMemories } from "../learning/dreaming.js";
import { contextMatches } from "../semantic/planner.js";
export interface TaskOutcome { success:boolean; criticalFailure:boolean; latencyMs:number; tokens:number; at:number; environment:string; condition?:string }
export interface ExperienceEnvelope {
  eventId:string; domain:string; task:string; environment:string; at:number;
  trajectory:{operation:string;target:string;result:string}[];
  outcome:TaskOutcome; siteKnowledge?:string[]; candidate?:ProcedureSpec;
}
function median(xs:number[]):number{const a=[...xs].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]!:(a[i-1]!+a[i]!)/2;}
export function validateSpec(spec:ProcedureSpec):void{
  assert(spec!=null&&typeof spec.domain==="string"&&/^[a-z0-9.-]+$/.test(spec.domain)&&spec.domain.includes("."),"INVALID_DOMAIN");
  assert(typeof spec.task==="string"&&spec.task.length>0&&spec.task.length<128&&typeof spec.environment==="string"&&spec.environment.length>0,"INVALID_PROCEDURE");
  assert(Array.isArray(spec.steps)&&spec.steps.length>0&&spec.steps.length<=64&&spec.steps.every(s=>["navigate","fill","click","wait","read"].includes(s.operation)&&typeof s.target==="string"&&s.target.length<=2000),"INVALID_STEPS");
  assert(spec.preconditions&&Object.entries(spec.preconditions).every(([k,v])=>k.length<=128&&typeof v==="string"&&v.length<=256),"INVALID_PRECONDITIONS");
  assert(Array.isArray(spec.failureConditions)&&spec.failureConditions.length<=64&&spec.failureConditions.every(c=>typeof c==="string"&&c.length<=256),"INVALID_FAILURE_CONDITIONS");
  assert(Array.isArray(spec.shortcuts)&&spec.shortcuts.length<=32&&spec.shortcuts.every(c=>typeof c==="string"&&c.length<=2000),"INVALID_SHORTCUTS");
  for(const s of spec.steps)if(s.operation==="navigate"){const url=new URL(s.target);assert(url.protocol==="https:"&&url.hostname===spec.domain,"CROSS_DOMAIN_PROCEDURE");}
}
/** Runs inside Belmont. Aside can submit experience, but cannot directly promote a procedure. */
export class ExperienceLoop {
  constructor(readonly aside:MemorySession,readonly outcomes:MemorySession,readonly evaluator:MemorySession,readonly scope:string){}
  ingest(input:ExperienceEnvelope){
    assert(input&&typeof input.eventId==="string"&&input.eventId.length>0&&input.eventId.length<200,"INVALID_EXPERIENCE_ID");
    assert(input.outcome.environment===input.environment&&input.outcome.at===input.at,"OUTCOME_CONTEXT_MISMATCH");
    assert(Array.isArray(input.trajectory)&&input.trajectory.length<=128&&Number.isSafeInteger(input.at),"INVALID_TRAJECTORY");
    assert(typeof input.outcome.success==="boolean"&&typeof input.outcome.criticalFailure==="boolean"&&input.outcome.latencyMs>0&&input.outcome.tokens>0,"INVALID_OUTCOME");
    if(input.candidate){validateSpec(input.candidate);assert(input.candidate.domain===input.domain&&input.candidate.task===input.task&&input.candidate.environment===input.environment,"CANDIDATE_CONTEXT_MISMATCH");}
    const capture=(ref:string,content:string,source:"browser"|"tool-outcome")=>this.aside.capture({scope:this.scope,source,sourceRef:`aside:${input.eventId}:${ref}`,content,occurredAt:input.at,expectedEpoch:this.aside.snapshot(this.scope).epoch});
    const trajectory=capture("trajectory",JSON.stringify(input.trajectory),"browser"),outcome=capture("outcome",JSON.stringify(input.outcome),"tool-outcome");
    const result=this.aside.propose({scope:this.scope,type:"episodic",content:`${input.domain} ${input.task}: ${input.outcome.success?"succeeded":"failed"}${input.outcome.condition?` (${input.outcome.condition})`:""}`,
      title:`${input.domain} ${input.task}`,evidenceIds:[trajectory.id,outcome.id],validFrom:input.at,basedOn:this.aside.snapshot(this.scope),idempotencyKey:`episode:${input.eventId}`});
    const knowledgeIds:string[]=[];
    for(const [i,text]of(input.siteKnowledge??[]).entries()){
      const e=capture(`knowledge:${i}`,text,"browser");
      const r=this.aside.propose({scope:this.scope,type:"knowledge",content:text,title:input.domain,evidenceIds:[e.id],validFrom:input.at,basedOn:this.aside.snapshot(this.scope),idempotencyKey:`knowledge:${input.eventId}:${i}`});if(r.status==="committed")knowledgeIds.push(r.id);
    }
    const candidate=input.candidate?capture("candidate",JSON.stringify(input.candidate),"browser"):null;
    return{episode:result,knowledgeIds,candidateEvidenceId:candidate?.id??null};
  }
  /** Trusted host method. Never expose supplied trial arrays in the agent/Aside HTTP API. */
  promote(candidateEvidenceId:string,control:ProcedureTrial[],candidate:ProcedureTrial[],at:number){
    const ce=this.evaluator.evidence(this.scope,candidateEvidenceId);assert(ce?.content,"CANDIDATE_NOT_FOUND");
    const spec=JSON.parse(ce.content) as ProcedureSpec;validateSpec(spec);
    const verdict=evaluateProcedure(control,candidate,spec.environment);
    const evaluation:ProcedureEvaluation={kind:"procedure-evaluation-v1",spec,control,candidate,candidateEvidenceId};
    const evidence=this.outcomes.capture({scope:this.scope,source:"tool-outcome",sourceRef:`measure:${candidateEvidenceId}:${at}`,content:JSON.stringify(evaluation),occurredAt:at,expectedEpoch:this.outcomes.snapshot(this.scope).epoch});
    if(!verdict.accept)return{status:"rejected" as const,reason:verdict.reason,evaluationEvidenceId:evidence.id};
    const successes=candidate.filter(t=>t.success).length;
    const details:ProcedureDetails={...spec,kind:"procedure",state:"accepted",evaluationEvidenceId:evidence.id,successCount:successes,failureCount:candidate.length-successes,
      successRate:successes/candidate.length,medianLatencyMs:median(candidate.map(t=>t.latencyMs)),medianTokens:median(candidate.map(t=>t.tokens)),lastVerified:at,feedbackEvidenceIds:[]};
    const before=this.evaluator.snapshot(this.scope);
    const proposals=[];
    if(spec.supersedesId){const old=this.evaluator.read(this.scope,spec.supersedesId);assert(old?.details?.kind==="procedure"&&old.details.domain===spec.domain&&old.details.task===spec.task,"INVALID_SUPERSEDED_PROCEDURE");
      proposals.push({scope:this.scope,type:old.type,content:old.content,title:old.title,evidenceIds:old.evidenceIds,target:{id:old.id,expectedVersion:old.version},validFrom:old.validFrom,validTo:at,details:old.details,basedOn:before,idempotencyKey:`retire-procedure:${candidateEvidenceId}`});}
    proposals.push({scope:this.scope,type:"procedural" as const,title:`${spec.domain} ${spec.task}`,content:`Verified ${spec.domain} ${spec.task} procedure for ${spec.environment}. ${spec.steps.map(s=>s.operation+" "+s.target).join("; ")}`,
      evidenceIds:[candidateEvidenceId,evidence.id],validFrom:at,details,basedOn:before,idempotencyKey:`promote:${candidateEvidenceId}`});
    return this.evaluator.batch(this.scope,proposals).at(-1)!;
  }
  feedback(id:string,eventId:string,outcome:TaskOutcome){
    const item=this.evaluator.read(this.scope,id);assert(item?.details?.kind==="procedure","PROCEDURE_NOT_FOUND");const old=item.details;
    assert(Number.isFinite(outcome.latencyMs)&&outcome.latencyMs>0&&Number.isFinite(outcome.tokens)&&outcome.tokens>0&&typeof outcome.success==="boolean","INVALID_OUTCOME");
    const e=this.outcomes.capture({scope:this.scope,source:"tool-outcome",sourceRef:`procedure:${id}:${eventId}`,content:JSON.stringify(outcome),occurredAt:outcome.at,expectedEpoch:this.outcomes.snapshot(this.scope).epoch});
    if(outcome.environment!==old.environment)return{status:"rejected" as const,reason:"ENVIRONMENT_CHANGED"};
    if(old.feedbackEvidenceIds.includes(e.id))return{status:"committed" as const,id,version:item.version};
    const successCount=old.successCount+Number(outcome.success),failureCount=old.failureCount+Number(!outcome.success);
    const details:ProcedureDetails={...old,successCount,failureCount,successRate:successCount/(successCount+failureCount),lastVerified:Math.max(old.lastVerified,outcome.at),
      state:outcome.criticalFailure||failureCount>=2?"deprecated":old.state,
      feedbackEvidenceIds:[...old.feedbackEvidenceIds,e.id],failureConditions:[...new Set([...old.failureConditions,...(!outcome.success&&outcome.condition?[outcome.condition]:[])])]};
    return this.evaluator.propose({scope:this.scope,type:item.type,title:item.title,content:item.content,evidenceIds:[e.id],target:{id,expectedVersion:item.version},details,
      validFrom:item.validFrom,validTo:item.validTo,basedOn:this.evaluator.snapshot(this.scope),idempotencyKey:`feedback:${id}:${eventId}`});
  }
  select(domain:string,task:string,environment:string,context:Record<string,string>,conditions:string[],at:number):MemoryItem|null{
    return allMemories(this.evaluator,this.scope).filter(m=>{const d=m.details;return m.type==="procedural"&&m.validFrom<=at&&(m.validTo==null||m.validTo>at)&&d?.kind==="procedure"&&d.state==="accepted"&&d.domain===domain&&d.task===task&&d.environment===environment&&contextMatches(d.preconditions,context)&&!d.failureConditions.some(c=>conditions.includes(c));})
      .sort((a,b)=>(b.details as ProcedureDetails).lastVerified-(a.details as ProcedureDetails).lastVerified)[0]??null;
  }
}
export interface MeasuredExecutor { (scenarioId:string):Promise<{success:boolean;criticalFailure:boolean;tokens:number}> }
/** Paired alternating order reduces order/caching bias. Scenario independence still belongs to fixture design. */
export async function measure(control:MeasuredExecutor,candidate:MeasuredExecutor,scenarios:string[],environment:string):Promise<{control:ProcedureTrial[];candidate:ProcedureTrial[]}>{
  assert(new Set(scenarios).size===scenarios.length,"DUPLICATE_SCENARIOS");const results:{control:ProcedureTrial[];candidate:ProcedureTrial[]}={control:[],candidate:[]};
  for(const [i,id]of scenarios.entries())for(const arm of(i%2?["candidate","control"]:["control","candidate"]) as("control"|"candidate")[]){
    const start=performance.now();let outcome;try{outcome=await(arm==="control"?control:candidate)(id);}catch{outcome={success:false,criticalFailure:true,tokens:1};}
    results[arm].push({scenarioId:id,environment,...outcome,latencyMs:Math.max(0.001,performance.now()-start)});
  }return results;
}
