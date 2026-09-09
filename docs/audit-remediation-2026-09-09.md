# 감사 지적 사항 조치 기록 — 2026-09-09

기준: 외부 감사 보고서(main `c8e2079` 기준, GPT Pro 작성)의 결함 F01~F07과 작업 묶음 WP1~WP8. 이 문서는 무엇을 고쳤고 무엇이 남았는지를 커밋·테스트·CI 근거와 함께 적는다. **전체 parity 완료 선언이 아니다.**

브랜치: `fix/audit-remediation` (main `c8e2079` 위). 각 항목의 근거는 커밋과 CI run 번호다.

## 결과 요약

| 결함 | 상태 | 커밋 | 근거 |
|---|---|---|---|
| F02 clean-checkout CI 실패 (16 fail / 11 skip) | **해결** | `a42358f`, `a0c4889` | run 34307808982 success. root 997/995/0 fail/2 skip, 모바일 151/149/0 fail/2 skip |
| F04 Aside stop 실패 무시 | **해결** | `f53156b` | 중단 의도를 먼저 durable 저장, 서비스 확인 전엔 성공 선언 안 함, 실패 시 사용자 알림·재시도·새 작업 차단. 테스트 4건 |
| F05 timestamp cursor로 인한 메시지 유실 | **해결** | `f53156b` | 메시지 identity 기반 dedup + 되돌아보기 창, 메시지마다 atomic 저장, 손상 link는 격리·명시 복구. 테스트 6건 |
| F06 host 종료 시 정리 생략·exit 0 | **해결** | `f53156b` | `runCleanupSteps`로 모든 단계 시도, 단계별 timeout, 실패 시 exit 1. 시작 실패 경로도 같은 방식으로 되감기. 테스트 5건 |
| F03 Claude 경로 tool 미전달·비스트리밍 | **부분 해결 → 종결(사용자 미사용)** | `a4b7acf` | 부분 메시지 스트리밍 구현, tool 미지원을 명시(경고·capability·strict 모드), Claude/OpenRouter 전용 계정 readiness. **host tool loop를 Claude CLI에 넘기는 bridge는 미구현** |
| F07 Docker image mutable 태그 | **해결** | `82fdc99`, `99adb66` | manifest digest `sha256:6295e3ac…`로 고정, 컨테이너 라벨·상태에 digest, 옛 태그 컨테이너는 schema bump처럼 교체 |
| F01 native binary ↔ snapshot 계보 미확인 | **해결(launcher 범위)** | `82fdc99` | `native-build-identity.mjs`가 binary sha/mtime·snapshot 입력 hash·pinned daemon을 기록·검증, `run-fork.sh`가 실행 전 검증. 부정 대조 테스트 3건 |

부수 항목: 모바일 검사 2실패(감사 밖) 해결 `a0c4889`; `isReady` Cursor/Codex 편중 해결 `a4b7acf`; packaging 계약 테스트 갱신 `99adb66`.

## 작업 묶음 상태

| WP | 상태 | 비고 |
|---|---|---|
| WP1 CI 정상화 | 완료 | ffmpeg·poppler 설치, belmont-browse `npm ci`, `bootstrap:aside`(LFS 원본 2 + patched 2, sha 검증), 원본 경로 helper. browser 하위 suite는 **advisory 단계**(aside-ext·비교 자산 미보관) |
| WP2 중단·정리 확인 계약 | 완료 | F04, F06 |
| WP3 durable Aside inbox | 완료 | F05 |
| WP4 provider 동등화 | 종결 | 스트리밍·capability·readiness 완료. tool bridge는 사용자가 Claude를 쓰지 않기로 해 보류 |
| WP5 immutable runtime lineage | 완료(범위 내) | F01 launcher preflight, F07 digest pin. Chromium 재빌드 재현(E02)은 별도 머신 검증 없음 |
| WP6 golden E2E 18개 | 미착수 | 이번에 추가한 단위·계약 테스트는 E07·E08·E14·E03·E16의 일부 조건만 덮음 |
| WP7 원본 parity 종결 | 미착수 | 91-row ledger 그대로 |
| WP8 source-of-truth 정리 | 부분 | Aside 원본·patched 번들 manifest화. patched 907의 정확한 patch 순서는 탐색 중(아래) |

## 남은 것 (사용자 결정 필요)

1. **Claude tool bridge** — **보류 (사용자 결정 2026-09-09: Claude provider를 쓰지 않음).** 코드는 원본 parity 범위라 유지하며, 현재 상태(스트리밍 + 미지원 capability 표시)가 최종이다. 설계 메모(나중에 필요해질 때용): host runner는 stream에서 `tool-call`을 받아 직접 실행하고 결과를 append 후 다시 stream()을 부르는 구조다. Claude Agent SDK는 자체 loop 안에서 tool을 실행하므로, in-process MCP server(`createSdkMcpServer`)의 handler가 `tool-call` 이벤트를 방출하고 다음 stream() 호출에서 append된 tool-result로 handler를 풀어 주는 "차단형 bridge"가 필요하다. JSON schema→Zod 변환, abort·오류 전파, executor 수명 관리가 걸린다. 하루 이상 걸리는 설계 작업이라 이번엔 capability 표시로 대신했다.
2. **browser suite를 게이트에 넣기** — `vendor/aside-ext`(36MB)·extension-comparison 원본 자산을 LFS로 보관해야 advisory를 필수로 바꿀 수 있다.
3. **WP6/WP7** — golden E2E lane과 91-row ledger. 범위가 커서 별도 결정.
4. **patched 번들 recipe** — 탐색 결과(patch-daemon → linux/lifecycle/active-workloads/password-session/`--refresh-cdp-shutdown`의 모든 순서·부분집합) 907·906 모두 vendor 파일을 바이트 단위로 재현하는 순서는 없었다. 907은 CDP client 종료 패치가 든 minified 한 줄이 남고, 906은 vendor가 현재 chain보다 오래된 상태다. 둘 다 `research-archives/aside/artifacts.json`에 hash로 고정돼 있고, 재현 recipe는 다음 daemon 버전 갱신 때 chain을 다시 돌려 기록하는 것으로 미룬다.

## 검증 방법 (재현)

```bash
git fetch origin && git checkout fix/audit-remediation
npm ci && npm run bootstrap && npm run bootstrap:aside
npm run check          # root 997 tests + 모바일 151 tests
npm run test:browser   # belmont-browse 140 + 20 (로컬 자산 필요)
```
