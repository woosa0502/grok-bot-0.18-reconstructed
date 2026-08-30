# Grok Bot 0.18 → 0.30 설치파일 변경 원장

- 기준일: 2026-08-30 KST
- 대상: macOS arm64 Grok Bot desktop package
- 저장소: Belmont (`/home/hoon/work/Belmont`)
- 상태: `VERIFIED_ARTIFACT_LINEAGE / SEMANTIC_DIFF_PARTIAL / BACKEND_E2E_UNVERIFIED`

## 0. 결론

0.18에서 0.30까지 이번 조사 대상으로 정의한 client-side 구조·dependency·exact marker 변경은 알 수 있다. 0.18과 0.30 두 끝점만 비교해도 누적 차이를 얻을 수 있고, 중간 설치파일을 함께 비교하면 marker가 처음 관찰된 버전까지 좁힐 수 있다. 다만 minified bundle의 모든 의미 변화까지 전수 판독했다는 뜻은 아니다.

이번 조사에서는 0.18, 0.19, 0.20, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.30의 DMG와 `app.asar`를 직접 추출·해시 검증했다. 0.21은 두 공개 URL 계열에서 HTTP 403이어서 `UNAVAILABLE_AT_CHECK_TIME`으로 남긴다.

따라서 Belmont의 0.30 전환은 0.18을 버리고 처음부터 기능을 추측하는 작업이 아니다. 다음과 같은 **증분 복원**이 맞다.

```text
0.18 baseline
  → 0.19 i18n 기반
  → 0.22 runtime/coordination 계약 변화
  → 0.24 Bot 공유·harness
  → 0.25 process topology 대전환
  → 0.26 package/dependency rebase
  → 0.29 cookie approval
  → 0.30 virtual card·voice-call harness·messages-mac
```

단, 설치파일이 알려주는 것은 client bundle, UI, IPC/RPC, local process, packaged dependency 변화다. 서버 구현, 계정 entitlement, rollout flag, 실제 cloud lifecycle은 설치파일 diff만으로 확정할 수 없다.

## 1. 조사 방법과 판정 라벨

각 버전에서 다음을 독립적으로 비교했다.

1. DMG SHA-256
2. `app.asar` SHA-256
3. `package.json`의 name, version, productName, main, dependencies
4. ASAR 전체 파일 수와 renderer 파일 수
5. Electron main, host, coordinator, preload, worker, native dependency topology
6. 기능별 exact marker의 전체 bundle 출현 여부
7. 현행 공식 문서가 설명하는 제품 동작

판정 라벨:

- `DIRECT_ARTIFACT`: 설치파일 또는 ASAR에서 직접 관찰
- `FIRST_OBSERVED`: 확보한 package 중 marker가 처음 나타난 버전
- `PACKAGE_IMPLEMENTED`: UI와 RPC/worker 등 둘 이상의 client 구현층 확인
- `BINARY_CHANGED_ONLY`: hash·size는 변했지만 의미를 확정할 marker가 없음
- `BACKEND_E2E_UNVERIFIED`: client 구현은 있으나 실제 계정/backend 폐쇄 루프 미검증
- `UNAVAILABLE_AT_CHECK_TIME`: 공개 URL에서 artifact를 확보하지 못함

`FIRST_OBSERVED`는 공식 release note의 “출시 버전”과 동일하다고 가정하지 않는다. marker가 feature flag 뒤에 숨었거나 서버 rollout 시점이 달랐을 수 있다.

## 2. 검증된 설치파일 계보

| Version | DMG SHA-256 | `app.asar` SHA-256 | 상태 |
|---|---|---|---|
| 0.18.0 | `a253ccd8aab01e083f9812a0264354c5034d8ba7f0610bbb557e82ae77d203eb` | `6665408168466f9cacc6087e917890c17f59d2e2e9c2404a5c4a59ad79c1de58` | repo archive와 일치 |
| 0.19.0 | `4b8c34bad86d73c64a3f46d8fccb54d322681eb31b9eedb1d6cedd5d59e5cca1` | `223730583e9671bc283209c1bb81b85c6195b75bf4b92af084f38abe5c0a14cb` | 검증 |
| 0.20.0 | `73dfc1656a0e122a9a98bdcf1f49da5ec5475e156977c8730d207bfe01281a42` | `1e41f9da52be5d2ff24892b150a74d3d0145659cf6cbd83e9476d025865fb997` | 검증 |
| 0.21.0 | — | — | `UNAVAILABLE_AT_CHECK_TIME` |
| 0.22.0 | `85da6d6cb40ebcaaacae5f3bbea6c7d4fd1a741c0fc7c53bf293114df006e00d` | `450eef2a404d7003266a49856125ad8b5c68b17071a02c98a39245f6aa71f6e7` | 검증 |
| 0.23.0 | `25ccab4a23248053ede5219cf243be76b90bd459e5f410b070c82d86a6d80b61` | `079ae827d1ace6976143fac44c1381dff37ac7d5ac03b3cb1f890ab28296e023` | 검증 |
| 0.24.0 | `255873da42d2f19b27d7f34cdfb5b058002095ade883d8b321d6494f3cf6c615` | `41f7d5008db4edcb198d9e466c9c1e776bb8a75a7651951257ff9a4f885a4540` | 검증 |
| 0.25.0 | `7fbeb95bc862ce529d31497cdb615a69a212d45e31ecf2c7a2355b8c5e31b16b` | `489570ff39626d657605573a05b1a24e1c1a27bd0fd57048fac644c38835c686` | 검증 |
| 0.26.0 | `1bbae670567dc9781300793e48f853933362481d11cbb2465463fb55ea05dcce` | `7e881cd7a3a77df23f061a02ab9ecc1484fd1feb8b3d6d30075a8495acd773cb` | 검증 |
| 0.27.0 | `1dc4cce3bb8ce35e90c481f8fb1d27ddfe351685b9abbed7638298742ec5d866` | `8517a4ca7e7c986f1321de6165720645e4889df23687a4231a529b6b2a252162` | 검증 |
| 0.28.0 | `8f4fe71a4e53d1232602e24bc2048272c458fb7538f525d1a6c3290578b686aa` | `14f6b8cda72072440f9ea44cce5da37f307cd282c5e965951a6afa9d3a9fe0cc` | 검증 |
| 0.29.0 | `2b013b6e8934e39399bbeae9431c48ffe021e064e07420b1e07090f4d55c653d` | `f3f242c2f8068479e59ed8cf5ffd41d74f57be709ea478494782ead00fdc17ac` | 검증 |
| 0.30.0 | `255116458e104203f045a21e5310161f3600eb751c06879a6efe3487f08fd53e` | `4bbcd2f7af9f54cd1b354bd7b3c8376da569657a80f6560edac9b3280299a394` | 검증; current Homebrew cask도 같은 DMG hash를 기재 |

