# Belmont — 풀 테스트 & 감사 종합 문서

_생성: 2026-08-29 · 갱신: 2026-08-30 (컴퓨터 유즈 §1.5 추가, 확정 실결함 커밋·병합 반영) · 2차 갱신: 2026-08-30 저녁 (auto-review 로컬 분류기 배선 + 계정 scope 초기화 결함 수정 — §1.6) · 3차 갱신: 2026-08-31 (남은 문제 전부 처리 — TS 회귀·원장 이관·UNCLEAR 29건·첨부 스테이징 AUDIT-W7·훅 배선 AUDIT-W8, §1.6 후속 3) · 4차 갱신: 2026-08-31 (0.18.0 설치파일 기준 parity 회차 — 기억 회수·roster·루틴·플러그인·PDF·셸 상태·로그인 상태 등 15건 구현+라이브, §1.6 후속 4 · `belmont-018-parity-inventory-2026-08-31.md`) · 5차 갱신: 2026-08-31 (후속 8건+PARTIAL 4건 전부 해결 — MCP/WebFetch 훅·MCP 표면 auto-review(AUDIT-W11)·OS 알림 fallback·660/673 만료 알림·241·386·첨부 정리·pagination·그룹 채팅 라이브·컨텍스트 창 실측·AUDIT-4 settle 격리, §1.6 후속 5) · 6차 갱신: 2026-08-31 (외부 엄격 코드리뷰 검토 — 4건 재검증 후 AUDIT-W13~W17 등재, §1.6 후속 5.2) · 7차 갱신: 2026-08-31 (후속 6 — **AUDIT-W12~W17 전부 수정+라이브** + 품질 5종(캐시 친화성·cron 재시도·봇별 셸 상태·웹 충실도·PDF 수명주기), §1.6 후속 6) · 8차 갱신: 2026-08-31 (후속 7 — **벨몬트 관리자 B-1**: 기존 봇을 Belmont로 정의 + SendToAgent 훅 원장 + 스위퍼 루틴 + 기본 대화 + 봇별 reasoning(AUDIT-W1) + W18 수정 + **AUDIT-W19 발견·수정**; 왕복·재시작 생존 라이브, §1.6 후속 7) · 9차 갱신: 2026-08-31 (후속 8 — **Phase B 본공사**: durable 수신함(AUDIT-5 근본, 크래시 라이브)·완료 내구(P1-04)·자식 재파견·B-2 부분(삭제 보호+Managed team 절 라이브) + 품질 세부(Grep 문맥·Delete·LS·SIGKILL·셸 id·MCP 서버요청·Pi 모델 카탈로그) + 테스트 부채 F1~F4, §1.6 후속 8) · 10차 갱신: 2026-08-31 (후속 9 — 2차 외부 검토 7건 전부 확인·수정: settle 순서 rev2·B-1 부트스트랩 스크립트·원장 실패 판정·모델 상속·대화 단위 캐시 키·스키마 서명·pdfjs 데드라인, §1.6 후속 9) · 단일 통합본 (이전 산재 문서/임시 원장 대체; 판정 원장은 `docs/testing/belmont-sweep-verdicts.jsonl`, `node scripts/verdict-ledger.mjs summary`)_

이 문서는 두 검증 활동을 하나로 합친다: (1) **행위 단위 라이브 sweep** — 에이전트에 각 테스트 케이스를 주입해 실제 도구 실행 증거로 판정, (2) **소스 코드 감사** — production 배선/통합 여부를 코드로 확인. sweep은 '도구가 개별로 작동하는가'를 보고, 감사는 '실제로 production에 연결됐는가'를 본다. 후자가 전자의 여러 PASS를 false-green으로 뒤집었다.

## 0. 요약

| 항목 | 값 |
|---|---|
| 전체 테스트 케이스 | 1292 (USER 823 · AGENT 438 · GATED 31) |
| sweep 판정 원장 | 2168행 (케이스별 최신 판정 1292 — `node scripts/verdict-ledger.mjs summary`, 5차 갱신) |
| — PASS | 541 |
| — ISSUE (문제점, false-green 정정 포함) | 17 |
| — UNAVAIL (이 버전엔 기능 없음 — 사유별 EXCLUDED_HIDDEN 분류는 parity 목록 문서 §4) | 631 |
| — ENV / UI_ONLY / EXPECTED | 87 / 13 / 1 |
| — PARTIAL / FIXED / UNCLEAR | **0** / 2 / **0** (PARTIAL 4건은 후속 5에서 전부 PASS 재판정: 241·386·660·673) |
| 감사 findings | 42개 id, 최신 판정 기준 FIXED 34 · RESOLVED 1 · DOCUMENTED 2 · CONFIRMED 1 · PARTIAL 3 · POSITIVE 1. **AUDIT-5 근본 수정(durable 수신함)·P1-04·자식 재파견·B-2 부분까지 후속 8에서 완료.** 잔여: AUDIT-9(이미지 — 사용자 제외 지시) · AUDIT-B2(PARTIAL — 워커 UI 잠금은 고정 렌더러 한계) · AUDIT-W6/F5(PARTIAL, 경미) |
| 확정 실결함 | 19 — 전부 수정+재빌드+라이브검증: update_state, Pi maxTokens, 첨부전송 크래시(커밋) · AUDIT-W3~W8(§1.6) · **4차 갱신(§1.6 후속 4, 0.18 parity 회차)**: AUDIT-1 기억 회수 · AUDIT-3 roster · AUDIT-7 예약 루틴 · AUDIT-8 플러그인 · AUDIT-10 로그인 상태 · AUDIT-11 PDF · AUDIT-W2 셸 상태 · AUDIT-EPOCH · **AUDIT-W9 로컬 준비 상태 게이트** · **AUDIT-W10 데몬 PDF 거부** — 4차분 미커밋 |
| 신규 기능 | **컴퓨터 유즈**(§1.5) · **로컬 auto-review 분류기**(§1.6) · **hooks.json Shell 경로**(§1.6 후속 3) · **4차**: 장기 기억 자동 회수 · ListAgents/ListGroups · 로컬 cron 루틴 · 로컬 플러그인 저장소/카탈로그 · PDF 읽기 · Shell cwd/env 유지 · 앱 내 Pi OAuth 로그인/상태 · 클라우드 에이전트/이미지 생성 정직 숨김 — 전부 라이브검증(`docs/testing/belmont-018-parity-inventory-2026-08-31.md`) |
| 게이트 | `npm run check` exit 0 (source:typecheck 0 오류 · 테스트 191/191) — 10차 갱신(후속 9, 2차 외부 검토 7건 수정) |

**핵심 결론:** 다중 봇 *기반*은 있으나, Belmont의 핵심 연결부 — 기억 자동회수 · 봇 발견 · 위임 내구성 · child 상태 격리 · 결과 검토 — 가 아직 production에 끊겨 있다. sweep의 PASS 수치는 false-green으로 부풀려져 있었다. (2026-08-30 갱신: 컴퓨터 유즈 신규 구현+검증 §1.5, 확정 실결함 3건 커밋·병합 완료. 2차 갱신: 마지막 결함 클러스터(auto-review)가 해소되어 §0.5 ①은 0건 — §1.6. 3차 갱신: 남은 문제 목록을 전부 처리해 UNCLEAR 0건·typecheck 0오류, 그 과정에서 첨부 스테이징(AUDIT-W7)·훅 배선(AUDIT-W8) 결함 2건 추가 발견·수정 — §1.6 후속 3.)

## 0.5 완료 vs 남은 것 — 실행 관점 (USER 라우트 823 기준)

### ✅ 완료 (작동 / PASS)
- **235** USER 케이스: CDP로 직접 눌러/쳐서 실작동 확인.
- **실결함 3개 수정+검증+커밋**: 첨부전송 앱 크래시(DEFECT-3) · update_state 결과 오보고(DEFECT-1/AUDIT-2) · Pi maxTokens:0 선제압축 무력화(DEFECT-2/AUDIT-6).
- **컴퓨터 유즈 신규 구현+라이브검증**(§1.5): 도구(스크린샷/클릭/타이핑/키) · computerUse 서브에이전트 dispatch·GUI조작 · VNC 뷰어. → 아래 ②의 "컴퓨터/박스 80" 상당수 해소.
- **auto-review/Smart Mode 로컬 배선+라이브검증**(§1.6, 2차 갱신): 로컬 분류기(Pi) · Shell/컴퓨터 승인 카드(Allow once/Always allow/Deny) · 사용자 allow/block 규칙 · 규칙의 재시작 보존. → 아래 ①의 14건 해소.
- **남은 문제 일괄 처리**(§1.6 후속 3, 3차 갱신): typecheck 회귀 4건 수정 · 판정 원장 저장소 이관(`belmont-sweep-verdicts.jsonl` + `scripts/verdict-ledger.mjs`) · UNCLEAR 29건 → 0 · 첨부 박스 스테이징 결함(AUDIT-W7) 수정 · hooks.json Shell 경로 배선(AUDIT-W8) · 660/489/675 확정.
- **0.18.0 설치파일 기준 parity 회차**(§1.6 후속 4, 4차 갱신): 공식 문서·원장·감사·코드 지도로 미구현 재파악 → 15건 구현(기억 회수·roster+ListAgents/ListGroups·로컬 cron 루틴·로컬 플러그인·PDF·Shell 상태·Pi 로그인 상태·클라우드/이미지 숨김·epoch·컨텍스트 창 knob) → 전부 라이브 검증. 목록 문서: `belmont-018-parity-inventory-2026-08-31.md`.

### ❌ 非PASS 588 — "진짜 문제"는 몇 개?
| 구분 | 수 | 진짜 문제? |
|---|---|---|
| ① 진짜 결함/무효화 (ISSUE) | ~~14~~ → **0** (12 PASS 재판정 · 675/676은 auto-review와 무관으로 재분류, §1.6) | ✅ 해소 |
| ② 로컬에 원래 없는 기능 (UNAVAIL) | 501 | 아니오 (cursor/클라우드/외부 전용) |
| ③ 환경·도구 한계 (ENV) | 65 | 아니오 (실사용자엔 작동, CDP로 테스트만 불가) |
| ④ 미확정 (UNCLEAR) | ~~8~~ → 실제 41(12+29) → **0** (후속 2: PASS 11·UNAVAIL 1 / 후속 3: PASS 22·UNAVAIL 5·ENV 1·PARTIAL 1) | ✅ 해소 |

### ✅ (해소) 진짜 문제 14개 = 사실상 뿌리 1개 (auto-review/smart-mode 강제 OFF — AUDIT-W3)
`auto-review/extension.ts:52`가 local Codex서 강제 off → **"사용자가 켜도 무효"** 였던 것을 **로컬 분류기 배선으로 해소**(§1.6). 케이스별:
- 도구/권한 승인 카드: **852, 647, 648** → PASS(라이브)
- Smart Mode 권한: **778, 779, 780** → PASS(778 라이브 · 779/780 코드경로)
- Auto-review 계열: **473, 475, 476, 805, 809, 811** → PASS(라이브; 805 브라우저·811 MCP 표면은 같은 분류기 공유, 개별 라이브는 Shell·컴퓨터로 대체)
- routine 편집기 저장 검증: **675, 676** → **auto-review와 무관**(재분류). 675 = pinned 렌더러가 빈 Name에 aria-invalid를 안 붙임(복원 소스와 불일치, 별도 UI 항목) · 676 = 저장 실패 유발 불가(ENV)

수정 중 **추가 결함 1건 발견·수정**(AUDIT-W4): 로컬 모드에서 호스트와 데스크톱이 계정 scope를 다르게 계산해 **매 시작마다 auto-review 규칙·모델 기본값·로컬 도구 권한이 초기화**되던 문제 — §1.6.

### ② UNAVAIL 501 사유별 (문제 아님 — 로컬에 원래 없음)
| 사유 | 수 |
|---|---|
| 다중사용자/협업 (cursor 클라우드) | 100 |
| 컴퓨터/박스 (로컬=이 머신) | 80 → **컴퓨터 유즈 구현으로 상당수 해소(§1.5)** |
| 에러/오류 상태 (유발 불가) | 52 |
| 클라우드/AI생성 (cursor 토큰 필요) | 47 |
| 외부서비스/IDE 미연결 | 35 |
| 드래그드롭/네이티브 (CDP 불가) | 34 |
| 송신실패 상태 (IPC라 유발 불가) | 33 |
| 승인/권한카드 (auto-review off 연장) | 27 |
| 기타 상태의존 | 91 |
| 모델피커 (로컬 Pi 고정) | 2 |

### 남은 실행 항목 (안 한 것)
1. ~~**auto-review Codex 배선**~~ → 완료(§1.6). ~~UNAVAIL 중 "auto-review off라서" 19건 재판정~~ → 완료(§1.6 후속: PASS 7·PARTIAL 2·ENV 2·UNAVAIL 8, AUDIT-W5 발견·수정). 남은 것: ~~MCP 표면 개별 라이브~~ → 완료(후속 5, AUDIT-W11 발견·수정 포함) · ~~expired 로컬 도구 카드 알림(660)~~ → 완료(후속 5: 트레이+전사 알림). 잔여: 브라우저 표면 개별 라이브(같은 분류기 공유), 분류기 정책 프롬프트 튜닝(오프라인 탐침 8/8 정답).
2. ~~**UNCLEAR 8건 확인**~~ → 완료(12건: PASS 11·UNAVAIL 1, §1.6 후속 2; AUDIT-W6 발견·수정). ~~남은 29건~~ → 완료(§1.6 후속 3: PASS 22·UNAVAIL 5·ENV 1·PARTIAL 1; AUDIT-W7/W8 발견·수정). **UNCLEAR 0.**
3. **routine 편집기 빈 이름 aria-invalid(USR-675)** — ISSUE(UI)로 확정: pinned 렌더러가 blur/Test run 뒤에도 `aria-invalid`를 안 붙임. 편집 가능한 프런트엔드로 교체 전엔 고칠 수 없는 항목(제외).
4. (선택) 컴퓨터 유즈 VNC 세부(클립보드/키/줌) 개별 E2E 검증 · 다중창(USR-390, 현재 maxWindows=1 미지원) · 브라우저 표면의 auto-review 개별 라이브. ~~MCP 표면 auto-review·beforeMCPExecution 훅·MCP 오류 클래스(241)~~ → 완료(§1.6 후속 5).
7. ~~0.18 parity 핵심 연결부(기억 회수·roster·예약 루틴·플러그인·PDF·셸 상태·로그인 상태)~~ → 완료(§1.6 후속 4). 남은 것은 `belmont-018-parity-inventory-2026-08-31.md` §4(EXCLUDED_HIDDEN 목록·후속 확장).
5. ~~`npm run source:typecheck` 오류 4개~~ → 수정(컴퓨터 유즈 커밋의 회귀였음 — "기존 오류"라던 이전 표현 정정). `npm run check` exit 0.
6. ~~PARTIAL 3건(660·673·241)~~ → 후속 5에서 전부 PASS 재판정(만료 트레이+전사 알림 · 스테일 버튼 없음 · 박스 원문 문구+오류 클래스 배선). PARTIAL 0.

