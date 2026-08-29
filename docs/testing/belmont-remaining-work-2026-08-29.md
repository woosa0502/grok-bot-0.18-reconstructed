# Belmont — 남은 작업 (코드 대조 검증판, 2026-08-29)

기준: HEAD `f39d971`, 작업트리 clean, `npm run check` 97/97 (Node 26.5).
방법: 감사(`belmont-complete-pi-functional-audit-2026-08-28.md`)의 §4·§5 레지스트리 **전 항목을 현재 소스에 대조**(정적, 읽기 전용). 각 판정에 `file:line` 근거를 붙였다.
짝 문서: 위 감사(원장/통계), 이 문서(현재 상태).

---

## 0. 읽는 법 (정확성 원칙)

- 이 목록은 **완전한 결함 목록이 아니다.** 감사 원장 1,292건 중 durable 관측 90건 / 미관측 1,202건 (감사 §6, `...audit-2026-08-28.md:356`). 미관측 = "실행 안 해봄"이지 실패가 아니다 → 완전성 단정 불가.
- 판정은 정적 코드 대조 결과다. **RESOLVED = 코드상 구현·배선 확인**, PARTIAL/OPEN = 미구현 또는 미검증. `NEEDS-LIVE-VERIFY` = 코드는 있으나 런타임 확인 안 함.
- "검증됨(verified)" 판정은 대부분 **테스트/코드 유무** 기준이지 런타임 통과가 아니다.
- 아래 §0.5는 실행 중 인스턴스로 **실제 돌려 확인한 것**(라이브)이다.

## 0.5 라이브 검증 (2026-08-29, 실행 인스턴스 + 에이전트)

| 검증 | 결과 | 판정 |
|---|---|---|
| **Shell cwd 미유지** | `cd /tmp` 후 **별도** Shell 호출의 `pwd` = box-workspace (/tmp 아님) | ✅ 확인 (SHELL-001 실증) |
| **grep context 버림** | `-B2 -A2` 요청 → 매치 라인만 반환, before/after 라인 안 나옴 | ✅ 확인 (FILES-001 실증) |
| **video subagent 불일치** | Task `subagent_type:videoReview` → `Error: Invalid value. Expected one of: executor` | ✅ 확인 (프롬프트는 쓰라는데 미등록 → 실패) |
| **로컬 stdio MCP** | belmont-test 서버 툴 호출 → `MCP_ECHO hi` 반환 | ✅ 작동 (PLUGIN 로컬부 실증) |
| **PDF Read (교정)** | 바이너리 PDF Read → **raw 바이트 그대로 반환**(`%PDF`+garbage), worker 에러 아님·텍스트 추출 안 됨 | 🔧 정적 판정 교정 (아래 §9) |
| **interrupt** | 긴 턴 중 UI stop 컨트롤을 CDP로 못 찾음(라벨 없는 아이콘) | ➖ 정적 확인(signal 배선)만, 라이브 UI-stop harness 미타겟 |

---

## 1. Pi 전환 blocker (감사 §4) — 전부 RESOLVED

| 항목 | 판정 | 근거 |
|---|---|---|
| PI-P0-01 packaged runtime | ✅ (배포 closure는 개인 dev N/A) | `pi-codex-runtime.ts:67` `await import("@earendil-works/pi-coding-agent")`; provider-session.ts:41 literal import |
| PI-P0-03 executor state | ✅ | `provider-session.ts:320` `getState … return [...this.#messages]` (배열) |
| PI-P0-04 content/event 스키마 | ✅ | `pi-codex-projection.ts:357` text_delta/thinking_delta·`:359` toolcall_end·`:274` reasoning `{text,signature}` |
| PI-P1-02 모델 소유권 | ✅ | `host-runner-composition.ts:189`=`gpt-5.5` = `pi-codex-runtime.ts:48` |
| PI-P1-05 system instruction | ✅ | `pi-codex-projection.ts:248` role:"system" → Pi systemPrompt 채널 |

→ 감사의 **`PI-001 REJECTED_AS_IS`는 더 이상 성립하지 않는다.**

## 2. P0 제품 흐름 (감사 §5.1)

