import { DatabaseSync } from "node:sqlite";
import type { MemorySession } from "../repository.js";
import type { MemoryItem } from "../types.js";
import { allMemories } from "../learning/dreaming.js";
import { cjkBigrams, ftsQuery } from "../text.js";
import type { QueryPlan } from "./planner.js";
export function validAt(item:MemoryItem,plan:QueryPlan):boolean{
  return item.validFrom<=plan.at&&(item.validTo==null||item.validTo>plan.at)&&(!plan.types||plan.types.includes(item.type));
}
/** Derived summaries and typed adjacency are reconstructed from canonical atoms after each generation. */
export class NavigationIndex {
  #db=new DatabaseSync(":memory:"); #key=""; #items:MemoryItem[]=[];
  constructor(){this.#db.exec("CREATE VIRTUAL TABLE nav USING fts5(id UNINDEXED,title,aliases,body,grams,tokenize='unicode61 remove_diacritics 2')");}
  close(){this.#db.close();}
  refresh(session:MemorySession,scope:string){
    const key=JSON.stringify(session.snapshot(scope));if(key===this.#key)return;
    this.#items=allMemories(session,scope);this.#db.exec("DELETE FROM nav");
    const groups=new Map<string,MemoryItem[]>();for(const m of this.#items){if(m.details?.kind!=="atomic")continue;const id=m.details.episodeId;groups.set(id,[...(groups.get(id)??[]),m]);}
    for(const [id,items]of groups){const text=items.map(m=>m.content).join("\n");this.#db.prepare("INSERT INTO nav VALUES(?,?,?,?,?)").run(id,"episode navigation","",text,cjkBigrams(text).join(" "));}
    this.#key=key;
  }
  episodeCandidates(session:MemorySession,plan:QueryPlan,episodes=3):MemoryItem[]{
    this.refresh(session,plan.scope);const expr=ftsQuery(plan.queries.join(" "));if(!expr)return[];
    const ids=this.#db.prepare("SELECT id FROM nav WHERE nav MATCH ? ORDER BY bm25(nav,0,6,4,1,1.5) LIMIT ?").all(expr,episodes).map(r=>String(r.id));
    return ids.flatMap(id=>this.#items.filter(m=>m.details?.kind==="atomic"&&m.details.episodeId===id&&validAt(m,plan)));
  }
  graphCandidates(session:MemorySession,plan:QueryPlan,maxDepth=2,maxEdges=32):MemoryItem[]{
    if(plan.intent!=="relationship")return[];
    this.refresh(session,plan.scope);
    const edges=this.#items.filter(m=>validAt(m,plan)&&m.details?.kind==="atomic"&&/^(relation\.|project\.)/.test(m.details.predicate));
    const entities=new Set<string>();for(const m of edges){const d=m.details!;if(d.kind!=="atomic")continue;entities.add(d.subject);entities.add(d.value);}
    const q=plan.query.toLowerCase();let frontier=[...entities].filter(e=>e!=="user"&&q.includes(e.toLowerCase()));
    if(/내|나의|my\b|나와/.test(q))frontier.push("user");
    const visited=new Set(frontier),result:MemoryItem[]=[];
    for(let depth=0;depth<Math.min(maxDepth,2)&&frontier.length;depth++){
      const next:string[]=[];
      for(const m of edges){const d=m.details!;if(d.kind!=="atomic")continue;if(!frontier.includes(d.subject)&&!frontier.includes(d.value))continue;
        if(!result.some(x=>x.id===m.id))result.push(m);if(result.length>=maxEdges)return result;
        for(const e of[d.subject,d.value])if(!visited.has(e)){visited.add(e);next.push(e);}
      }frontier=next;
    }
    return result;
  }
}
