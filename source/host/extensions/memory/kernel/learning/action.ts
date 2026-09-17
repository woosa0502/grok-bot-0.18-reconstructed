import type { MemorySession } from "../repository.js";
import type { MemoryItem } from "../types.js";
import { assert } from "../types.js";
import type { AtomicDetails } from "./contracts.js";
import type { MemoryRetriever,RetrievalOptions,RetrievalResult } from "../semantic/retriever.js";
import { contextMatches } from "../semantic/planner.js";
export interface ActionRequest {scope:string;query:string;task:"flight_search"|"hotel_search"|"draft_message"|"browser_procedure";at:number;context:Record<string,string>;arguments:Record<string,unknown>;conditions?:string[]}
export interface GroundedAction {tool:string;arguments:Record<string,unknown>;memoryBindings:{id:string;version:number;evidenceIds:string[];argument:string}[];blocked:boolean;reasons:string[]}
export function groundAction(session:MemorySession,request:ActionRequest,retrieval:RetrievalResult):GroundedAction{
  const action:GroundedAction={tool:request.task,arguments:{...request.arguments},memoryBindings:[],blocked:false,reasons:[]};
  // Use only memories actually included in the evidence budget, not hidden unexpanded candidates.
  const memories=retrieval.packet.memories.flatMap(h=>{const m=session.read(request.scope,h.id);return m&&m.version===h.version&&m.validFrom<=request.at&&(m.validTo==null||m.validTo>request.at)?[m]:[];});
  const mapping:Record<string,Record<string,string>>={flight_search:{"flight.seat":"seatPreference","flight.tradeoff":"pricePriority","flight.avoid_seat":"avoidSeat"},hotel_search:{"hotel.priority":"priority"},draft_message:{"project.owner":"recipientName"}};
  const fields=mapping[request.task]??{};
  for(const [predicate,argument]of Object.entries(fields)){
    if(Object.hasOwn(request.arguments,argument))continue; // Current-turn arguments always win.
    const applicability = predicate === "flight.tradeoff" && typeof action.arguments.seatPreference === "string"
      ? { ...request.context, seat: action.arguments.seatPreference } : request.context;
    const applicable=memories.filter(m=>m.details?.kind==="atomic"&&m.details.predicate===predicate&&contextMatches(m.details.context,applicability));
    applicable.sort((a,b)=>Number(b.authority==="user_explicit")-Number(a.authority==="user_explicit")||Object.keys((b.details as AtomicDetails).context).length-Object.keys((a.details as AtomicDetails).context).length||(b.details as AtomicDetails).observedAt-(a.details as AtomicDetails).observedAt);
    const m=applicable[0];if(!m||m.details?.kind!=="atomic")continue;
    const allowed:Record<string,string[]>={seatPreference:["aisle","window"],avoidSeat:["aisle","window"],pricePriority:["seat_over_price"],priority:["quiet","location","price"]};
    if(allowed[argument]&&!allowed[argument]!.includes(m.details.value))continue;
    action.arguments[argument]=m.details.value;action.memoryBindings.push({id:m.id,version:m.version,evidenceIds:m.evidenceIds,argument});
  }
  if(request.task==="flight_search"&&action.arguments.seatPreference===action.arguments.avoidSeat&&action.arguments.seatPreference!=null){
    action.blocked=true;action.reasons.push("CONTRADICTORY_SEAT_CONSTRAINTS");
  }
  if(request.task==="browser_procedure"){
    const candidates=memories.filter(m=>{const d=m.details;return d?.kind==="procedure"&&d.state==="accepted"&&d.domain===request.arguments.domain&&d.task===request.arguments.procedureTask&&d.environment===request.context.environment&&contextMatches(d.preconditions,request.context)&&!d.failureConditions.some(c=>(request.conditions??[]).includes(c));});
    const m=candidates.sort((a,b)=>b.updatedAt-a.updatedAt)[0];
    if(m?.details?.kind==="procedure"){action.arguments.steps=m.details.steps;action.arguments.procedureId=m.id;action.memoryBindings.push({id:m.id,version:m.version,evidenceIds:m.evidenceIds,argument:"steps"});}
    else{action.blocked=true;action.reasons.push("NO_VALID_MEASURED_PROCEDURE");}
  }
  return action;
}
/** All tool-specific field names above are reference contracts; map them to the host's actual tool schema. */
export class DigitalSelf {
  constructor(readonly session:MemorySession,readonly retrieval:MemoryRetriever){}
  async prepare(request:ActionRequest,options:RetrievalOptions={}){
    const result=await this.retrieval.retrieve({scope:request.scope,query:request.query,at:request.at,task:request.task,context:request.context},options);
    return{retrieval:result,action:groundAction(this.session,request,result)};
  }
  async execute<T>(request:ActionRequest,dispatch:(action:GroundedAction)=>Promise<T>,options:RetrievalOptions={}){
    const prepared=await this.prepare(request,options);assert(!prepared.action.blocked,"ACTION_BLOCKED");
    for(const binding of prepared.action.memoryBindings){const current=this.session.read(request.scope,binding.id);assert(current?.version===binding.version,"ACTION_MEMORY_STALE");}
    const result=await dispatch(prepared.action);return{...prepared,result};
  }
}
