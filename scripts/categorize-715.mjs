import { readFileSync, writeFileSync } from "node:fs";
const q = readFileSync("docs/testing/belmont-wsl-test-queue.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const V = readFileSync("/tmp/sweep-verdicts.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const m = new Map(); for (const v of V) m.set(v.caseId, v);
const qById = new Map(q.map((c) => [c.testCaseId, c]));
const inh = [...m.values()].filter((v) => v.verdict === "UI_INHERITED").map((v) => qById.get(v.caseId)).filter(Boolean);

// method buckets by area/expected keywords
const VIEWER = /PDF viewer|Spreadsheet|media|Attachments\/Media|attachment|첨부|미디어|이미지 뷰|image viewer|파일 미리보|preview.*file|viewer/i;
const COLLAB = /공유룸|정보-채널|채널|정보-멤버|멤버|조직도|org chart|로스터|roster|cross-user|multi-user|shared room|group|그룹|정보-공유|협업|collaborat|remote agent|다른 사용자|초대|invite/i;
const CLOUD = /cloud-agent|cloud agent|Babysit|Diff 탭|Diff tab|PR |github|Google Workspace|OAuth|MCP \(|자동화 트리거|workflows\/store|automation|routine|예약|schedule|notifications|OS 알림|도구 승인|permission|computer\(forever|forever-box|Computer\b/i;
const AX = /Command Palette|Composer|Emoji|메뉴|menu|Settings|설정|Sidebar|Transcript|Timeline|outline|아바타|avatar|button|toggle|switch|봇 삭제|delete|rename|검색|search|account|Conversation details|detail/i;

function bucket(c) {
  const s = `${c.area || ""} ${c.expectedBehavior || ""}`;
  if (VIEWER.test(s)) return "VIEWER";
  if (COLLAB.test(s)) return "COLLAB";
  if (CLOUD.test(s)) return "CLOUD";
  if (AX.test(s)) return "AX";
  return "OTHER";
}
const out = {}; const assign = [];
for (const c of inh) { const b = bucket(c); out[b] = (out[b] || 0) + 1; assign.push({ id: c.testCaseId, area: c.area, method: b, exp: (c.expectedBehavior || "").slice(0, 70) }); }
writeFileSync("/tmp/method-assign.jsonl", assign.map((a) => JSON.stringify(a)).join("\n") + "\n");

console.log("715 UI_INHERITED 방법 배정:");
for (const [b, n] of Object.entries(out).sort((a, b2) => b2[1] - a[1])) console.log("  " + String(n).padStart(4) + "  " + b);
console.log("\n방법별 정의:");
console.log("  AX     : 접근성트리로 이름 찾아 클릭+상태검증 (자동)");
console.log("  VIEWER : 실제 fixture(pdf/csv/xlsx/png/md/json/txt) 첨부→뷰어 렌더 검증 (반자동)");
console.log("  COLLAB : 다중사용자/협업 — 로컬 배선 여부 코드확인→대부분 UNAVAIL (정직판정)");
console.log("  CLOUD  : 클라우드/통합(cloud-review/PR/MCP-OAuth/자동화/알림) — 코드확인→UNAVAIL/ENV");
console.log("  OTHER  : 개별 판단 필요");
console.log("\n샘플 (AX 10):");
for (const a of assign.filter((x) => x.method === "AX").slice(0, 10)) console.log("  " + a.id.replace("GBF-USR-0000", "") + " [" + a.area + "] " + a.exp);
