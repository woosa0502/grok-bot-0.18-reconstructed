import { appendFileSync } from "node:fs";
const [,,verdict,reason,...ids]=process.argv;
for(const id of ids) appendFileSync("/tmp/sweep-verdicts.jsonl",JSON.stringify({caseId:id,verdict,reason,by:"claude-cdp-ui"})+"\n");
console.log("recorded",ids.length,verdict);
