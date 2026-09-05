# Belmont 기능 완성 로드맵

- 상태: `DRAFT / IMPLEMENTATION_PENDING`
- 기준일: 2026-08-28 KST
- 코드 기준: `73be6f0`
- 우선순위: 보안 고도화보다 기능 완성도 우선

## 1. 목적과 현재 판단

Belmont는 Grok Bot 0.18의 Electron UI, 대화 저장소, 로컬 도구 실행기와 봇 경험을 유지하면서 Cursor 인증·원격 백엔드 의존성을 로컬 Codex 런타임으로 교체하는 프로젝트다.

현재 방향 자체는 맞지만 통합 경계가 아직 완성되지 않았다. 일반 추론은 Codex ChatGPT 인증 산출물을 직접 소비하지만, 계정 UI는 합성 상태를 반환하고 Web, 플러그인 마켓, 일부 계정 기능은 계속 Cursor credential을 요구한다. 따라서 화면에 기능이 존재하는 것과 현재 WSL Codex 모드에서 실제로 동작하는 것을 구분해야 한다.

최종 목표는 다음과 같다.

```text
Belmont Electron UI
  -> Belmont host: transcript, permissions, tools, work lifecycle
  -> Pi Codex provider: auth, models, streaming, reasoning, usage
  -> Belmont executors: Shell, File, MCP, Task/Subagent
```

## 2. 유지·교체·추가 경계

유지할 항목:

- 기존 Electron/React 사용자 경험과 대화 카드
- Belmont transcript와 봇 설정 저장소
- Shell, 파일, MCP, Task/Subagent 도구 정의와 실제 실행기
- 승인, 권한, 작업 예약, 결과 검증과 완료 판정
- Cursor provider를 사용하는 원본 모드의 호환 경로

교체할 항목:

- `local@codex` 고정 계정 상태
- `~/.codex/auth.json` 내부 구조 직접 해석과 자체 OAuth refresh
- Codex Responses backend에 대한 수동 transport 확장
- Cursor backend에 고정된 WebSearch/WebFetch와 플러그인 provider
- 모델 문자열과 환경변수 중심 선택

추가할 항목:

- Pi `Models + openaiCodexProvider + BelmontCredentialStore`
- child 실행에 Pi agent runtime을 사용할지 기존 Belmont runtime을 유지할지에 대한 별도 결정
- 실제 계정 상태, 로그인, 로그아웃, refresh event
- 봇별 모델·reasoning 설정
- compact, resume, interrupt의 단일 수명주기
- Codex native hosted Web Search event와 Belmont UI 변환
- 로컬 MCP의 등록·인증·지속성 경로

## 3. Pi Codex 런타임

권장 통합은 Pi의 OAuth 함수 일부를 복사하는 방식이 아니라 provider 전체를 Belmont에 주입하는 방식이다. 목표 계약은 Pi가 Codex OAuth, token refresh 직렬화, 모델 카탈로그와 Responses transport를 제공하고 Belmont가 제품 상태와 도구 실행을 소유하는 것이다. reasoning, 이미지와 usage의 정확한 지원 범위는 도입할 Pi 버전의 compile/runtime 검증으로 고정한다.

`BelmontCredentialStore`는 다음 최소 계약을 제공해야 한다.

- provider별 credential 읽기와 목록 조회
- serialized read-modify-write
- 로그아웃 시 삭제
- 프로세스 재시작 후 복원
- credential 변경 event

기능 완성 단계에서는 안전한 권한의 로컬 저장부터 시작할 수 있다. OS keyring, Electron `safeStorage`, 플랫폼별 fallback 검증은 후속 보안 단계에서 강화한다. 다만 UI와 추론이 반드시 같은 CredentialStore를 source of truth로 사용해야 한다.

현재 `package.json`에는 Pi 의존성이 없으므로 이 항목은 구현 예정이며, 도입 시 실제 고정 버전의 API와 라이선스를 다시 확인한다. `pi-ai` provider 경계와 child session을 실행하는 Pi agent package는 동일한 것으로 취급하지 않는다.

