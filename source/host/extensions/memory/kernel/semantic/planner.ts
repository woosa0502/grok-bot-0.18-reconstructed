import type { MemoryType } from "../types.js";
export interface QueryRequest { scope: string; query: string; at: number; types?: MemoryType[]; task?: string; context?: Record<string,string> }
export interface QueryPlan extends QueryRequest { queries: string[]; intent: "lookup" | "action" | "temporal" | "relationship"; context: Record<string,string> }
/** Search cues only. This module has no repository writer. */
export function planQuery(input: QueryRequest, enabled=true): QueryPlan {
  const plan: QueryPlan={...input,queries:[input.query],intent:"lookup",context:{...input.context}};
  if(!enabled)return plan;
  const q=input.query.toLowerCase();
  const task=input.task ?? (/항공|비행|flight|airfare/.test(q)?"flight_search":/호텔|숙소|숙박|hotel|accommodation/.test(q)?"hotel_search":undefined);
  if(task){plan.task=task;plan.intent="action";}
  if(task==="flight_search")plan.queries.push("좌석 통로석 창가 선호 flight seat preference","장거리 비행 가격 seat price tradeoff");
  if(task==="hotel_search")plan.queries.push("호텔 숙소 선호 위치 조용 가격 hotel preference");
  if(/출장|business trip/.test(q))plan.context.purpose="business";
  if(/휴가|vacation|leisure/.test(q))plan.context.purpose="leisure";
  if(/장거리|long[- ]haul/.test(q))plan.context.distance="long-haul";
  if(/단거리|short[- ]haul/.test(q))plan.context.distance="short-haul";
  if(/관계|동료|담당자|colleague|relationship|who.*project|프로젝트.*누구/.test(q)) {plan.intent="relationship";plan.queries.push("동료 담당자 colleague project.owner");}
  if(/코드|검증|테스트|code|verification|regression/.test(q))plan.queries.push("test check build verification");
  if(/한국어|한글/.test(q))plan.queries.push("Korean CJK bigram");
  if(/아바타/.test(q))plan.queries.push("avatar");
  if(/기억.*문자|기억.*예산/.test(q))plan.queries.push("memory prompt budget");
  if(/기준|당시|그때|as of|back in/.test(q)){
    const date=q.match(/\b(20\d\d-\d\d-\d\d)\b/);if(date){const at=Date.parse(date[1]+"T23:59:59.999Z");if(Number.isFinite(at)){plan.at=at;plan.intent="temporal";}}
  }
  return plan;
}
export function contextMatches(memory: Record<string,string>, task: Record<string,string>): boolean {
  return Object.entries(memory).every(([key,value])=>task[key]===value);
}
export function meaningfulTerms(query:string):string[]{
  const stop=new Set(["what","which","is","the","a","my","i","do","does","was","for","to","me","find","show","get","of","in","and","it","내","나는","사용자","나의","뭐야","뭐였지","알려줘","찾아줘","검색해줘","어떤","선호하는","전에","지금"]);
  const words = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_./-]+/gu) ?? [];
  const normalized = words.map(word => {
    if (!/^[가-힣]+$/.test(word)) return word;
    // A limited query-side particle rule, not a Korean morphological analyzer.
    const stem = word.replace(/(?:으로부터|에서부터|에게서|에서는|으로는|에서|으로|에게|부터|까지|은|는|이|가|을|를)$/, "");
    return stem.length >= 2 ? stem : word;
  });
  return [...new Set(normalized)].filter(t=>t.length>1&&!stop.has(t));
}
