# Belmont — 다음 세션 인수인계

_작성: 2026-08-30 · 갱신: 2026-09-01 오후 (Phase A 전영역 스윕 회차 — A2~A13 + §6 disposition 마감)_

## 2026-09-01 오후 회차 (Phase A 전영역, Phase B 제외 지시)

커밋 5개: `c654c56`(A2) → `24135da`(A4/A7/A8/A10) → `44ab764`(A8/A10/A11/A12) → `4c73709`(A7/A9/A13/§6) → (마감 문서 커밋). 게이트 **287/287 + frontend:build green (현재 HEAD)**.

**발견·수정한 실결함 (전부 라이브 재현→수정→라이브 재검증)**:
1. **A2 warm-cache 점유량 과소집계** — Pi가 `usage.input`에서 캐시를 빼는데 `usedTokens=input+output`으로 재계산 → 캐시가 살아있는 한 선제 압축 문턱 도달 불가. `contextOccupancyTokens`(provider total_tokens)로 수정. 선제 압축 라이브 발화 실증(30k 핀, 요약 blob 실물·코드워드 보존·재시작 recall).
2. **A4 subagent 관리 도구 미노출** — 프롬프트가 광고하는 Check/Message/StopSubagent가 production provider에 미배선. 수정 후 동시 2자식·선택 취소·computerUse 배타성 라이브 통과.
3. **A8 lifecycle 훅 전체 무발화(P1)** — 엔진 accessor의 hookExecutorResource가 box 데몬(hooks.json 주인)에 안 닿음. 턴 local projection에 box행 주입 + 데몬 preCompact 응답 매핑. preCompact·afterAgentThought 마커 실발화. `ask`는 양 게이트 일관 차단+안내(라이브 확인). workspaceOpen=구조적 제외 확정.
4. **A10 손상 이미지 대화 영구 오염(P1)** — 투영이 과거 image part 재전송 → 이미지 하나가 대화 전체를 죽임(무첨부 턴 3연속 실사). 전송 시 강등 + 투영 시 PNG 청크 구조·CRC 걷기 검증(서명+꼬리만으론 부족 — 내부 깨진 PNG가 실제로 통과했음). 오염 대화 부활 라이브 확인. MCP image 결과 경유 오염 벡터도 동일 차단.
5. **A7 MCP crash 후 영구 사망** — callMcpTool 호출당 1회 자동 재기동. 라이브: crash→echo 즉시 복구, image 도구 PNG가 Pi vision까지 관통("파란색"), 300KB spill 파일 실증.
6. **A11 VNC URL 정직화** — websockify 실청취 확인 후에만 URL 공개(미설치/실패 시 미공개).
7. **A12 kinds 계약** — editable frontend 파서가 host의 배열 shape 수용.

**라이브 E2E 마감**: A5 기억(저장→새 에이전트 recall→의사결정 반영→tombstone→재시작 recall 전부 정답), A9 루틴(1분 발화→재시작 재발화→delete), A10 vision(이미지 텍스트/색 판독)·손상/59MB 오류 흐름, A13 kill 매트릭스(고아 0·중단 정직 종결·자식 중단 자동 통지·SIGTERM drain·상태 정합), A6-마켓플레이스 도구 정직화.

**§6**: `scripts/assign-unavail-dispositions.mjs` → `belmont-unavail-dispositions.jsonl`(UNAVAIL·ENV 전수, 미분류 0). 이후 실측으로 계속 소거해 **Gate A5 구체 잔여 = 4건**(645/646 permissions.json 격리 검증 — 주의: 실제 `~/.cursor`를 건드리지 말고 `CURSOR_CONFIG_DIR`로 격리 · 462 하드리밋+GC · 653 이전기록 로드 실패 상태) + env-explained 35 + fresh profile 절차(OAuth 만료/재로그인·attachment commit 창·VNC 뷰어 clipboard/zoom·MCP 설정 UX 수정/삭제·child MCP identity). 최종 원장: PASS 556 · FIXED 21 · ISSUE 0.

