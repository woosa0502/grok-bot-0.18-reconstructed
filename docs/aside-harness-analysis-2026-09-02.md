# Aside 하네스 정적 분석 (2026-09-02)

대상: `Aside-1.0.825.1.dmg` (macOS, Chromium 151 기반 자체 브라우저). 실행하지 않고 DMG의 UDIF 블록표를 풀어
디스크를 복원한 뒤, 데몬(`at.studio.AsideBrowser.daemon`, Node SEA에 내장된 `apps/daemon/build/sea/index.mjs`,
약 11.6 MB)에서 프롬프트·도구 정의·상수를 읽었다. 원본 코드·프롬프트 전문은 저장소에 넣지 않는다(학습용 요약만).

## 1. 한 줄 요약

Aside의 에이전트는 "도구 하나에 클릭 하나"가 아니라 **REPL 도구 안에서 Playwright 코드를 직접 써서 여러 동작을
한 번에 실행**하고, 페이지는 **접근성 트리 스냅샷의 변경분(diff)** 으로 읽는다. 승인은 결제·메시지 발송 같은
소수 행위와 "권한 범위 밖 파일/명령"에만 걸리고, 그 외에는 끝까지 자율 실행한다.

## 2. 구조

| 계층 | 내용 |
|---|---|
| 브라우저 | Chromium fork. 페이지 안에 주입되는 `aria-snapshot` 생성기(`generate-accessibility-tree.ts`)가 ARIA 트리를 만든다 |
| 데몬 | Node. tRPC 라우터 25개(sessions, memory, routines, inbox, mcp, models …). 모델 호출은 pi-ai 계열 코드(OpenAI Responses, `prompt_cache_key`, `reasoning.encrypted_content`) |
| 모델 | 사용자의 키/구독(GPT, Claude, Gemini, Kimi …). 모델별 `thinkingLevelMap`으로 off/minimal/low/medium/high/xhigh/max 매핑 |
| 클라우드 | 로그인·과금·`/search`(웹검색)·패스키 디렉터리만. 페이지 조작·모델 호출은 로컬 |

## 3. 도구 목록 (모델에게 노출)

`repl`(핵심), `websearch`, `webfetch`, `write_todos`, `subagent`, `subagent_wait`, `ask_user_question`,
`memory_search`, `browsing_history_search`, `notification`, `routine_update`, `bash`, `read_file`,
`write_file`, `edit_file`, `get_time`, 액션 확인 요청 도구.

브라우저 전용 도구(click/type/navigate …)는 **없다**. 전부 `repl` 안의 Playwright API로 한다.

## 4. REPL 하네스

- 지속 샌드박스 JS 컨텍스트, 120초 제한, import/require 금지, 변수는 호출 간 유지.
- 전역: `page`, `tabs`, `openTab/closeTab`, `attachBrowserTab`, `snapshot(page, opts) → {tree, diff}`,
  `annotatedScreenshot(page)`(ref 라벨이 찍힌 PNG), `page.screenshot`, `locator.screenshot`, `page.pdf`, `display(image)`.
- 출력 상한 16 KB(`REPL_CONTEXT_OUTPUT_MAX_BYTES`), 이미지 1장 ≈ 4,800자로 계산.
- 프롬프트 규칙: "다음 단계가 새 페이지 상태에 의존하지 않으면 **동작과 스냅샷을 한 도구 호출에 묶어라**",
  "동작 후에는 `tree`가 아니라 **`diff`를 출력**하라", "스냅샷 없이 ref를 추측하지 마라", "이미 대기가 내장돼 있으니 `sleep()` 남발 금지",
  "스크롤 불필요(트리에 화면 밖 요소 포함)".

## 5. 스냅샷 형식

