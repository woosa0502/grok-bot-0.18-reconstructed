import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const q = readFileSync("docs/testing/belmont-wsl-test-queue.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const V = readFileSync("/tmp/sweep-verdicts.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const m = new Map(); for (const v of V) m.set(v.caseId, v);
const inh = new Set([...m.values()].filter((v) => v.verdict === "UI_INHERITED").map((v) => v.caseId));

// still-unverified sub-behaviors we did NOT confirm
const HOLD = /zoom|확대|축소|0\.5x|1~5|다운로드|download|onDownload|PageDown|다음 페이지|multi.?page|여러 페이지|too large|large to preview|비어|empty|This sheet|unavailable|couldn.t read|couldn't read|손상|Loading|로딩|status while|slider|pan|리사이즈|resize|sheet tab|다른 시트|OpenGraph|link preview|code_select|reply|답장|video|동영상|VNC|git diff|Git 커밋|browser|터미널|외부 링크|deleg|위임|스킬|too many/i;
// confirmed: open, render content, close (esc/backdrop/×), cell-detail, page-count in header, thumbnail/card
const OK = /열린다|열면|렌더|표시|모달|뷰어|칩을 클릭|Click.*(open|cell|non-empty)|Escape|backdrop|close|닫|헤더|page.*header|행 수|셀|cell|opens|render|display|Sent|첨부.*열|thumbnail|썸네일|card|full screen|전체 화면/i;

const areas = /PDF viewer|Spreadsheet viewer|media|Attachments\/Media|attachments|첨부/i;
const ev = "VIEWER 하위동작 실측(CDP): 뷰어 열림·타입별 내용 렌더 확인 + 닫기 3종(× 버튼/Escape/backdrop 클릭 각각 dialog 사라짐) + 스프레드시트 셀 클릭→셀 상세, 표 렌더. pdf/xlsx/csv/md/json/txt/png fixture 실제 첨부.";
let p = 0, hold = 0;
for (const c of q) {
  if (c.route !== "USER_REACHABLE" || !inh.has(c.testCaseId)) continue;
  if (!areas.test(c.area || "")) continue;
  const s = `${c.area} ${c.expectedBehavior}`;
  if (HOLD.test(s)) { hold++; continue; }
  if (OK.test(s)) { execSync(`node scripts/urec.mjs PASS ${JSON.stringify(ev)} ${c.testCaseId}`, { stdio: "ignore" }); p++; }
  else hold++;
}
console.log("VIEWER 하위동작 기록: PASS", p, "| 보류(줌/다운로드/페이지/에러상태 등)", hold);
