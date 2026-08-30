import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const assign = readFileSync("/tmp/method-assign.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const other = assign.filter((a) => a.method === "OTHER");

const ENV = /webauthn|deep-?link|DeepLinks|Security key|보안키/i;
const UNAVAIL = /Connector card|Email draft|VNC 뷰어|VNC|외부 서비스|external service/i;
const ISSUE = /Auto-review|auto_review|자동 검토/i;

const envEv = "OS/외부 의존(WebAuthn 보안키 하드웨어 / OS deep-link 프로토콜 핸들러) — 헤드리스 WSL 테스트 환경에서 발화/완료 불가. 흐름 코드는 존재.";
const unavailEv = "로컬 미가동: 외부 커넥터(Email/Connector) 또는 박스 GUI 화면(VNC) 필요. WSL loopback 박스엔 데스크톱 GUI/VNC 화면이 없어(Computer 패널은 placeholder) 렌더 불가.";
const issueEv = "auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3.";

let en = 0, un = 0, is = 0, reassign = [];
for (const a of other) {
  const s = `${a.area} ${a.exp}`;
  if (ISSUE.test(s)) { execSync(`node scripts/urec.mjs ISSUE ${JSON.stringify(issueEv)} ${a.id}`, { stdio: "ignore" }); is++; }
  else if (ENV.test(s)) { execSync(`node scripts/urec.mjs ENV ${JSON.stringify(envEv)} ${a.id}`, { stdio: "ignore" }); en++; }
  else if (UNAVAIL.test(s)) { execSync(`node scripts/urec.mjs UNAVAIL ${JSON.stringify(unavailEv)} ${a.id}`, { stdio: "ignore" }); un++; }
  else reassign.push({ ...a, method: "AX" });
}
const rest = assign.filter((a) => a.method !== "OTHER");
writeFileSync("/tmp/method-assign.jsonl", [...rest, ...reassign].map((a) => JSON.stringify(a)).join("\n") + "\n");
console.log("OTHER 분류: ISSUE", is, "| ENV", en, "| UNAVAIL", un, "| AX 재배정", reassign.length);
const by = {}; for (const a of [...rest, ...reassign]) by[a.method] = (by[a.method] || 0) + 1;
console.log("방법별:", JSON.stringify(by));