모든 확보 버전은 다음 identity를 유지한다.

- package name: `sand`
- product name: `Grok Bot`
- bundle identifier: `com.anysphere.sand`
- main: `dist/electron-main/main.cjs`
- Electron framework: `42.1.0`

## 3. 구조 변화 원장

| Version | ASAR files | Renderer files | 독립 host | Chrome worker | Dev controls | Electron main bytes | Coordinator bytes | Copied deps |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.18 | 681 | 131 | yes | no | yes | 18,570,417 | 143,614 | 47 |
| 0.19 | 682 | 132 | yes | no | yes | 8,193,929 | 71,546 | 47 |
| 0.20 | 682 | 132 | yes | no | yes | 8,202,709 | 71,546 | 47 |
| 0.22 | 710 | 160 | yes | no | yes | 8,598,702 | 87,109 | 47 |
| 0.23 | 710 | 160 | yes | no | yes | 8,605,598 | 87,109 | 47 |
| 0.24 | 751 | 201 | yes | no | yes | 8,675,818 | 89,075 | 47 |
| 0.25 | 783 | 239 | no | yes | no | 7,492,284 | 1,030,710 | 47 |
| 0.26 | 349 | 316 | no | yes | no | 6,246,797 | 437,405 | 6 |
| 0.27 | 349 | 316 | no | yes | no | 6,253,910 | 440,114 | 6 |
| 0.28 | 373 | 340 | no | yes | no | 6,436,061 | 455,420 | 6 |
| 0.29 | 376 | 343 | no | yes | no | 6,453,700 | 468,068 | 6 |
| 0.30 | 414 | 381 | no | yes | no | 7,192,328 | 512,511 | 6 |

`Copied deps`는 `dist/deps/runtime-deps-manifest.json`의 `copied` 배열과 대응하는 top-level package directory inventory의 개수다. 두 계산은 일치하며, `package.json` 전체 dependency 개수가 아니다.

핵심 구조 경계는 두 번이다.

1. **0.24 → 0.25 process topology 전환**
   - `dist/host/host-main.cjs` 제거
   - `dist/electron-dev-controls/main.cjs` 제거
   - `dist/electron-main/chrome-import-worker.cjs` 추가
   - coordinator가 89,075 bytes에서 1,030,710 bytes로 증가
   - 현재 Belmont 0.18 bootstrap의 host 필수 조건과 production activation anchor가 이 경계에서 깨진다.
2. **0.25 → 0.26 package closure 전환**
   - copied runtime dependency가 47개에서 6개로 축소
   - `better-sqlite3`, `whichlang` 등 0.18 계열 native closure 제거
   - renderer가 더 많은 lazy/code-language chunk로 분할

파일 수 감소는 기능 제거 개수와 동일하지 않다. 0.26은 dependency packaging과 code splitting 방식이 바뀌었기 때문에 파일 수와 bundle 크기만으로 기능 증감을 판정하지 않는다.

## 4. 기능 marker 최초 관찰 버전

| 기능·marker | 0.18 | 0.19 | 0.20 | 0.22 | 0.23 | 0.24 | 0.25 | 0.26 | 0.27 | 0.28 | 0.29 | 0.30 | 최초 관찰 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `@lingui/core`·`@lingui/react` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 0.19 |
| `durable_pending_wake_ledger` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 0.22 |
| `reattached_after_host_restart` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 0.22 |
| `bot-template-share` | — | — | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 0.24 |
| `user-form` | — | — | — | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 0.25 |
| `grok-voice-latest` | — | — | — | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 0.25 |
| Chrome import worker | — | — | — | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 0.25 |
| `cookie-origin-approval` | — | — | — | — | — | — | — | — | — | — | ✓ | ✓ | 0.29 |
| `virtual-card-approval` | — | — | — | — | — | — | — | — | — | — | — | ✓ | 0.30 |
| `grok-bot-voice-call-harness` | — | — | — | — | — | — | — | — | — | — | — | ✓ | 0.30 |
| `@anysphere/messages-mac` | — | — | — | — | — | — | — | — | — | — | — | ✓ | 0.30 |

