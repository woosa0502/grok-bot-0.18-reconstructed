import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const assign = readFileSync("/tmp/method-assign.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const cloud = assign.filter((a) => a.method === "CLOUD");

const UNAVAIL = /Diff 탭|cloud-agent|Cloud agent|Cloud-agent|Cloud agents|PR review|자동화 트리거 \(GitHub\)|자동화 트리거 \(Slack\)|자동화 트리거 \(외부|Connector card|automation-auto-review|computer-auto-review/i;
const ENV = /MCP \(Google|MCP 인증|Security key/i;
const unavailEv = "cloud 전용 기능(Cursor 클라우드 에이전트/PR diff/babysit/외부 서비스 커넥터). 로컬 Belmont는 로컬 영구봇 + Task 서브에이전트로 동작하고 Cursor 클라우드 백엔드/에이전트가 없음(sand-cloud-agent-auto-review.ts는 cloud-agent 전용). 로컬 미가동.";
const envEv = "외부 OAuth/하드웨어 필요(Google Workspace OAuth / WebAuthn 보안키) — 이 테스트 환경엔 외부 커넥터/키 없음. 흐름 코드는 로컬에 존재(mcp-oauth.ts, mcp-oauth-loopback-provider.ts)하나 완료 불가.";

let un = 0, en = 0, reassign = [];
for (const a of cloud) {
  const s = `${a.area} ${a.exp}`;
  if (UNAVAIL.test(s)) { execSync(`node scripts/urec.mjs UNAVAIL ${JSON.stringify(unavailEv)} ${a.id}`, { stdio: "ignore" }); un++; }
  else if (ENV.test(s)) { execSync(`node scripts/urec.mjs ENV ${JSON.stringify(envEv)} ${a.id}`, { stdio: "ignore" }); en++; }
  else reassign.push({ ...a, method: "AX" }); // local-present → test interactively
}
// merge reassignments back into method-assign so AX batch picks them up
const rest = assign.filter((a) => !(a.method === "CLOUD" && !UNAVAIL.test(`${a.area} ${a.exp}`) && !ENV.test(`${a.area} ${a.exp}`)));
writeFileSync("/tmp/method-assign.jsonl", [...rest, ...reassign].map((a) => JSON.stringify(a)).join("\n") + "\n");
console.log("CLOUD 분류: UNAVAIL", un, "| ENV", en, "| AX 재배정", reassign.length);
