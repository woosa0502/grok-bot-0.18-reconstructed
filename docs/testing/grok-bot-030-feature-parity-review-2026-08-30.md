# Grok Bot 0.30 기능셋 대 Belmont 패리티 검토

- 기준일: 2026-08-30 KST
- 대상 저장소: Belmont (`/home/hoon/work/Belmont`)
- Belmont 기준 원본: Grok Bot `0.18.0`
- 현행 공식 macOS 배포: Grok Bot `0.30.0`
- 상태: `VERIFIED_INVENTORY / LIVE_PARITY_NOT_ESTABLISHED`
- 작업 성격: 조사 문서 작성. 제품 코드, 실행 프로세스, DB, 프로필은 변경하지 않았다.

## 0. 결론

Belmont는 **Grok Bot 0.18에서 출발한 같은 제품 계보의 복원판**이지만, 아직 현행 Grok Bot 0.30과 기능 패리티가 아니다. 0.30 설치파일도 0.18 때와 마찬가지로 새로운 checksum-pinned 원본으로 사용할 수 있으므로, 0.30 클라이언트 복원 자체는 가능하다. 단순 버전 교체가 아니라 중간 설치파일의 런타임 계약 변화를 따라가는 증분 복원이 필요하다.

단, 이 "전체 패리티" 표는 공식 제품과의 차이를 빠짐없이 보는 감사 기준이며 개인용 Belmont의 구현 목록이 아니다. 개인용 Windows+WSL+Codex 범위에서는 공개 공유, 결제, Cursor cloud/account, Teams, iPhone, marketplace와 전체 다국어를 의도적으로 제외한다. 실제 구현 우선순위는 [변경 원장의 개인용 기능 분류](grok-bot-018-to-030-change-ledger-2026-08-30.md#64-개인용-기능-분류)를 따른다.

판정은 두 기준으로 분리해야 한다.

1. **Grok Bot 0.18 복원 정합성**
   - Belmont는 0.18의 checksum-pinned renderer를 유지하면서 Electron, host, coordinator, local execution 등의 runtime을 readable TypeScript로 복원한 하이브리드다.
   - UI와 protocol 표면은 광범위하게 보존됐지만, memory 자동 회수, 재시작을 견디는 Bot 간 handoff, media 이해, runtime lifecycle 같은 핵심 연결부가 아직 공식 0.18 동작과 동일하다고 검증되지 않았다.
2. **현행 Grok Bot 0.30 제품 정합성**
   - 공식 배포판은 0.30.0으로 올라갔고 iOS, Teams/Enterprise, 공개 Bot 템플릿 공유, Chrome cookie 가져오기, user form, virtual-card approval, voice call, 다국어 infrastructure 같은 0.18 이후 표면이 확인된다.
   - Belmont의 1,500개 원자 기능 원장은 0.18 기준이므로 0.30 차이를 포함하지 않는다.

따라서 현재 사용할 수 있는 정직한 상태 라벨은 다음과 같다.

- `0.18 구조·UI 복원`: 광범위
- `0.18 전체 실사용 패리티`: 미확정
- `0.30 현행 기능 패리티`: 불일치 확인
- `완성도 백분율`: 산출 금지 — 미관측 및 현행-version 분모 누락 때문에 의미 있는 분모가 없다.

## 1. 증거와 판정 규칙

### 1.1 증거 계층

- `direct_observation`: 공식 다운로드, 추출한 0.18/0.30 package, 현재 process/CDP 상태, 현재 source를 직접 확인했다.
- `documented_official`: SpaceXAI/Cursor 공식 문서에 명시된 제품 기능이다.
- `code_present`: Belmont source에 구현 또는 protocol이 존재하지만 실제 제품 lifecycle은 확인하지 않았다.
- `live_verified`: 현재 또는 이전 동일 Belmont runtime에서 실제 사용자/agent 동작을 관찰했다.
- `unverified`: 코드나 UI가 있어도 설치→인증→호출→재시작 유지 같은 폐쇄 루프를 통과하지 않았다.

### 1.2 과장 방지 규칙

- UI 카드가 보인다고 backend 기능이 완료된 것으로 판정하지 않는다.
- source path 또는 문자열 하나만으로 신기능을 확정하지 않는다.
- plugin은 `검색 → 상세 → 설치 → 인증 → tool 호출 → 재시작 유지 → 삭제`가 연결돼야 완료다.
- routine은 `생성 → 자동 발동 → 결과 저장 → history → 재시작 → pause/edit/delete`가 연결돼야 완료다.
- Bot handoff는 메시지 전송뿐 아니라 수신·wake·result·restart recovery까지 내구성이 있어야 완료다.
- 0.30 package에 UI와 RPC가 함께 있어도 account entitlement와 실제 backend E2E를 확인하지 않았으면 `PACKAGE_IMPLEMENTED / LIVE_UNVERIFIED`로 남긴다.

## 2. 버전과 원본 정체성

Belmont의 공식 복원 기준은 [PROVENANCE.md](../../PROVENANCE.md)에 고정돼 있다.

| 항목 | Grok Bot 0.18 | 현행 Grok Bot 0.30 |
|---|---|---|
| macOS DMG | `Grok_Bot_0.18.0.dmg` | `Grok_Bot_0.30.0.dmg` |
| DMG SHA-256 | `a253ccd8aab01e083f9812a0264354c5034d8ba7f0610bbb557e82ae77d203eb` | `255116458e104203f045a21e5310161f3600eb751c06879a6efe3487f08fd53e` |
| `app.asar` SHA-256 | `6665408168466f9cacc6087e917890c17f59d2e2e9c2404a5c4a59ad79c1de58` | `4bbcd2f7af9f54cd1b354bd7b3c8376da569657a80f6560edac9b3280299a394` |
| Belmont 기준 여부 | 기준 원본 | 미복원 현행 비교 대상 |

공식 뉴스의 macOS Download 링크는 현재 다음 URL로 redirect된다.

`https://downloads.cursor.com/grokbot/stable/darwin-arm64/0.30.0/Grok_Bot_0.30.0.dmg`

Belmont의 hybrid 구조와 별도 확장 기능은 [README.md](../../README.md)에 설명돼 있다. Runtime은 `source/`에서 빌드하지만 polished renderer는 0.18 artifact를 checksum-pinned 입력으로 유지하고 Router UI만 좁게 patch한다.

### 2.1 0.18과 0.30의 제품 계보

0.18과 0.30은 서로 다른 Cursor IDE와 Grok Bot 제품이 아니다. 추출한 두 macOS package는 모두 다음 정체성을 공유한다.

- package name: `sand`
- product name: `Grok Bot`
- bundle identifier: `com.anysphere.sand`
- Electron main entry: `dist/electron-main/main.cjs`

즉 Belmont는 같은 Grok Bot 계보의 0.18 클라이언트를 복원·확장한 저장소이고, 0.30은 그 후속 원본이다.

### 2.2 0.30 설치파일 기반 복원 가능성

판정: `CLIENT_RECOVERY_FEASIBLE / SOURCE_AND_BACKEND_PARITY_UNVERIFIED`

0.30 DMG에서 `app.asar`, Electron main/preload, renderer, local-exec daemon, node-agent coordinator, native launcher와 ABI dependency manifest를 직접 추출했다. 따라서 0.30 설치파일을 immutable specification과 실행 증거로 삼아 새 복원 기준선을 만드는 것은 가능하다.

다만 “복원”은 네 층으로 나눠야 한다.

| 복원 층 | 설치파일만으로 가능한가 | 판정 |
|---|---:|---|
| 원본 0.30 macOS 클라이언트 보존·실행 입력 | 가능 | DMG와 `app.asar`를 해시 고정하고 원본 Electron shell과 함께 보존 가능. 이 조사에서는 macOS 실행 E2E는 수행하지 않음 |
| 0.30 renderer를 유지하는 Belmont fidelity 분기 | 가능성이 높음 | 새 renderer inventory와 package verifier가 필요하며 실제 재패키징 E2E는 아직 수행하지 않음 |
| 0.30 동작을 readable TypeScript로 재구성 | 설치파일을 증거로 가능, 자동 변환은 불가 | minified/compiled bundle을 기준으로 계약·상태·RPC를 다시 복원해야 함 |
| 공식 Cursor/Grok Bot cloud backend까지 복원 | 설치파일만으로 불가 | 계정 entitlement, server flags, managed computer, billing·voice·card 등의 서버 구현은 package 밖에 있음 |

현재 0.18 파이프라인에 0.30 파일만 대입하면 실패하는 직접 원인은 다음과 같다.

1. `scripts/lib/config.mjs`가 버전, DMG 경로·크기·해시, `app.asar` 해시, 앱 이름을 0.18에 고정한다.
2. `scripts/lib/runtime.mjs`는 `dist/host/host-main.cjs`를 필수 입력으로 요구하지만 0.30 ASAR에는 독립 host bundle이 없다.
3. fidelity/verification 경로가 0.18 renderer의 전체 파일 inventory와 특정 Electron/host/coordinator marker를 고정 검증한다.
4. 0.30은 renderer 파일 수와 chunk graph가 크게 바뀌었다. 기존 Router의 네 byte-exact patch anchor를 0.30 renderer에서 대조한 결과 모두 0건이라 현재 patch는 fail-closed한다.
5. 0.30 runtime dependency manifest와 process topology가 0.18과 달라 ABI·utility-process·WSL package closure를 다시 검증해야 한다.
6. 두 설치파일 모두 원본 TypeScript나 source map을 제공하지 않는다. 설치파일은 원본 소스가 아니라 실행 가능한 client bundle과 복원 증거를 제공한다.

두 macOS package의 Electron 버전은 모두 `42.1.0`으로 확인돼 shell ABI 출발점은 유리하다. 그러나 0.30 dependency manifest에서 0.18의 `better-sqlite3`, `whichlang` 등이 빠졌고 현재 package verifier는 일부 0.18 native module을 필수로 요구하므로, 동일 Electron 버전만으로 package closure가 성립한다고 판정할 수는 없다.

따라서 안전한 경로는 현재 0.18 기준선을 덮어쓰는 업그레이드가 아니라, 0.30 artifact·manifest·cache·profile·output을 분리한 병렬 기준선을 만든 뒤 Belmont 확장을 하나씩 재적용하는 것이다.

0.18, 0.19, 0.20, 0.22~0.30의 설치파일을 직접 비교한 버전별 근거와 migration checkpoint는 [0.18 → 0.30 설치파일 변경 원장](grok-bot-018-to-030-change-ledger-2026-08-30.md)에 정리했다.

## 3. 현행 공식 기능셋 대조

판정 라벨:

- `PRESENT`: 현재 Belmont에서 기능 또는 동등한 로컬 경로가 확인됨
- `PARTIAL`: 일부 코드·UI·동작은 있으나 공식 lifecycle과 동등하지 않음
- `MISSING`: 해당 제품 표면이 Belmont에 없음
- `UNVERIFIED`: 코드가 있으나 실사용 폐쇄 루프 미검증
- `BELMONT_EXTENSION`: 공식 0.18/0.30 복원이 아니라 Belmont가 추가한 기능

| 기능군 | 현행 Grok Bot 기능 | Belmont 상태 | 판정·근거 |
|---|---|---|---|
| Bot 생성·프로필 | 이름, title, description, avatar, 최대 50 Bot+group | 0.18 UI와 저장 구조 존재 | `PARTIAL`: 생성·프로필·sidebar 상호작용 일부 라이브 확인. 0.30의 정확한 limit 재검증 없음 |
| Pin·hide·unhide | sidebar pin, 숨김 목록, 복원 | 0.18 renderer 표면 존재 | `PARTIAL`: 기본 UI는 상속, 모든 persistence 경계 미검증 |
| Bot 복제 | profile/settings/skills/routines/avatar 복사, history/memory/attachments 제외 | 0.18 계열 복제 경로 존재 | `UNVERIFIED`: 0.30의 복제 제외·포함 계약을 다시 검증하지 않음 |
| Bot 공개 공유 | 공개 링크로 Bot configuration 복사 | 0.30 `bot-template-share` protocol/RPC 없음 | `MISSING` |
| 장기 memory | Bot별 역할·선호·요약 자동 재사용 | store와 write 경로는 존재 | `PARTIAL/CONFIRMED_GAP`: production prompt context의 `memoryStore`, `memorySnapshots`, `userMemory`, `projectMemory`가 `null` ([host-runner-composition.ts](../../source/host/host-runner-composition.ts)) |
| 일반 chat | text, link, image, file, reply, reaction, redirect, stop | 0.18 renderer와 host 경로 존재 | `PARTIAL`: composer, mention, draft, reaction, search 일부 관찰. login→stream→tool→renderer→interrupt→restart 통합 E2E 없음 |
| Search·command palette | Bot/group/message/file/link/routine 검색과 jump | 0.18 UI 표면, 일부 CDP 관찰 | `PARTIAL` |
| Group chat | 2~6 Bots, `@everyone`, thread, visible handoff | group protocol/UI 존재 | `PARTIAL`: 환경·backend 의존 흐름과 전체 E2E 미검증 |
| Bot 간 메시지 | 비동기 전달, 수신 Bot wake, reply | send/wake 경로 구현 | `PARTIAL/CONFIRMED_GAP`: pending queue와 revive state가 process-memory `Map`/`Set`이라 restart-safe하지 않음 ([agent-to-agent-messaging.ts](../../source/host/extensions/transcript/agent-to-agent-messaging.ts)) |
| Bot roster 발견 | Bot이 다른 Bot/group을 찾아 배정 | 실제 roster provider 후보는 존재 | `CONFIRMED_GAP`: production prompt 조립의 `agentDirectory`·`agentGroups`가 빈 배열 |
| Persistent cloud computer | 사용자별 managed VM, Bot별 screen, 앱 종료 후 계속 실행 | remote connector와 optional local Docker 경로 존재 | `PARTIAL`: current WSL box daemon은 `computerUseSupported:false`; 공식 cloud lifecycle parity 없음 |
| Browser/computer use | click/type/navigation, parallel screens, takeover | browser/computer code와 0.18 UI 흔적 존재 | `UNVERIFIED_CURRENT_RUNTIME`: current WSL profile에서 official computer-use E2E가 성립하지 않음 |
| Local computer execution | Ask/Always/Never, command approval | Shell/file local execution 존재 | `PARTIAL`: core 표본은 동작하지만 cwd/env가 호출 간 유지되지 않고 Codex mode Auto-review는 off |
| Secure takeover/secret | password, 2FA, CAPTCHA, secure secret request | 0.18 secret/permission card 표면 존재 | `PARTIAL`: 공식 browser takeover와 연결된 current E2E 없음 |
| File attachment | image/audio/video/PDF/Office/CSV/JSON/YAML/code/HTML/email/notebook | native-byte staging과 renderer viewer 존재 | `PARTIAL`: upload/preview와 model이 실제 내용을 이해하는 기능을 분리해야 함 |
| PDF 이해 | PDF text extraction 후 reasoning | renderer PDF preview는 작동 | `CONFIRMED_GAP`: agent Read의 PDF extraction worker 미탑재; 명확한 실패로 닫힐 뿐 기능 제공은 아님 |
| Audio/video 이해 | audio/video input과 analysis | attachment bytes 보관 표면 일부 | `MISSING_OR_UNBOUND`: audio transcription과 video analysis parity 증거 없음 |
| 결과 artifact | file/image/link/tool-result card, preview/save/open | 0.18 renderer 기반 preview 존재 | `PARTIAL`: PDF/XLSX viewer 관찰, 전체 format matrix는 미검증 |
| Plugin marketplace | discover, install, update, uninstall | catalog/install/update/uninstall 코드 존재 | `UNVERIFIED`: blanket `MISSING`은 부정확. 실제 full lifecycle acceptance가 없음 |
| Plugin auth | browser OAuth 후 connector tool 사용 | Cursor account/backend 경로 존재 | `PARTIAL`: Codex-local auth가 Cursor access token을 대체하지 못함 |
| Local MCP | stdio initialize/list/call, tool toggle | 직접 `mcp.json` 경로와 stdio call 구현 | `PRESENT/PARTIAL`: echo tool live 확인. pagination, server request/notification, blob/audio fidelity 등 경계 미완 |
| Skills | global skill, Bot별 enable, `/` mention | local `SKILL.md`, workflow store, prompt wiring 존재 | `PARTIAL`: local skill core는 존재, managed/plugin skill lifecycle은 backend 의존 |
| Teach by demonstration | 최대 10분 browser demonstration → draft skill | 연결된 user path 확인 안 됨 | `MISSING_OR_UNVERIFIED` |
| Routine CRUD | create/test/pause/edit/history/delete | automation store·run ledger·cloud sync 코드 존재 | `PARTIAL` |
| Scheduled routine | timezone cron, 앱 종료 중 cloud 실행 | backend definition sync→fire poll→runner wake 코드 존재 | `UNVERIFIED`: `cron 없음`은 틀림. 다만 Codex-local 독립 timer가 아니며 backend auth/lifecycle 의존 |
| Event routine | Slack/GitHub 등의 event trigger | trigger hub·relay 코드 존재 | `UNVERIFIED`: 실제 connector/event E2E 필요 |
| Approval card | allow once, deny, always allow | 0.18 permission/approval 표면 존재 | `PARTIAL` |
| Auto-review | Require Approval 우선, Always Allow, model review | Cursor mode classifier 경로 존재 | `CONFIRMED_RUNTIME_DIFFERENCE`: non-Cursor provider에서는 의도적으로 `isEnabled:false` |
| Notification | per-Bot OS/mobile notification, attention state | OS notification, dock badge, mobile-push 코드 존재 | `PARTIAL/UNVERIFIED`: 현재 settings store는 notification config를 disabled로 정규화하며 live delivery E2E 없음 |
| App update | check/restart-to-update | upstream updater intentionally disabled | `INTENTIONAL_DIFFERENCE` |
| Computer update/recover/reset | durable state를 보존한 VM rebuild/recovery | local/remote connector와 recovery 관련 코드 일부 | `PARTIAL`: 공식 managed computer lifecycle과 동등하다고 검증되지 않음 |
| iPhone | 동일 Bot/chat/routine/connector/computer, dictation/photo/push | native iOS product 없음 | `MISSING` |
| Teams/Enterprise | Cursor SSO, team rules, managed setup, MCP policy, admin computer control | protocol/code 흔적 일부 | `MISSING_AS_PRODUCT`: 운영 가능한 팀 관리 제품 표면 없음 |
| Account·billing | Cursor/SuperGrok entitlement, weekly usage, on-demand billing | local Codex/Pi auth와 local usage counter | `INTENTIONAL_DIFFERENCE`: local counter는 provider invoice가 아님 |
| X connector | X sign-in, post search, timeline, mentions | generic plugin 경로 가능성 | `UNVERIFIED_CURRENT_RUNTIME`: 설치·auth·tool call 성공 경로 미확인 |
| Provider routing | 공식 제품이 관리하는 model/provider routing | Cursor·Claude Code·Codex·OpenRouter Router | `BELMONT_EXTENSION` |
| Local Docker box | 공식 cloud computer와 별개 | optional owned local Docker sandbox | `BELMONT_EXTENSION` |

공식 기능 문서:

- Overview: <https://docs.x.ai/grok-bot/overview>
- Bot management: <https://docs.x.ai/grok-bot/bots>
- Chat and collaboration: <https://docs.x.ai/grok-bot/chat-and-collaboration>
- Files and results: <https://docs.x.ai/grok-bot/files-and-results>
- Computer and apps: <https://docs.x.ai/grok-bot/computer-and-apps>
- Skills and routines: <https://docs.x.ai/grok-bot/skills-routines-and-automations>
- Settings and notifications: <https://docs.x.ai/grok-bot/settings-and-notifications>
- Approvals: <https://docs.x.ai/grok-bot/approvals-security-and-privacy>
- iOS: <https://docs.x.ai/grok-bot/mobile>
- Teams/Enterprise: <https://docs.x.ai/grok-bot/teams-and-enterprises>
- Plans and billing: <https://cursor.com/help/grok-bot/plans>
- X connector announcement: <https://x.ai/news/grok-bot-and-x>

## 4. 0.30 package에서 직접 확인한 신규 표면

아래 항목은 0.18 package와 Belmont `source/`, `frontend/`, `tests/`에서 exact marker가 0건이었고, 0.30 package에서는 UI/card와 RPC 또는 전용 worker가 함께 발견됐다.

### 4.1 `user-form`

- renderer card/view 존재
- email, tel, password, OTP, select, textarea, checkbox field 지원
- required validation
- submit, dismiss, escalate RPC
- 판정: `PACKAGE_IMPLEMENTED / BACKEND_E2E_UNVERIFIED`

### 4.2 `cookie-origin-approval`와 Chrome import worker

- cookie-origin approval request/response stream
- renderer pending approval card
- `chrome-import-worker.cjs`
- Chrome profile 열거
- SQLite Cookie DB 복사 및 WAL recovery
- cookie decrypt와 origin allow-item 수집
- 판정: `PACKAGE_IMPLEMENTED / ACCOUNT_E2E_UNVERIFIED`

### 4.3 `virtual-card-approval`

- amount, currency, merchant, line-item 표시
- approve/deny
- approval URL open
- `resolveVirtualCardApproval` 경로
- 판정: `PACKAGE_IMPLEMENTED / REAL_PAYMENT_BACKEND_UNVERIFIED`

### 4.4 `bot-template-share`

- publish/list/get/delete/visibility RPC
- 공개 링크 복사
- published/deleted 상태
- source agent와 template 연계
- 공식 FAQ도 공개 link를 통한 Bot configuration 복사를 문서화한다.
- 판정: `PACKAGE_IMPLEMENTED / BELMONT_MISSING`

### 4.5 `voice-call`

- `grok-voice-latest`
- `wss://api.x.ai/`
- voice-call credential mint
- `voice-calls/` 기록 지시
- duration receipt와 transcript open UI
- 판정: `PACKAGE_IMPLEMENTED / LIVE_CALL_AND_ENTITLEMENT_UNVERIFIED`

### 4.6 Lingui/i18n

- `@lingui/core`, `@lingui/react`
- Follow System locale
- 21 locale surface와 RTL infrastructure
- 판정: `INFRASTRUCTURE_CONFIRMED / TRANSLATION_COMPLETENESS_UNVERIFIED`

### 4.7 신기능으로 승격하지 않은 marker

`durable_pending_wake_ledger`와 `reattached_after_host_restart`는 0.30 renderer async-task의 `detailKind` 표시 분기에서만 확인됐다. 동일 marker를 생성하는 electron/coordinator producer는 확인되지 않았다.

따라서 현재 판정은 다음과 같다.

- `UI_DISPLAY_COMPATIBILITY_CONFIRMED`
- `DURABLE_RECOVERY_FEATURE_INCONCLUSIVE`

Hidden Chats, Settings, Plugins, Team, Slack overlay의 신규 source-path marker도 code splitting 또는 renderer modularization일 수 있다. 0.18에도 있던 기능을 0.30 신기능으로 중복 계산하지 않았다.

## 5. 사소하지만 재검증해야 하는 정확한 계약

현행 공식 문서에는 기능 유무뿐 아니라 다음과 같은 limit·copy·persistence 계약이 있다.

| 계약 | 공식 동작 | Belmont 0.30 재검증 상태 |
|---|---|---|
| Bot+group limit | 합계 최대 50 | `UNVERIFIED` |
| Group size | 2~6 Bots | `UNVERIFIED` |
| Bot duplicate | profile/settings/skills/routines/avatar 포함 | `UNVERIFIED` |
| Bot duplicate 제외 | history/memory/attachments 제외 | `UNVERIFIED` |
| Routine limit | Bot당 최대 50 | `UNVERIFIED` |
| Routine history | routine별 최근 20 run | `UNVERIFIED` |
| Desktop attachment count | 한 번에 최대 6개 | `UNVERIFIED` |
| Document/image/audio size | 파일당 25MB | `UNVERIFIED` |
| Video size | 파일당 200MB | `UNVERIFIED` |
| Computer screen | shared computer지만 Bot마다 별도 screen | current WSL parity 없음 |
| Computer concurrency | Bot screen당 computer-use task 하나 | `UNVERIFIED` |
| iOS draft | conversation별 draft 보존 | native iOS 없음 |
| iOS routine management | pause/resume만 mobile, edit/test/history/delete는 desktop | native iOS 없음 |
| Notification focus behavior | app focused일 때 알림 억제, badge는 유지 | `UNVERIFIED` |
| Platform | macOS Apple/Intel, Windows x64/Arm64, iPhone iOS 18 | Belmont package/runtime과 불일치 |

이 항목들은 유사 UI 또는 protocol이 있다는 이유로 `PASS`를 줄 수 없다. 0.30 기준 expected behavior와 실제 packaged runtime을 다시 연결한 원장이 필요하다.

## 6. Belmont에만 있는 확장 기능

Belmont는 공식 제품 복원 외에 다음 기능을 추가했다.

1. Inference Router
   - Cursor
   - Claude Code
   - Codex
   - OpenRouter
2. routed provider용 Grok Bot MCP/tool bridge
3. provider별 local request/token usage 기록
4. optional local Docker sandbox
5. Router settings UI를 pinned renderer에 deterministic patch

이 기능들은 Grok Bot 0.30 패리티 항목과 별도로 검증해야 한다. Belmont의 확장 기능이 많다고 공식 feature gap이 상쇄되지는 않는다.

## 7. 기존 0.18 원장과 검증 완성도

[기존 전체 기능 계획](legacy-grok-2026-08-25/grok-bot-full-feature-user-test-plan-2026-08-25.md)은 0.18 표면에서 active 원자 기능 1,500개를 추출했다.

```text
active atomic features     1,500
runnable                   1,292
excluded/deferred            208
```

1,292 runnable queue의 구조적 분류는 다음과 같았다.

```text
PROVISIONAL_PASS             84
REVIEW_REQUIRED             484
UNREACHABLE_CURRENT_BUILD   656
BLOCKED_EXTERNAL             68
total                     1,292
```

그러나 [완전 Pi 기능 감사](belmont-complete-pi-functional-audit-2026-08-28.md)는 durable evidence를 다시 계산해 canonical observation이 90개이고 1,202개는 미관측이라고 교정했다. 즉 `STRUCTURE_COMPLETE_UNVERIFIED`는 분류 구조 완결이지 제품 통과가 아니다.

[남은 작업 문서](belmont-remaining-work-2026-08-29.md)와 현재 미커밋 [풀 테스트 보고서](belmont-full-test-report.md)는 이후 live sweep과 source audit을 추가했지만, 자체적으로 여러 false-green을 뒤집었다. 따라서 단순 PASS 합계로 제품 완성도를 계산하면 안 된다.

## 8. 확인된 주요 gap

### P0 — 제품 핵심 흐름

1. Memory 자동 recall
   - write/store는 존재
   - production prompt injection이 끊겨 있음
2. Restart-safe Bot handoff
   - send/wake는 존재
   - pending delivery/result가 process-memory에 머묾
3. Bot roster/discovery
   - 실제 roster provider 후보는 존재
   - production prompt context에는 빈 배열 전달
4. Computer/browser parity
   - connector와 local box는 존재
   - current WSL runtime은 공식 managed cloud computer와 동등하지 않음
5. Media understanding
   - preview/staging과 model ingestion을 분리해야 함
   - PDF extraction, audio transcription, video analysis gap

### P1 — lifecycle 완결성

1. Plugin full lifecycle acceptance
2. Routine automatic firing·history·restart lifecycle
3. Notification delivery·focus suppression·restart lifecycle
4. Auto-review의 non-Cursor local 대체
5. UI account 상태와 실제 Pi/Codex authentication의 진실원 통합
6. 공식 usage/billing과 local counter 구분

### P2 — 0.30 drift와 세부 UX

1. Bot template public sharing
2. User forms
3. Cookie-origin approval와 Chrome import
4. Virtual-card approval
5. Voice call
6. i18n/RTL
7. 0.30 numeric limits와 persistence semantics
8. iOS와 Teams/Enterprise 제품 표면

## 9. 권장 재기준화 순서

1. **0.30 분모 재추출**
   - 공식 문서
   - 0.30 renderer cards/RPC
   - electron/coordinator/worker
   - settings·background state transitions
2. **0.18 원장과 stable ID mapping**
   - retained
   - changed semantics
   - removed
   - new in 0.30
3. **핵심 closed-loop acceptance**
   - login→stream→tool→renderer→interrupt→restart
   - memory write→new turn recall
   - Bot A→Bot B→result→restart recovery
   - attachment→model understanding→artifact result
4. **backend lifecycle acceptance**
   - plugin
   - routine
   - notification
   - approvals
5. **사소한 UI/limit sweep**
   - limits
   - empty/loading/error states
   - focus/keyboard
   - copy/delete/persistence semantics

## 10. 재현 명령

아래 명령은 저장소가 아니라 `/tmp`에 공식 0.30 artifact를 내려받고 확인하는 예시다.

```bash
grok030_audit_dir="$(mktemp -d /tmp/grokbot-030-audit.XXXXXX)"
curl -L \
  https://downloads.cursor.com/grokbot/stable/darwin-arm64/0.30.0/Grok_Bot_0.30.0.dmg \
  -o "$grok030_audit_dir/Grok_Bot_0.30.0.dmg"
sha256sum "$grok030_audit_dir/Grok_Bot_0.30.0.dmg"
7z x "$grok030_audit_dir/Grok_Bot_0.30.0.dmg" -o"$grok030_audit_dir/dmg"
node_modules/.bin/asar extract \
  "$grok030_audit_dir/dmg/Grok Bot.app/Contents/Resources/app.asar" \
  "$grok030_audit_dir/asar"
jq -r '.version' "$grok030_audit_dir/asar/package.json"
```

Belmont 기준 원본은 다음 명령으로 확인한다.

```bash
sha256sum \
  research-archives/original/0.18.0/macos-arm64/Grok_Bot_0.18.0.dmg \
  research-archives/original/0.18.0/windows-x64/Grok_Bot_0.18.0_Setup.exe
```

현재 실행 중 runtime의 read-only 상태는 다음으로 확인한다.

```bash
node scripts/belmont-cdp.mjs status
git status --short --branch
```

## 11. 한계와 verdict 변경 조건

### 현재 한계

- Grok Bot은 closed-source packaged product라 server-side flag와 account entitlement를 package inspection만으로 모두 알 수 없다.
- 0.30 package에 구현된 card/RPC가 모든 계정에서 rollout됐다고 단정할 수 없다.
- current Belmont live profile은 공식 Cursor/Grok Bot cloud account와 다른 Codex/Pi local execution 경로를 사용한다.
- 0.18 원장은 0.30 feature drift를 포함하지 않는다.
- 코드 존재와 실제 packaged user flow는 동일한 증거가 아니다.

### verdict를 바꿀 수 있는 증거

다음이 모두 충족되기 전에는 `0.30_PARITY_VERIFIED`로 승격하지 않는다.

1. 0.30 atomic feature denominator 고정
2. 모든 official/current entry point를 row에 연결
3. 정상·경계·오류·지속성·재시작 oracle 정의
4. 핵심 lifecycle을 실제 packaged runtime에서 관찰
5. account/backend 의존 기능은 실제 entitlement로 E2E 수행
6. independent adversarial review가 headline gap과 PASS를 재계산
7. raw screenshots/logs/artifacts와 verdict ledger를 hash로 고정

## 12. 최종 판정

```text
Belmont 0.18 structural reconstruction  = BROAD
Belmont 0.18 live product parity         = NOT ESTABLISHED
Belmont vs current Grok Bot 0.30 parity  = REFUTED
Belmont-only extensions                  = PRESENT, SEPARATE ACCEPTANCE REQUIRED
0.30 package-only feature backend E2E    = PARTIALLY UNVERIFIED
```

이 문서는 기능 부재를 과장하지 않는다. Cron, notification, plugin lifecycle은 관련 코드가 존재하므로 `없음`이 아니라 `backend/live lifecycle 미검증`으로 판정했다. 반대로 memory 자동 recall 단절, restart-비내구성 Bot 메시지, media 이해 gap, non-Cursor Auto-review off, native iOS/Teams 부재, 공식 billing/account 차이는 현재 source와 공식 문서 대조에서 유지되는 핵심 차이다.