주의:

- `durable_pending_wake_ledger`와 `reattached_after_host_restart`는 0.22부터 renderer 표시 marker가 존재한다. producer와 실제 restart recovery를 확인하지 않았으므로 durable 기능 완료로 승격하지 않는다.
- `grok-voice-latest`는 0.25부터 존재하지만 전용 `grok-bot-voice-call-harness`는 0.30에서 처음 나타난다. 0.25를 완성된 voice call 출시 버전으로 단정하지 않는다.
- Chrome worker는 0.25부터 있으나 `cookie-origin-approval` UI/RPC marker는 0.29부터다. worker 추가와 승인 lifecycle 추가를 별도 변경으로 본다.

## 5. 버전별 해석

### 0.18 → 0.19

- Lingui core/react 추가
- Electron main bundle이 18.57 MB에서 8.19 MB로 크게 재편
- renderer와 host topology는 유지
- 판정: `I18N_FOUNDATION + MAIN_BUNDLE_REPACK`

### 0.19 → 0.20

- 추적 dependency와 구조 수치 변화는 거의 없음
- Electron main과 ASAR hash는 변경
- 판정: `BINARY_CHANGED_ONLY`; 세부 동작 diff는 별도 symbol/string delta 필요

### 0.20 → 0.22

- `@anysphere/dune`, `@anysphere/mcp-core`, `@anysphere/metrics` 추가, `@sand/dune` 제거
- renderer 132 → 160 files
- durable wake/restart 표시 marker 최초 관찰
- 판정: `RUNTIME_CONTRACT_REBASE / DURABILITY_UI_MARKERS_ONLY`

### 0.22 → 0.23

- 추적 marker·dependency·topology 변화 없음
- binaries와 ASAR hash는 변경
- 판정: `BINARY_CHANGED_ONLY`

### 0.23 → 0.24

- `@anysphere/grok-bot-harness` 추가
- `bot-template-share` host/renderer marker 최초 관찰
- renderer 160 → 201 files; settings/general/usage 등의 lazy chunk 분리 확대
- publish RPC와 실제 공유 폐쇄 루프는 이 marker scan만으로 확정하지 않음
- 판정: `BOT_TEMPLATE_SHARE_MARKERS + HARNESS_FOUNDATION`

### 0.24 → 0.25

- 독립 host와 dev-controls bundle 제거
- Chrome import worker 추가
- coordinator 대폭 확대
- `user-form` 최초 관찰
- `grok-voice-latest`와 voice 관련 UI 자산 최초 관찰
- `rehype-katex` 제거, `katex` `^0.16.21` → `^0.16.45`
- 판정: `MAJOR_ARCHITECTURE_CUTOVER + USER_FORM + INITIAL_VOICE_PATH`

### 0.25 → 0.26

- native/runtime copied dependency 47 → 6
- `@anysphere/otel-proto`, `@sentry/node-core` 추가
- `@sentry/node`, `highlight.js` 제거
- renderer 239 → 316 files; 언어별 code rendering chunk 확대
- 판정: `PACKAGE_CLOSURE_REBASE + RENDERER_MODULARIZATION`

### 0.26 → 0.27

- 추적 dependency와 feature marker 변화 없음
- Electron/coordinator binaries 변경
- 판정: `BINARY_CHANGED_ONLY`

### 0.27 → 0.28

- `ws` 8.20.0 → 8.21.3
- renderer 316 → 340 files
- locale 이름을 가진 renderer asset 추가; 번역 완성도와 실제 노출 범위는 미검증
- 판정: `TRANSPORT_PATCH + LOCALE_ASSET_ADDITION`

### 0.28 → 0.29

- `cookie-origin-approval` UI/RPC 최초 관찰
- computer 이름의 lazy chunk가 추가됐지만 semantic surface 변화는 별도 판독 필요
- 판정: `COOKIE_IMPORT_APPROVAL_LIFECYCLE`

### 0.29 → 0.30

- `virtual-card-approval` UI/RPC 최초 관찰
- `@anysphere/grok-bot-voice-call-harness`와 `@anysphere/messages-mac` 추가
- renderer 343 → 381 files, Electron main과 coordinator 확대
- 추가 locale 이름 renderer assets; 번역 완성도는 미검증
- 판정: `VIRTUAL_CARD + VOICE_CALL_HARNESS + MAC_MESSAGES`

## 6. 알 수 있는 것과 남는 한계

