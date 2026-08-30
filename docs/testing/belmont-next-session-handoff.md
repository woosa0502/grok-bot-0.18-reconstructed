# Belmont — 다음 세션 인수인계

_작성: 2026-08-30 · 이전 세션(컴퓨터 유즈 구현 + full-test 재분류) 종료 시점 기준_

전체 현황은 `docs/testing/belmont-full-test-report.md`(단일 SSOT). 이 문서는 **다음 세션이 바로 이어받도록** 한 곳에 요약.

---

## TL;DR

- **모든 작업 커밋+푸시 완료.** `main` = `origin/main` (github.com/woosa0502/Belmont). 작업트리 clean.
- **실제로 남은 결함은 딱 하나 클러스터**: auto-review/smart-mode가 로컬 Codex에서 **강제 OFF** → 14개 ISSUE의 단일 뿌리.
- 그 외 남은 건 UNCLEAR 8건 확인, (선택) VNC 세부 E2E·다중창.

---

## ✅ 이번 세션에 완료한 것 (커밋됨)

| 항목 | 커밋 |
|---|---|
| 컴퓨터 유즈 도구(스크린샷/클릭/타이핑/키) — 라이브검증 | `815c410` |
| 이전 결함 3개(선제압축/state-write/첨부투영) | `68b57c9` |
| CDP 테스트 하네스 + 감사 문서 | `d4babb9` |
| computerUse 서브에이전트 dispatch + VNC 뷰어 | `893aa53` |
| full-test 케이스 재분류·판정 기록 | `ef5f579`·`815cbfa`·`6e64786` |
| 완료 vs 남은 것 요약(§0.5) | `cb14ca5` |

컴퓨터 유즈는 §1.5 참조. 도구·서브에이전트·VNC 화면표시는 **라이브 PASS**, VNC 세부 상호작용(클립보드/키/줌)은 **코드배선 확인**(개별 E2E 미완).

---

## ⚠️ 남은 실제 결함 (유일한 클러스터): auto-review Codex 강제 OFF

**증상 14개** (전부 같은 뿌리): 도구/권한 승인 카드 미발화(852·647·648), Smart Mode 권한 무효(778·779·780), auto-review 계열(473·475·476·805·809·811), routine 편집기 저장 검증(675·676). → **"사용자가 켜도 무효"**.

**뿌리**: `source/host/extensions/auto-review/extension.ts:52-54`
```ts
const localCodexMode = ...getInferenceProvider() !== "cursor";  // 로컬 Codex면 true
const settingsForAutoReview = localCodexMode
  ? { getAutoReviewInstructions: () => ({ ..., isEnabled: false }) }  // 강제 OFF
  : settings;
```
**왜 껐나** (주석): auto-review 분류기(approve/reject 판정기)가 **Cursor 클라우드 backend 전용**(`createClassifierExecutor: createSandBackendSmartModeClassifierExecutor`, extension.ts:65). 로컬엔 그 분류기가 없어서, 켜두면 모든 Shell이 "없는 분류기"로 가서 "safety review errored"로 거부됨 → Shell 자체가 안 돎. 그래서 안전하게 off.

**고치려면** (다음 세션 시작점):
1. **로컬 분류기 구현** — `createSandBackendSmartModeClassifierExecutor`(Cursor RPC) 대신 **Pi(gpt-5.5)로 분류**하는 executor를 만들어 `createClassifierExecutor`에 주입. Pi는 이미 로컬 추론 가능(컴퓨터 유즈 비전도 Pi).
2. 그 분류기가 붙으면 `localCodexMode`여도 `isEnabled` 강제 off를 풀 수 있음(사용자 설정 존중).
3. 관련 배선: `remote-box-resources.ts:377-382`(autoReviewClassifierExecutor 등록), `host-runner-composition.ts:1649·2819`(auto-review/smart-mode classifier 주입). `SAND_AUTO_REVIEW_MODE` env + `parseLocalAutoReviewMode`(extension.ts:64)로 모드 제어 경로 존재.
4. 검증: CDP로 Shell/권한 카드가 뜨는지 + 승인/거부 흐름. 증상 14개 케이스로 재판정.

주의: 분류기 프롬프트/판정 포맷은 `packages/agent/smart-mode-classifier-context.ts` 참고(computerUse 포맷터 등 이미 존재).

---

## 확인 필요 (UNCLEAR)