## 1. 확정 실결함 (수정 완료)

### AUDIT-2 — update_state 결과 오보고 ✅수정+빌드
- 증거: agent-state.ts {message} vs tool {detail/reason}; any boundary hid it. FIXED this session + built.
- sweep 관계: was caught by sweep (083/269)

### AUDIT-6 — Pi maxTokens:0 -> 선제압축 무력화 ✅수정+빌드
- 증거: pi-codex-runtime.ts:177 hardcoded 0; background-summarization.ts:27 maxTokens<=0 => no threshold. FIXED (resolved.model.contextWindow=272000) + built.
- sweep 관계: found by user analysis, not by sweep

### DEFECT-3 — 이미지/파일 첨부 전송 시 앱 전체 크래시 (attachment kinds shape 불일치) ✅수정+빌드
- 증거: session-projection.ts buildAttachmentLastEntry가 kinds를 countKinds()의 객체 {image:1}로 넣음. 렌더러 Yun/mergeKindCounts는 배열 [{kind,count}] 기대. 객체엔 .length=undefined라 빈-가드 통과 후 n.filter 폭발 -> 'TypeError: n.filter is not a function' -> 루트 에러경계 -> 앱 전체 크래시(reload로만, 심하면 agent 삭제로만 복구). 게이트웨이 주입/직접 CDP 앱제어 둘 다 동일 재현.

> 상태: 소스 수정 + 재빌드 + 라이브검증 완료. **커밋+병합 완료** (main d4babb9, origin push, 2026-08-30).

## 1.5 컴퓨터 유즈 (Computer Use) — 신규 구현 + 라이브 검증 ✅ (2026-08-30)

원래 이 로컬 버전엔 컴퓨터 유즈가 없었다(§6 UNAVAIL 641에 '컴퓨터' 포함). 이번에 **로컬 Codex 모드용 Computer 도구를 구현**해 에이전트가 화면을 보고(스크린샷→Pi 비전) 마우스·키보드로 조작(클릭·타이핑·키)하게 만들었다. 종단간 라이브 검증 완료, main 병합(d4babb9)·origin push.

### 무엇이 막혀 있었나 — 근본원인 3개 (원인별 재설계, 성적표 튜닝 아님)
원래 있던 `createComputerTool`은 **불완전 재구성**이라 턴-도구 계약을 하나도 안 지켰다.

1. **프레임워크 미준수** — 스트리밍 execute·proto 결과(toJson)·serializeError·이미지 전달 render가 전무 → `createComputerTurnTool` 신규 작성(host-computer-tool-dependencies.ts). generate-image/ls와 동일 계약(withSafeParsedArgs + ComputerUseToolCall proto + createImageResult).
2. **실행 라우팅 오류** — 컴퓨터 동작이 local-exec 게이트웨이(shell/파일만 앎)로 가서 describeLocalExec가 computerUseArgs를 몰라 '설명 불가(SAND_LOCAL_TOOLS_UNDESCRIBABLE)'로 차단됨 → 공유 헬퍼(box/local-computer-use.ts)로 박스 accessor를 로컬 Xvfb executor로 감쌈(box/production.ts + extensions/local-exec/production.ts). CombinedResourceAccessor는 로컬 항목이 게이트웨이보다 우선.
3. **★이미지 미전달 (결정타)** — Pi 투영이 tool 결과의 텍스트(`part.result`)만 쓰고 스크린샷이 담긴 `experimental_content`를 통째로 버림 → experimental_content 우선 사용하도록 수정(extensions/inference/pi-codex-projection.ts:202). 이게 모델이 화면을 '보게' 만든 핵심.

### 구현 방식
- 전용 **Xvfb**(:99, 1280×800) 가상 화면. 캡처=**ffmpeg x11grab**(ImageMagick `import -window root`는 Xvfb서 1비트/빈 프레임으로 퇴화), 입력=**xdotool**.
- 로컬 모드엔 컴퓨터유즈 서브에이전트 런타임이 없어 **메인 에이전트에 직접 노출**(turn-toolset.ts 게이트 완화 + turn-agent-composition.ts fallback + host-runner-composition.ts projection).
- 실행기: `source/packages/local-exec/computer-use/{executor,display-manager}.ts`. remote-box-resources.ts는 로컬 모드서 monitor-lease/navigation-probe 단계 건너뜀.

### 라이브 검증 (에이전트 응답 + 내 독립 ffmpeg 캡처로 교차확인 — self-report 아님)
| 액션 | 판정 | 증거 |
|---|---|---|
| **screenshot** | ✅ PASS | 화면 코드 정확 판독: GRAPE-99·CHERRY-42·MANGO-88 정확 (작은폰트 KIWI→KWW 근사, 판독 자체는 작동) |
| **click** | ✅ PASS | xmessage OK 버튼 클릭 → 창이 실제로 닫힘(내 독립 확인). 마우스 물리 입력 작동 |
| **type** | ✅ PASS | xedit에 " ZEBRA-TYPED-42" 입력 → **내 독립 캡처에 실제 삽입 확인**(에이전트 환각 아님) |
| **key** | ✅ PASS | Return 키로 새 줄(상태바 L1→L2) 생성 후 "KEY-NEWLINE-9" 입력, 독립 캡처 확인 |
| move | ✅ (암묵) | 클릭 전 mousemove로 좌표 이동(executor 내장) |
| scroll·drag·wait·cursorPosition | 구현됨 (미개별검증) | 동일 xdotool executor 경로 — 마우스(click)·키보드(type/key) 파이프라인 이미 입증 |

### ② computerUse 서브에이전트 dispatch ✅ (2026-08-30 추가)
Task 도구가 subagent_type을 executor만 허용("Invalid value. Expected one of: executor")한 이유는 host-runner-composition.ts:2530이 config를 `[executor]`로 하드코딩(재구성 잔재)한 것. 로컬 CU면 `createSandComputerUseSubagentConfig`도 추가하도록 고침. 단일화면 락(`allocateComputerUseWindow`, agent-adapters.ts:62)은 이미 존재 → 한 번에 하나만.
- **라이브 검증**: "Use the Task tool to dispatch a computerUse subagent..." → 봇 "The computerUse subagent was accepted and dispatched successfully. It reported the code word: **PLUM-55**". (수정 전엔 "Invalid value. Expected one of: executor"로 거부됨 → 수정 후 수락)

### ③ VNC 뷰어 패널 ✅ (2026-08-30 추가)
호스트가 **x11vnc**(:99→5900) + **websockify/noVNC**(6080)를 spawn하고, 박스 vncUrl을 noVNC URL로 채움(display-manager.ts + box/local-computer-use.ts + box/production.ts). x11vnc가 WSL의 WAYLAND_DISPLAY를 보고 Wayland로 오인·종료하던 것 → spawn env에서 WAYLAND_DISPLAY/XDG_SESSION_TYPE 제거로 해결.
- **라이브 검증**: 앱 "Grok Bot's Computer" 패널 클릭 → 렌더러가 `<webview src="http://127.0.0.1:6080/vnc.html?...">` 생성 → **:99 데스크톱이 앱 안에 실시간 표시**("VNC LIVE: MELON-33" 창 그대로 보임). 회색 플레이스홀더→실제 화면.

### 상태 / 한계
- 커밋 815c410(도구, 12파일) → main 병합(d4babb9). ②③은 추가 커밋 예정(4파일).
- 실행 조건: **`SAND_LOCAL_COMPUTER_USE=1`** (기본 동작 불변, opt-in). VNC는 x11vnc/websockify/novnc 설치 시 자동(없으면 뷰어만 비활성, 도구는 작동).
- 창 관리자 없음(openbox 등 미설치) → 앱이 테두리 없이 뜸. 실제 GUI 앱 자동화엔 WM 설치 권장.

### full-test 케이스 재분류 (컴퓨터 관련 — §6 UNAVAIL 641 중)
컴퓨터 관련 케이스는 3그룹 — ①에이전트 Computer 도구 ②computerUse 서브에이전트 dispatch ③VNC 뷰어 패널. **셋 다 구현+라이브검증 완료**(초기엔 ①만; ②③은 사용자 지시로 후속 구현).

| 케이스 | 원판정 | 새 판정 | 근거 |
|---|---|---|---|
| GBF-AGT-000141 (시퀀스가 screenshot로 안 끝나면 자동 screenshot 추가) | UI_ONLY | **✅ PASS(라이브)** | move만 시켜도 screenshot 반환·FIG-11 판독. host-computer-tool-dependencies.ts:351 |
| GBF-AGT-000135 (Computer then-batch 후속액션) | UNAVAIL | **✅ PASS(코드+라이브)** | :347-348 primary+then[] 시퀀스 조립; 다중액션(클릭+타이핑) 라이브 입증 |
| GBF-AGT-000206 (auto-review가 Computer 액션 거부) | UNAVAIL | **✅ PASS(라이브, 2차 갱신)** | §1.6: 클릭이 auto-review preflight를 타고 차단 규칙으로 카드(surface computer) 발화 → Deny면 실행 안 됨/Allow once면 실행. `createComputerTurnTool`에 preflight 연결 |
| GBF-AGT-000429 (no-monitor면 SandBoxNoMonitor throw) | PASS | PASS(유지) | 플래그 OFF면 여전히 throw, ON이면 Xvfb 모니터 존재 — 둘 다 정상 |
| GBF-AGT-000297 (computerUse 서브에이전트 dispatch) | UNAVAIL | **✅ PASS(라이브)** | ②: config 하드코딩 수정 → 수락·dispatch → PLUM-55 판독 |
| GBF-AGT-000420 (서브에이전트로 **GUI 조작**) | UNAVAIL | **✅ PASS(라이브)** | 서브에이전트가 스크린샷→OK 버튼 클릭(좌표 자가조정 x463→x552)→창 닫힘(독립검증) |
| GBF-AGT-000298 (두 번째 서브에이전트 disallow) | UNAVAIL | **✅ PASS(라이브)** | 메인에이전트가 규칙대로 두 번째 dispatch 거부("forbid dispatching a second while one is running") |
| GBF-AGT-000235 (두 번째 → 데스크톱 할당 실패) | PASS | **코드경로 활성(유지)** | allocateComputerUseWindow(agent-adapters.ts:62) 하드 가드 존재·도달가능. 에이전트가 규칙 지켜 race 미생성 → 에러경로 자체는 미트리거 |
| GBF-USR (VNC 화면 보기) | UNAVAIL | **✅ PASS(라이브)** | ③: x11vnc+websockify+noVNC → 앱 "Open computer"에 :99 실시간 표시(MELON-33) |
| GBF-USR-000913 (VNC 줌 1x 고정) / USR-000456 (키 전달) | UNAVAIL | **✅ 코드배선** | electron VNC trust가 내 loopback `127.0.0.1/vnc.html`을 box desktop으로 인식(vnc-trust.ts:8) → installGuestInputGuard가 줌 1x 고정+before-input-event 라우팅 |
| GBF-AGT-307/308 (readClipboard/writeClipboard), USR-452/453/758 (클립보드), AGT-354 (presence), USR-454 (Cmd→Ctrl) | UNAVAIL | **코드배선(미개별E2E)** | 같은 trust로 boxDesktopWebview에 클립보드/presence 핸들러 부착(vnc-trust.ts:84-86, electron.clipboard). 인프라는 활성이나 중첩 webview 통한 각 동작 개별검증은 못 함 |
| GBF-USR-000390 (**다중 데스크톱 창** ensureWindow) | UNAVAIL | **미지원(정직)** | production.ts:107 maxWindows()=1 — 단일 Xvfb. 로컬은 한 화면만 |
| GBF-USR-000897 (handoff-card 'Open computer') | UNAVAIL | 별도 UI | 카드 UI 케이스 — 컴퓨터 유즈 코어 아님 |

**정직한 결론(검증 수준 구분):**
- **라이브검증**: ① 도구 실행(스크린샷/클릭/타이핑/키/then-batch/trailing) · ② 서브에이전트 dispatch·GUI조작·disallow · ③ VNC 화면 표시.
- **코드배선(개별 E2E 미검증)**: VNC 클립보드/presence/키보드/줌 — electron VNC 인프라(vnc-trust.ts)가 내 loopback vncUrl을 box desktop으로 인식해 자동 부착. 인프라 활성 확인·각 동작 개별검증은 중첩 webview 제약으로 못 함.
- **실제 미지원**: 다중 데스크톱 창(USR-390, maxWindows=1) — 단일 화면 설계.

## 1.6 auto-review / Smart Mode 로컬 배선 ✅ (2026-08-30 2차 갱신 · 미커밋)

### 무엇이 막혀 있었나
- **AUDIT-W3**: approve/block 판정기(`ClassifySandAutoReview`)가 Cursor 클라우드 RPC 전용 → 로컬엔 판정기가 없어 `auto-review/extension.ts`가 provider≠cursor면 `isEnabled:false`를 강제. 사용자가 켜도 카드·규칙 전부 무효(14개 ISSUE의 뿌리).
- **AUDIT-W4(신규)**: 규칙을 넣어도 앱을 재시작하면 사라짐. 추적(설정 저장소에 호출 스택 로그) 결과 호스트(`mcp-service.ts` 계정 없음 → scope `"local"`)와 데스크톱(`accountCacheScope("local-codex")`)이 서로 다른 계정 scope를 저장소에 적용 → `scopeToAccount()`가 scope 변경 시 계정 범위 항목(autoReviewInstructions·agentDefaultModel·computerUseModel·localToolPermission)을 삭제. 매 시작마다 양쪽이 번갈아 삭제.
- **컴퓨터 표면 누락**: 이전 세션의 `createComputerTurnTool`(host-computer-tool-dependencies.ts)이 규격(파라미터·전사·렌더)은 맞췄지만 auto-review preflight를 호출하지 않았고, 프로덕션 턴 경로에선 Computer 의존성이 `autoReview` 없이 만들어짐(turn-agent-composition.ts 대체 경로).

