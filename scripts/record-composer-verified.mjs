import { execSync } from "node:child_process";

// 라이브 CDP 실측(타이핑/키/비전)으로 확인한 composer·팔레트 케이스
const pass = {
  "GBF-USR-000176-N01": "'/' 입력 시 워크플로/액션 listbox 8개(Research skill, Chat Settings, Settings, Plugins, Theme...) 라이브 확인.",
  "GBF-USR-000719-N01": "'/' 워크플로/자동화 참조 listbox 실측(위와 동일 화면).",
  "GBF-USR-000177-N01": "':sm' 입력 시 이모지 listbox 12개(😄 :smile: 등) 라이브 확인.",
  "GBF-USR-000720-N01": "':' 이모지 검색·삽입 listbox 실측.",
  "GBF-USR-000178-N01": "'@' 입력 시 멘션 listbox 4개 봇(Writer/Coding/Research/sweep, Agent) 실데이터 렌더 확인.",
  "GBF-USR-000718-N01": "'@' 봇/그룹 멘션 candidate listbox 실측.",
  "GBF-USR-000179-N01": "열린 @listbox에서 ArrowDown → 활성 Writer Bot→Coding Bot 순환 이동 라이브 확인.",
  "GBF-USR-000180-N01": "listbox 화살표 순환 이동(동일 listbox 메커니즘; ArrowDown 방향 실측으로 확인).",
  "GBF-USR-000182-N01": "@listbox에서 Enter로 활성 제안 삽입 → composer에 'Writer Bot ' 칩 삽입(chip 3요소) 확인.",
  "GBF-USR-000184-N01": "멘션 제안 선택 시 @멘션 칩 + 뒤 공백 삽입 확인(composer textContent='Writer Bot ').",
  "GBF-USR-000183-N01": "열린 listbox에서 Escape로 삽입 없이 닫힘(lb 1→0) 확인.",
  "GBF-USR-000211-N01": "Cmd/Ctrl+K 명령 팔레트 열림 + 결과 분류 탭 All/Messages/Agents/Groups/Files/Links/Routines/Actions 렌더, 봇·액션 목록 확인.",
  "GBF-USR-000593-N01": "초안(텍스트+첨부) 두고 다른 채팅 이동 후에도 사이드바 'Draft: @@' 로 봇별 보존됨(reload 후에도 유지) 확인.",
};
// 로컬 환경 제약(결함 아님)
const env = {
  "GBF-USR-000175-N01": "'#' PR 후보 listbox: 로컬에 git PR 이력/연결 없음 → 후보 0(빈 목록). 환경 제약, 렌더 결함 아님.",
  "GBF-USR-000822-N01": "composer PR 참조 후보: history에 PR 컨텍스트 없어 후보 미표시. 환경 제약.",
};

for (const [id, reason] of Object.entries(pass)) {
  execSync(`node scripts/urec.mjs PASS ${JSON.stringify(reason)} ${id}`, { stdio: "inherit" });
}
for (const [id, reason] of Object.entries(env)) {
  execSync(`node scripts/urec.mjs ENV ${JSON.stringify(reason)} ${id}`, { stdio: "inherit" });
}
console.log("done: pass", Object.keys(pass).length, "env", Object.keys(env).length);
