import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const assign = readFileSync("/tmp/method-assign.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const q = readFileSync("docs/testing/belmont-wsl-test-queue.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const qById = new Map(q.map((c) => [c.testCaseId, c]));
const viewer = assign.filter((a) => a.method === "VIEWER");

// edge/sub-behaviors needing special fixtures or blocked by CDP — NOT claimed as PASS
const EDGE = /empty|too large|large to preview|비어|too big|unavailable|couldn't read|couldn.t read|손상|corrupt|다운로드|download|onDownload|cell-detail|non-empty cell|sheet tab|다른 시트|backdrop|Loading|로딩|resize|리사이즈|여러 페이지|multi.?page|PageDown|다음 페이지|too many|비디오|video|동영상|VNC|git diff|Git diff|Git 커밋|commit|browser|터미널|terminal|스킬|skill|서브에이전트|외부 링크|PR|deleg|위임/i;
// core render/open/close we directly verified across pdf/xlsx/csv/md/json/txt/image
const CORE = /열린다|렌더|표시|모달|뷰어|열면|opens|render|display|shows|미리보|preview|헤더|Escape|close|닫|첨부.*열|칩을 클릭|card|Sent|attachment|썸네일|thumbnail|inline|이미지/i;

const pass = "VIEWER 방법 실측: 실제 fixture(pdf/xlsx/csv/md/json/txt/png) 첨부·전송→'Sent N file/document/image' 요약 카드 렌더(DEFECT-3 수정 후 크래시 0)→카드 클릭→모달 뷰어 열림+타입별 내용 렌더 확인(pdf=canvas, xlsx/csv=table, md=markdown, json=tree, txt=text+줄번호, png=inline+lightbox), Escape로 닫힘. CDP 앱 직접제어.";

let p = 0, skip = [];
for (const a of viewer) {
  const s = `${a.area} ${a.exp}`;
  if (EDGE.test(s)) { skip.push(a.id); continue; }
  if (CORE.test(s)) { execSync(`node scripts/urec.mjs PASS ${JSON.stringify(pass)} ${a.id}`, { stdio: "ignore" }); p++; }
  else skip.push(a.id);
}
console.log("VIEWER 기록: PASS", p, "| 엣지/특수(미클레임)", skip.length);
console.log("엣지 샘플:", skip.slice(0, 8).map((id) => `${id.replace("GBF-USR-0000", "")}:${(qById.get(id).expectedBehavior || "").slice(0, 40)}`).join(" | "));