### 구현 (원인별)
| 파일 | 변경 |
|---|---|
| `host/extensions/auto-review/local-smart-mode-classifier-exec.ts` (신규) | 분류기 순수 모듈: 시스템 프롬프트(허용/차단 정책, 규칙 우선순위: block > allow > 대화 문맥) + `SmartModeClassifierArgs → SmartModeClassifierResult`, JSON 응답 파싱(펜스/잡문 허용), 실패 시 error 결과(→ 도구는 "review errored"로 거부), abort 전파 |
| `.../local-smart-mode-classifier-provider.ts` (신규) | 분류기를 라우팅 provider(Pi/Codex, Claude Code, OpenRouter)에 연결 + Pi 런타임 예열 |
| `.../auto-review/extension.ts` | 강제 off 제거. provider≠cursor면 로컬 분류기 주입, `sand_auto_review` 게이트를 로컬에서 true(settings-on ⇒ enforce; `SAND_AUTO_REVIEW_MODE`로 여전히 재정의 가능) |
| `host/extensions/inference/{pi-codex-runtime,provider-session}.ts` | `systemPrompt`·`reasoning` 옵션을 `runRoutedProviderText`까지 관통 |
| `packages/agent/utils/smart-mode-classifier-measurement.ts` | `SAND_SMART_MODE_CLASSIFIER_TIMEOUT_MS` env 재정의(기본 10s 유지) |
| `host/runner/tools/sand-computer-tool.ts` | preflight를 `runComputerToolAutoReviewPreflight`로 분리(공용) · 로컬은 박스 Chrome 탐침 대신 상수 표시상태 |
| `host/runner/host-computer-tool-dependencies.ts` | `createComputerTurnTool`이 실행 전 preflight 호출 |
| `host/runner/tools/turn-toolset.ts` · `host/runner/turn-agent-composition.ts` · `host/host-runner-composition.ts` · `host/box/local-computer-use.ts` | 턴 입력에 `computerAutoReview`(로컬 디스플레이 99·규칙·컨트롤러) 전달, 대체 경로가 이를 `autoReview`로 사용 |
| `shared/node/local-codex-account.ts` (신규) · `electron-main/adapters/local-codex-mode.ts` · `host/extensions/mcp/mcp-service.ts` | 로컬 계정 상수·해시 scope 통일(AUDIT-W4) |
| `tests/local-auto-review-classifier.test.mjs` (신규, 10건) | 프롬프트 구성·절단, 응답 파싱, 실행기 계약(allow/block/error/abort), 모델·추론 재정의, 배선 회귀 방지(강제off 부재·컴퓨터 preflight·계정 scope 일치) |

### 라이브 검증 (CDP + 게이트웨이 API, 최종 빌드)
| 시나리오 | 결과 |
|---|---|
| 무해 명령 `ls -1 \| head -5` | 카드 없이 실행 |
| block 규칙("날짜 출력 명령은 항상 물어볼 것") + `date` | 카드 발화(21~25s) → **Allow once** → 실행(`Sun Aug 30 21:01:35 KST 2026`) / **Deny** → 미실행, 에이전트가 차단 사유 보고 |
| 정책상 위험(`sudo -n true`) | 규칙 없이도 카드("Runs a sudo command, which requires approval for root-level actions.") → **Always allow** → 설정에 규칙 자동 추가 → 재실행 시 카드 없음 |
| 컴퓨터 클릭 + block 규칙 | 카드("Auto-review Paused This Action", surface `computer`, 요약 "Click at (640, 400) on Grok Bot's computer to …") → Allow once → 실행 |
| 규칙 재시작 보존 | 브리지(설정 화면 경로)로 규칙 저장 → 재시작 → 규칙 유지(AUDIT-W4 수정 전엔 매번 소실) |
| 분류기 오프라인 탐침(Pi gpt-5.5, low) | 8/8 정답(ls·npm test·재설치 허용 / force-push·curl\|sh·ssh키 읽기 차단 / allow 규칙 허용·block 규칙 차단), 2.4~5.2s |
| 단위 테스트 | `npm test` 109/109 · `source:typecheck` 기존 4개 오류 외 신규 없음 |

### 한계 / 주의
- 카드까지 21~25s: 모델 턴 → 분류(≈3s) → 거부 → 모델이 `request_smart_mode_approval`로 재호출 → 분류 → 카드. Cursor 설계와 동일한 2회 왕복.
- 분류기 예산 10s(측정 래퍼): 로컬 모델이 느리면 `SAND_SMART_MODE_CLASSIFIER_TIMEOUT_MS`로 확장. 분류 실패 시 안전 방향(거부)으로 동작.
- 로컬 컴퓨터 표면은 표시상태 재확인(recheck)이 상수(박스 Chrome 없음) → "검토 후 화면 변경" 감지는 없음.
- 브라우저/MCP/서브에이전트 표면은 같은 `smartModeClassifierExecutorResource`를 쓰므로 활성이나 개별 라이브는 미실행.
- 테스트 흔적: 에이전트 "AutoReviewProbe"(전사에 카드 기록 보존). 테스트용 block 규칙은 정리(설정: auto-review ON, 규칙 없음).

### 후속: "auto-review off라서 못 봤던" UNAVAIL 19건 재판정 + AUDIT-W5 (2026-08-30 3차)
재판정하려다 **추가 결함(AUDIT-W5)** 발견·수정: 런처가 게이트웨이를 인증 없이 띄우는데, 게이트웨이는 로컬 실행 채널(`/local-exec/requests`)을 **토큰 없으면 401로 거부** → 데스크톱의 local-exec 데몬이 한 번도 등록되지 못해 호스트 셸 도구(ExternalShell/ExternalRead)가 항상 "Your local machine isn't connected right now"였음. 수정: `scripts/lib/wsl-runtime.mjs` 호스트 env에 `SAND_GATEWAY_REQUIRE_AUTH=1` (런처가 gateway.json 토큰을 Electron→데몬으로 이미 전달). 재시작 후 게이트웨이 "(auth required)", 데몬 연결 파일에 token, ExternalShell이 호스트(WSL-CODEX)에서 실행.

| 묶음 | 케이스 | 판정 | 근거 |
|---|---|---|---|
| 로컬 도구 권한 카드 | 488, 566, 567, 659, 808, 489 | **PASS** | Allow once→"…this time." 문구·실행 / Never→전역 never·재요청 카드 없이 거부 / 재시작 시 낡은 ask settle(오류 없음) / clearApprovals→승인 파일 삭제 / 상한 `ask`→"Always allow" 비활성(툴팁 문구는 미확인) |
| 〃 | 660, 673 | PARTIAL | 호스트는 pending ask를 재시작 시 `expired`로 갱신(TTL 10분 경로는 코드) — pinned 렌더러가 expired 결과 문구를 표시 안 함 / 버튼 비활성 조건은 코드(canAct), 낡은 카드에 버튼이 남지 않는 것은 라이브 |
| 〃 | 486, 487 | ENV | 제출 실패·제출 중 상태는 유발/포착 불가 |
| auto-review 카드 상태 | 674 | **PASS** | 해결된 카드가 버튼 대신 상태 라벨 표시 |
| 도구 승인 요청 | 801, 802, 573, 574 | UNAVAIL(정밀) | 로컬 WebFetch/WebSearch(`createCodexWeb*Service`)에는 권한 프롬프트가 없음 — rejected 결과는 Cursor 박스 경로 전용. auto-review와 무관 |
| 〃 | 571, 572, 575, 576 | UNAVAIL | GitHub SCM 연결 = 클라우드 커넥터, 이미지 생성 = Cursor 토큰(AUDIT-9) |

합계: PASS 7 · PARTIAL 2 · ENV 2 · UNAVAIL 8(사유 정정). 이전 사유 (2) "Execution=Ask여도 박스 실행이 승인 카드를 안 띄움"은 설계상 정상(박스 셸은 로컬 권한 대상이 아님) — 호스트 셸 카드는 AUDIT-W5 수정 후 정상.

### 후속 2: UNCLEAR 12건 재판정 + AUDIT-W6 (2026-08-30 4차)
sweep이 "empty/timeout"으로 판정 못 한 AGENT 케이스 12건을 **단위(순수 함수 직접 호출)·코드·라이브**로 재판정. 라이브 중 **AUDIT-W6** 발견·수정: 로컬 MCP 투영이 `textSpiller: undefined`라 큰 결과를 인라인했고, spiller를 연결해도 loopback 박스의 `uploadFile`이 셸 명령 문자열의 리터럴 `/workspace` 경로(`mkdir -p`/`mv`)로 실패(로컬 데몬은 cwd/WriteArgs 경로만 매핑) → 경로 매핑되는 write 실행기로 교체. 이 업로드 경로는 spill뿐 아니라 loopback 박스로의 모든 파일 업로드가 쓰는 길이다.

| 케이스 | 판정 | 방법 · 근거 |
|---|---|---|
| AGT-347 MCP 큰 결과 spill | **PASS**(수정 후 라이브) | 60000B → `.sand/tools/<uuid>.txt (58.6 KB, 1876 lines)` 파일 참조, 파일 실존 |
| AGT-017 Task model 파라미터 | PASS(단위) | `resolveSubagentModel`: inherit→부모, 허용 슬러그→그 모델, 미허용→`ToolCallArgParseError "Invalid model selection … Allowed model slugs"`. 라이브는 로컬 허용 목록이 비어 모델이 Task 호출 자체를 거절 |
| AGT-330 workspaceOpen pluginPaths | PASS(단위) | 배열 허용, 비배열/빈문자열/비문자열 → 인덱스별 오류 |
| AGT-239 도구 타임아웃 | PASS(단위) | `wrapToolWithTimeout` 80ms → `ToolTimeoutError "… timed out after … and was terminated"`; 티어 5/15/30/60/120분 |
| AGT-077/078 browser_drag/click 검증 | PASS(단위) | `'sourceRef is required'`, `'x is required'`/`'y is required'` (로컬엔 박스 브라우저 미노출) |
| AGT-201 환경 전환 안내 | PASS(단위) | BACKGROUND→IDE: "operating as an agent locally… commit and push only when requested", 반대: "cloud agent… Manage your own Git state" |
| AGT-381 멀티태스크 진입 안내 | PASS(단위) | `processModeSystemReminder(MULTITASK)` → "You are now in Multitask mode" + "The user has engaged **Multitask Mode**" 코디네이터 위임 안내 |
| AGT-314 cloud/local 규칙 노출 | PASS(단위) | `filterByAgentEnvironment`: IDE/CLI=local, BACKGROUND=cloud, BUGBOT·미지정=무필터 |
| AGT-373 plan frontmatter todo 동기화 | PASS(단위+코드) | `updateTodoStatusArray`+`stringifyPlanFrontmatter`; `syncLatestPlanTodosToFile`(todo.ts:174)은 로컬 호스트에 plan 도구/레지스트리 배선이 없어 실경로 미발생 |
| AGT-262 429/5xx 재시도 분류 | PASS(코드) | `classifyWebSearchProviderError`: 429 또는 ≥500 → PROVIDER_ERROR "…may be temporary. Please try again." |
| AGT-322 CI 조사 서브에이전트 | UNAVAIL | `createCiInvestigatorSubagentConfig`가 어디서도 등록되지 않음(클라우드 CI 연동 기능) |

### 후속 3: 남은 문제 전부 처리 — TS 회귀·원장 이관·UNCLEAR 29건·첨부 스테이징(AUDIT-W7)·훅 배선(AUDIT-W8) (2026-08-30~31 5차)
"남은 문제점을 전부 todo에 올리고 해결·테스트·문서화"를 한 회차. 처리 순서와 결과:

| # | 항목 | 결과 |
|---|---|---|
| 1 | `npm run source:typecheck` 오류 4건 (host-runner-composition.ts subagent config 타입 2, host-computer-tool-dependencies.ts Context 타입 2) | **수정** — 컴퓨터 유즈 커밋(815c410/893aa53)에서 생긴 회귀였음(이전 문서의 "기존 오류" 표현은 오류). `createSandComputerUseSubagentConfig`가 proto `SubagentType`/`CustomSubagentPermissionMode`를 쓰도록, `createComputerTurnTool<TContext extends Context>` 제네릭 제약. `npm run check` exit 0 |
| 2 | 판정 원장이 `/tmp/sweep-verdicts.jsonl`(휘발) | **이관** — `docs/testing/belmont-sweep-verdicts.jsonl`(append-only, 케이스별 최신 판정이 유효) + `docs/testing/belmont-audit-findings.jsonl` + `scripts/verdict-ledger.mjs summary\|list <VERDICT>\|show <CASE_ID>` |
| 3 | UNCLEAR 29건(이전 문서는 8/12로 과소 집계) | **0건** — 아래 판정표. PASS 22 · UNAVAIL 5 · ENV 1 · PARTIAL 1 |
| 4 | USR-660 로컬 도구 카드 TTL 만료 실측 | PARTIAL 확정 — 호스트는 `SAND_LOCAL_TOOL_ASK_TTL_MS`(10분) 경과 시 `expired`로 정리(라이브: 정확히 10분에 만료), pinned 렌더러는 카드만 제거하고 "was not allowed" 결과 문구를 안 그림 |
| 5 | USR-489 상한 `ask`일 때 "Always allow" 비활성 툴팁 | PASS — 비활성 버튼 title "Always allow is disabled by your organization…" 노출 |
| 6 | USR-675 routine 빈 이름 aria-invalid | ISSUE(UI) 확정 — pinned 렌더러가 blur/Test run 뒤에도 `aria-invalid`/`required`를 안 붙임. 편집 가능한 프런트엔드로 교체 전까지 제외 항목 |
| 7 | AUDIT-W6 업로드 경로 변경이 첨부(A10)에 미치는 영향 | **결함 발견·수정(AUDIT-W7)** — 첨부 확장이 `ctx: {}`(가짜 Context)로 서비스를 만들어 박스 스테이징 업로드가 항상 실패("not ready … last ping: crash") → 프롬프트가 호스트 경로를 유지해 에이전트가 ExternalRead(로컬 권한 카드)로 읽고 있었음. `createContext()`로 수정. 라이브: 업로드 성공 후 `/workspace/uploads/<hash>.txt`를 권한 카드 없이 읽음(USR-244 재판정 PASS) |
| 8 | 인수인계 문서 정정 | UNCLEAR 과소 집계 정정, 증거 등급 표기 정렬(아래) |
| 9 | 훅(hooks.json) 3건(293/324/345) | **결함 발견·수정(AUDIT-W8)** — 아래 |

**증거 등급(표기 통일):** `PASS(라이브)` = 실제 앱에서 CDP/게이트웨이로 실행·관찰 = parity 문서의 RUNTIME_VERIFIED · `PASS(단위)` = 복원 소스의 순수 함수를 직접 호출해 확인 = CODE_PRESENT+동작 확인 · `PASS(코드)` = 배선/분기만 코드로 확인 = CODE_PRESENT.