| 질문 | 판정 | 근거 |
|---|---|---|
| 어떤 client 파일이 추가·삭제·변경됐나 | 알 수 있음 | 전체 ASAR manifest와 hash diff |
| UI/RPC/worker marker가 어느 package에서 처음 보이나 | 알 수 있음 | 버전별 exact marker scan |
| process topology가 언제 바뀌었나 | 알 수 있음 | host/dev-controls/worker/coordinator 직접 비교 |
| Belmont의 어떤 0.18 anchor가 깨지는가 | 알 수 있음 | 현재 bootstrap·patch·verifier와 package diff |
| 기능이 모든 계정에 실제 rollout됐나 | 설치파일만으로 모름 | server flag와 entitlement 필요 |
| cloud computer·routine·plugin·결제가 실제로 끝까지 동작했나 | 설치파일만으로 모름 | 공식 계정/backend E2E 필요 |
| 원본 TypeScript를 그대로 회수할 수 있나 | 불가 | package에 compiled/minified bundles만 있고 source map 없음 |

0.20, 0.23, 0.27처럼 `BINARY_CHANGED_ONLY`로 남은 release의 의미 변화와 minified symbol/string 전체 delta는 후속 전수 diff 대상이다. 그러므로 이 문서는 검증된 lineage와 선택한 구조·기능 marker 원장이며, 모든 내부 조건문과 사소한 UX 변경까지 완료한 최종 semantic diff는 아니다.

### 6.1 바이너리 완벽 복원 경계

여기서 `완벽 복원`은 네 등급으로 분리한다.

| 등급 | 의미 | 합격 조건 |
|---|---|---|
| `BIT_EXACT` | canonical artifact byte가 동일 | DMG/ASAR는 whole-file SHA-256 일치. App bundle은 모든 file hash, symlink target, executable mode, 보존 대상 filesystem metadata inventory가 일치해야 함. 서명 byte 보존과 Apple codesign 유효성은 별도 판정 |
| `COMPONENT_EXACT` | 앱 전체는 다르지만 특정 원본 component는 byte 동일 | component별 SHA-256과 경로가 원본 inventory와 일치 |
| `BEHAVIORAL_EQUIVALENT` | binary는 다르지만 사전등록된 유한 시나리오에서 관찰 가능한 동작이 동일 | 동일 version·account·environment 범위에서 정상·오류·지속성·재시작 E2E와 protocol transcript가 일치 |
| `UNRECOVERABLE_FROM_INSTALLER` | 설치파일만으로 원본을 얻을 수 없음 | 원본 source, server, 계정·사용자 state 등 package 밖 자료 필요 |

#### A. 설치파일만으로 `BIT_EXACT` 복원 가능한 것

다음은 decompile이나 재작성 없이 원본 byte를 그대로 보존할 수 있다.

- 원본 DMG 자체
- DMG 안의 `Grok Bot.app` 전체
- 원본 `app.asar`
- renderer HTML/JavaScript/CSS/font/image/locale asset
- Electron main과 preload bundle
- 해당 버전에 포함된 host, coordinator, local-exec daemon, worker bundle
- native launcher와 ASAR-unpacked native module
- `Info.plist`, helper executable, Electron framework, code-signature resource
- packaged `package.json`과 runtime dependency manifest

이 등급의 복원 방법은 **원본을 다시 빌드하는 것**이 아니라 검증된 DMG/ASAR byte를 그대로 보존·복사하는 것이다. 이번 조사에서 `BIT_EXACT_ARCHIVE_VERIFIED`인 대상은 12개 원본 DMG와 그 안의 `app.asar` 파일이다.

DMG 내부 app/component byte는 회수 가능하지만, 추출된 `.app` 전체의 regular-file manifest, symlink target, executable mode, xattr/resource fork 등 filesystem metadata와 Apple signature validity는 검증하지 않았다. 또한 이 조사 환경은 WSL이므로 원본 macOS app의 실제 launch와 Apple code-signature 검증도 수행하지 않았다. 따라서 DMG/ASAR만 `BIT_EXACT_ARCHIVE_VERIFIED`이며 `.app` 전체는 `BIT_EXACT_RECOVERABLE / MANIFEST_SIGNATURE_UNVERIFIED`다.

#### B. `COMPONENT_EXACT`로 복원 가능한 것

Belmont가 자체 코드나 Router를 추가하더라도 다음 원본 component를 수정하지 않고 포함하면 component 단위의 완벽 보존은 가능하다.

- 0.30 renderer 전체 또는 선택한 원본 chunk
- original Electron framework와 helper
- original preload/main/coordinator/local-exec bundle
- original native tools와 static resources

그러나 하나라도 patch하면 그 파일은 더 이상 `COMPONENT_EXACT`가 아니다. 예를 들어 0.30 renderer에 Router 코드를 직접 삽입하면 renderer hash가 바뀌므로 `PATCHED_DERIVATIVE`다.

원본 component와 Belmont 확장을 분리된 sidecar, 별도 process, IPC adapter로 연결하면 원본 component hash를 유지할 여지는 있다. 그래도 **Belmont 전체 앱**은 원본 Grok Bot과 다른 product artifact이므로 `BIT_EXACT`라고 부를 수 없다.

Component byte가 정확하다는 사실은 modified Belmont 안에서 그 component가 실제로 load·run된다는 것, 전체 app code-signature가 유효하다는 것, 다른 component와 ABI가 맞는다는 것을 보장하지 않는다.

#### C. binary가 달라지는 `BEHAVIORAL_EQUIVALENT` 복원

다음은 설치파일에서 일부 client contract를 추출해 `RECONSTRUCTED_CANDIDATE`를 작성할 수 있지만 원본 byte 복원은 아니며, installer만으로 `BEHAVIORAL_EQUIVALENT`를 확정할 수도 없다.