| 항목 | 판정 | 근거 / 비고 |
|---|---|---|
| INTERRUPT-001 | ✅ (UI→턴 클릭은 라이브 미확인) | `pi-codex-runtime.ts:150` signal→streamSimple; provider-session.ts:338 |
| ATTACH-INFERENCE-001 | ✅ 이미지+reasoning (일반 file 파트는 drop) | `pi-codex-projection.ts:112` image 처리 |
| AUTH-001 | ⚠️ PARTIAL | Cursor 경로는 실제 credential 기반(`cursor-auth.ts:242`); 고정 logged-in은 `SAND_LOCAL_CODEX_MODE`에서만(`local-codex-mode.ts:7`), 그땐 실인증=Pi OAuth |
| MODEL-001 | ⚠️ PARTIAL | per-agent 저장·검증 있음(`sand-settings-store.ts:68,131`); **렌더러 모델 selector 소스 없음**(렌더러는 prebuilt 번들) |
| PROFILE-001 | ❌ OPEN | 기본 provider 여전히 `cursor`(`sand-settings-store.ts:167`), fail-closed Codex allowlist 아님 |
| ACCEPTANCE-001 | ❌ OPEN | login→stream→tool→renderer→interrupt→restart 통합 E2E 없음 |

## 3. 서브에이전트 (SUBAGENT-001) — 격리 갭 다수 OPEN

| 항목 | 판정 | 근거 |
|---|---|---|
| 부모 전용 툴 게이팅 | ✅ | `turn-toolset.ts:1494/1546/1668` `!host.isSubagentRunner` |
| Task modelId → child (타입별 모델) | ✅ | `host-runner-composition.ts:2681`, `turn-run-shell.ts:198` |
| child가 parent store/DB/MCP/blob 공유 | ❌ OPEN | `host-runner-composition.ts:2877` (transcript만 격리) |
| **child cancel이 parent를 interrupt** | ✅ CLOSED (`9dbb6e3`) | conversationId→runner 맵으로 턴 소유 runner를 타겟 |
| resume이 durable checkpoint 없음 | ❌ OPEN | `:2689` 매 dispatch 빈 state |
| **background settle이 runner 미dispose (누수)** | ✅ CLOSED (`9dbb6e3`) | settle 시 `runner.dispose()` 추가 |
| readonly 실집행 | ⚠️ PARTIAL | 프레임워크엔 있음(`readonly-resource-accessor.ts:191`), **shipped DEFAULT executor엔 미적용** |
| CloudAgent가 child에 남음 | ❌ OPEN | `turn-toolset.ts:1598` isSubagentRunner로 게이트 안 함 |

## 4. Hooks (HOOK-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| reasoning event → afterAgentThought | ✅ | `provider-session.ts:137`·`pi-codex-projection.ts:358`·handler:1841 |
| central gate 커버리지 | ⚠️ PARTIAL (좁음) | pre/postToolUse가 사실상 **WebSearch에만**(`web-search.ts:289`, 조립 `:2246`); Shell/stdin/MCP/WebFetch 미포함 |
| subagentStart deny/ask + Stop follow-up | ⚠️ PARTIAL | 프레임워크는 소비(`task-subagent-completion.ts:96`), client-side는 fire-and-forget(`:2712`); "ask" 미구현(`remote-hooks.ts:70`) |

## 5. MCP (MCP-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| stdio initialize/list/call | ✅ | `box-exec-daemon/mcp-stdio-client.ts:114` |
| AbortSignal + notifications/cancelled | 🔶 코딩됨, **라이브 cancel E2E만 남음** | `mcp-stdio-client.ts:224` `notifications/cancelled` |
| config cwd | ⚠️ PARTIAL (경로 의존) | box·account JSON은 보존, **box-push projection이 strip**(`mcp-display-runtime.ts:2` cwd 없음, `tools-discovery.ts:162`) |
| pagination / list_changed / server req·notif | ❌ OPEN | `mcp-stdio-client.ts:123` once, `:196` server-initiated 무시 |
| blob/audio fidelity | ⚠️ PARTIAL (손실) | image만 보존, 나머지 text로 축약(`mcp-stdio-client.ts:145`) |
| isError 텔레메트리 | ✅ | `mcp-result-factory.ts:35` |
| subagent MCP projection 신원 | ❌ OPEN | `host-runner-composition.ts:2361` `isSubagentRunner:false` 하드코딩 + 부모 신원 |

## 6. File tools (FILES-001)

> 주의: 실제 실행자는 in-box daemon `box-exec-daemon/server.ts`. 별도 파서 `packages/local-exec/grep-output.ts`는 **importer 0 (dead code)**.