**추가 배선·실측 (같은 날 저녁)**: 채널 연결/해제 timeline 카드 발행부 배선(+실렌더 확인), 루틴 편집기 전체 lifecycle UI 실측(생성/수정/활성/비활성/삭제 알림 7종), hooks.json 오류 검증 fail-open, SetMcpInstructions 로컬 정상 재확인, 부팅 활성 에이전트 복원, 이전기록 스크롤 페이지 로드, outline/async 패널은 오프너 자체가 없음(정직 숨김 재분류), 후속 프롬프트 제안은 비용성 백그라운드 호출이라 기본 오프 정책 확정.

**주의**: probe 에이전트 다수 생성됨(CompactProbe 75370c77, PreCompactProbe 55549415, VisionProbe fc55efa1, MemProbe1~4 등) — 정리해도 무방. 픽스처 서버에 image/slow 도구 추가됨. hooks.json은 관리자 기본으로 복원 済. 앱 정지 시 `ps -eo pid,args | awk '$2 ~ /node$/ && $3=="scripts/run-wsl.mjs"'`로 정확히 조준할 것(pgrep -f는 감시 셸을 오폭).

---

_이하는 2026-08-31 (후속 5) 기준 기록._

전체 현황은 `docs/testing/belmont-full-test-report.md`(단일 SSOT, §1.6 후속 5가 이번 작업). 이번 회차의 재파악·판정표는 `docs/testing/belmont-018-parity-inventory-2026-08-31.md`. 판정 원장은 `docs/testing/belmont-sweep-verdicts.jsonl`(케이스별 최신 판정이 유효, `node scripts/verdict-ledger.mjs summary`), 감사 원장은 `docs/testing/belmont-audit-findings.jsonl`(id별 최신 행이 유효). 이 문서는 **다음 세션이 바로 이어받도록** 한 곳에 요약.

---

## TL;DR

