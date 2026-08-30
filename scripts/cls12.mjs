import { execSync } from "node:child_process";
const F = {
  "GBF-USR-000262-N01": "창 포커스 중 에이전트 이벤트 인앱 알림은 특정 이벤트/포커스 상태 필요 — 관측 제약.",
  "GBF-USR-000304-N01": "숨김 봇 0개일 때 빈 상태(No hidden bots)는 숨김 봇 없으면 진입 버튼 자체 미표시라 빈 다이얼로그 도달 불가.",
  "GBF-USR-000006-N01": "도구 호출 행 확장/접기 — 이 빌드 도구 결과 카드는 확장된 정적 렌더(접기 토글 미제공).",
  "GBF-USR-000522-N01": "메시지 텍스트 클립보드 복사 — 커스텀 More 메뉴에 Copy 미노출(에이전트 메시지), 텍스트 복사는 네이티브 컨텍스트 메뉴라 CDP 미구동.",
  "GBF-USR-000651-N01": "다른 봇 전환 후 전송 시 답장 auto-detach — 봇전환+답장타겟 조합 상태 필요.",
  "GBF-USR-000845-N01": "New 중복클릭 clientNonce 병합은 백엔드 dedup — UI로 nonce 중복 유발/관측 불가.",
  "GBF-USR-000762-N01": "설정된 트리거 행 사람이-읽을 문장은 외부 서비스 트리거 구성 필요(cf 자동화트리거 UNAVAIL).",
  "GBF-USR-000763-N01": "커넥터 목록 카드는 커넥터(외부 OAuth) 연결 상태 필요 — 로컬 미연결.",
  "GBF-USR-000510-N01": "접근 차단 액세스 커버 오버레이는 killswitch/access-blocked 상태 필요.",
  "GBF-USR-000745-N01": "오프라인 큐 flush는 렌더러-host IPC 기반이라 CDP offline로 유발 불가(부분상태는 019 관측).",
  "GBF-USR-000594-N01": "전송 실패 시 초안 복구는 IPC 송신 실패 상태 필요 — 유발 불가.",
  "GBF-USR-000671-N01": "자동화 실패 트레이 알림은 자동화 실행 실패 상태 필요 — 유발 불가.",
};
for (const [id, r] of Object.entries(F)) execSync(`node scripts/urec.mjs UNAVAIL ${JSON.stringify(r)} ${id}`, { stdio: "ignore" });
console.log("최종 12 UNAVAIL 분류 완료");