- Electron main의 창·protocol·IPC 동작
- preload API surface
- coordinator routing
- user-form, cookie approval, virtual-card approval 같은 client contract
- settings, persistence, notification, recovery state machine
- Belmont의 Codex·Claude·OpenRouter·Docker 경로는 `CONTRACT_COMPATIBLE_SUBSTITUTE` 또는 `MODIFIED_RECONSTRUCTION`이며 원본 backend 전체와의 `BEHAVIORAL_EQUIVALENT`가 아님

이 등급은 build 성공이나 UI 존재만으로 통과하지 않는다. 최소 합격 조건은 다음과 같다.

1. 같은 입력에 같은 RPC method·payload·state transition을 생성
2. 정상·취소·거절·timeout·재시작 결과가 원본 관찰과 일치
3. renderer 표시와 backend/client acknowledgement가 연결
4. persistence와 recovery가 새 process에서 재현
5. 독립 verifier가 raw transcript와 state ledger를 비교

이 조건을 통과하기 전에는 `RECONSTRUCTED_CANDIDATE`이며 `BEHAVIORAL_EQUIVALENT`가 아니다.

#### D. 설치파일만으로 완벽 복원할 수 없는 것

| 대상 | 불가능한 이유 | 가능한 대안 |
|---|---|---|
| 원본 TypeScript·React source | package에는 compiled/minified bundle만 있고 source map이 없음 | readable source를 새로 재구성하되 원본 source라고 부르지 않음 |
| 원본 monorepo와 build graph | workspace package source, lockfile, internal build config가 없음 | package surface와 bundle evidence로 새 build graph 작성 |
| 공식 cloud backend | server executable과 database가 installer에 없음 | 원본 endpoint 사용 또는 local substitute 구현 |
| account entitlement·feature flag | 계정과 server rollout state | 실제 권한 계정으로 E2E 검증 |
| persistent cloud computer | VM image, orchestration, storage가 package 밖에 있음 | 별도 Docker/VM runtime 구현; 공식 동등성은 별도 판정 |
| plugin catalog·OAuth backend | catalog service, provider credential, callback state가 외부에 있음 | 실제 service 연결 또는 local registry 대체 |
| cloud routine/event trigger | scheduler와 event relay가 server-side | local scheduler/relay 구현; 앱 종료 중 동작 별도 검증 |
| billing·virtual card·voice credential mint | 결제·credential server가 외부에 있음 | UI/contract는 복원하고 실제 service는 원본 또는 대체 backend 필요 |
| 기존 사용자 chat·memory·files | user DB와 cloud storage는 installer에 없음 | 계정 sync 또는 별도 backup 필요 |
| Keychain secret·login session | machine/user-scoped secure storage | 사용자가 다시 인증하거나 별도 승인된 migration 필요 |
| iOS·Windows client | macOS arm64 DMG에는 다른 플랫폼 binary가 없음 | 해당 플랫폼 installer를 별도로 확보 |
| macOS binary의 WSL/Linux native 실행 | Mach-O와 macOS framework는 Linux ABI가 아님 | Linux/Electron port를 새로 빌드; byte-perfect 불가 |

#### E. 수정·재패키징 시 반드시 강등되는 항목

다음 작업의 **최종 결과 byte·metadata·signature가 원본과 달라지면** 원본 앱 전체는 `BIT_EXACT`에서 탈락한다.

- ASAR를 다시 pack한 결과 `app.asar` SHA-256 또는 보존 대상 metadata가 원본과 달라짐
- renderer 문자열 patch
- main/preload/coordinator 교체
- `Info.plist`나 bundle ID 변경
- helper 또는 native dependency 교체
- ad-hoc 재서명
- Belmont source나 별도 dependency를 ASAR에 삽입

기능이 동일하게 보이더라도 요구 범위의 최종 hash·metadata·signature byte가 원본과 다르면 정확한 라벨은 `MODIFIED_RECONSTRUCTION`이다. Repack 뒤에도 whole-file hash가 원본과 같다면 해당 artifact는 byte-exact다.

### 6.2 최종 판정표

| 복원 목표 | 현재 판정 |
|---|---|
| 0.18·0.19·0.20·0.22~0.30 DMG/ASAR 보존 | `BIT_EXACT_ARCHIVE_VERIFIED` |
| 원본 0.30 macOS app 전체 추출 보존 | `BIT_EXACT_RECOVERABLE_FROM_DMG / MACOS_MANIFEST_AND_SIGNATURE_UNVERIFIED` |
| 원본 0.30 macOS app 실제 실행 | `UNVERIFIED_IN_CURRENT_WSL_ENVIRONMENT` |
| 원본 renderer/binary를 유지한 Belmont 조합 | `ARCHIVAL_COMPONENT_EXACT_FEASIBLE / EXECUTABLE_INTEGRATION_AND_PACKAGE_SIGNATURE_UNVERIFIED` |
| readable TypeScript 기반 0.30 client 재구성 | `READABLE_RECONSTRUCTION_CANDIDATE_FEASIBLE / BEHAVIORAL_EQUIVALENCE_UNVERIFIED / NOT_BIT_EXACT` |
| Belmont Router를 넣은 0.30 renderer | `PATCHED_DERIVATIVE / NOT_COMPONENT_EXACT` |
| 공식 backend 포함 전체 제품 복제 | `UNRECOVERABLE_FROM_INSTALLER_ALONE` |
| 기존 사용자 계정·대화·secret까지 복원 | `REQUIRES_ACCOUNT_OR_BACKUP_DATA` |