- **현재 상태(2026-08-31, 후속 12 완료)**: 로컬 HEAD `7f04bd4`(후속 12 커밋 완료; origin 푸시는 사용자 지시 대기). 게이트 **208/208**. 감사 원장 45개 id — 수정 대기 실결함 0(잔여는 제외 지시·유보·경미 PARTIAL뿐). 앱은 최신 빌드로 실행 중이며 시작 시 Belmont(관리자, 8bebd5e2…)가 기본 대화. 새 프로필 복원은 `npm run belmont:manager` 한 번.
- **후속 13**: 추천 묶음 — 봇별 도구 제한(CreateAgent deny_tools, 라이브) · 크래시 창 dedupe · SAND_MANAGER_ONLY_CHAT 게이트(옵트인, 라이브) · 그룹 턴 durable(라이브) · W6/F5. 잔여 PARTIAL은 AUDIT-B2 하나.
- **후속 14**: memory dreaming 활성화(pin 로컬 우회 + summarization 채널 모델 대체 + 런처 게이트 기본 온) + **AUDIT-W21 발견·수정**(턴 종료 기억 기록 경로 전체 미배선 — 재구성 결함, CDP 로그포인트로 실측). 라이브: 프롬프트→45초 내 합성 기억 커밋→다음 턴 회상 정답. 게이트 216/216 — **주의: 테스트는 node 24+로**(셸 v22는 `using` 구문 가짜 실패), 앱은 mise 26.5.0.
- **후속 15**: 적대적 검토(독립 서브에이전트, d7e5b9b 대상) 10건 → 7건 수정·1건 부분·2건 수용(기각 0). P1 3건: pin 우회가 무관 게이트 3종(GC류)을 익명 캐시로 켬→`localGatePinValue` 명시 전용화 · applySynthesis 다중 제거 낡은 줄번호 오삭제+부분 적용→선검증+id 재해석 · Task 자식 settle이 부모 기억 오염→`!isSubagentRunner` 가드. 게이트 221/221, AUDIT-W23. cycle46 라이브 재확인.
- 회차 이력(전부 완료): 후속 4(0.18 parity 15건) → 5(후속·PARTIAL 12건) → 5.2(엄격 리뷰 검토) → 6(W12~W17+품질) → 7(벨몬트 관리자 B-1) → 8(Phase B 내구성) → 9~12(외부 검토 2~5차 전소화 — settle 순서·부트스트랩·유실 창·cloud-agent payload). 상세는 보고서 §1.6 후속 각 절.
- **후속 11**: 4차 검토 — **rearm 선삭제 유실 창 폐쇄**(payload 마커는 선삭제 없이 전달 후 정산 — 유실 창 0, 중복 창 2개 명시의 bounded at-least-once) · grep multiline -A 회귀 수정(끝줄 기준) · 문서 잔재 정리. 게이트 198/198.
- **후속 10**: 3차 외부 검토 6건 전부 사실 확인·수정 — 영속 실패 시 ack 경고+telemetry · at-least-once 의미론(두 크래시 창) 정밀 명시 · payload 마커 14일 보존(감시형만 48h) · grep 줄번호 귀속(grep-projection.ts 순수 함수 + rg 이벤트 동작 테스트) · 부트스트랩이 persona/스위퍼 드리프트 재조정 · 문서 정합(§2/§7). 게이트 196/196.
- **후속 9**: 2차 외부 검토 7건 전부 사실 확인·수정 — ①settle 순서 rev2(공유 가변 제거, 자식별 어댑터 고정) ②B-1 재현성(`npm run belmont:manager` + manager.json 자동 지정 — 새 프로필에서도 한 명령으로 복원) ③원장 실패 판정(getFailureInfo) ④reasoning 모델 상속 ⑤캐시 키=대화 id ⑥MCP 서명에 스키마 포함 ⑦pdfjs 데드라인. 게이트 191/191. tests/external-review-fixes.test.mjs(6).
- **후속 8**: Phase B 본공사 — durable 수신함(AUDIT-5 근본: pending-wake 'agent-message' kind, 크래시 라이브 검증) · 완료 내구(P1-04: 결과를 마커에 저장, rearm이 실제 결과 재생) · 자식 재파견 정보(A-3 lite) · B-2 부분(관리자 삭제 보호 + Managed team 절 — 라이브: 지시 없이 워커 자발 회신) · 품질(Grep 문맥 그룹·Delete 부분읽기·LS 절단 계약·SIGKILL 승격·셸 id 시드·MCP 서버요청 응답·**로컬 모델 피커=실제 Pi 카탈로그 7종**) · 테스트 부채 F1~F4 정리. 게이트 185/185. tests/phase-b-durability.test.mjs(8).
- **후속 7**: 벨몬트 관리자 B-1 — Belmont 봇 정의·SendToAgent 훅 배선·작업 원장·스위퍼 루틴·SAND_DEFAULT_AGENT_ID·CreateAgent reasoning(AUDIT-W1 수정)·W18 수정(+WSL 서브리퍼 대응)·**AUDIT-W19 발견·수정**(automation 완료 보고 언바운드 크래시). 라이브: 위임 왕복(b1h7, Belmont가 재검증까지)·재시작 생존(r91q, 스위퍼 복구). 게이트 175/175. tests/belmont-manager-b1.test.mjs(5).
- "다 실테스트까지 했니?" 후속: 남았던 3건도 라이브 완료 — 첨부 staging(생성 3.3초 뒤 삭제 감시+박스 판독), pagination(belmont-page 2페이지 앱 경유), AUDIT-4(Task 자식 dispatch 후 root slot 단일·부모 기억/이력 온전). 그 과정에서 **AUDIT-W12 발견(CONFIRMED, 수정 대기)**: list_changed가 데몬까지만 전파, 호스트 도구 캐시(24h TTL) 미무효화 → 동적 추가 도구는 refreshMcp 전까지 발견·호출 불가.
- 커밋: 사용자 요청 시에만. **`upstream` 푸시 금지, `origin`만.** 사용자 문서 `belmont-grokbot-parity-first-scope-2026-08-30.md`(untracked)는 커밋 제외 유지.
- 저장소 파일(문서 포함)을 바꾸면 다음 실행 전 재빌드 필요(stale 검사가 작업 트리 전체를 봄, 내용 해시 기준). ⚠️ 다른 체크아웃(예: `belmont-018-restore-*`)의 인스턴스가 동시에 떠 있으면 호스트가 기동 직후 exit(1)할 수 있음 — `ss -ltnp`로 확인.
- 텔레그램: 내장 Claude Code 플러그인 채널(@agc_sebas_bot) 점검 완료·발신 테스트 전송. Belmont 봇용 별도 커넥터는 미구현(사용자 결정 대기).

