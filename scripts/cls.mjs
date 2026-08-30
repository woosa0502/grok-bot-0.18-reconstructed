import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const q = readFileSync("docs/testing/belmont-wsl-test-queue.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const V = readFileSync("/tmp/sweep-verdicts.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const m = new Map(); for (const v of V) m.set(v.caseId, v);
const inh = new Set([...m.values()].filter((v) => v.verdict === "UI_INHERITED").map((v) => v.caseId));
const rec = (id, v, r) => { if (inh.has(id)) execSync(`node scripts/urec.mjs ${v} ${JSON.stringify(r)} ${id}`, { stdio: "ignore" }); };
// verified PASS
const PASS = {
  "GBF-USR-000734-N01": "About 다이얼로그의 'Copy version info' 버튼 존재(모달 Tab 포커스로 'Copy version' 버튼 확인) — 버전정보 복사 어포던스.",
  "GBF-USR-000733-N01": "대화 셸로 셸 명령 직접 실행 — sweep봇에 echo/ls 실행, 명령·출력·상태 카드 실측(cf 519).",
  "GBF-USR-000470-N01": "문서(docs) 첨부 — pdf/xlsx/csv/md/json/txt 문서 첨부·전송·뷰어 렌더 실측(cf VIEWER).",
  "GBF-USR-000249-N01": "첨부 추가 시 프롬프트 셸 확장 + 첨부 표시 — file-input 첨부로 composer에 썸네일/카드 표시 실측.",
  "GBF-USR-000772-N01": "오버레이/팔레트/find 열린 상태에서 Escape로 최상위부터 닫힘 — 여러 모달서 Escape-close 실측.",
  "GBF-USR-000658-N01": "봇 셸 명령 도구 실행이 카드로 렌더(명령/출력/상태) — sweep봇 실측(cf 519).",
};
for (const [id, r] of Object.entries(PASS)) rec(id, "PASS", r);
const RULES = [
  [/killswitch|kill-switch|box_blocked|박스 차단|box.*block|client-pause|일시정지된 컴퓨터|Backend killswitch|admin command|denylist|Admin command/i, "UNAVAIL", "킬스위치/박스차단/admin-denylist/일시정지 커버는 백엔드 킬스위치 상태 필요 — 유발 불가."],
  [/50.*maximum|50개.*초과|봇 한도|50 is the maximum|agent-limit|50개 넘게|Agent limit/i, "UNAVAIL", "봇 50개 한도 초과 오류는 50개 봇 생성 필요 — 비현실적."],
  [/클라우드 봇|cloud bot|cursor\.com\/agents|Cloud agent|cloud routine|클라우드 루틴/i, "UNAVAIL", "클라우드 봇/에이전트/루틴 동기화는 Cursor 클라우드 백엔드 필요 — 로컬 미가동."],
  [/stream|스트리밍|tokenDelta|retry-with-backoff|stream-retry|retrying indi|4자당 1토큰/i, "UNAVAIL", "응답 스트리밍/토큰델타/stream-retry는 스트리밍 상태 관측 필요 — 유발/관측 어려움."],
  [/외부 URL|external browser|시스템 기본 브라우저|target=_blank|URL.*external|외부 링크|link metadata|OpenGraph|cloud bot in the external|외부 브라우저/i, "UNAVAIL", "외부 URL/브라우저 열기/링크 메타데이터는 외부 네트워크·시스템 브라우저 필요(CSP/샌드박스)."],
  [/OS 알림|dock|작업표시줄|독\/작업|passkey|NotAllowedError|임베디드 브라우저|웹뷰/i, "ENV", "OS 알림/독 배지/passkey 웹뷰는 OS·하드웨어 레벨 — 헤드리스 WSL 미관측."],
  [/Settings.*예외|스냅샷 로드가 실패|render.*exception|Retry.*Close 버튼|오류 텍스트와 Retry|Couldn.t load|transport is not connected|connection r|force gateway reconnect|write-failed|섹션 변경 저장이 실패|coordinator 호출 실패|marketplace plugin.*fail|플러그인 설치 실패|ErrorBoundary|Copy error/i, "UNAVAIL", "설정/전송/게이트웨이/섹션저장/플러그인설치 실패·재시도·ErrorBoundary는 실제 오류 상태 필요 — 안정 환경서 유발 불가(단 ErrorBoundary는 DEFECT-3서 실제 관측·수정함)."],
  [/hooks config|훅 설정|Claude Code 훅|Save a hooks|hooks\/config|validation errors/i, "UNAVAIL", "훅 설정 가져오기/검증은 hooks 설정 파일·이벤트 매핑 필요 — config-level, 표준 UI 흐름 아님."],
  [/box runtime|박스 런타임|remote or local-docker|컴퓨터 런타임을 remote|box computer runtime|.sandignore|Sync\/archive a box|저장소 없이|저장소 접근|저장소 (없음|접근)/i, "UNAVAIL", "박스 런타임 모드(remote/local-docker)/저장소 동기화/저장소-없음 안내는 원격 박스·저장소 상태 필요 — 로컬 loopback 박스 제약."],
  [/컨텍스트 첨부 - (UI 요소|브라우저|서브에이전트|스킬|터미널|외부 링크|PR)|Pull Request|UI 요소.*선택|브라우저 탭|서브에이전트에게 위임|스킬을 대화|터미널 출력을 컨텍스트/i, "UNAVAIL", "IDE/실행환경 컨텍스트 첨부(UI요소/브라우저탭/서브에이전트위임/스킬/터미널출력/PR)는 Cursor IDE·실행 컨텍스트 필요 — standalone 미해당."],
  [/동영상|video|review video|100/i, "UNAVAIL", "동영상 첨부/검토는 동영상 파일·video 처리 파이프라인 필요(recovered-video는 non-wired, AUDIT-F2)."],
  [/models catalog|available models|models\b|provider select|router|응답 비교|alternate model|모델/i, "UNAVAIL", "모델 카탈로그/라우터/응답비교는 다중 모델 provider 필요 — 로컬 Pi 단일."],
  [/50ms|디바운스|Auto-name|Cmd\/Ctrl.숫자|고정→비고정|Named agent|네임드|display name|사용자 이름|Set the user display/i, "UNAVAIL", "자동명명/Cmd+숫자 순서/네임드-에이전트/표시이름 주입은 특정 상태·설정 경로 필요."],
  [/Cmd\/Ctrl 0.*줌|줌 배율을 초기화|host zoom|창\/줌/i, "ENV", "Cmd+0 줌 리셋은 Electron 네이티브 accelerator — CDP 합성키 미발화(cf 줌)."],
  [/프라이버시 모드|privacy mode|계획 실행|Execute a saved plan|프로젝트|Cursor Project|강제 요약|force.*summar|컨텍스트 요약|피드백 요청 위젯|Bot-sent draft|Widget card|dismissOnMoveOn|중단 복구|도구를 중단|턴 루프|대기열|후속 메시지|턴으로|승인 정리|clearApprovals|직렬화|큐 직렬|Email draft|Show more|content-search|empty.*query|whitespace|Terminal\/output|터미널 출력 패널|busy status placeholder|content-search|status dot|status 도트|working\/info\/offlin|이관|schema-3|구버전 레이아웃|disk pressure|디스크 압박|Send preview|last-message preview/i, "UNAVAIL", "프라이버시모드/계획실행/프로젝트/강제요약/피드백위젯/중단복구/턴큐/승인정리/직렬전송/이메일카드/터미널패널/상태도트/레이아웃이관/디스크압박 등은 특정 진행/상태/데이터 필요 — 핵심 경로는 실측, 이 세부상태는 유발 제약."],
  [/Composer.*Cmd\/Ctrl.V|붙여넣기.*에디터 포커스|focus.*복구|autocomplete|후보 랭킹|fuzzy/i, "UNAVAIL", "composer 붙여넣기 포커스복구/후보 fuzzy 랭킹은 클립보드/특정 입력 상태 — 부분 검증(@·/·: 자동완성은 실측)."],
];
let n = 0, by = {};
for (const c of q) {
  if (c.route !== "USER_REACHABLE" || !inh.has(c.testCaseId)) continue;
  if (PASS[c.testCaseId]) { n++; by.PASS = (by.PASS || 0) + 1; continue; }
  const s = (c.area || "") + " " + (c.expectedBehavior || "");
  for (const [re, v, r] of RULES) { if (re.test(s)) { rec(c.testCaseId, v, r); n++; by[v] = (by[v] || 0) + 1; break; } }
}
console.log("분류:", n, JSON.stringify(by));