### 6.3 Belmont의 실제 목표 환경

이 프로젝트의 목표는 공식 Cursor backend를 포함한 Grok Bot 복제가 아니다.

```text
Windows Grok Bot 0.30 UI
          ↕
Windows ↔ WSL bridge
          ↕
Belmont WSL host
          ↕
Codex OAuth·inference
          ↕
Belmont tools·MCP·transcript·local storage
```

현재 공식 update endpoint에서 Windows x64 `0.30.0` installer URL을 확인했다. Windows 원본 UI 기준선은 이 installer를 별도로 추출·해시 검증한 뒤 정한다.

그대로 재사용할 영역:

- WSL host lifecycle과 격리 profile
- Codex OAuth login/logout/status/model 조회
- Codex streaming·reasoning·tool projection
- Belmont의 tool, MCP, subagent, transcript 소유권
- local storage와 WSL/Docker 실행 경로

새로 연결할 영역:

- Windows launcher가 `wsl.exe`로 Belmont host 시작
- WSL gateway URL/token을 Windows Electron에 전달
- Windows Electron과 WSL host의 공동 종료·재연결
- 0.30 renderer가 기대하는 preload/main RPC를 Belmont bridge에 연결
- Windows file dialog, attachment, deep-link, notification 경계

목표에서 제외할 Cursor 전용 영역:

- Cursor account login과 access token
- Cursor inference backend
- Cursor Cloud Computer와 updater
- Cursor billing·usage 화면
- Cursor Statsig/telemetry/Sentry
- Cursor token이 필요한 image generation·marketplace·일부 plugin backend

Provider 선택 UI도 필요하지 않다. Codex 단일 계정·모델 설정 화면으로 단순화할 수 있다.

현재 `npm run wsl:start`는 Windows Electron이 아니라 WSLg의 Linux Electron을 실행한다. 따라서 기존 WSL host는 재사용할 수 있지만 Windows launcher/bridge는 새로 구현·검증해야 한다.

### 6.4 개인용 기능 분류

판단 기준은 "Grok Bot 0.30에 있느냐"가 아니라 **한 사람이 Windows에서 Belmont를 열고, WSL의 Codex로 실제 일을 끝낼 때 필요한가**이다. 0.30 renderer는 UI 기준선으로 사용할 수 있지만, renderer 안의 모든 메뉴와 공식 backend 기능을 구현할 필요는 없다.

#### A. 1차 완성에 반드시 필요

| 기능 | 처리 | 이유 |
|---|---|---|
| Windows 앱 창과 기본 0.30 채팅 UI | 가져옴 | 사용자가 직접 만지는 기본 화면 |
| Windows → WSL 실행 bridge | 새로 구현 | Windows 앱이 Belmont host를 시작하고 다시 연결해야 함 |
| Codex OAuth 로그인·로그아웃·상태·모델 선택 | 유지·단순화 | Cursor 계정 없이 사용할 유일한 인증·추론 경로 |
| 메시지 전송·streaming·중지·재시도 | 유지하고 0.30 UI에 연결 | 에이전트의 최소 대화 폐쇄 루프 |
| Shell·파일·MCP tool과 승인 카드 | 유지하고 UI 계약 연결 | 개인용 로컬 작업의 핵심 실행 기능 |
| 대화 기록·초안·로컬 저장 | 유지 | 앱을 다시 열어도 작업을 이어가기 위해 필요 |
| Windows 파일 선택과 Windows↔WSL 경로 변환 | 새로 구현 | 첨부파일과 결과 파일을 실제로 열고 저장하기 위해 필요 |
| host 재시작·재연결·single-instance 처리 | 보강 | WSL이나 앱이 다시 떠도 고장 난 화면으로 남지 않아야 함 |
| Codex 실제 인증 상태를 표시하는 설정 화면 | 보강 | 가짜 Cursor 로그인 상태가 아니라 실제 사용 가능 여부를 보여줘야 함 |

#### B. 개인용으로 가치가 커서 2차에 권장

| 기능 | 처리 | 이유 |
|---|---|---|
| Memory 저장 후 다음 대화에서 자동 recall | 현재 단절 보수 | 반복 설명을 줄이는 개인 비서 핵심 기능 |
| Bot 프로필·pin·hide·복제 | 필요한 부분만 유지 | 작업별 Bot을 나누는 데 유용하지만 공식 50개 limit는 불필요 |
| 검색·command palette | 유지·재검증 | 오래 쓸수록 대화와 파일 찾기에 유용 |
| 이미지·텍스트·코드·PDF 첨부와 실제 model ingestion | 단계적으로 보강 | preview만 아니라 Codex가 내용을 읽어야 의미가 있음 |
| 로컬 Skills | 유지 | marketplace 없이도 개인 자동화를 재사용할 수 있음 |
| 로컬 Routine | cloud sync 대신 local scheduler로 구현 | WSL host가 켜져 있을 때 개인 반복 작업 자동화에 유용 |
| Windows 알림 | local notification만 연결 | 긴 작업 완료를 확인하기 편함; mobile push는 제외 |
| 로컬 browser/computer use | 필요 시 Belmont 소유 runtime으로 연결 | cloud computer 없이 웹 작업을 자동화할 때만 가치가 있음 |
| Ask / Always Allow / Never 승인 정책 | 유지 | 개인 로컬 실행의 기본 제어 방식 |