CDP/코드로 재판정 필요 (USER 라우트 8 + AGENT 일부):
`GBF-AGT-000201`(env transition reminder), `000381`(multitask coordinator reminder), `000314`(cloud/local rule 노출), `000017`(서브에이전트 model 파라미터 유효성), `000347`(MCP 큰 결과 파일 spill), `000373`(TODO frontmatter 자동싱크), `000322`(CI 조사 서브에이전트), `000330`(workspaceOpen 훅 pluginPaths), `000077/078`(browser_drag/click 검증), `000239`(도구 타임아웃), `000262`(429/5xx retryable 분류).

---

## (선택) 컴퓨터 유즈 잔여

- **VNC 세부 개별 E2E**: 클립보드 복사/붙여넣기(452/453/758/307/308)·키 전달(456/454)·줌 1x(913)·presence(354). electron VNC trust(`vnc-trust.ts`)가 loopback `127.0.0.1/vnc.html`을 box desktop으로 인식해 핸들러 자동 부착 — 인프라는 활성, 중첩 webview 통한 각 동작 개별 확인만 남음.
- **다중 데스크톱 창**(USR-390): 현재 `production.ts:107 maxWindows()=1`, 단일 Xvfb. 구현하려면 2번째 Xvfb + fork window 라우팅 필요(로컬 가치 낮음).
- **창 관리자**: openbox 등 미설치 → GUI 앱이 테두리 없이 뜸. 실제 앱 자동화엔 `apt install openbox` 권장.

---

## 환경 / 실행 방법

- **빌드**: `node scripts/setup-wsl.mjs` (중단 금지 — 중간에 죽이면 host-main.cjs 손상). `npm run wsl:setup`은 백그라운드서 실패하니 직접 node로.
- **실행**: `SAND_LOCAL_COMPUTER_USE=1 BELMONT_WSL_DEBUG_PORT=9347 NODE_OPTIONS=--max-old-space-size=8192 node scripts/run-wsl.mjs`
- **CDP**: 9347 고정. `scripts/ax-ui.mjs` 하네스(connect/axNodes/find/clickNode/domClick/shot). AX 트리에 role+name 완전(data-testid는 없음).
- **컴퓨터 유즈**: Xvfb `:99`(1280x800). 캡처=ffmpeg x11grab, 입력=xdotool. VNC=x11vnc(5900)+websockify/noVNC(6080) — **설치됨**(x11vnc/websockify/novnc). x11vnc는 spawn env에서 WAYLAND_DISPLAY 제거 필수(WSL Wayland 오인 방지).
- **테스트 코드 창**: `setsid bash -c 'export DISPLAY=:99; xmessage -center -buttons OK:0 "CODE" >/dev/null 2>&1' &`
- **케이스/판정 데이터**: `docs/testing/belmont-wsl-test-queue.jsonl`(1292, expectedBehavior 포함), `/tmp/sweep-verdicts.jsonl`(2075).

---

## 제약 (반드시 지킬 것)

1. **`upstream`(b-nnett/grok-bot-...)에 절대 푸시 금지.** 푸시는 `origin`(woosa0502/Belmont)만.
2. belmont 프로세스에 `kill -9` 전에 `prlimit --pid <p> --core=0` (크래시 덤프 0 유지). Xvfb :99는 살려두면 재사용됨.
3. 커밋은 사용자가 요청할 때만.
4. 빌드 중간에 setup-wsl.mjs 죽이지 말 것.

---

## 핵심 파일 지도

| 영역 | 파일 |
|---|---|
| 컴퓨터 유즈 도구(규격 준수) | `source/host/runner/host-computer-tool-dependencies.ts` (`createComputerTurnTool`) |
| 실행기(ffmpeg/xdotool) | `source/packages/local-exec/computer-use/{executor,display-manager}.ts` |
| 로컬 CU 배선(공유) | `source/host/box/local-computer-use.ts` |
| 게이트웨이 우회 | `source/host/extensions/local-exec/production.ts` |
| Pi 이미지 전달(결정타) | `source/host/extensions/inference/pi-codex-projection.ts:202` |
| 서브에이전트 config | `source/host/host-runner-composition.ts:2530` |
| VNC trust(클립보드/키/줌) | `source/electron-main/vnc/vnc-trust.ts` |
| **auto-review 강제off(남은일)** | `source/host/extensions/auto-review/extension.ts:52` |