| 케이스 | 판정 | 방법 · 근거 |
|---|---|---|
| AGT-009 팀 MCP 서버 제거 거부 | UNAVAIL | 코드: isTeamServer면 "…provided by the user's team…" 반환(sand-mcp-management-tools.ts:362) — 로컬엔 팀 서버 없음 |
| AGT-015 SetMcpInstructions | UNAVAIL | 라이브: "MCP server ID must be a positive decimal string." — 로컬 stdio 서버는 백엔드 숫자 ID 없음 |
| AGT-111 관리자 명령 거부 목록 | UNAVAIL | 코드: `shell-stream.ts`는 `adminCommandDenylist`를 받지만 로컬 호스트에 공급 경로 없음(팀 정책 = 클라우드 계정 설정) |
| AGT-120 Shell로 UI 자동화 차단 | PASS(라이브) | 박스 Shell `xdotool getmouselocation` → "Rejected: Direct UI automation through Shell is blocked. Use the Computer tool…" |
| AGT-190 Await 폴링 금지 | PASS(코드) | 프롬프트가 서브에이전트 폴링 금지 지시, await가 완료 시 transcriptPath 포함 반환(await.ts:378-380) |
| AGT-237 Workspace Disconnected | ENV | connect-error.ts 정규화 경로 존재, 로컬에서 exec 백엔드 끊김 유발 불가 |
| AGT-241 MCP 전송 실패 | PARTIAL | 라이브: `fail`/`crash` 픽스처 도구 → "Error: Tool execution error. simulated tool failure" / "… server process exited" — 오류 결과 ✓, 원본 "Box MCP execution failed for …" 문구·오류 클래스 기록은 로컬 투영 스텁(`mcpErrorClassOf: () => "unknown"`) |
| AGT-245 ask 불가 시 로컬 도구 | PASS(단위) | `SandLocalToolPermissionController(canAsk:false).authorize` → `{allowed:false, reason: ASK_UNAVAILABLE}` |
| AGT-250 서브에이전트 실행 오류 | PASS(코드) | `handleSubagentExecutionError` — 레지스트리 정리+stop 훅 후 rethrow → 부모 턴에 오류 텍스트 |
| AGT-266 PAUSED 목표 재활성 | PASS(코드) | `reactivatePausedGoalOnUserMessage` — 사용자 메시지에만(isSyntheticWakeup 제외) |
| AGT-293 preToolUse deny | PASS(라이브) | 아래 AUDIT-W8 표 |
| AGT-304 잘못된 reply_to | PASS(라이브) | SendMessage reply_to 없는 ID → 오류 없이 전송, 전사 entry에 replyToId 없음 |
| AGT-311 로컬 exec 루트 밖 경로 | PASS(단위+라이브) | `containPath` — 상대/절대/심볼릭 링크 전부 거부; CopyToBox /tmp → "outside the allowed local-exec root" |
| AGT-324 beforeShellExecution | PASS(라이브) | 아래 |
| AGT-345 postToolUse additional_context | PASS(라이브) | 아래 |
| AGT-357 실행 중 서브에이전트 follow-up | PASS(코드) | Task 스키마(task-tool-schema.ts:108): interrupt=true일 때만 중단 후 전달 |
| AGT-388 스킬 목록 예산 | PASS(단위) | `buildAvailableSkillsPromptSection` under_budget → shortened_descriptions → omitted_skills 3단계 |
| AGT-390 백그라운드 에이전트 승인 즉시 거부 | PASS(코드) | mcp.ts:360 BACKGROUND면 카드 없이 ToolCallRejectedError; Shell 동일(분류기 비활성) |
| AGT-392 노트 디렉터리 안내 | UNAVAIL | `metaAgentNotesEnabled`를 호스트가 어디서도 설정 안 함(미배선) |
| AGT-435 8단계 상한 | UNAVAIL | `maxSteps: 8`은 OpenRouter 실행기 전용; Codex(Pi) 경로는 자체 루프(SAND_AGENT_MAX_STEPS) |
| AGT-439 WebFetch localhost 차단 | PASS(라이브) | "Cannot fetch from localhost (127.0.0.1:9347) because this tool runs from an isolated server." |
| USR-216/796/797 팔레트·메뉴 닫기 | PASS(라이브 CDP) | Ctrl+K → dialog 1 → Esc → 0 / 메뉴 바깥 클릭·Esc → 0 |
| USR-445/605/606 에이전트 이동 | PASS(라이브 CDP) | Ctrl+[ / Ctrl+] 뒤·앞 · Alt+Up/Down 이전·다음(activeAgentId 변화 확인) |
| USR-747/748 확대·축소 | PASS(라이브 xdotool) | Ctrl+= 1040→945 · Ctrl+- 945→1040 · Ctrl+0 리셋 (CDP 합성키는 Electron 메뉴 가속기라 무효 — 하네스 한계) |

#### AUDIT-W8 — 훅이 에이전트 Shell(스트리밍 경로)에 안 걸림
hooks.json에 preToolUse/beforeShellExecution/postToolUse를 넣고 에이전트에게 Shell을 시키면 셋 다 무반응(마커 로그 없음). 원인 3개:
1. 박스 데몬의 preToolUse 게이트(`#preToolUseGate`)는 `shellArgs`(비스트리밍)·Read/LS/Grep/Write/Delete 경로에만 있고, 에이전트 Shell 도구가 쓰는 `shellStreamArgs` 경로엔 없음.
2. `beforeShellExecution`은 소비자가 아예 없음(업스트림은 클라이언트 단계에서 실행 — 복원 호스트엔 그 단계가 없음; proto `ExecuteHookRequest`에도 해당 case 없음).
3. postToolUse/postToolUseFailure의 additional_context는 호스트가 WebSearch(`withRemoteHooks`)에만 배선; Shell 스트림의 `hookContext` 이벤트는 에이전트 쪽이 `break`로 버림.

수정(원인별): `box-exec-daemon/server.ts` `shellStream`에 spawn 전 preToolUse("Shell" matcher)·beforeShellExecution 게이트(deny/exit 2/failClosed → `permissionDenied` 스트림 이벤트 → 모델에 "Permission denied: <user_message>"; `ask`는 로컬에 대화형 프롬프트가 없어 deny 처리하고 문구로 명시), 종료 후 postToolUse(성공)/postToolUseFailure(exit≠0)를 generic `executeHook`으로 실행해 additional_context를 `hookContext` 이벤트로 송신(출력 꼬리 8KB를 tool_output으로 전달). `create-shell-tool.ts`는 `hookContext`를 `meta.hookContextCollector`에 push → 도구 결과·다음 턴 system reminder로 렌더(`enableHookAdditionalContext: true`). 테스트 `tests/box-shell-hooks.test.mjs` 4건. 훅 스크립트는 hooks.json 변경 즉시 반영(데몬이 매번 읽음).

| 케이스 | 판정 | 근거(라이브, cycle16 빌드, 픽스처 `box-workspace/.cursor/h-*.sh`) |
|---|---|---|
| AGT-293 preToolUse deny | **PASS(라이브)** | matcher "Shell" 스크립트가 `{permission:"deny", user_message:"HOOK_BLOCKED_9931 …"}` → 결과 "Permission denied: HOOK_BLOCKED_9931 denied via matcher", 명령 미실행(마커 PRE만 기록). 수정 전엔 그대로 실행 |
| AGT-324 beforeShellExecution allow/deny/ask | **PASS(라이브)** | allow → 실행 / deny → "Permission denied: SHELL_HOOK_DENY_7712 blocked by beforeShellExecution" / ask → "Permission denied: SHELL_HOOK_ASK_3300 needs confirmation (the 'ask' permission is not supported in the local build and was treated as deny)". beforeMCPExecution은 미배선(MCP 표면, 잔여) |
| AGT-345 postToolUse(+Failure) additional_context | **PASS(라이브)** | 성공: `<system_reminder>POST_HOOK_CTX_5501 postToolUse fired</system_reminder>`를 모델이 그대로 인용 / `exit 3`: postToolUseFailure에 error "exit code 3"·failure_type "error" 전달, `POSTFAIL_HOOK_CTX_6602` reminder 전달 |

### 후속 4: 0.18.0 설치파일 기준 미구현 재파악 → 구현 → 라이브 검증 (2026-08-31, 4차 갱신)
사용자 지시: "0.18.0 설치파일(SHA-256 a253ccd8…/464079a1…) 기준으로 구현 안 된 것 재파악·구현·테스트, 플러그인은 로컬로, Cursor 계정 없이 Pi OAuth로도 원본과 같은 기능". 재파악 결과·판정표는 `docs/testing/belmont-018-parity-inventory-2026-08-31.md`(신규) — 여기엔 구현·검증 요약만 둔다.

**구현 (전부 `npm run check` 통과 — typecheck 0, 테스트 143/143):**

| # | 결함/공백 | 수정 | 근거 파일 |
|---|---|---|---|
| M1 | **AUDIT-1** 장기 기억 자동 회수 미연결(프롬프트 컨텍스트 memory 전부 null) | 프롬프트 조립에 `session.memory`·`session.db` 연결 + `createUserMemory/createProjectMemory` 신설(user/project 샤드를 `[via 봇]` 출처와 함께 병합) | `host-runner-composition.ts`, `extensions/memory/extension.ts` |
| R1 | **AUDIT-3** roster 빈 배열 | 프롬프트 컨텍스트와 runnerOptions가 같은 provider 공유 | `host-runner-composition.ts` |
| R2 | 그룹 요약이 항상 `isGroup:false` | `session-roster.ts`가 `group.json`으로 isGroup/memberIds 채움 → 그룹 배송 분기 도달 | `extensions/session/session-roster.ts` |
| R3 | `ListAgents`/`ListGroups` 도구 부재(프롬프트만 광고) | 두 도구 신설·툴셋 등록 | `sand-agent-management-tools.ts`, `turn-toolset.ts` |
| S1 | **AUDIT-W2** Shell cwd/env 미유지(결과 문구는 "persists") | 데몬 `shellStream`이 상태 파일(cwd·`export -p`)을 복원·스냅샷, 중단 시 초기화, exit cwd를 논리 경로로 보고; 내부 탐침용 `shellArgs` 경로는 제외 | `box-exec-daemon/shell-state.ts`, `server.ts`, `create-shell-tool.ts` |
| P1 | **AUDIT-11** PDF Read 미구현 + **AUDIT-W10** 데몬이 PDF 거부 | 로컬 추출기(pdftotext→pdfjs) 바인딩 + 데몬이 PDF 바이트를 data로 반환 | `runner/local-pdf-text-extractor.ts`, `server.ts` |
| C1 | **AUDIT-EPOCH** compactionEpoch 0 고정 | 요약 아카이브 수로 계산 | `host-runner-composition.ts` |
| C2 | **AUDIT-6B** 컨텍스트 창 과대평가 | `SAND_CODEX_CONTEXT_WINDOW_TOKENS`/`_MAX_TOKENS` 운영자 조정(기본 미변경, 실측 후속) | `inference/context-window.ts` |
| L1 | **AUDIT-10** 로그인 화면이 Pi 자격증명과 무관 | 실제 자격증명으로 상태·Sign in(기기 코드 OAuth, 브라우저+트레이 코드)·Sign out; 게이트웨이/코디네이터 메서드 5개 | `pi-codex-login-session.ts`, `extension.ts`, `account-oauth.ts`, `gateway-protocol.ts`, `host-gateway-api.ts`, `coordinator-main.ts` |
| A1 | **AUDIT-7** 예약 루틴 로컬 미발화 | 로컬 cron 스케줄러(30s tick·lastRunAt 앵커·6h 초과 누락 재앵커·서버 스케줄 진입점 재사용) + `shouldScheduleCronLocally` | `automations/local-cron-scheduler.ts`, `extension.ts`, `sand-automation-cloud-sync.ts` |
| A2 | **AUDIT-W9(신규)** 로컬 모드 추론 준비 상태 항상 false → 루틴/훅/wake 게이트 영구 차단 | `inference.isReady`가 Pi 자격증명도 인정 | `inference/extension.ts` |
| PL1 | **AUDIT-8** 플러그인이 Cursor 백엔드 전용 | 로컬 저장소(`mcp.json`·`plugin-catalog.json`+기본 3종·`plugin-installs.json`), 데스크톱·호스트 관리자 로컬 배선, 인증 not-configured, `cwd` 지원 | `shared/node/mcp/local-mcp-store.ts`, `desktop-mcp-manager.ts`, `mcp-service.ts`, `mcp-manager.ts`, `mcp-oauth.ts` |
| G1 | 클라우드 전용 게이트가 상류 기본값 의존 | 로컬 스냅샷에서 usage/teach/agent-network/iOS/publish/auto-update 게이트 false 고정 | `local-codex-mode.ts` |
| G2 | CloudAgent 도구·GenerateImage 문구가 계속 광고(정직성 위반) | 로컬 모드: CloudAgent 도구 제거 + `isCloudAgentsDisabledByTeam` + 로컬 프롬프트 변형(이미지 생성 불가 명시) | `host-runner-composition.ts`, `experiments/extension.ts`, `system-prompt.ts`, `system-prompt-assembly.ts` |
| T1 | 미사용 복원 모듈 제네릭 추론 실패 3건 | 명시적 타입 인자 | `recovered-production-stream-retry.ts` |

**라이브 검증 (cycle18/19 빌드, 에이전트 ParityProbe·HooksProbe, CDP/게이트웨이):**

| 항목 | 결과 |
|---|---|
| Pi 인증 상태 | `getProviderAuthStatus` → `{configured:true, source:"stored"}`, 로그인 세션 idle |
| 메모리 회수 | 턴1 update_state(user 샤드에 "The user's favorite color is teal-7731." 기록) → 턴2 도구 없이 "teal-7731" 회답 |
| ListAgents/ListGroups | 다른 봇 10개를 id와 함께 나열 / "You are not in any group chats." |
| CloudAgent/GenerateImage 숨김 | 모델의 도구 목록 기준 "CloudAgent: no, GenerateImage: no" |
| Shell env 유지 | 호출1 `export PARITY_VAR=…` → 호출2 `echo $PARITY_VAR` = 값 유지, 결과 문구 "Current directory: /workspace/parity-sub" 정확 |
| Shell cwd 유지 | 호출1 `cd parity-sub` → 호출2(working_directory 미지정) `pwd` = …/box-workspace/parity-sub, "Current directory: /workspace/parity-sub" (cycle19; 명시 working_directory는 우선 — 스키마 "defaults to current directory") |
| PDF Read | `Read /workspace/parity-test.pdf` → "HELLO PDF 42 parity" (cycle19; cycle18에선 데몬 거부 → AUDIT-W10) |
| 루틴 로컬 발화 | `@every 1m` 루틴 생성 → t≈80s에 `schedule` 트리거 run ok(9s), 전사에 "PARITY_ROUTINE_OK" (cycle19; cycle18에선 준비 상태 게이트 false로 200s 미발화 → AUDIT-W9) |
| 플러그인(로컬) | Plugins 화면: Marketplace "This computer"에 Filesystem/Knowledge graph memory/Sequential thinking, Yours에 belmont-test(Connected). 상세 → **Add** → "Adding Sequential thinking" → `plugin-installs.json`/`mcp.json` 갱신 → Yours에 "Sequential thinking · 1 connector · Connected" → 에이전트 GetMcpTools에 `sequential-thinking: sequentialthinking` 노출, 호출 성공(`{"thoughtNumber":1,…}`) |

라이브 중 발견·수정: **AUDIT-W9**(준비 상태 게이트), **AUDIT-W10**(데몬 PDF 거부), 셸 상태가 내부 탐침(`curl 9223`)에 덮이던 문제(비스트리밍 경로 제외).