#### C. 있으면 편하지만 요구가 생길 때만 추가

| 기능 | 기본 결정 | 이유 |
|---|---|---|
| Group chat·Bot 간 메시지·roster | 보류 | 혼자 써도 여러 Bot 협업은 가능하지만 1차 사용에는 필요 없음 |
| `user-form` 구조화 입력 카드 | 보류 | 일반 채팅으로 대체 가능; 반복 양식이 많을 때만 이식 |
| Chrome cookie import·origin approval | 보류 | 편하지만 민감하고 Windows Chrome 연동 작업이 큼; 직접 로그인으로 대체 가능 |
| local Auto-review | 보류 | 편의 기능이지만 현재 Codex mode에서는 강제 off; 기본 승인 정책부터 완성 |
| 음성 입력·voice call | 보류 | 개인 취향 기능이며 xAI credential/backend 없이 공식 call은 동작하지 않음 |
| 외부 event routine | 보류 | Slack/GitHub 등 실제 trigger가 필요해질 때 local connector로 추가 |
| 다국어·RTL 전체 | 축소 | 개인용은 한국어·영어·Follow System만 먼저 지원하면 충분 |
| X connector | 보류 | 실제 사용 요구가 있을 때 MCP 또는 전용 connector로 연결 |

#### D. 개인용 목표에서 제거

| 기능 | 결정 | 이유 |
|---|---|---|
| Bot 공개 링크·template marketplace | 제거 | 다른 사용자에게 배포하지 않음 |
| Virtual card·결제 승인 | 제거 | 개인 로컬 에이전트에 필요 없고 공식 결제 backend도 없음 |
| Cursor/SuperGrok 계정·billing·entitlement | 제거 | Codex OAuth만 사용 |
| Cursor inference와 Cursor Cloud Computer | 제거 | WSL Codex와 local runtime으로 대체 |
| Cursor plugin marketplace·OAuth backend | 제거 | local MCP와 Skills로 대체 |
| Teams·Enterprise·SSO·admin policy | 제거 | 단일 사용자 제품 |
| iPhone 전용 앱·mobile push | 제거 | 현재 목표는 Windows desktop |
| Statsig·analytics·Sentry·codebase telemetry | 제거 또는 no-op | 개인용 동작에 기여하지 않음 |
| 공식 updater | 제거 | Belmont 자체 설치·업데이트 방식이 필요하며 Cursor updater를 쓰지 않음 |
| 공식 cloud numeric limit 복제 | 제거 | Bot 50개, routine 50개 등의 상품 제한을 따라갈 이유가 없음 |

#### E. 0.18 → 0.30 변경을 버전별로 다시 자른 결과

| 구간 | 공식 package 변화 | 개인용 결정 |
|---|---|---|
| 0.18 → 0.19 | Lingui/i18n 기반 | 전체 21개 언어가 아니라 한국어·영어·Follow System만 선택 |
| 0.19 → 0.20 | 의미를 확정하지 못한 binary 변경 | 별도 이식 작업 없음 |
| 0.20 → 0.22 | runtime contract rebase, restart/wake 표시 marker | 공식 내부 구조는 복제하지 않고 Belmont식 WSL reconnect·복구만 구현 |
| 0.22 → 0.23 | 의미를 확정하지 못한 binary 변경 | 별도 이식 작업 없음 |
| 0.23 → 0.24 | Bot 공개 template와 harness | 개인용에서는 제거 |
| 0.24 → 0.25 | 공식 host topology 전환, `user-form`, 초기 voice, Chrome worker | host 전환은 따라가지 않음; user-form·cookie import만 선택 기능, voice는 제외 |
| 0.25 → 0.26 | package closure와 renderer chunk 재편 | 사용자 기능이 아님; 선택한 0.30 UI를 실행하는 데 필요한 dependency만 포함 |
| 0.26 → 0.27 | 의미를 확정하지 못한 binary 변경 | 별도 이식 작업 없음 |
| 0.27 → 0.28 | transport patch와 locale asset 추가 | transport fix는 0.30 component 사용 시 따라옴; locale은 한국어·영어만 활성화 |
| 0.28 → 0.29 | Chrome cookie origin approval | 보류; browser 자동화에서 실제 필요할 때 추가 |
| 0.29 → 0.30 | virtual card, voice-call harness, macOS Messages, UI 누적 변경 | Windows 채팅 UI만 사용; 결제·voice·macOS Messages는 제외 |

따라서 개인용 1차 목표는 다음 한 줄로 줄어든다.

```text
0.30 Windows 채팅 화면
  + 0.18 Belmont WSL 엔진
  + Codex OAuth
  + 로컬 tool/MCP/파일/기록
  + Windows↔WSL bridge
```

0.30 renderer를 통째로 참고하거나 원본 component로 보존하더라도, D 영역의 메뉴는 숨기고 RPC는 연결하지 않는다. 이는 "복원 실패"가 아니라 의도적인 개인용 제품 범위 축소다.