---

## ✅ 이번 회차(후속 5)에 한 것 (미커밋 — `git status` 참고)

| 항목 | 파일 |
|---|---|
| beforeMCPExecution·preToolUse(MCP) 게이트 + 241 문구 | `source/box-exec-daemon/server.ts` |
| MCP pagination/list_changed | `source/box-exec-daemon/mcp-stdio-client.ts`, `tests/fixtures/mcp-paginated-server.mjs` |
| Shell 별칭/옵션/함수 스냅샷(386) | `source/box-exec-daemon/shell-state.ts` |
| WebFetch 훅 | `source/packages/agent/tools/core/web-fetch.ts`, `host-runner-composition.ts`(hookOptions) |
| MCP 표면 auto-review(AUDIT-W11) · 241 오류 클래스 · 660 만료 알림 · AUDIT-4 settle 격리 | `source/host/host-runner-composition.ts` |
| 첨부 staging 정리 | `source/electron-main/attachments/attachments.ts` |
| OS 알림 fallback | `source/electron-main/notifications/{linux-notification-fallback(신규),os-notification-manager}.ts`, `production-binding-providers.ts` |
| 테스트(신규 2 + 갱신 1) | `tests/{mcp-stdio-extras,subagent-settle-parity}.test.mjs`(신규), `tests/box-shell-state.test.mjs` |
| 문서 | full-test 보고서 §0/§0.5/§1.6 후속 5/§2/§3/§4, parity 목록 §1/§4, 원장 2종, 이 문서 |

### 직전 회차(후속 4, 커밋 `c466160`)에 한 것

| 항목 | 파일 |
|---|---|
| 기억 회수(M1) | `source/host/host-runner-composition.ts`(프롬프트 컨텍스트 memory/roster provider), `source/host/extensions/memory/extension.ts`(`createPromptUserMemory/createPromptProjectMemory`) |
| roster/그룹/도구(R1-R3) | `host-runner-composition.ts`, `extensions/session/session-roster.ts`(group.json), `runner/tools/sand-agent-management-tools.ts`(ListAgents/ListGroups), `runner/tools/turn-toolset.ts`, `agents/agent-messaging.ts` |
| Shell 상태 유지(S1) | `source/box-exec-daemon/shell-state.ts`(신규), `server.ts`(shellStream만), `packages/agent/tools/core/shell/create-shell-tool.ts`(exit cwd) |
| PDF(P1) | `source/host/runner/local-pdf-text-extractor.ts`(신규), `host-runner-composition.ts`(Read 옵션), `box-exec-daemon/server.ts`(PDF → data) |
| epoch/컨텍스트 창(C1,C2) | `host-runner-composition.ts`, `source/host/extensions/inference/context-window.ts`(신규), `pi-codex-runtime.ts` |
| Pi 로그인(L1) + 준비 상태(A2) | `extensions/inference/pi-codex-login-session.ts`(신규), `extensions/inference/extension.ts`(api 5개 + isReady), `gateway-protocol.ts`, `host-gateway-api.ts`(트레이에 코드), `shared/rpc/coordinator-main.ts`, `electron-main/adapters/account-oauth.ts` |
| 로컬 cron 루틴(A1) | `extensions/automations/local-cron-scheduler.ts`(신규), `extension.ts`, `sand-automation-cloud-sync.ts`(`shouldScheduleCronLocally`) |
| 로컬 플러그인(PL1) | `shared/node/mcp/local-mcp-store.ts`(신규), `mcp-display-runtime.ts`(cwd), `mcp-manager.ts`(catalog 옵션), `electron-main/mcp/desktop-mcp-manager.ts`, `electron-main/adapters/mcp-oauth.ts`, `host/extensions/mcp/mcp-service.ts` |
| 숨김/게이트(G1,G2) | `electron-main/adapters/local-codex-mode.ts`, `host/extensions/experiments/extension.ts`, `host/runner/system-prompt.ts`, `system-prompt-assembly.ts`, `host-runner-composition.ts`(cloudAgent) |
| 테스트(신규 8 파일) | `tests/{box-shell-state,local-pdf-text-extractor,context-window,pi-codex-login,host-wiring-parity,memory-prompt-adapters,local-cron-scheduler,local-mcp-store}.test.mjs` |
| 문서 | `belmont-018-parity-inventory-2026-08-31.md`(신규), full-test 보고서 §0/§0.5/§1.6 후속 4/§2/§3, 원장 2종, 이 문서 |