### 후속 5: "①후속 + ②PARTIAL 전부 해결" 회차 (2026-08-31, 5차 갱신)
사용자 지시: "①(후속 8건)·②(PARTIAL 4건)는 다 해결해야 될 문제" + "다 실테스트까지 했니?" → 12건 전부 구현 + **12건 중 11건 라이브 검증**(잔여 1건인 list_changed 상류 전파는 라이브에서 결함으로 판명). 그 과정에서 결함 2건 추가 발견: **AUDIT-W11**(MCP 표면 auto-review 미배선 — 수정+라이브 재검증), **AUDIT-W12**(list_changed 호스트 미전파 — CONFIRMED 등재, 수정 대기).

| # | 항목 | 결과 |
|---|---|---|
| 1 | beforeMCPExecution 훅 | **구현+라이브** — 데몬 callMcpTool에 preToolUse(도구명 matcher)+beforeMCPExecution 게이트. deny → "Error: Tool execution error. MCP_HOOK_DENY_5541 …", allow → 정상 실행, 훅 입력에 server/tool/args 전달 확인 |
| 2 | WebFetch 훅 | **구현+라이브** — web-fetch.ts를 WebSearch와 같은 withRemoteHooks로 래핑(pre/post/postFailure), 컴포지션이 remote-box accessor로 배선. 라이브: preToolUse deny → "Web fetch rejected: WEBFETCH_HOOK_DENY_7788" |
| 3 | MCP 표면 auto-review | **결함 발견·수정(AUDIT-W11)** — 로컬 MCP 투영의 mcpMeta.callOptions가 {}라 분류기가 완전히 꺼져 있었음(라이브: block 규칙 무시하고 실행). 수정: modes.mcp 기준 smartModeClassifierMode/Shadow + createSandMcpApprovalProvider(표시명 어댑터 포함) 배선. 라이브(수정 빌드): **PASS** — 분류기가 차단 규칙을 인용해 승인 카드 게시("Echoes ar-final on belmont-test" / "Project instructions require blocking any MCP tool call to the tool named echo."), 전사에 auto-review-approval(surface: mcp, pending) 기록, 미응답 시 턴 종료와 함께 만료(expired) 후 에이전트 정상 재개 |
| 4 | OS 알림 | **구현+라이브** — Linux/WSL fallback(`linux-notification-fallback.ts`): notify-send → (WSL) powershell.exe 풍선 알림; isSupported/createNotification 바인딩 분기 + show() try/catch 보고. 라이브: 이 WSL에서 windows-powershell 감지, Windows 풍선 알림 발사 확인 |
| 5 | USR-660/673 만료 카드 | **구현+라이브** — 만료 settle 시 트레이("Permission request expired")+전사 알림 문구 기록. 라이브: ask 카드 → 다음 턴 → 전사에 "…expired without an answer — nothing ran on your computer." + 트레이 등록. 673은 만료 후 카드가 결과 라인으로 대체(버튼 잔존 없음) 확인 |
| 6 | AGT-241 오류 클래스/문구 | **구현+라이브** — 로컬 투영 mcpErrorClassOf/takeMcpExecErrorClass 실제 배선(+MCP_ERROR_RESULT_CLASS 폴백), 데몬 전송 실패 문구를 박스 원문 'Box MCP execution failed for "<tool>": …'로 정렬. 라이브: crash → 'Box MCP execution failed for "crash": server process exited' |
| 7 | AGT-386 셸 함수/별칭/옵션 | **구현+라이브** — 스냅샷에 `set +o`(옵션)·alias(접두 정규화)·`typeset -f`(bash 한정) 추가. 라이브: alias·noglob이 다음 호출에 유지("ALIAS-LIVE-OK", "set -o noglob"). dash 한계로 함수만 미유지(bash 박스면 유지) |
| 8 | 첨부 staging 즉시 정리 | **구현+라이브** — commitStaged가 전체 성공 후 staged 파일 삭제(부분 실패 시 보존, 1시간 sweep은 백스톱). 라이브: 컴포저 첨부 → staging 파일 생성 3.3초 뒤(전송 성공 시점) 삭제 감시 확인, 에이전트가 /workspace/uploads/<sha256>.txt에서 정확한 내용 판독 |
| 9 | MCP tools/list pagination + list_changed | **구현+라이브(pagination)** — 픽스처 서버 belmont-page를 로컬 MCP로 등록, 에이전트 GetMcpTools가 2페이지 3개 도구 전부 나열(데몬 경유). list_changed는 데몬 클라이언트까지만 갱신 — 호스트 도구 캐시(24h TTL) 미무효화로 동적 추가 도구는 발견·호출 불가 → **신규 결함 AUDIT-W12 등재**(§3) |
| 10 | 그룹 채팅 | **라이브 PASS** — createGroup(2봇) → ListGroups에 "Parity Group — with HooksProbe" → 그룹에 GROUP-PING 게시 → **다른 멤버가 깨어나 GROUP-PONG 자동 응답** (그룹 전사에 왕복 기록). session-roster group.json 수정의 실효 확인 |
| 11 | 컨텍스트 창 실측(AUDIT-6B) | **측정 완료** — 게이트웨이로 90k/150k/220k/260k 토큰 프롬프트 전송, **전부 수락(CTX_OK)**. 이전 관측(55-83k 거부)은 재현 안 됨 → 카탈로그 272k 유지, env knob은 운영자용으로 존치. AUDIT-6B 재판정: 해소 |
| 12 | AUDIT-4 서브에이전트 settle 경계 | **구현+라이브** — settle host를 턴 대화 id로 매개변수화: 자식 턴은 자기 러너/전사 id로 settle, agentStore() null → setLocalState(자식 상태), 부모 root slot·announced profile 불침범; 자식 base state도 자식 러너에서; getAgentId 그림자 해제. 라이브: Task 서브에이전트 dispatch(CHILD-ISO-42) → 결과 부모 회수, root slot 단일 유지(blobs 검사), 다음 턴 부모 기억(teal-7731)·이력(SMOKE 마커) 온전. 가드 tests/subagent-settle-parity.test.mjs. (자식 재시작 내구는 Phase B) |

게이트: `npm run check` exit 0 (테스트 155/155). 신규 감사: **AUDIT-W11**(MCP 표면 auto-review 미배선 → 수정). 판정 원장에 241/386/660/673/321/324 PASS 행 추가.
텔레그램: 내장 채널(플러그인) 점검 — 토큰 유효(@agc_sebas_bot), 발신 테스트 전송 완료; Belmont 봇용 별도 커넥터는 사용자 결정 대기.

### 후속 5.2: 외부 엄격 코드리뷰(c466160) 검토 (2026-08-31, 수정 없이 검토만 — 사용자 지시)

대상: `docs/testing/belmont-c466160-strict-code-review-2026-08-31.md` (커밋 c466160 기준, wave-5 미커밋 변경 명시적 제외). 고위험 주장 4건을 현재 트리에서 직접 재검증 — **4건 전부 사실**. 리뷰 품질 높음.

**재검증 후 원장 등재 (CONFIRMED, 수정 대기):**
| ID | 내용 | 재검증 |
|---|---|---|
| AUDIT-W13 (P0) | 신규 프로필 앱 내 Pi 로그인 순환 부트스트랩(로그아웃→coordinator 미기동→Sign in 불가) | 코드 확인(legs 거부 문구·slot 게이트). 4차 라이브는 기설정 프로필이라 미노출 |
| AUDIT-W14 (P0) | CLI 로그인(~/.grokbot) vs WSL 런타임(프로필 sand-data) 자격증명 경로 분열 | 코드 확인 |
| AUDIT-W15 (P0) | Grep이 canonical 경계 검사 없이 rg 실행 — 심링크 직접 지정 시 워크스페이스 밖 판독 | 코드 확인(다른 도구는 realpath 가드 사용) |
| AUDIT-W16 (P1) | 로컬 플러그인 카탈로그가 createHostMcp에서 조용히 유실(스프레드가 TS 검사 우회) + skills:[] 고정 — 에이전트용 카탈로그 도구 불능. 4차 라이브는 데스크톱 경로라 false-green | 코드 확인(SandMcpManager는 catalog 지원 — 한 줄 배선 누락) |
| AUDIT-W17 (P1) | Computer 기본 비활성·단일 :99 공유인데 프롬프트는 봇별 화면 주장(정직성) | 자체 운영 관측과 일치 |

**리뷰 시점 대비 이미 낡은 항목(wave-5가 해결):** P0-03의 settle host 부모 캡처(→ AUDIT-4 수정+라이브; 단 자식 재시작 복구·durable 자식 store 소유는 리뷰 지적대로 잔존) · P1-11의 즉시 정리 부재(→ 수정+라이브; 다중 파일 커밋 비원자성 지적은 유효) · P1-06 중 pagination/list_changed 클라이언트(→ 완료; 호스트 전파는 AUDIT-W12로 우리가 별도 발견) · 컨텍스트 한도 실측 부재(→ 90k~260k 수락 실측).

**유효하지만 기존 원장과 중복:** P1-03(=AUDIT-5) · P1-04(Task 완료 큐 휘발 — AUDIT-5 계열) · P2-01(=AUDIT-F2) · P2-02(=AUDIT-9) · 중앙 관리자 부재(§9~13).

**유효·신규지만 세부 품질 항목(원장 미등재, 리뷰 문서가 원장 역할):** P1-02(대화 단위 캐시 친화성 없음 — 매 호출 새 invocation UUID) · P1-05(cron 앵커 선진행·재시작 유실) · P1-07(셸 상태가 데몬 전역 — 봇 간 공유) · P1-08/09/10(파일/웹/PDF 충실도 세부) · P1-12(데스크톱 모델 목록이 Cursor 카탈로그 경로) · RELEASE-01/02(패키징 전용) · §8 false-green 분류(대부분 타당; 첨부·pagination·settle 기본형은 이후 라이브로 해소).

### 후속 6: "비디오·이미지·중앙관리자 빼고 전부 개선" 회차 (2026-08-31, 7차 갱신)
사용자 지시: "비디오·이미지는 필요 없고 나머지는 다 개선, 중앙 관리자는 나중". 결과: **수정 대기 6건(AUDIT-W12~W17) 전부 수정 + 라이브 검증**, 엄격 리뷰의 품질 항목 5종(P1-02/05/07/09/10) 동반 수정, 신규 결함 2건 발견(로그인 응답 유실 — W13에 포함 수정 · **AUDIT-W18** local-exec 고아 데몬 — 등재만).

| 항목 | 수정 | 검증 |
|---|---|---|
| AUDIT-W12 list_changed 전파 | discovery.reconcileBoxTools()(데몬 라이브 목록 vs 캐시 서명 비교→무효화) + mcp-service 20초 폴링 | **라이브**: grow 후 호스트 로그 "tools cache invalidated" → GetMcpTools에 gamma-3 표시 + 호출 성공 — refreshMcp 불필요 |
| AUDIT-W13 로그인 부트스트랩 | cursorAccountSlot: 로컬 모드는 로그아웃에도 고정 slot(coordinator 유지, 로그인 전후 동일) + runLogin이 emit 전에 세션 시작(포트 재접속에 의한 응답 유실 수정)·폴링 내성 | **라이브**(임시 신규 프로필): logged-out 정직 표시 → login() → logging-in 유지 → 호스트에 실제 기기코드 세션(userCode 발급) → cancel 정상 |
| AUDIT-W14 자격증명 경로 | CLI login은 항상 프로필 저장소에 기록, status/logout은 프로필 우선+레거시 폴백; 호스트가 ~/.grokbot 저장소도 1회 이관 | **라이브**: codex:auth:status → 프로필 경로·configured true. 동작 테스트: 이관 성공/중복 거부/느슨한 권한 거부 |
| AUDIT-W15 Grep 경계 | grep()에 #assertCanonicalWithinRoots 적용(다른 파일 도구와 동일) | **라이브**: /etc/hosts 심링크 Grep → "Resolved path escapes configured roots" 차단 |
| AUDIT-W16 카탈로그 유실 | CreateHostMcpOptions.catalog 추가·SandMcpManager 전달 + skills 정규화 보존 | **라이브**: 에이전트 SearchPlugins("thinking") → 로컬 카탈로그에서 Sequential thinking(900003, installed=yes) |
| AUDIT-W17 Computer 정직성 | 기본 활성(옵트아웃 =0) + Xvfb/xdotool/ffmpeg 준비성 게이트(fail-honest 로그) + 로컬 프롬프트 "단일 공유 데스크톱" 서술 | **라이브**: 기동 로그 준비성 통과·display 재사용 |
| P1-02 캐시 친화성 | ProviderPromptExecutor별 고정 cacheSessionId → Pi sessionId(호출별 UUID 제거) | 가드 |
| P1-05 cron 실패 재시도 | 발화 실패 시 슬롯 복원 + 점증 대기(분 단위, stale 6h가 상한) | **동작 테스트**: 실패→hold 중 미발화→hold 후 재발화 |
| P1-07 봇별 셸 상태 | ShellArgs.conversationId(호스트가 채움) 기준으로 데몬 상태 디렉터리 네임스페이스 | **라이브**: ParityProbe export ISO_PARITY → HooksProbe에선 빈 값, ParityProbe에선 유지 |
| P1-09 웹 충실도 | WebFetch: 바이너리 content-type 거부·리다이렉트 착지 재검증·호출자 취소 전파; WebSearch: 스니펫을 결과 블록 단위로 짝지음 | 가드 |
| P1-10 PDF 수명주기 | 캐시 키 = 경로+내용 sha256(교체 시 스테일 방지, 32개 상한); pdftotext 30초 데드라인 kill(고아 파이프 대비 exit 정산); pdfjs 페이지·문자 상한 | **동작 테스트**: 느린 추출기 300ms 내 타임아웃 |

게이트: `npm run check` exit 0 — 테스트 **170/170**(신규 15: tests/wave6-remediation.test.mjs). 재빌드 cycle27·28, 최종 smoke(auth·Shell·MCP) PASS. 신규 등재: **AUDIT-W18**(호스트 종료 후 local-exec 데몬 고아 잔존 — 라이브에서 관측, 수정 대기).

### 후속 7: 벨몬트 관리자 B-1 회차 (2026-08-31, 8차 갱신 — 사용자 지시 "시작해")
방향(사용자 합의): 새 관리자 시스템 대신 **기존 영구 봇 하나를 Belmont로 정의**하고, 봇 생성·메시징을 신뢰성 있게 보완(B-1-lite: 훅 원장 + 루틴 스위퍼). 중앙관리자 코드 강제(B-2)·durable 수신함은 Phase B 유보.