| 항목 | 판정 | 근거 |
|---|---|---|
| grep 종료코드·stderr·abort·전체카운트·잘림 | ✅ | `server.ts:995/992/1023/1030` |
| **grep ripgrep context 이벤트** | ✅ CLOSED (`9dbb6e3`) | context 이벤트를 매치와 함께 emit(`isContextLine`), count는 context 제외. 라이브 검증 |
| 제한 후 파일별 count 의미 | ⚠️ PARTIAL | `server.ts` retained slice만 반영, 파일별 잘림 표시 없음 |
| list_dir budget/오류 표시 | ⚠️ PARTIAL | `server.ts:890` `childrenWereProcessed=false`로 표시하나 오류 사유 삼킴 |
| symlink 경계 (glob/grep/shell) | ⚠️ PARTIAL | grep/glob/shell은 lexical `resolvePath`만(`:956`), realpath 검사 건너뜀 (ls/read/write는 함) |
| protected-path fail-open | ✅ (literal은 항상 강제) | `protected-path-guard.ts:11` (symlink 부분만 skip) |
| **write atomic** | ✅ CLOSED (`9dbb6e3`) | temp 파일 write 후 rename(원자), 실패 시 temp 정리 |

## 7. Background Shell (SHELL-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| handoff/terminal record/status/Await | ✅ | `server.ts:1137` |
| handoff 전 early output 보존 | ✅ | `server.ts:1154` buffered flush |
| **hardTimeout (handoff 후)** | ⚠️ PARTIAL (경로 의존) | local은 강제(`shell-stream.ts:32`), **box daemon은 미강제**(`server.ts:1117`) → in-box background 무한 |
| **cwd/env/session 유지** | ❌ 매 호출 새 shell | `server.ts:1234` `spawn("/bin/sh",["-lc",cmd])` per-call, `cd`/export 안 이어짐 |

## 8. Transcript / compact / resume (TRANSCRIPT-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| ownership-first routing | ✅ | `transcript-mirror-router.ts:80` (enable gate보다 먼저) |
| compact 후 model/session metadata 유지 | ✅ | `pi-codex-projection.ts:411`, test `pi-codex-projection.test.mjs:112` |
| WAL/crash/restart 복구 테스트 | ❌ OPEN | router 테스트는 stub 포트(`gb-core-001-...:156`), 실제 torn-write/crash 커버리지 없음 |
| **Codex 매턴 전체 transcript 재전송** | ❌ OPEN (native continuity 없음) | `pi-codex-runtime.ts:149` 전체 재투영, `previous_response_id` 미사용 |

## 9. Attachment / media (MEDIA-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| native-byte staging | ✅ | `electron-main/attachments/attachments.ts:95` |
| 이미지 입력 처리 | ✅ | `pi-codex-projection.ts:112` |
| **성공 후 staging 파일 삭제** | ✅ CLOSED (`9dbb6e3`) | host-side startup sweep(`sweepStagedAttachments`, 1h 초과 정리) — 렌더러 pinned라 host 측에서 처리 |
| **PDF Read** | ✅ CLOSED (`9dbb6e3`) | 박스 read가 PDF 감지 → raw 바이트 대신 명확한 에러. (텍스트 추출 자체는 여전히 미구현 — 별도 feature) |
| **video subagent 불일치** | ✅ CLOSED (`9dbb6e3`) | 프롬프트가 "video 서브에이전트 없음"으로 정직화 → 거짓 위임 지시 제거. 라이브: 에이전트 거절 |

## 10. Skill / Routine (SKILL/ROUTINE-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| 로컬 SKILL.md 스토어 + 프롬프트 배선 | ✅ | `workflow-library.ts:5`, `system-prompt-assembly.ts:221` |
| CRUD·persist·run-ledger·재시작유지 | ✅ | `automation-store.ts:70,80`, runs.json |
| **cron 자동 발동** | ❌ 클라우드 백엔드 의존 | `sand-automation-cloud-sync.ts:370` `shouldScheduleLocally=false`(cron), `getBackendUrl` 폴링 → **Codex 모드 로컬 자동발동 안 됨** |
| 전체 lifecycle E2E (자동발동→저장→재시작→삭제) | ❌ OPEN | tests에 lifecycle 테스트 없음 |
| managed/plugin skill fetch/publish/sync | ✅ Cursor 백엔드 | `skill-publish.ts:58` DashboardService |

## 11. Chat-state (CHAT-STATE-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| reaction source + toggle | ✅ | `inference-router.ts:110`, `ProductionRenderer.tsx:1151` |
| 패키지드 렌더러 click→persist→restart E2E | ❌ OPEN | 정적/SSR 문자열 검사만(`publication-packaging.test.mjs:129`) |

