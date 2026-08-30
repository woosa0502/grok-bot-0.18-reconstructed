import { readFileSync } from "node:fs";
const V = readFileSync("/tmp/sweep-verdicts.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const queue = readFileSync("/home/hoon/_roots/labs/work/Belmont/docs/testing/belmont-wsl-test-queue.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const area = new Map(queue.map((c) => [c.testCaseId, c.area]));

const notPass = V.filter((x) => x.verdict !== "PASS" && x.verdict !== "FIXED" && x.verdict !== "EXPECTED");

const CURSOR = /cloudagent|cloud agent|generateimage|image gen|이미지생성|이미지 생성|no image|computer tool|computeruse|computer-use|browser|browseruse|videoreview|video 분석|video|plugin|cursor|auto-review|smart-mode|smart_mode|auto_review|required_permissions|sandbox/i;
const UNNEEDED = /group|room|cross-user|remote|slack|teams|github|messaging channel|채널|no channel|multi-user|shared room|listagents|listgroups|봇 목록|agent directory|send.?to.?agent|SendMessage channel/i;
// everything else = real-matters
const buckets = { cursor: [], unneeded: [], real: [] };
for (const x of notPass) {
  const s = (x.reason || "") + " " + (area.get(x.caseId) || "");
  if (CURSOR.test(s)) buckets.cursor.push(x);
  else if (UNNEEDED.test(s)) buckets.unneeded.push(x);
  else buckets.real.push(x);
}
const cnt = (arr) => { const b = {}; for (const x of arr) b[x.verdict] = (b[x.verdict] || 0) + 1; return b; };
console.log("문제(not PASS) 총:", notPass.length);
console.log("");
console.log("① 커서 전용 (로컬엔 원래 없음):", buckets.cursor.length, cnt(buckets.cursor));
console.log("② 개인 로컬엔 불필요:", buckets.unneeded.length, cnt(buckets.unneeded));
console.log("③ 실제 고칠 문제:", buckets.real.length, cnt(buckets.real));
console.log("");
console.log("=== ③ 실제 고칠 문제 목록 (area | verdict | 사유) ===");
for (const x of buckets.real) console.log("  " + x.caseId.replace("GBF-AGT-0000", "").replace("-N01", "") + " [" + (area.get(x.caseId) || "") + "] " + x.verdict + " — " + (x.reason || "").slice(0, 90));