## 4. 계정과 Cursor 잔여 기능

현재 local Codex 계정 어댑터는 실제 token 존재 여부와 무관하게 로그인 상태를 반환한다. 이를 다음 상태 기계로 교체한다.

```text
signed-out -> logging-in -> logged-in -> refreshing
                          -> expired/error -> logged-in 또는 signed-out
```

계정 UI에는 실제 email/display name/account ID를 표시하고 계정 변경 시 account-scoped 상태를 다시 계산한다. 로그아웃은 credential을 실제로 삭제해야 한다.

다음 Cursor 전용 기능은 Codex 로그인만으로 대체되지 않는다.

- Cursor usage, trial과 dashboard action
- Cursor privacy mode와 PR review preference
- Cursor transcription backend
- Cursor 계정 범위의 마켓·MCP 상태

필요한 기능은 Belmont 로컬 구현으로 교체하고, 대체하지 않는 기능은 거짓 성공이나 no-op 버튼 대신 명시적으로 숨기거나 unavailable 상태를 표시한다.

## 5. 모델과 봇별 설정

모델 목록은 Pi provider 카탈로그에서 가져오고 하드코딩된 문자열을 제거한다. 저장 우선순위는 다음과 같다.

```text
봇별 override -> 전역 기본 모델 -> provider 기본값
```

각 봇은 `provider`, `model`, `reasoning effort`를 별도로 지정할 수 있어야 한다. 서브에이전트 역할도 부모 모델 상속 또는 명시적 override를 선택한다. 사용할 수 없는 모델은 조용히 다른 모델로 바꾸지 않고 사용자에게 fallback 또는 오류를 표시한다.

## 6. 대화 상태, Compact, Resume, Interrupt

현재 Codex 경로는 Belmont transcript를 매 요청마다 다시 구성한다. Belmont 자체에는 이미 summarization, accepted checkpoint와 retry resume 기반이 있으므로 이를 버리지 않는다. 목표는 이 기반을 Belmont 대화 ID와 Codex provider continuity에 연결하는 것이다.

- 기존 summarization을 context 임계치의 compact summary와 continuation metadata에 연결
- 기존 accepted checkpoint/retry resume를 재시작 후 provider continuity까지 확장
- tool call/result와 reasoning 연속성 보존
- 중복 전송과 이미 완료한 도구 재실행 방지
- provider 응답 ID와 usage를 transcript에 기록

Pi provider만 연결한다고 Belmont의 compact/resume이 자동 완성되지는 않는다. 미완성 범위는 Codex provider response metadata, 재시작 continuity와 부분 tool-loop의 E2E parity다. Belmont transcript/checkpoint와 Pi provider 사이의 명시적 bridge가 필요하다.

Belmont에는 이미 turn `AbortController`와 interrupt 기반이 있다. 부족한 것은 이 signal이 현재 direct Codex HTTP request까지 전달되지 않는다는 점이다. 최종 취소 경로는 다음 한 줄로 이어져야 한다.

```text
UI Stop -> Belmont AbortController -> Pi request -> tool loop -> child agent
```

중단된 turn은 성공이나 일반 오류가 아니라 `cancelled` 상태로 저장하고 재개 가능 여부를 기록한다.

## 7. 첨부파일과 Reasoning 보존

현재 provider 변환기는 `file`, `reasoning`, `redacted-reasoning` part를 명시적으로 제외한다. Pi 통합 시 다음 parity가 필요하다.

- 이미지 입력과 provider가 지원하는 일반 파일 입력
- attachment-only 메시지
- tool-result 이미지
- reasoning/encrypted reasoning replay
- 캐시·입력·출력 token usage
- 지원하지 않는 파일의 명확한 사용자 오류

파일을 단순 텍스트로 바꾸어 의미를 잃지 않도록 provider가 지원하는 native part와 Belmont 저장 형식을 양방향 변환한다. 이미지와 임의 파일 지원을 동일하게 가정하지 않고 모델/provider capability별로 판정한다.

## 8. Codex Native Web Search