---

## 동작 방식 (다음 사람이 알아야 할 것)

- **기억**: `update_state`가 쓰는 `<agentDir>/memory`(agent), `<sandRoot>/user-memory/agents/<id>`(user), `<sandRoot>/projects/<slug>/memory/agents/<id>`(project) 샤드를 프롬프트 조립이 읽음. 메모리 섹션은 compaction epoch별로 스냅샷 동결(`SAND_DISABLE_MEMORY_FREEZE=1`로 해제) — 같은 에이전트에서 방금 저장한 사실은 아직 스냅샷이 없을 때(사실이 0개였을 때) 다음 턴에 바로 보임, 그 뒤엔 압축 후 재렌더.
- **roster**: `listAgentsSync()` 캐시 기반(사이드바 로드 후 채워짐). 그룹은 `<agentDir>/group.json`.
- **Shell 상태**: 데몬 `terminalsDirectory/shell-state/{cwd,env.sh}`. 에이전트 Shell(스트리밍)만 읽고/쓴다. `working_directory`를 주면 그 디렉터리가 우선(스키마 "defaults to current directory"). 중단(SIGTERM) 시 초기화. 후속 5부터 별칭(`aliases.sh`)·셸 옵션(`options.sh`)·함수(`functions.sh`, bash 박스 한정 — 기본 /bin/sh=dash에선 함수만 미유지)도 스냅샷·복원.
- **PDF**: `pdftotext`(poppler, 호스트에 설치됨) → 없으면 `pdfjs-dist`. 빈 텍스트면 안내문. `SAND_PDFTOTEXT_PATH`로 바이너리 지정.
- **루틴**: 로컬 cron 스케줄러 30s tick, 앵커 `lastRunAt ?? createdAt`, 6h 초과 누락은 재앵커(로그 `[local-cron]`), 발화는 `runServerScheduledAutomation`(수동 실행과 같은 경로). 준비 상태 = `inference.isReady`(로컬: Pi 자격증명).
- **플러그인(로컬)**: `<sandRoot>/mcp.json`(stdio: command/args/env/cwd, url 항목 보존하나 로컬 실행은 stdio-only), `plugin-catalog.json`(`{"plugins":[…]}`, 없으면 기본 3종: Filesystem/Knowledge graph memory/Sequential thinking — npx로 실행), `plugin-installs.json`. 설치 = 카탈로그 fragment의 `${VAR}`를 폼 값으로 치환해 mcp.json에 병합. 서버 id = 이름 해시의 숫자열. Connect(인증)는 not-configured로 강등.
- **Pi 로그인**: 데스크톱 상태 = 호스트 `getProviderAuthStatus`(코디네이터 없으면 자격증명 파일). Sign in → 호스트 `startProviderLogin`(기기 코드) → 브라우저 열기 + 트레이 "Codex sign-in: Enter code …" → 폴링 `getProviderLoginStatus` → 완료 시 logged-in. `SAND_CODEX_LOGIN_METHOD=browser`로 브라우저 방식. Sign out은 자격증명 삭제(주의).
- **숨김**: 로컬 모드 프롬프트 = `SAND_SYSTEM_PROMPT_LOCAL_CODEX`(클라우드 에이전트·이미지 생성 없음 명시), CloudAgent 도구 미제공, 게이트 `LOCAL_CODEX_FEATURE_GATE_OVERRIDES`.
- 이전 회차 항목(분류기, 로컬 도구 권한, 훅, 첨부 스테이징, 빌드 계보 검사)은 full-test 보고서 §1.6 참조.