## 7. Belmont 0.30 복원 전략 교정

기존 0.18 source를 버리거나 0.30 기능 전체를 순서대로 복제하지 않는다. 개인용 A 영역부터 다음 checkpoint 순서로 이식한다.

1. **Artifact freeze**
   - 각 DMG·ASAR hash와 full file inventory 고정
   - 0.18 기준선과 중간 버전을 삭제하지 않음
2. **Windows 0.30 UI 기준선 확보**
   - Windows x64 0.30 installer 추출·hash·renderer inventory
   - 채팅·설정·승인·결과·notification UI만 active 범위로 지정
3. **Windows ↔ WSL bridge**
   - `wsl.exe` host 시작, gateway URL/token 전달
   - reconnect, shutdown, single-instance, Windows/WSL path 변환
4. **Codex 단일 provider 연결**
   - Cursor Router를 옮기지 않고 Codex OAuth 상태와 model 설정만 연결
   - Cursor account·billing·telemetry UI는 제거 또는 숨김
5. **핵심 closed-loop acceptance**
   - 설치 → Codex 로그인 → chat stream → tool 승인·실행 → 결과 표시
   - interrupt → 앱/host 재시작 → 대화·상태 복구
   - Windows 첨부 → WSL model/tool → Windows에서 결과 열기
6. **개인용 2차 기능**
   - memory recall, 검색, local Skills/Routine, 알림, 필요한 attachment format
   - browser/computer use는 실제 사용 요구가 있을 때 별도 gate로 추가
7. **선택 기능은 요구 시에만**
   - group/Bot handoff, user-form, cookie import, auto-review, voice, 외부 event trigger

0.24→0.25의 공식 host ownership 변화를 그대로 복제하는 것은 더 이상 선행 목표가 아니다. 선택한 0.30 renderer 화면이 요구하는 RPC만 adapter로 제공하고, 실행 소유권은 현재 Belmont WSL host에 유지한다.

## 8. 교차검증 자료

### Tier S — 직접 배포 artifact·업데이트 endpoint

- Belmont 보존 0.18 manifest: [`research-archives/original/0.18.0/artifacts.json`](../../research-archives/original/0.18.0/artifacts.json)
- Cursor download pattern: `https://downloads.cursor.com/sand/stable/darwin-arm64/<version>/Grok_Bot_<version>.dmg`
- Current update API: <https://api2.cursor.sh/updates/api/update/darwin-arm64/sand/0.0.0/stable>
- Current Homebrew cask: <https://github.com/Homebrew/homebrew-cask/blob/master/Casks/g/grok-bot.rb>

### Tier A — 공식 제품 문서

- Overview: <https://docs.x.ai/grok-bot/overview>
- Bot management and sharing: <https://docs.x.ai/grok-bot/bots>
- Messaging and handoff: <https://docs.x.ai/grok-bot/chat-and-collaboration>
- Skills and routines: <https://docs.x.ai/grok-bot/skills-routines-and-automations>
- Approvals: <https://docs.x.ai/grok-bot/approvals-security-and-privacy>
- Cursor account and billing: <https://cursor.com/help/grok-bot/plans>
- X connector announcement: <https://x.ai/news/grok-bot-and-x>

공식 문서는 현행 기능 의미를 검증하는 데 사용했다. 특정 기능의 최초 package 버전은 문서가 아니라 직접 추출한 versioned artifact marker로 판정했다.

### 독립 재검산

별도 read-only refute-by-default 검증이 12개 DMG/ASAR hash, 파일·renderer 수, process topology, bundle identity, Electron version, dependency 변화, exact marker first-seen을 원본에서 다시 계산했다. 수치와 first-seen 표는 모두 재현됐다. 검증자가 지적한 전수 semantic diff 과장, 0.24 Bot-template RPC 과장, 0.25 KaTeX 변화 누락은 본 문서에 교정했다. 최종 검증 verdict는 `PARTIAL`: artifact lineage는 verified지만 모든 minified semantic 변화와 backend E2E는 아직 완료되지 않았다.

## 9. 재현 명령

아래는 특정 중간 버전을 저장소 밖 임시 디렉터리에서 확인하는 최소 절차다.

```bash
grok_lineage_dir="$(mktemp -d /tmp/grokbot-lineage.XXXXXX)"
version="0.25.0"
curl -L --fail \
  "https://downloads.cursor.com/sand/stable/darwin-arm64/$version/Grok_Bot_$version.dmg" \
  -o "$grok_lineage_dir/Grok_Bot_$version.dmg"
sha256sum "$grok_lineage_dir/Grok_Bot_$version.dmg"
7z x -bd -y \
  -o"$grok_lineage_dir/dmg-$version" \
  "$grok_lineage_dir/Grok_Bot_$version.dmg"
node_modules/.bin/asar extract \
  "$grok_lineage_dir/dmg-$version/Grok Bot.app/Contents/Resources/app.asar" \
  "$grok_lineage_dir/asar-$version"
sha256sum \
  "$grok_lineage_dir/dmg-$version/Grok Bot.app/Contents/Resources/app.asar"
```

이 조사에서는 실행 중인 Belmont process, DB, profile을 변경하지 않았다. 중간 installer와 추출물은 `/tmp`에서만 다뤘다.