Belmont의 `WebSearch`와 `WebFetch` 도구 UI, 승인, 결과 렌더링은 구현되어 있다. 그러나 실제 provider는 `createCursorWebSearchService()`와 `createCursorWebFetchService()`를 통해 Cursor `AiService.runWebSearch/runWebFetch`를 호출한다. WSL Codex 모드에는 해당 credential이 없으므로 외부 요청이 실패한다.

Codex provider에서는 Cursor Web을 고치는 대신 OpenAI hosted Web Search 계약을 사용한다. 공개 Codex 소스가 하는 일은 검색엔진을 로컬에서 실행하는 것이 아니라 Responses 요청에 hosted tool을 추가하고 서버 event를 해석하는 것이다. 다음 예시는 `live` mode다.

```json
{
  "type": "web_search",
  "external_web_access": true
}
```

OpenAI 측 검색·인덱스와 hosted page action을 Belmont가 복제할 필요는 없다. 다만 hosted `open_page/find_in_page`는 모델이 선택하는 검색 action이며 사용자가 지정한 임의 URL을 deterministic하게 가져오는 `WebFetch(url)`과 동일하지 않다. Belmont에 필요한 포팅 범위는 다음과 같다.

1. `codex-direct-responses.ts`의 function-only tool 형식을 hosted tool union으로 확장한다.
2. Codex mode에서 `web_search`를 요청 도구에 추가한다.
3. `cached -> external_web_access:false`, `indexed -> external_web_access:true + indexed_web_access:true`, `live -> external_web_access:true`, `disabled -> tool 생략`을 매핑한다.
4. `web_search_call` SSE item과 `search`, `open_page`, `find_in_page` action을 파싱한다.
5. assistant annotation, source와 citation metadata를 별도 변환기로 기존 Web 카드와 transcript에 매핑한다.
6. Codex mode에서는 Cursor WebSearch service를 등록하지 않는다.
7. 임의 URL용 WebFetch는 timeout, redirect, content type과 크기 제한을 갖춘 local fetch provider로 분리한다.
8. Cursor mode에서는 기존 Cursor WebSearch/WebFetch를 유지한다.
9. provider가 해당 capability를 지원하지 않으면 도구를 노출하지 않는다.

공식 Codex 클라이언트가 hosted Web Search를 지원한다는 사실과 Belmont의 현재 수동 ChatGPT Codex endpoint 호출이 같은 entitlement를 받는다는 사실은 별도 주장이다. 구현 시 실제 계정으로 capability probe와 citation event E2E를 통과해야 하며, 지원되지 않으면 외부 검색 provider 또는 검색 MCP fallback을 선택한다.

현재 도구 등록은 service method 존재 여부만 보고 있어 credential 준비 여부와 어긋난다. provider capability와 readiness를 모두 확인하도록 바꾼다. `localhost`와 private IP를 차단하는 기존 WebFetch 정책은 로컬 fetch fallback을 추가할 경우 실행 위치에 맞게 문구와 정책을 다시 정의한다.

참고 자료:

- [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference)
- [openai/codex hosted_spec.rs](https://github.com/openai/codex/blob/5f49aba876922d6f2f55caa153bbb0ed1b46feba/codex-rs/core/src/tools/hosted_spec.rs)
- [openai/codex tool_spec.rs](https://github.com/openai/codex/blob/5f49aba876922d6f2f55caa153bbb0ed1b46feba/codex-rs/tools/src/tool_spec.rs)

## 9. 서브에이전트

Task/Subagent 도구와 WSL multitask enable 경로는 코드에 존재하며 현재 브랜치에는 foreground 결과 binding 복구도 포함되어 있다. 그러나 실제 child 실행, cancel, resume와 부모 결과 반영을 포함한 완전한 E2E가 통과해야 기능 완료로 판정한다.

`pi-ai` provider 연결은 child-agent runtime을 자동 제공하지 않는다. 기존 Belmont child runtime에 Pi inference만 연결할지, 별도 Pi agent runtime을 도입할지 먼저 선택한다. 별도 Pi child runner를 도입할 경우:

- 짧은 읽기·분석 작업은 in-process session
- 격리·재시작·장기 실행 작업은 RPC/process worker
- 부모와 child의 tool allowlist 분리
- 역할별 모델과 reasoning 설정
- mailbox, liveness, cancel, respawn과 결과 receipt

를 제공한다.

권한 경계는 유지한다.

```text
선택된 child runtime: 모델 실행과 child session
Belmont host: work claim, 권한, tool execution, receipt, 검증, 완료 판정
```

선택된 child runtime의 `done` 또는 `idle` event만으로 Belmont 작업을 성공 처리하지 않는다.

## 10. MCP, 메일과 캘린더

필요한 외부 연동은 마켓 전체보다 로컬 MCP를 먼저 완성한다. Gmail 또는 Calendar 하나를 선정해 다음 수명주기를 검증한다.

```text
등록 -> 프로세스 실행 -> tool discovery -> OAuth
     -> 실제 tool call -> 재시작 후 유지 -> 비활성화/삭제
```

Codex 모델 인증과 Google/Microsoft 등 서비스 인증은 서로 다른 credential이다. MCP 프로세스가 로컬에 설치되더라도 검색 인덱스나 SaaS 데이터는 외부 서비스와 통신한다.

현재 MCP discovery와 tool execution은 존재하지만 server 추가·삭제와 OAuth 일부가 Cursor 계정 writer/backend에 묶여 있다. 따라서 검증만으로 끝나지 않으며 로컬 config source/writer와 서비스별 독립 OAuth adapter를 추가해야 한다.

최소 저장 항목은 command, args, environment reference, enabled tools, custom instructions, auth 상태와 마지막 오류다. 비밀값 자체는 설정 UI나 로그에 노출하지 않는다.

## 11. 플러그인과 스킬

플러그인은 단순 MCP 서버보다 큰 선택적 capability 묶음이다. UI는 필수 구성요소가 아니다.

```text
Plugin = commands/agents/skills/rules/hooks/MCP 중 일부 + metadata
```

Cursor 마켓을 그대로 복구하는 작업은 현재 우선순위가 아니다. 사용자에게 필요한 연동은 로컬 MCP 직접 등록으로 먼저 제공한다. 이후 로컬 플러그인이 필요하면 디렉터리 manifest, 설치 위치, enable/disable, update와 uninstall만 갖춘 작은 registry부터 시작한다.

기존 skill surface는 유지하되 다음을 실제로 검증한다.

- 로컬 skill discovery
- 봇별 enable/disable
- system prompt에 실제 주입
- 변경 후 reload
- 재시작 후 유지

UI 카드가 보인다는 사실만으로 플러그인이나 skill을 완료 판정하지 않는다.

## 12. 모바일 사용

현재 Electron UI를 그대로 휴대폰에서 사용하는 가장 빠른 방법은 Tailscale 위의 VNC 또는 원격 데스크톱이다. 이는 Belmont 내장 기능이 아니며 별도 VNC/RDP server, 휴대폰 client와 인증 구성이 필요한 외부 배포 경로다. UI를 다시 만들지 않지만 모바일 전용 조작감은 제공하지 않는다.

장기적으로는 Belmont host를 WSL에 유지하고 모바일용 반응형 Web/PWA client를 추가한다. 현재 gateway는 loopback을 기본으로 하고 browser `Origin` 요청을 거부하므로 PWA가 그대로 직접 재사용할 수는 없다. 브라우저용 인증 adapter/BFF, 허용 origin, Tailscale bind와 노출 범위를 별도로 설계해야 한다. 개인 전용이라는 조건에서는 이 경로가 네이티브 앱보다 구현·배포·업데이트 비용이 낮다.

모바일 검증은 단순 listener 확인이 아니라 실제 휴대폰 peer 연결, 인증, 대화 resume와 tool 결과 수신까지 포함한다.

## 13. 구현 원칙

- 기존 UI와 잘 동작하는 대형 파일은 줄 수만 보고 분할하지 않는다.
- 새로 만드는 소스 파일은 500줄 미만으로 유지한다.
- 기능별 adapter와 변환기를 작은 모듈로 추가한다.
- 공개 Codex/Pi 경계가 있으면 OAuth나 protocol을 처음부터 재발명하지 않는다.
- upstream Git 이력과 현재 복원 이력을 보존하고 기능별 checkpoint commit을 만든다.
- 기존 auth/settings를 새 저장소로 옮기는 migration, rollback과 손상 복구 절차를 함께 만든다.
- 구조 테스트가 통과해도 실사용 E2E가 없으면 `PROVISIONAL`을 유지한다.
- 기능 parity를 먼저 완성하고 keyring, 암호화 저장소와 세부 보안 정책은 후속 단계에서 강화한다.

## 14. 구현 순서

### Phase 1: Provider 기반 확립

- Pi 버전과 라이선스 고정
- BelmontCredentialStore 구현
- 실제 login/logout/status/refresh 연결
- fake local account 제거
- Pi Codex streaming smoke test

### Phase 2: 기본 추론 parity

- 모델 카탈로그와 봇별 모델
- function tool 왕복
- attachment와 reasoning 보존
- usage와 AbortSignal 연결
- Codex native Web Search

### Phase 3: 대화 수명주기

- 기존 summarization과 compact checkpoint 연결
- 기존 retry checkpoint를 provider-aware restart resume로 확장
- 중복 tool 실행 방지
- cancel 상태와 복구

### Phase 4: 서브에이전트

- 역할·모델별 child session
- foreground/background 결과 binding
- cancel, resume, liveness와 receipt
- 부모 완료 판정과 독립 검증

### Phase 5: 외부 연동

- Gmail 또는 Calendar MCP 한 개 완성
- local MCP config source/writer와 독립 OAuth adapter
- 재시작 지속성
- 오류·재인증·삭제 경로
- 필요 시 로컬 plugin registry

### Phase 6: 모바일

- Tailscale 내부 gateway 계약
- 반응형 Web/PWA
- 실제 휴대폰 E2E

## 15. 완료 기준

기존 `a84059d` 기준 1,292개 원장은 `data/artifacts/belmont-user-e2e-20260825/STRUCTURE_COMPLETE_UNVERIFIED-2026-08-26.md`에 기록된 역사적 snapshot이며 자동·구조 테스트만으로 제품 완성을 뜻하지 않는다. 당시 484개 `REVIEW_REQUIRED`는 484개 확정 버그가 아니라 실제 조작과 판정이 필요한 사례다. 현재 `73be6f0`에 같은 판정을 그대로 승격하지 않고 변경 기능을 다시 대조한다.

최소 release gate는 다음과 같다.

1. 실제 ChatGPT login, refresh, logout과 재시작 유지
2. 모델 응답, streaming, usage와 사용자 cancel
3. Shell/File/MCP function call 왕복
4. 이미지·파일·attachment-only 메시지
5. native Web Search와 citation 표시
6. compact 이후 연속 대화와 재시작 resume
7. 봇별 모델 분리
8. 서브에이전트 spawn, tool, cancel, result와 실패 복구
9. Gmail 또는 Calendar MCP의 전체 수명주기
10. 변경된 기능에 대응하는 사용자 E2E와 독립 검토
11. 기존 `auth.json`/settings migration, 재실행 idempotency, 재시작 복원과 실패 주입 시 rollback·원본 보존

Negative/recovery gate에는 refresh 거부와 동시 refresh, 계정 전환, credential/config 손상, MCP OAuth 만료·거부·재인증, MCP server crash, 부분 tool-loop cancel/restart와 중복 실행 방지를 포함한다. Cursor 호환 모드를 유지하는 동안에는 해당 경로의 별도 regression도 통과해야 한다.

각 항목은 `code present`, `structural test`, `runtime observed`, `E2E verified`를 별도로 기록한다. 마지막 단계까지 통과하기 전에는 제품 전체를 완료로 선언하지 않는다.