---

## 확인 필요 (UNCLEAR)

**없음.**

---

## (선택) 잔여 — parity 목록 문서 §4 참조

- EXCLUDED_HIDDEN(숨김 완료): Cursor 클라우드 에이전트, GenerateImage/AI 아바타, Teams/SSO/조직도/공유룸, Usage & Billing, iPhone/모바일 푸시, updater, Update/Reset Agent Computer, Teach by demonstration, 공개 공유 링크, 오디오/비디오 이해, Slack/GitHub 이벤트 루틴.
- 후속: ~~OS 알림 · MCP/WebFetch 훅 · MCP auto-review · 컨텍스트 창 실측 · Shell 별칭/옵션 · pagination/list_changed · 그룹 채팅 · 첨부 정리 · AUDIT-4 · PARTIAL 4건~~ → **후속 5에서 전부 완료.** 잔여(전부 유보/제외/경미): 이미지·비디오(사용자 제외) · 텔레그램 커넥터(D, 결정 대기) · 패키징 RELEASE-01/02(F, 배포 시) · 워커 UI 잠금·게시 게이트(AUDIT-B2 PARTIAL — 고정 렌더러 한계) · 자식 완전 재개(재파견으로 완화) · 봇별 도구 제한/MCP 집합 · Edit CAS(미적용 사유 명시) · 그룹 게시 durable · AUDIT-W6/F5(경미). ~~Phase B 본공사(AUDIT-5·P1-04·자식 재파견·B-2 부분)·품질 세부(P1-08/12)·테스트 부채(F1~F4)~~ → **후속 8에서 완료**(보고서 §1.6 후속 8; 테스트 185/185, tests/phase-b-durability.test.mjs).
- 내구성 의미론: agent 메시지/완료 통지는 **at-least-once**(pending-wake 마커 기반; 전사 중복은 displayed 플래그로 최소화 — 전사 추가↔기록·wake 완료↔정산의 두 크래시 창은 재전달/재실행 가능, 후속 10 명시). 크래시 라이브(후속 8 기록): kill -9 → 재시작 → 1회 재전달 관측.

**벨몬트 관리자(B-1, 후속 7) 운영 정보**: Belmont id `8bebd5e2-55a4-416d-80d7-343af595371f`(관리자 지침 persona) · 런처 env `SAND_DEFAULT_AGENT_ID`로 시작 시 기본 대화 · 원장 `box-workspace/.jobs/ledger.jsonl`(훅 .cursor/h-jobs.sh + hooks.json의 SendToAgent matcher) · 스위퍼 루틴 job-sweeper(@every 15m) · 워커: QA Bot(b2d1c233…), Clerk(97ab5a3d…, reasoning low). 위임 규약: [job:<id>] 태그 + 증거 요구 + 회신 의무. 라이브 검증: 왕복(b1h7)·재시작 생존(r91q) — 보고서 §1.6 후속 7.

---

## 환경 / 실행 방법