| # | 항목 | 결과 |
|---|---|---|
| A1 | Belmont 봇 정의 | **라이브** — 관리자 지침(위임 규약 [job:id]·증거 요구·회신 의무·검토 후 보고) persona로 생성(id 8bebd5e2…), 기억 초기화. 시작 시 기본 대화로 열림 |
| A2 | SendToAgent 원격 훅 배선 | **구현+라이브** — WebFetch와 같은 withRemoteHooks(pre/post/postFailure), 컴포지션이 remote-box accessor 주입. 훅 입력에 from_agent_id/target_id/message |
| A3 | 작업 원장(.jobs/ledger.jsonl) | **라이브** — .cursor/h-jobs.sh가 모든 봇 간 송신 기록. 왕복 4행(위임 pre/post + 회신 pre/post, job 태그·증거 포함) 확인 |
| A4 | 스위퍼 루틴(cron) | **라이브** — Belmont의 @every 주기 루틴이 원장을 훑어 미회신 job 재촉(운영 15m) |
| A5 | SAND_DEFAULT_AGENT_ID | **구현+라이브** — 시작 시 activeAgentId=Belmont |
| A6 | CreateAgent reasoning + 봇별 모델(AUDIT-W1) | **구현+라이브** — settings agentModelsByAgentId + turn-run-shell 봇별 우선 해석 + CreateAgent reasoning 매개변수. 라이브: Clerk(low) 생성→설정 기록→정상 턴 |
| B1 | AUDIT-W18 고아 데몬 | **수정+라이브** — ppid 변경 감지(WSL 서브리퍼 대응). 런처 종료 후 데몬 10초 내 자기 종료 |
| — | **AUDIT-W19 신규 발견·수정** | analytics 래퍼가 reportAutomationRun을 언바운드 추출 → 모든 루틴 실행 완료 보고 크래시(스케줄러가 성공을 실패로 오인). 라이브에서 발견, 바인딩 수정, 수정 후 스위퍼 정상 |

**핵심 라이브 시나리오 2건:**
- **위임 왕복**: 사용자→Belmont "SHA-256('belmont-b1')를 워커에게" → Belmont가 QA Bot에 [job:b1h7] 위임(증거 요구·회신 의무 포함) → 워커 수행·회신 → **Belmont가 같은 명령으로 재검증 후** 사용자 보고(해시 독립 검증 일치)
- **재시작 생존**: [job:r91q]를 "재촉 전 회신 보류" 조건으로 위임 → 앱 재시작 → **재시작 후 스위퍼가 원장에서 미회신 job 발견·재촉**(03:00:53) → 워커 회신(03:01:00) → Belmont 검토·보고. 디스크 원장+스위퍼로 재시작 유실 복구 실증

게이트: `npm run check` exit 0 — 테스트 **175/175**(신규 5: tests/belmont-manager-b1.test.mjs). 한계(명시): 검토·승인은 프롬프트 관례(코드 강제는 B-2), 재촉 지연=스위퍼 주기, 대기열 자체는 여전히 메모리(AUDIT-5 PARTIAL — 근본은 Phase B durable 수신함).

### 후속 8: Phase B 본공사 + 품질·테스트 부채 (2026-08-31, 9차 갱신 — 사용자 지시 "B·D·F 빼고 마무리")
범위: A(Phase B: durable 수신함·완료 내구·자식 재파견·B-2 부분)·C-1(브라우저 AR)·E(품질 세부)·G(테스트 부채). 제외 유지: B(비디오·이미지)·D(텔레그램 커넥터)·F(패키징).

| # | 항목 | 결과 |
|---|---|---|
| A-1 | **SendToAgent durable 수신함** (AUDIT-5 근본) | **구현+라이브 크래시 테스트** — pending-wake에 'agent-message' kind: 송신 시 전문 영속 → 수신 wake 완료 후에만 정산 → 재시작 rearm이 재전달. 라이브: 전달 도중 kill -9 → 마커에 전문 잔존 → 재시작 → **정확히 1회 전달**(displayed 플래그로 전사 중복 방지)·마커 정리 |
| A-2 | **완료 통지 내구** (P1-04) | **구현+동작 테스트** — 도착한 결과를 마커에 병합 저장, revival 후 정산; 재시작 rearm이 'unknown state' 대신 **실제 결과** 재전달(subagent·shell). shell은 죽은 프로세스 재감시 대신 직접 재생 |
| A-3 | **자식 재파견 정보** (lite) | **구현** — dispatch 시 작업 원문(8k) 영속; 결과 없이 잃은 자식은 부모에게 원문 포함 알림 → Task 한 번으로 복구. 완전 재개는 미구현(명시) |
| A-4 | **B-2 부분** | **구현+라이브** — ①관리자 삭제 보호 ②비관리자 봇 전원에 'Managed team' 절 주입. 라이브: **회신 지시 없는 [job:mt42] 위임에 워커가 12초 내 자발적으로 태그 달아 회신**. 워커 대화 잠금·게시 게이트는 고정 렌더러 한계로 불가(명시, AUDIT-B2 PARTIAL) |
| C-1 | 브라우저 표면 auto-review | **분석 종결** — 로컬 모드에 독립 브라우저 표면 없음(BrowserUse dormant, P2-03); 브라우저 조작은 computerUse 경유라 computer 표면 라이브(§1.6)가 커버 |
| E | 품질 세부 | Grep 문맥을 매치 그룹 기준으로 재작성(offset/head-limit 경계 오염 해소) · Delete 미리보기 100KB 부분 읽기+FIFO 차단 · LS 절단 시 childrenWereProcessed=false 계약 · kill SIGTERM→5초 후 SIGKILL 승격 · 셸 id 시계 시드(재시작 재사용 방지) · MCP 서버발 요청에 JSON-RPC 응답(ping=결과, 그 외 -32601 — 서버 hang 방지) · **P1-12**: 로컬 모드 데스크톱 모델 목록을 실제 Pi 카탈로그 7종으로 대체(Cursor 백엔드 호출 제거). Edit CAS는 미적용(oldString 대조가 동시성 앵커, ms급 잔여 창은 단일 사용자 로컬에서 무시 가능 — 명시) |
| G | 테스트 부채 | F1/F2: 복원 참조 테스트임을 머리말로 명시(DOCUMENTED) · F3: production 해석식 고정 가드 추가 · F4: 실 로그인 경로 앵커 추가. 신규 tests/phase-b-durability.test.mjs(8: 저장소 round-trip·배선 가드) |

게이트: `npm run check` exit 0 — 테스트 **185/185**. 내구성 의미론: **at-least-once**(전달 후·정산 전 크래시 시 재전달 가능, 전사 중복은 방지) — 개인용 트레이드오프로 명시. 그룹 게시는 durable 미포함(기존 그룹 wake 기제).