## 12. Plugin (PLUGIN-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| 로컬 stdio MCP (mcp.json + CallMcpTool) | ⚠️ PARTIAL | `mcp-service.ts:188` mcp.json 읽음, CallMcpTool OK; **`AddMcpServer`는 원격 HTTP/SSE + Cursor 계정 전용**(`sand-mcp-management-tools.ts:343`) → 로컬 stdio는 mcp.json 직접만 |
| getCatalog 주입 가능 + install=account writer | ✅ (그래서 마켓 install은 Cursor 계정 필요) | `mcp-catalog-flow.ts:38` fetchMarketplace 주입; `mcp-manager.ts:322` requireAccountWriter throws |
| 전체 plugin lifecycle | ⚠️ PARTIAL | 툴은 다 존재, stdio round-trip만 테스트, search→install→auth→delete 미검증 |

## 13. Web (WEB-001) — 이번 세션 RESOLVED

| 항목 | 판정 | 근거 |
|---|---|---|
| 로컬 WebSearch(DDG) + WebFetch | ✅ (unit test) | `codex-web-tools.ts:162/99`, `codex-web-tools.test.mjs` |
| production.ts Codex 분기 | ✅ | `production.ts:12/39/50` isLocalCodexMode |
| 라이브 happy path | ✅ | transcript `1452673d-...:79` (WebFetch), 세션 라이브(WebSearch→anthropic) |

## 14. Auto-review (AUTOREVIEW-001)

| 항목 | 판정 | 근거 |
|---|---|---|
| 로컬 모드 강제 off (workaround) | ✅ (프로필 capability 아님) | `auto-review/extension.ts:52` |

## 15. 개인용이라 제외 (클라우드/배포)

배포 패키징(PI-P0-01 closure/PACKAGE-001), Windows installer, Cursor marketplace 검색·설치·publish·sync, CloudAgent, Computer/Browser Use, mobile push, cron 클라우드 자동발동. — 개인 WSL Codex 사용과 무관(단 cron 자동발동은 "제외"가 아니라 로컬 대체가 필요할 수 있는 항목).

---

## 16. 결론 (교정) + 우선순위

정적 대조 결과: **Pi blocker 5개·주요 배선(툴게이팅·Task모델·reasoning경로·transcript routing·compact metadata·이미지)은 RESOLVED**. 그러나 감사의 여러 경계 갭은 **여전히 OPEN**이며, 원장 1,202건은 미관측이라 "전체 결함 목록"이라 단정할 수 없다.

### 확정 결함 (버그성) — 전부 CLOSED (2026-08-29, 커밋 `9dbb6e3`)
1. ✅ **PDF Read** — 박스 read가 PDF magic/확장자 감지 → garbage 대신 **명확한 actionable 에러**. (라이브 검증)
2. ✅ **video subagent 불일치** — 프롬프트 정직화(없는 위임 지시 제거). (라이브: 에이전트가 거절, videoReview 시도 안 함)
3. ✅ **grep context 라인 버림** — `context` 이벤트를 매치와 함께 emit(`isContextLine`). (라이브: `-B2 -A2` before/after 나옴)
4. ✅ **write 비원자적** — temp 파일 write 후 rename(원자). (코드/tsc)
5. ✅ **child cancel이 parent interrupt** — conversationId→runner 맵으로 올바른 runner 타겟. (코드/tsc)
6. ✅ **background subagent runner 누수** — settle 시 `runner.dispose()`. (코드/tsc)
7. ✅ **staging 파일 누수** — host-side startup sweep(`sweepStagedAttachments`, 1h 초과 정리). (유닛 테스트)

> 렌더러가 pinned 번들이라 staging 수정은 소스(ProductionRenderer) 대신 host-side sweep으로 처리. PDF도 `read.ts:374`가 아니라 실제 실행되는 박스 read에서 수정.

### 부분/미검증 (동작하나 경계·검증 부족)
- MCP: cancel 라이브 E2E, cwd projection strip, pagination/list_changed/server-req, blob fidelity.
- Shell: box handoff 후 hardTimeout 미강제, cwd/env 미유지.
- Skill: cron 자동발동 클라우드 의존, lifecycle E2E 없음.
- Subagent: 상태 공유·resume checkpoint·readonly 실집행(shipped executor).
- Hooks: gate가 WebSearch에만.
- Transcript: WAL/crash 복구 미검증, native continuity 없음.
- Interrupt/이미지: 코드 있음, 라이브 미확인.

### 대량 미검증
원장 1,202건 미관측 — 결함 아님, 검증 공백. 완전성 판단엔 재실행 선행 필요.

> 정확한 마지막 문장: **"개인 Codex 사용 기준 확정 결함은 위 §16 목록이고, 다수 경계 항목은 부분 구현/미검증이며, 원장 1,202건 미관측 때문에 전체 결함 목록이라 단정할 수 없다."**