- Playwright식 ARIA 트리: `- role "name" [ref=e12] [level=2] [placeholder=…] [size=WxH]`, 제목·URL 헤더(URL 128자 절단), iframe은 `f1e1` 접두.
- 기본은 `interactive: true`(클릭·포커스 가능한 요소만). 필요 시 전체 트리 → 잠깐 대기 후 재촬영 → 주석 스크린샷 순으로 **읽기 확대**.
- 비밀번호 필드 값은 `[redacted]`. shadow DOM, aria-owns, 스크롤 가능 여부, 커서 포인터 신호까지 반영.
- `diff`는 줄 단위 unified diff(`@@ -a,b +c,d @@`). diff가 트리보다 길면 트리를 돌려준다.
- 매 스냅샷마다 ref가 새로 매겨진다(이전 ref 무효).

## 6. 문맥·토큰 관리

- 컴팩션 기본값: `reserveTokens` 16,384, `keepRecentTokens` 20,000(gpt-5.6 계열은 27,200). 문맥이 창 크기 − reserve를 넘으면
  요약 프롬프트("You are a context summarization assistant…")로 구조화 요약 후 최근 2만 토큰만 유지.
- 프롬프트에 "문맥이 다 차면 도구가 자동 압축한다. 요약이 보이면 그대로 이어서 하라"고 명시.
- 스크린샷은 옵션(`takeScreenshotOnEverySnapshot`, 기본 꺼짐). 기본은 텍스트 트리만.

## 7. 승인·권한

- 세션 `permissionMode`: `ask` / `full-access` / `read-only`. 파일 읽기·쓰기 루트, bash 홈 격리(`full-access`면 실제 홈).
- 권한 밖 사용 시 `approval` 중단 카드(`allow/deny` + `always` 기억). 결제·전송류는 모델이 `action-confirmation` 도구로
  스크린샷·미리보기 첨부해 `confirm/cancel`을 받는다. 질문은 `ask_user_question`.
- 중단(suspension)은 세션 상태로 저장되고 사용자가 답할 때까지 유지된다. **시간 만료로 실패시키는 경로는 확인되지 않았다.**
- 런타임 플래그: `proactiveMode`, `finalConfirm`(최종 확인), `memoryExtractionDisabled`.

## 8. 장시간 작업

- `routine_update`: cron(새 세션) / heartbeat(현재 세션을 깨움) / event(인박스·웹푸시 이벤트로 발동). "답장 기다렸다가 이어서"가 이 경로.
- `subagent`(spawn/resume) + `subagent_wait`, 프롬프트에 "context_explorer 서브에이전트를 병렬로 띄워 맥락 수집" 지시.
- 진행 보고는 "약 30초마다 짧게", 완료 시 스크린샷 증거 첨부.

## 9. 메모리

- 계정 루트에 `AGENTS.md`, `SOUL.md`, `memory/MEMORY.md`(L1 운영 요약), `memory/USER.md`, `memory/TAXONOMY.md`, `memory/episodic/`(append-only),
  의미 메모리 페이지(frontmatter + Current + History). "Dreaming"이 세션 후 의미·에피소드 메모리에서 L1을 다시 쓴다(모델 호출, 사용량 기록).
- 브라우징 히스토리 검색이 도구로 노출된다(`browsing_history_search`).

## 10. Belmont와의 차이와 채택 후보

| 항목 | Aside | Belmont(현재) | 채택 |
|---|---|---|---|
| 동작 단위 | REPL 한 호출에 여러 Playwright 동작 | 도구 호출 1개 = 동작 1개, 매번 스냅샷 | REPL형 브라우저 도구 도입 |
| 페이지 읽기 | interactive 트리 + diff | 전체 스냅샷 반복 | diff 스냅샷 |
| 승인 | 결제·전송·권한 밖만, 만료 없음 | 클릭마다 분류기 + 카드, 15분 만료 | 모드(ask/full-access) + 만료 제거 |
| 문맥 | reserve/keepRecent 자동 압축, 스크린샷 기본 꺼짐 | 관측 누적, 스크린샷 동봉 | 압축 임계값·이미지 정책 |
| 대기 | heartbeat/event 루틴으로 세션 재개 | 유휴 10분에 브라우저 종료, 15분 자동 작업 끼어듦 | 유휴 종료 중지, 루틴 격리 |

분석 산출물(복원 디스크, 번들, 프롬프트 전문)은 세션 임시 폴더에만 두고 저장소에는 넣지 않는다.