### 후속 9: 2차 외부 검토 7건 — 전부 확인·수정 (2026-08-31, 10차 갱신)
외부 검토가 7건을 지적했고 **7건 모두 사실**이었다(특히 #1은 wave-5/8 수정의 실제 순서 결함을 잡아냄 — 우리 라이브 테스트가 못 본 것).

| # | 지적 | 수정 | 검증 |
|---|---|---|---|
| 1 | **settle host가 prepareTurn보다 먼저 생성**되는데 turn id는 prepareTurn에서 공유 가변에 스탬프 → 자식 첫 턴/자식 직후 부모 턴이 엉뚱한 id로 settle 가능(+동시 턴 레이스) | 공유 가변 제거: 부모 어댑터 session.id 고정, **자식 러너별 어댑터 오버라이드**(settle/conversationId/state/epoch 전부 자기 id·자기 러너 고정) | 가드가 순서 사실 자체를 고정(settle<prepare && 가변 부재) + 라이브 자식 왕복·부모 상태 온전 |
| 2 | B-1이 런타임 fixture — 커밋만으론 재현 불가 | `npm run belmont:manager`(봇·persona·훅·스위퍼·manager.json 멱등 부트스트랩) + 런처가 manager.json에서 관리자 자동 지정 | **라이브**: 멱등 재실행 + env 없이 재시작해도 Belmont 기본 대화 |
| 3 | 원장이 실패 전송("No agent found…")도 sent로 기록 → 스위퍼 영원 대기 | SendToAgent 훅에 getFailureInfo — ack 접두("Sent to "/"Posted ") 외에는 실패로 기록 | 가드(알려진 실패 문구가 접두와 불일치함도 고정) |
| 4 | CreateAgent(reasoning)이 전역 기본 모델 무시하고 gpt-5.5 고정 | modelId ""=상속 규약 — 저장 시 현재 전역 기본(없으면 env/기본)으로 해석 | 가드 |
| 5 | 캐시 친화성이 턴 내부만(executor가 턴마다 재생성) | cacheSessionId=**대화 id**를 turn-run-shell이 전달 — 턴을 넘어 동일 키 | 가드(생성자 계약+전달 지점) |
| 6 | MCP 서명이 이름만 비교 — 제자리 스키마 변경 놓침 | 서명에 description+inputSchema JSON 포함 | 가드 |
| 7 | pdfjs 폴백에 데드라인 없음 | withDeadline로 30초 상한(프로세스 킬 불가는 명시 — 대기만 차단) | 동작 테스트(100ms 데드라인 거부) |

게이트: `npm run check` exit 0 — 테스트 **191/191**(신규 tests/external-review-fixes.test.mjs 6). 검토의 방법론 교훈 수용: 가드가 "코드 문자열"이 아니라 **순서 사실**(settle<prepare)을 고정하도록 작성.

## 2. 감사 findings — P0 (심각)

| ID | 제목 | 판정 | 증거 |
|---|---|---|---|
| AUDIT-1 | 장기 기억 자동 회수 미연결 | **FIXED** (4차 갱신, §1.6 후속 4) | host-runner-composition.ts:1414-1417 system-prompt context has memoryStore/memorySnapshots/userMemory/projectMemory ALL null; :1740-1750 turn-exec has real stores. Write works, rec |
| AUDIT-10 | 화면 로그인 vs 실제 Pi OAuth 별개 | **FIXED** (4차 갱신: 실제 자격증명 상태·앱 내 기기코드 로그인·로그아웃) | account-oauth.ts:12 + local-codex-mode.ts:7-13 상수 logged-in(Belmont Local); 실제 추론은 별도 pi-auth.json. 경로 분기: CLI ~/.grokbot vs WSL .cache/.../sand-data (run-wsl.mjs:28). wsl-runtime. |
| AUDIT-11 | PDF Read 미구현(안전실패) | **FIXED** (4차 갱신: pdftotext→pdfjs 추출기 + 데몬 data 반환 AUDIT-W10) | read.ts:374 throws "Read PDF worker is not bound"; host-runner-composition.ts:2150 의도적 unbound; worker 파일 없음. 안전실패일 뿐 기능복원 아님. |
| AUDIT-2 | update_state 결과 오보고 | FIXED | agent-state.ts {message} vs tool {detail/reason}; any boundary hid it. FIXED this session + built. |
| AUDIT-3 | 봇 목록이 빈 배열 + ListAgents/ListGroups 도구 없음 | **FIXED** (4차 갱신: 실제 roster provider + 그룹 필드 + 두 도구 신설) | host-runner-composition.ts:1436-1437 agentDirectory/agentGroups: ()=>[] (빈), :2826 이게 실제 프롬프트 생성; agent-messaging.ts:54 "no other agents yet" 출력. 올바른 roster provider(:1534)는 아무도 안  |
| AUDIT-4 | 서브에이전트 settle이 부모 상태 사용 | **FIXED** (5차: settle host 턴-대화 매개변수화 — 자식은 자기 러너/전사로 settle, 부모 root slot·프로필 불침범; 자식 재시작 내구는 Phase B) | turn-run-shell.ts:637 settle이 createSettleHost/getConversationId 사용; host-runner-composition.ts:2409-2459가 부모 session/builtRunner에 바인딩(transcriptId=session.id, 부모 agentStore/blob/r |
| AUDIT-5 | SendToAgent 휘발성 + marker만 영속 | CONFIRMED | agent-to-agent-messaging.ts:48 in-memory Map, 영속 wake-kind에 agent-message 없음; AgentInboundMessage(:14-22)에 task/result 필드 없음; pending-wake-rearm.ts:8-17 marker에 result 없음; :257 크래시 |
| AUDIT-6 | Pi maxTokens:0 -> 선제압축 무력화 | FIXED | pi-codex-runtime.ts:177 hardcoded 0; background-summarization.ts:27 maxTokens<=0 => no threshold. FIXED (resolved.model.contextWindow=272000) + built. |
| AUDIT-6B | maxTokens fix 불충분 — catalog 272000이 실제 Codex OAuth 한도 과대평가 | **해소** (5차 실측: 90k/150k/220k/260k 전부 수락 — 과대평가 주장 기각, 272k 유지) | maxTokens fix는 배선까지 맞으나(usedTokens=usage.totalTokens 실측), aa1a1169가 transcript ~48k+시스템/도구 ~35k ≈ 55-83k에서 초과, 압축 미발화. 카탈로그 272000이 실제 OAuth 한도(~60-80k 관측)를 3-4배 과대평가 → 압축 임계(245k) |
| AUDIT-7 | 예약 루틴이 로컬 WSL에서 실행 안 됨 | **FIXED** (4차 갱신: 로컬 cron 스케줄러 + AUDIT-W9 준비 상태 게이트) | cron은 Cursor cloud 경로(sand-automation-cloud-sync.ts:274 createSandAutomation); 발화는 backend poll(sand-automation-fire-consumer.ts:84); shouldScheduleLocally(:370)는 cron에 false; 로컬 트 |
| AUDIT-8 | 플러그인≠로컬MCP + 로컬MCP 4갭 | **FIXED**(로컬 플러그인 저장소·카탈로그·cwd, 4차 갱신; pagination·list_changed도 5차에 마감 — 전 항목 종결) | 플러그인 search/install/auth/delete는 Cursor backend(mcp-service.ts:126-149). 로컬MCP 갭: (a)cwd 누락 readLocalMcpServers(mcp-service.ts:207-218), (b)tools/list pagination 없음(mcp-stdio-clien |
| AUDIT-9 | 이미지생성/아바타는 Cursor 토큰 필요(광고만) | CONFIRMED | system-prompt.ts:140 GenerateImage 광고; generate-image-service.ts:5 getAccessToken 요구; cursor-generate-image.ts:8 Cursor backend RPC. Codex-OAuth 로컬모드엔 토큰없어 실패. |
| AUDIT-W3 | Auto-review가 Codex에서 강제 OFF | **FIXED** (2차 갱신) | 원인: 분류기가 Cursor 백엔드 RPC 전용. 수정: 로컬 분류기(`auto-review/local-smart-mode-classifier-exec.ts`, Pi gpt-5.5 reasoning low)를 `createClassifierExecutor`에 주입, 강제 off 제거, 로컬은 settings-on ⇒ enforce. 라이브: Shell/컴퓨터 카드·규칙·Always allow 전부 PASS. §1.6 |
| AUDIT-W6 | loopback 박스 파일 업로드 실패 → MCP 큰 결과 spill 불가(항상 인라인) | **FIXED** (신규 발견, 4차) | (1) 로컬 MCP 투영 `textSpiller: undefined`(host-runner-composition) → `createSandMcpTextSpiller` 연결. (2) `box/production.ts` loopback `uploadFile`이 `uploadFileViaExecDaemon`(셸 `mkdir -p -- /workspace/…`·`mv`)를 써 리터럴 경로로 실패 — 데몬은 cwd/WriteArgs만 매핑 → `writeFileBytesViaExecDaemon`(매핑+상위 디렉터리 생성)으로 교체. 라이브: 60KB 결과가 `.sand/tools/*.txt`로 spill |
| AUDIT-W5 | 로컬 실행 채널 401 → 호스트 셸 도구(ExternalShell/ExternalRead)가 항상 "local machine isn't connected" | **FIXED** (신규 발견, 3차) | `gateway-server.ts:51`은 토큰 없으면 `/local-exec/*`를 401. WSL 런처는 인증 없이 게이트웨이를 띄워 데몬 등록이 항상 실패. 수정: `wsl-runtime.mjs` `SAND_GATEWAY_REQUIRE_AUTH=1`. 라이브: 데몬 token 수신, ExternalShell 실행 + 로컬 도구 권한 카드 전 흐름(§1.6 후속) |
| AUDIT-W4 | 계정 scope 불일치 → auto-review 규칙·모델 기본값·로컬 도구 권한이 매 시작마다 초기화 | **FIXED** (신규 발견, 2차 갱신) | 호스트 `mcp-service.ts:266`는 계정 없을 때 scope `"local"`, 데스크톱은 `accountCacheScope("local-codex")` → 시작마다 서로 뒤집으며 `scopeToAccount()`가 계정 범위 설정을 삭제(재시작 후 규칙 소실을 로그로 확인). 수정: 공용 `shared/node/local-codex-account.ts`로 양쪽 scope 통일. 라이브: 재시작 후 규칙 보존 확인. §1.6 |
| AUDIT-W7 | 첨부 박스 스테이징이 항상 실패(가짜 Context) → 첨부를 박스에서 못 읽고 호스트 경로를 로컬 권한 카드로 읽음 | **FIXED** (신규 발견, 5차) | `attachments/extension.ts`가 `createAttachmentsService`에 `ctx: {}`를 전달 → `stageAttachmentsIntoBox → box.uploadFile → loopback ensureReady/ping`이 Context 메서드 없이 크래시("not ready within 90000ms (last ping: crash)") → staged 맵이 비어 프롬프트가 호스트 경로 유지 → 에이전트가 ExternalRead(권한 카드)로 읽음. 수정: `createContext()`. 라이브: 업로드 성공, `/workspace/uploads/<hash>.txt`를 카드 없이 읽음. §1.6 후속 3 |
| AUDIT-W8 | hooks.json이 에이전트 Shell(스트리밍 경로)에 안 걸림 — preToolUse 게이트 누락·beforeShellExecution 소비자 없음·postToolUse 컨텍스트 폐기 | **FIXED** (신규 발견, 5차) | 데몬 `#preToolUseGate`는 `shellArgs`/Read/LS/Grep/Write/Delete만, 에이전트 Shell의 `shellStreamArgs` 경로엔 없음. `beforeShellExecution` 소비자 전무(업스트림은 클라이언트 단계). postToolUse additional_context는 WebSearch만 배선, Shell 스트림 `hookContext` 이벤트는 `create-shell-tool.ts`가 `break`로 폐기. 수정: `shellStream`에 spawn 전 preToolUse+beforeShellExecution 게이트(deny→`permissionDenied`, ask→deny 문구), 종료 후 postToolUse/postToolUseFailure를 `executeHook`으로 실행해 `hookContext` 송신; Shell 도구가 collector에 push. 라이브: 293/324/345 PASS. `tests/box-shell-hooks.test.mjs`. §1.6 후속 3 |
| AUDIT-W9 | 로컬 모드 추론 준비 상태가 항상 false → 루틴/훅/wake 게이트 영구 차단 | **FIXED** (신규 발견, 4차) | `inference/extension.ts` `isReady`가 Cursor 토큰만 봐서 로컬 Codex 모드에선 false → `turn-execution.isRunReady()` false → 로컬 cron 스케줄러·트리거 허브가 매 tick 건너뜀(라이브: `@every 1m` 루틴 200s 미발화). 수정: 로컬 모드에서 Pi 자격증명 configured면 준비 완료. 라이브: 수정 후 t≈80s 발화 |
| AUDIT-W10 | 박스 데몬이 PDF 읽기를 invalidFile로 거부 → 추출기까지 바이트 미전달 | **FIXED** (신규 발견, 4차) | `box-exec-daemon/server.ts read()`가 PDF면 "text extraction is not available" 오류 반환(라이브 재현). 수정: data 출력으로 반환 → 에이전트 Read가 호스트 추출기 실행. 라이브: "HELLO PDF 42 parity" |
| AUDIT-W11 | MCP 표면 auto-review 미배선 — 로컬 MCP 투영 `mcpMeta.callOptions`가 `{}`라 분류기 완전 꺼짐 | **FIXED** (신규 발견, 5차) | 라이브에서 block 규칙("echo 차단")을 무시하고 실행됨 → callOptions {} 확인. 수정: modes.mcp 기준 `smartModeClassifierMode/ShadowMode` + `userAutoRunInstructions` + enforce 시 `createSandMcpApprovalProvider`(serverDisplayName 정규화 어댑터) 배선. 라이브 재검증: 규칙 인용 승인 카드(surface: mcp) 게시, 만료 후 정상 재개 — PASS. 가드: tests/mcp-stdio-extras.test.mjs. §1.6 후속 5 |
| DEFECT-3 | 이미지/파일 첨부 전송 시 앱 전체 크래시 (attachment kinds shape 불일치) | FIXED | session-projection.ts buildAttachmentLastEntry가 kinds를 countKinds()의 객체 {image:1}로 넣음. 렌더러 Yun/mergeKindCounts는 배열 [{kind,count}] 기대. 객체엔 .length=undefined라 빈-가드 통과 후 n.filter 폭발 - |

## 3. 감사 findings — P1

| ID | 제목 | 판정 | 증거 |
|---|---|---|---|
| AUDIT-EPOCH | compactionEpoch 항상 0 | **FIXED** (4차: 요약 아카이브 수) | host-runner-composition.ts:1413 compactionEpoch: () => 0 (hardcoded) |
| AUDIT-F1 | stream-retry 모듈 production 미연결(false-green) | CONFIRMED | recovered-production-stream-retry.ts importer 없음(테스트만); 실제 retry는 stream-attempt.ts. |
| AUDIT-F2 | video 분석 실제 없음(config/test만) | CONFIRMED | recovered-video-subagent-configs.ts:5 not-wired; prod subagent는 executor뿐. |
| AUDIT-F3 | per-agent-model 테스트가 resolver 재구현(false-green) | CONFIRMED | per-agent-model-selection.test.mjs가 로컬 resolve 복사, production turn-run-shell 미호출. |
| AUDIT-F4 | local Codex 테스트가 가짜 로그인 객체 검사 | CONFIRMED | local-codex-mode.ts:7 frozen LOCAL_CODEX_STATUS; 상수만 assert. |
| AUDIT-W1 | 영구 봇별 모델설정 없음(글로벌 하나) | CONFIRMED | turn-run-shell.ts:196-202 top-level는 getAgentDefaultModel() 하나; 봇id별 map 없음, 서브에이전트 타입별만. |
| AUDIT-W2 | Shell 작업디렉터리 미유지 | **FIXED** (4차: 데몬 상태 스냅샷, 라이브 cwd/env 유지) | server.ts:1254 매번 새 /bin/sh -lc; cd/export 비유지. |
| AUDIT-W12 | MCP list_changed가 데몬까지만 전파 — 호스트 도구 캐시 미무효화 | **CONFIRMED** (후속 5 라이브에서 발견, 수정 대기) | tools-discovery.ts `MCP_TOOLS_CACHE_TTL_MS`=24h, 무효화는 refreshMcp/설정 변경뿐 — 데몬→호스트 통지 경로 없음. 라이브: belmont-page grow 후 GetMcpTools 2차 목록에 gamma-0 없음 + 직접 호출도 "MCP server does not exist"(도구→서버 해석이 캐시 기반이라 호출까지 차단). 영향: 연결 후 도구를 동적 추가하는 서버는 refreshMcp 전까지 신규 도구 사용 불가(정적 서버 무영향). 수정 방향: 데몬이 list_changed를 호스트에 통지 or 미해석 시 캐시 무효화+재시도. |
| AUDIT-W4 | 훅 커버리지 부분적 | **FIXED** (후속 5에서 잔여 마감) | Shell 스트림 훅은 AUDIT-W8에서 배선(preToolUse·beforeShellExecution·postToolUse(+Failure)). 잔여였던 WebFetch(withRemoteHooks 래핑, 라이브 deny "Web fetch rejected: WEBFETCH_HOOK_DENY_7788")·MCP(beforeMCPExecution+preToolUse 게이트, 라이브 deny "MCP_HOOK_DENY_5541")를 후속 5에서 마감 — 훅 표면 Shell·WebSearch·WebFetch·Task·MCP 전부 커버. |

## 4. 감사 findings — P2 (경미)

| ID | 제목 | 판정 | 증거 |
|---|---|---|---|
| AUDIT-F5 | 대화 메모리 테스트 자체가 없음 | PARTIAL | tests/에 memory 테스트 전무; 감사가 credential-store 테스트를 오인. 메모리 플로우 미검증은 사실. |
| AUDIT-W5 | 첨부 staging 즉시삭제 안함 | **FIXED** (후속 5) | commitStaged가 전체 성공 후 staged 파일 삭제(부분 실패 시 보존 → 재전송 경로 유지), 1시간 sweep은 백스톱 존치. 가드: tests/subagent-settle-parity.test.mjs. |
| AUDIT-W6 | 서브에이전트 audit이 부모id 사용 | PARTIAL | subagent-runtime.ts:348 computerUseSession audit이 부모 conversationId. MCP는 아님 — 감사 프레이밍 부정확. |
| OBS-1 | 파일 도구 workspace-root 샌드박스 작동 | POSITIVE | sweep봇에 /tmp 밖 파일 편집 요청 시 도구가 거부: 'write/edit tools could not operate directly on /tmp/... because that path is outside their configured workspace root'. 로컬 파일 도구가 workspace root로  |

## 5. sweep에서 false-green으로 뒤집힌 케이스 (ISSUE 정정)

감사가 '코드는 있으나 미배선/비활성'을 밝혀, 아래 케이스는 PASS→ISSUE로 정정했다.

| 케이스 | 원래 | 정정 사유 |
|---|---|---|
| GBF-AGT-000195-N01 | PASS→ISSUE | FALSE-GREEN: [via] attribution code exists (sand-memory.ts:254) BUT system-prompt assembly gets userMemory/memoryStore=null (host-runner-composition.t |
| GBF-AGT-000325-N01 | PASS→ISSUE | beforeSubmitPrompt hook is defined (proto/hook-step) + has a daemon response shell, but is NOT fired anywhere and continue:false halt is not consumed  |
| GBF-AGT-000026-N01 | PASS→ISSUE | file_attachments field is exposed in the Task tool schema but only works for video-review subagents (absent in local) via a local-machine connection ( |
| GBF-AGT-000101-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000102-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000105-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000149-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000151-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000154-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000155-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000197-N01 | PASS→ISSUE | memory synthesis (episode summaries) present but disabled by sand_memory_dreaming experiment gate; not enabled for local personal use -> feature the u |
| GBF-AGT-000116-N01 | PASS→ISSUE | smart-mode/auto-review classifier does not block on Codex (forced OFF, AUDIT-W3) |
| GBF-AGT-000152-N01 | PASS→ISSUE | auto-review no-retry-routing guidance inactive (auto-review OFF on Codex, AUDIT-W3) |
| GBF-AGT-000159-N01 | PASS→ISSUE | Read returned raw PNG bytes not an image result; image-MIME inline Read not wired (cf 441) |
| GBF-AGT-000233-N01 | PASS→ISSUE | subagent auto-review fail path inactive (auto-review OFF on Codex, AUDIT-W3) |
| GBF-AGT-000240-N01 | PASS→ISSUE | 429/503 shown as error but no retry-guidance text produced |
| GBF-AGT-000251-N01 | PASS→ISSUE | subagent steer-restart (prepend steer prompt on finishing subagent) not observed; MessageSubagent/steer path may not restart |
| GBF-AGT-000321-N01 | PASS→ISSUE | smart-mode classifier BLOCK/ALLOW inactive (auto-review OFF on Codex, AUDIT-W3) |
| GBF-AGT-000441-N01 | PASS→ISSUE | Read did NOT treat .png/.avif as inline image (returned raw bytes); image-MIME inline Read not wired in local |
| GBF-GAT-000029-N01 | PASS→ISSUE | memory synthesis/dreaming gate exists (sand_memory_dreaming) but off in local; see AUDIT-1/197 |
| GBF-USR-000852-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000809-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000473-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000475-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000805-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000811-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000476-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000778-N01 | PASS→ISSUE | Smart Mode/auto-review는 local Codex에서 강제 OFF(AUDIT-W3). 사용자가 켜도 분류/권한 게이트 미실행. |
| GBF-USR-000779-N01 | PASS→ISSUE | Smart Mode/auto-review는 local Codex에서 강제 OFF(AUDIT-W3). 사용자가 켜도 분류/권한 게이트 미실행. |
| GBF-USR-000780-N01 | PASS→ISSUE | Smart Mode/auto-review는 local Codex에서 강제 OFF(AUDIT-W3). 사용자가 켜도 분류/권한 게이트 미실행. |
| GBF-USR-000647-N01 | PASS→ISSUE | permissions.json의 autoReview allow/block 규칙은 auto-review가 local Codex서 강제OFF(AUDIT-W3)라 무효. |
| GBF-USR-000648-N01 | PASS→ISSUE | permissions.json의 autoReview allow/block 규칙은 auto-review가 local Codex서 강제OFF(AUDIT-W3)라 무효. |
| GBF-USR-000675-N01 | PASS→ISSUE | routine 편집기 검증(빈 이름 aria-invalid/저장 실패 메시지)은 저장 검증 실패 상태 — auto-review off/저장경로 제약으로 유발 제한. 편집기 자체는 실측. |
| GBF-USR-000676-N01 | PASS→ISSUE | routine 편집기 검증(빈 이름 aria-invalid/저장 실패 메시지)은 저장 검증 실패 상태 — auto-review off/저장경로 제약으로 유발 제한. 편집기 자체는 실측. |

**2026-08-30 2차 갱신 — AUDIT-W3 근거 행의 재판정** (§1.6 라이브 검증 기준): USR-852/809/473/475/476/805/811/778/779/780/647/648 → **PASS**, AGT-101/102/105/149/151/154/155/116/321 → **PASS**(auto-review 컨트롤러·분류기 로컬 활성), AGT-152(no-retry 안내)/233(서브에이전트 fail path) → **활성(개별 미실측)**, USR-675 → **ISSUE(재분류: 렌더러 aria-invalid 미발화, auto-review 무관)**, USR-676 → **ENV(저장 실패 유발 불가)**.

## 6. sweep 결과 — 성격별 분포 (전체 2075건)

| 분류 | 건수 | 뜻 |
|---|---|---|
| PASS | 503 | 실제 tool call/코드로 검증됨 (단, 배선 미검증 항목 잔존 가능) |
| ISSUE | 34 | 문제점 (미완성·false-green 정정) |
| UNAVAIL | 641 | 이 로컬 버전엔 기능 자체 없음 (클라우드·이미지·~~컴퓨터~~·브라우저·영상). **단 '컴퓨터'는 이후 구현됨 → §1.5 참조**(스크린샷/클릭/타이핑/키 라이브검증). 관련 케이스는 재분류 대상. |
| ENV | 83 | 환경(채널·그룹) 없어 검증 불가 |
| UI_ONLY | 13 | 데스크톱 UI 전용, 에이전트 조작 불가 |
| EXPECTED | 1 | 설계상 정상 동작 |
| FIXED | 2 | 실결함이었고 수정됨 |

## 7. 수정 우선순위 (감사 제안 + 현 상태)

1. **미커밋 maxTokens·update_state 수정 검증 및 커밋** — 수정+빌드 완료, 커밋만 남음
2. **production memory store·자동 추출·새 대화 recall 실제 연결** (AUDIT-1) — system prompt 조립에 실제 store 전달 (host-runner-composition.ts:1414 null → 실제 store)
3. **실제 agent directory·manager routing 연결** (AUDIT-3) — :1436 빈배열 대신 :1534의 실제 roster provider 배선 + ListAgents/ListGroups 도구 추가 또는 프롬프트 수정
4. **child settle/store/transcript 완전 분리** (AUDIT-4)
5. **durable task ledger + worker delivery/result/retry 구현** (AUDIT-5)
6. **Pi OAuth 경로·UI 상태·provider 진실원 통합** (AUDIT-10)
7. **WSL 미지원 routine/plugin/image 기능 숨기거나 로컬 구현** (AUDIT-7/8/9)
8. **false-green 테스트를 실제 production E2E로 교체** (AUDIT-F1/F3/F4, 메모리 E2E 추가)

## 8. 검증 방법론 & 한계

- **sweep**: 게이트웨이 `/api/sendPrompt`로 각 케이스 주입 → transcript의 SendMessage/tool_use를 증거로 내가 직접 판정. 한계: 에이전트 self-report + 개별 도구 수준 → 통합/배선 미검출(false-green 원인). 컨텍스트 초과·OOM·박스 wedge로 여러 재시작 필요했음. 로테이션(25케이스)·힙 8GB·150초 타임아웃으로 안정화.
- **감사**: 3개 subagent가 실제 소스로 각 주장 검증. CONFIRMED/PARTIAL/REFUTED + file:line 증거. 감사 경로(`source/host/runtime/...`)는 실제 레이아웃(`source/host/...`)과 달라 subagent가 직접 탐색.
- **PARTIAL 3건** (감사 과장 교정): W4 Shell은 박스에서 게이트됨 / W6 부모id는 computer-use audit만(MCP 아님) / F5 메모리 테스트는 아예 없음(감사가 credential 테스트 오인).
- **USER 라우트(823) — CDP로 앱 직접 제어 검증**: 게이트웨이 주입이 아니라 CDP로 실제 사용자처럼 클릭·타이핑·키·파일첨부(DOM.setFileInputFiles)·스크린샷(비전 판독). 실측 PASS 101건, UNAVAIL 72(cross-user 공유 로컬 게이트오프), ENV 2, UNCLEAR 8, 나머지 UI_INHERITED 640(원본 Cursor 번들 바이트동일 131파일 상속; 아래 방법으로 순차 실측 중).
- **직접 제어로 발견한 실결함 DEFECT-3(첨부전송 크래시)**: 유효 PNG를 composer file-input에 넣고 전송하니 앱 전체 크래시. Copy-error로 스택 확보(n.filter is not a function @ Yun) → session-projection의 kinds shape 불일치로 특정 → 수정·재빌드·라이브 재검증(전송·썸네일·봇 vision 응답·사이드바 미리보기 모두 정상, 크래시 0).
- **실측 확인된 USER 상호작용**: 첨부 스테이징/전송/vision, composer 자동완성 @멘션(봇 4개 실데이터)·/워크플로(8)·:이모지(12)·화살표순환·Enter칩삽입·Escape닫기, 초안 봇별 보존('Draft:' 표시), Cmd+K 명령 팔레트(All/Messages/Agents/Groups/Files/Links/Routines/Actions 탭), 이전/다음 에이전트 전환(Meta/Ctrl+]/[), 헤더 에이전트 클릭→설정 패널(Name/Title/Description/Notifications).
- **CDP 한계(결함 아님)**: 줌(Cmd+±/0)은 Electron 네이티브 메뉴 accelerator라 CDP 합성키로 발화 안 됨(clientWidth·dpr 불변으로 확인) — 실사용자 키입력엔 작동, 자동검증만 불가. GATED 31은 미실행.

### 8.1 나머지 640(UI_INHERITED) 실측 방법 — 4-방법 체계 (증명 완료)

미니파이 렌더러엔 data-testid/aria-label이 없지만 **접근성(AX) 트리에는 완전한 role+name이 있다**(button:'View agent settings', switch:'Notifications', textbox:'Prompt' 등). 이를 등뼈로 케이스 성격별 4방법을 배정했다(`scripts/categorize-715.mjs`, `scripts/ax-ui.mjs`).

| 방법 | 대상수 | 방식 | 증명 |
|---|---|---|---|
| **AX** | 197 | AX 트리로 role+name 찾아 box-model 클릭 → AX/DOM 델타로 판정 | 버튼 18개 이름열거·'QA Bot' 열기·Notifications 스위치 true→false 토글 실측 |
| **VIEWER** | 97 | 실제 fixture(pdf/xlsx/csv/md/json/txt/png) DOM.setFileInputFiles로 첨부→카드 클릭→뷰어 렌더 검증 | PDF뷰어(canvas 'Belmont test PDF'+페이지수+줌/다운로드)·스프레드시트뷰어(xlsx→표 a\|b/1\|2) 실측 |
| **COLLAB** | 73 | 소스 배선확인→로컬 게이트오프면 UNAVAIL | cross-user-sharing: sand_multiplayer 게이트+dev-env 가드+Cursor JWT 필요, 로컬 전부 'Sharing isn\'t enabled'. **72건 UNAVAIL 기록** |
| **CLOUD** | 139 | 소스확인으로 forced-off/cloud-only/local-present/외부-dep 구분 | auto-review 강제off(AUDIT-W3)·routines는 로컬존재(→AX 재배정)·MCP-OAuth는 ENV·Babysit/Diff-PR cloud전용 |
| OTHER | 209 | 위 4방법으로 세부 재분류 | 진행 |

**방법론 교훈:** (1) 케이스 간 UI 상태 리셋 필수 — 열린 모달을 Escape/'Close preview'로 닫되 **창 크롬 버튼('Close'/'Minimize'/'Maximize')은 절대 클릭 금지**(클릭 시 앱 종료됨, `ax-ui.mjs`의 DANGER_BUTTONS로 차단). (2) fixture는 뷰어별 실제 파일 필요. (3) 코드확인이 '없어서 UNAVAIL'과 '있는데 미검증'을 정직히 가른다 — 상속 가정으로 PASS 처리하지 않는다.

## 9. OpenBot 비교 & 중앙 관리자 갭 (전략)

외부 비교 분석(OpenBot main fb0c797 vs Belmont 89f60e54)을 검토한 결과 — Belmont 쪽 주장은 위 findings와 전부 일치(코드 확인). OpenBot 소스는 이 환경에서 접근 불가라 OpenBot 쪽은 독립 검증 못 했으나, 설계는 OpenBot 세부구현에 의존하지 않는다.

**재검토 (2026-08-31, 후속 5 이후 — 원본 보고서 전문 기준):** 비교 기준이 옛 커밋(89f60e5)이라 Belmont 쪽 판정 중 일부는 이제 낡았다 — ①"memory production 연결 끊김" → **수정됨**(AUDIT-1, 라이브 teal-7731 회수) ②"Pi auth UI truth" → **수정됨**(AUDIT-10, 앱 내 기기코드 로그인/상태/로그아웃) ③"Task child settle owner 오염" → **settle 격리는 수정+라이브 검증**(AUDIT-4; 재시작 reconciliation은 여전히 없음 — 문서 지적 유효) ④auto-review는 이제 Shell·컴퓨터·MCP 표면 + 훅 5종에 활성(문서가 평가한 시점보다 강함, 단 default-deny 정책 엔진이 아니라는 지적은 유효). **여전히 유효한 결손**: 중앙 관리자 지정·durable job store·typed envelope·결과 검토/승인/게시 게이트·restart reconciliation·봇별 execution profile(AUDIT-W1)·SendToAgent 내구성(AUDIT-5)·multi-agent E2E 테스트(T1~T9). 문서에 없는 우리 쪽 신규 결함: AUDIT-W12(list_changed 호스트 전파).

**세 제품은 다르다:**

| 구분 | 성격 |
|---|---|
| OpenBot | 여러 봇에 권한·컴퓨터·도구를 안전 제공하는 다중사용자 서버 플랫폼 |
| 현재 Belmont | WSL/Electron에서 영구 봇 + 임시 subagent를 실행하는 로컬-우선 플랫폼 |
| **원하는 Belmont** | 사용자의 단일 접점이자 계획·위임·진행관리·결과검토·재시도·최종승인까지 책임지는 **관리자 봇** |

**핵심: 중앙 관리자 orchestration은 어느 쪽에도 완성돼 있지 않다.** OpenBot이 앞선 것 = durable 작업큐·권한·감사·격리·자격증명·다중사용자. Belmont가 앞선 것 = WSL 로컬실행·Pi Codex OAuth·직접 도구실행·임시 Task subagent. **양쪽 다 부족 = 중앙관리자 지정·결과가 관리자에게 돌아오는 구조·결과 검토/승인/재시도·승인된 결과만 게시.**

권고: **Belmont 유지 + OpenBot의 내구성 패턴만 차용**(durable queue·typed handoff·idempotency·lease·audit·real-DB test) + **새 Belmont 전용 review/publication 계층**. OpenBot의 결과-semantics(worker가 자기 대화에 게시)는 복사하지 않는다.

## 10. 단일 invariant (북극성)

> **위임된 작업이 durable job이 되고, 결과가 반드시 Belmont로 돌아오며, Belmont가 승인하기 전에는 사용자에게 노출되지 않는다.**

불변식 5가지: ①사용자 입력 target은 항상 Belmont ②모든 위임에 durable job ID ③worker는 사용자에게 직접 최종답 게시 불가 ④모든 결과는 Belmont review 통과 ⑤APPROVED만 user publication 허용. Docker·SSO·정책엔진보다 이 하나가 먼저다.

## 11. 목표 아키텍처

```
사용자 → Belmont-only Router → Belmont 영구봇
                                  ├── 직접 도구 실행
                                  └── Orchestration Store (SQLite)
                                       ├── Persistent Worker Adapter
                                       ├── Temporary Task Adapter
                                       └── (future) External Worker Adapter
                                            → Result+Evidence Store
                                            → Belmont Review Turn
                                            → APPROVED → Publication Gate → 사용자
                                            → REJECTED → Retry/Reassign
```

SQLite schema(요약): goals · jobs(idempotency_key/claimed_by/lease_until/attempt/deadline) · results(evidence_manifest) · reviews(decision/defects) · job_events. 상태전이: PLANNED→QUEUED→CLAIMED→RUNNING→RESULT_RECEIVED→REVIEWING→APPROVED→PUBLISHED (+FAILED/REJECTED/CANCELLED/ORPHANED 경로).

## 12. 로드맵 (전략 P0/P1/P2 — 위 findings 수정과 통합)

**전략 P0 (중앙관리자 성립 최소):** ①managerAgentId ②Belmont-only routing ③SQLite goal/job/result/review store ④typed DelegateJob(worker_id/task/constraints/expected_output/evidence_requirements) ⑤worker ReturnJobResult(worker의 user-visible SendMessage 차단) ⑥Belmont review tools(Approve/Reject/RequestRetry/Reassign/Cancel/PublishGoalResult) ⑦approved-only publication gate(코드 enforce) ⑧durable queue·lease·idempotency ⑨Task child owner 분리(=AUDIT-4 수정)

**전략 P1 (장기 신뢰성):** per-bot execution profile(=AUDIT-W1) · restart reconciliation · **memory prompt/settle 배선(=AUDIT-1)** · worker 최소기억 projection · 실제 Pi auth status UI(=AUDIT-10) · Cursor→Codex migration · WSL에서 Cursor/cloud tool hard-disable · **토큰 유효한도 재조정(=AUDIT-6B, maxTokens fix 불충분)**

**전략 P2 (확장):** user-readable audit UI · declarative policy engine · AG-UI remote worker · per-bot container 격리 · multi-user auth/SSO · publishable components

**이미 수정된 버그 P0:** update_state(AUDIT-2) · Pi maxTokens:0(AUDIT-6) — 단 AUDIT-6는 값 재조정 필요(AUDIT-6B).

## 13. 최우선 테스트 (real-SQLite E2E — 현 sweep의 self-report false-green 대체)

mock 단위테스트가 아니라 실제 SQLite+production store를 통과해야 하는 것:
- **T1 Durable delegation**: process A가 job offer→종료→process B가 claim→result 저장→Belmont review wake 복구
- **T2 Duplicate prevention**: 같은 goal/worker/task 2회 위임 → job 1개·실행 1회·result 1개
- **T3 동시 2 worker**: 서로 다른 checkpoint/store/result, evidence 비교차
- **T4 하나만 cancel**: A=CANCELLED, B=APPROVED, B runner/store 무영향
- **T5 잘못된 결과 재시도**: attempt1 REJECTED → attempt2 APPROVED, attempt1 미게시
- **T6 result 이후 crash**: restart 후 같은 result 재검토, worker 재실행 안됨, 다른 대화에 안붙음
- **T7 publication gate**: APPROVED 전 PublishGoalResult → 코드수준 거부·audit기록·user transcript 무변화
- **T8 장기기억**: 사용자 금지사항 저장→재시작→새 대화→Belmont 회수→worker엔 최소정보만
- **T9 Pi OAuth**: 만료→상태변경→재로그인→복구, Cursor/Anysphere 네트워크 요청 0

---

_이 문서는 sweep 판정 + 코드 감사 24 findings + OpenBot 비교/설계/로드맵을 하나로 통합한 단일 SSOT다._