- **Node 26**: `export PATH="$HOME/.local/share/mise/installs/node/26.5.0/bin:$PATH"`.
- **빌드**: `node scripts/setup-wsl.mjs` (약 2분, **중단 금지**, 빌드 중 저장소 파일 수정 금지 — 소스 identity 검사에 걸림).
- **실행**: `SAND_LOCAL_COMPUTER_USE=1 BELMONT_WSL_DEBUG_PORT=9347 NODE_OPTIONS=--max-old-space-size=8192 node scripts/run-wsl.mjs`
- **정지**: run-wsl node 프로세스에 SIGTERM(자식 정리됨). `kill -9` 전엔 `prlimit --pid <p> --core=0`. Xvfb :99는 살려두면 재사용.
- **CDP**: 9347 고정. `scripts/ax-ui.mjs`. 승인 카드 AX: `region "Auto-review approval"` / `"Local tool permission"`. Plugins 화면: Ctrl+K → "Plugins" → 탭 Marketplace/Yours, 항목 버튼 `Open <name>`, 상세의 **Add**가 설치.
- **게이트웨이 API**: `sand-data/gateway.json`의 port·token → `POST /api/{…, getProviderAuthStatus, startProviderLogin, getProviderLoginStatus, cancelProviderLogin, providerLogout, createAgentAutomation({id, spec:{name,prompt,trigger:{type:"cron",schedule},isEnabled}}), getAgentAutomations({id}), deleteAgentAutomation({id, automationId})}` (`authorization: Bearer <token>`).
- **테스트**: `npm run check` (= frontend typecheck + source:typecheck + `npm test` 155).
- **케이스/판정 데이터**: `docs/testing/belmont-wsl-test-queue.jsonl`(1292), `belmont-sweep-verdicts.jsonl`, `belmont-audit-findings.jsonl`.
- **테스트 픽스처(저장소 밖, `sand-data/`)**: `mcp.json`(belmont-test + 이번에 UI로 설치한 `sequential-thinking`), `plugin-installs.json`(900003), `box-workspace/parity-test.pdf`, `box-workspace/parity-sub/`, `box-workspace/.cursor/{mcp-test-server.mjs, h-*.sh, hooks.json(비어 있음)}`, 에이전트 ParityProbe(`5dbad30c…`)·HooksProbe(`8df23a70…`)의 user 메모리 샤드에 테스트 사실("teal-7731").

---

## 제약 (반드시 지킬 것)

1. **`upstream`(b-nnett/grok-bot-...)에 절대 푸시 금지.** 푸시는 `origin`(woosa0502/Belmont)만.
2. belmont 프로세스에 `kill -9` 전에 `prlimit --pid <p> --core=0`.
3. 커밋은 사용자가 요청할 때만. (현재 미커밋 변경 있음.)
4. 빌드 중간에 setup-wsl.mjs 죽이지 말 것 / 빌드 중 저장소 파일 수정 금지.
5. 사용자 작성 문서 `docs/testing/belmont-grokbot-parity-first-scope-2026-08-30.md`(untracked)는 요청 없이 커밋에 넣지 말 것.

---

## 핵심 파일 지도

| 영역 | 파일 |
|---|---|
| **기억 회수** | `source/host/extensions/memory/{extension,memory-service,agent-state}.ts`, `source/host/runner/{system-prompt-assembly,sand-memory}.ts` |
| **roster/도구** | `source/host/extensions/session/session-roster.ts`, `source/host/runner/tools/sand-agent-management-tools.ts`, `source/host/agents/agent-messaging.ts` |
| **루틴** | `source/host/extensions/automations/{local-cron-scheduler,extension,sand-automation-cloud-sync}.ts`, `source/host/extensions/transcript/automation-runtime.ts`, `source/shared/automation-schedule.ts` |
| **플러그인/MCP(로컬)** | `source/shared/node/mcp/{local-mcp-store,mcp-manager,mcp-catalog-flow,mcp-display-runtime}.ts`, `source/electron-main/mcp/desktop-mcp-manager.ts`, `source/host/extensions/mcp/mcp-service.ts` |
| **Pi 로그인/준비** | `source/host/extensions/inference/{extension,pi-codex-login-session,pi-codex-runtime,context-window}.ts`, `source/electron-main/adapters/account-oauth.ts` |
| **Shell 상태/PDF/훅(데몬)** | `source/box-exec-daemon/{server,shell-state}.ts`, `source/host/runner/local-pdf-text-extractor.ts` |
| 숨김/게이트/프롬프트 | `source/electron-main/adapters/local-codex-mode.ts`, `source/host/extensions/experiments/extension.ts`, `source/host/runner/system-prompt*.ts` |
| 이전 회차(분류기·권한·첨부·계정 scope) | full-test 보고서 §1.6 지도 |
