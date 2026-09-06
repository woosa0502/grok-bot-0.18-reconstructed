# 폰 앱(그록 모바일 복원판) 화면 → 실제 기능 연결 — 2026-09-05

원본 APK에서 화면만 복원돼 있던 항목을 전부 벨몬트(호스트)에 연결했다. 쓸지 말지는 사용자가 정한다.

| 화면 | 전 | 후 | 경로 |
|---|---|---|---|
| Bot 프로필 → 템플릿 | 예시 하나, 이름만 받아 빈 봇 생성 | 현재 봇을 템플릿(페르소나·켜진 스킬 본문·루틴)으로 내보내기: JSON 복사, 공유, 이 템플릿으로 새 Bot | `GET /api/bots/:id/template` |
| 템플릿 가져오기 | 없음 | x.ai 마켓플레이스 주소·공유 링크·내보낸 JSON → 봇 생성. 스킬은 전역 서재에 넣고 그 봇에만 켬(다른 봇은 끔), 루틴은 꺼진 채 생성 | `POST /api/templates/import` → createAgent, importAgentWorkflowText, setAgentWorkflowEnabled, createAgentAutomation |
| 채팅 메뉴 → 추가 정보 폼 | 폰에만 저장 | 입력값을 그 봇에게 메시지로 전달 (`[추가 정보] …`) | `POST /api/bots/:id/form` → sendPrompt |
| 설정 → 자동 완성 | 폰에만 저장 | 폰 + 관리자 봇 기억(프로필)에 저장·삭제 | `POST/DELETE /api/bots/:id/memories` → addAgentMemory(신설)/deleteAgentMemory |
| Bot 프로필 → 모델 (신설) | 없음 | 봇별 모델·노력·Max 모드. 다음 턴부터 적용 | `GET/POST /api/bots/:id/model` → get/setAgentModelSelection(신설) |
| 설정 → 기본 모델 | 폰에만 저장 | 호스트 기본 모델(agentDefaultModel) | `POST /api/settings {key:"agentDefaultModel"}` |
| 설정 → 시간대 | 폰에만 저장 | 호스트 userTimeZone(+override). 목록은 Intl 전체 | `POST /api/settings {key:"userTimeZone"}` |
| 설정 → 언어 | 폰에만 저장 | 호스트 userLanguage(신설) → 모든 봇 프롬프트에 "답변 언어" 한 줄 | `POST /api/settings {key:"userLanguage"}` |
| 피드백 / 앱 평가 / 메시지 신고 | 폰에만 저장 | 호스트 기록 `sand-data/mobile-feedback.jsonl` (원본은 xAI 서버로 보냄) | `POST /api/feedback` |
| 플랜 / 등급 없음 화면 | "미지원" 문구 | Codex 플랜·한도 표시, 사용량으로 연결 | 기존 `/api/codex/usage` |

그대로 둔 것(원본도 기기 설정): 화면 표시(테마·밀도), 햅틱, 알림 권한.

호스트에 추가한 것: 게이트웨이 `addAgentMemory`, `getAgentModelSelection`, `setAgentModelSelection`; 설정 `userLanguage`(getHostSettings/setHostSettings, `source/shared/user-language.ts`의 프롬프트 한 줄); `getHostSettings`에 `agentModelsByAgentId`.

검증: 호스트 테스트 346, 폰 서버 테스트 81 통과. 실제 폰 API로 설정·템플릿 내보내기·Clerk 모델 조회·기억 추가/삭제·피드백 기록 확인.

## 같이 잡은 버그

- 기억 삭제가 한 번도 동작한 적이 없었다: 관리자는 `remove({ agentId, memoryId })`를 보내고 기억 서비스는 `{ agentId, id }`를 읽어 항상 false였다(데스크톱 기억 화면의 삭제도 같은 경로). 두 키를 다 받게 고치고 게이트웨이로 추가→삭제를 확인했다.
- 호스트 재시작 절차: `tmux kill-server` 직후 `new-session`을 하면 새 세션이 죽는다(21:45). 실행기가 끝나면 세션은 이미 사라지므로 kill-server를 빼야 한다.
