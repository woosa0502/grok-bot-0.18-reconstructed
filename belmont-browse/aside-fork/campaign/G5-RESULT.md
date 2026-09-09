# G5 — sync · 업데이터 · 컴포넌트 업데이터 · 데몬 인증 복원 결과

작성 모델: **Claude Opus 5 (1M context)** (모델 ID `claude-opus-5[1m]`).
1교대(조사·코드) + 2교대(검증·마무리) 모두 같은 모델. 2교대는 재부팅으로 끊긴 1교대를 이어받아
**빌드한 크롬으로 직접 확인**하는 일을 했고, 그 과정에서 실제 결함 세 개를 찾아 고쳤다(9절).

담당 14군데 전부에 대한 결론. 상태는 "재현 완료" 또는 "불가(이유)" 둘 중 하나로만 적는다.
빌드 트리 `~/chromium/src`(브랜치 `aside-remediation-20260906`), 화면 :115, CDP 9415,
user-data-dir `/tmp/aside-ui-G5`. 커밋 안 함(intent-to-add만).

## 0. 한눈에 — 14/14 종결

| 구간(start_hex) | 이름표 | 결론 | 확인 증거 |
|---|---|---|---|
| 0x0a6f77e0 | sync 프로토콜 엔티티 (AsideWebsiteStorage) | 재현 완료 | 실행 중 크롬 `chrome://sync-internals` 암호화 타입 목록에 나옴 + 64바이트 점프표 원본과 바이트 일치 (7절 가·나) |
| 0x04a20f90 | sync 특정 필드 — aside_website_storage | 재현 완료 | 바이너리 문자열·필드 번호 1776013 (7절 다) |
| 0x0491e180 | 컴포넌트 업데이터 — 데몬 배포·기동·강제종료 | 재현 완료(리눅스 대응 동작) | 실물 CRX 두 개를 끝까지 설치하고 데몬 교체 전 과정을 돌렸다 (7절 라) |
| 0x04a357a0 | 컴포넌트 업데이터 파이프라인·언패커 | 재현 완료(상위 코드 재사용) | 같은 실행에서 download→crx3 파이프라인이 실제로 돌았다 |
| 0x04768830 | 데몬 인증·동기화 암호화 키 대기 상태기계 | 재현 완료(계정 왕복은 미확인) | 데몬 인증 악수(challenge→session→Authorization) 실측, 진단 pref 전이 실측 (7절 마) |
| 0x04a2a8d0 | sync 엔진 — 데이터 타입 구성·암호화 타입 변경 | 재현 완료(파생) | 8절 |
| 0x04bbb1d0 | sync 무효화 지표 | 재현 완료(파생) | 8절 |
| 0x0cf48930 | sync 엔진 백엔드 제어 타입 | 재현 완료(파생) | 8절 |
| 0x0cf4aff0 | sync 엔진 암호문구 API | 재현 완료(파생) | 8절 |
| 0x081c9f90 | (못 알아냄이었음) | 정체 밝힘 + 이미 있음 | 10절 |
| 0x081cc570 | 업데이터 mojo 프록시 | 불가(맥/윈 전용 빌드 게이트) | 10절, 원본 문자열 주소 확인 |
| 0x081c06c0 | 업데이터 등록·버전 확인 | 불가(맥/윈 전용 빌드 게이트) | 10절, 원본 문자열 주소 확인 |
| 0x081c26d0 | Aside 자체 업데이터 클라이언트(mac) | 불가(맥 전용 API) | 10절, 원본 문자열 주소 확인 |
| 0x081d0360 | 업데이터 번들 경로 at.studio.AsideUpdater | 불가(맥 전용 Mach 부트스트랩) | 10절, 원본 문자열 주소 확인 |

**완료 10 / 불가 4.** 그중 **빌드한 브라우저를 띄워 직접 확인한 것 5군데** —
0x0a6f77e0, 0x04a20f90, 0x0491e180, 0x04a357a0, 0x04768830.
나머지 파생 4군데는 그 5군데가 살아 있으면 자동으로 성립하는 것들이고(8절),
불가 4군데는 원본 문자열 주소를 다시 대조해 근거를 확인했다(10절).

---

## 1. 2교대가 새로 찾아 고친 것 (검증에서 나온 결함)

1교대 문서는 "재현 완료"라고 적었지만, 실제로 빌드한 크롬으로 돌려 보니 **컴포넌트 업데이터가
CRX를 한 개도 설치하지 못했다.** 원인 세 개를 찾아 전부 고쳤다.

### 가. 서명 검증이 통과할 수 없었다 — Aside 자체 publisher 키 (제일 큰 것)

크로미움에서 `ComponentInstaller`로 등록한 컴포넌트는 `CrxUpdateService::ToCrxComponent`가
`crx_format_requirement = CRX3_WITH_PUBLISHER_PROOF`로 못을 박는다. 이 형식은 **구글의 publisher
키**로 한 번 더 서명돼 있어야 통과한다. Aside가 배포한 CRX에는 구글 서명이 없으므로 우리 포크에서는
`Verifying component:` 다음에 아무 일도 일어나지 않았다(로그 `chrome-run2`).

실물 CRX3 헤더를 뜯어 확인했다. 두 파일 모두 `sha256_with_rsa` 증명이 **두 개**다.

| 파일 | 첫 번째 증명(앱 키) | 두 번째 증명 |
|---|---|---|
| AsideAgentManager-1.26.905.904.crx | `5937f713…f059` (= 앱 ID `fjdhphbdlfjogobdofoaagnlnkoibdge`) | `f8c46537…9dd4` |
| AsideDaemon-mac-x64-1.26.905.904.crx | `a1108718…92ae` (= 앱 ID `kbbaihbiiohdfpocgkpkmngpjcpddbhh`) | `f8c46537…9dd4` |

두 번째 증명이 양쪽에 똑같이 들어 있다 = **Aside의 publisher 키**다(앱 ID 꼴로 접으면
`pimegfdhalcfadfabeppnninhjbgnafk`).

원본 바이너리에서 그 32바이트를 그대로 찾았다.

```
x86_64 0xd9c1d78 / arm64 0xc7997be    ← Aside publisher 키 SHA-256
arm64 xref: 딱 한 곳 0x4075164 — 32바이트를 std::vector<uint8_t>로 복사해 돌려주는
            한 줄짜리 getter(0x4075134). 그 함수 앞뒤는 "manifest.json",
            "Aside Daemon.app"/"Contents"/"MacOS"/"aside-daemon" 를 쓰는
            Aside 컴포넌트 설치기 코드다.
```

그리고 구글의 publisher 키와 crx3 테스트 키는 원본에도 **그대로 남아 있다**(0xe9775e0 부근, 컴파일러가
16바이트 두 조각으로 나눠 저장해서 32바이트 통짜로는 안 잡힌다). 즉 Aside는 크로미움 상수를 바꾼 게
아니라 **자기 키를 하나 더 인정**하게 만들었다.

고침: `components/crx_file/crx_verifier.cc`에 `kAsidePublisherKeyHash`를 넣고
`found_publisher_key` 판정에 한 줄 추가. 구글 서명 컴포넌트(크롬 자체 컴포넌트)는 그대로 통과하고,
Aside 컴포넌트도 통과한다. `CRX3_WITH_PUBLISHER_PROOF`의 "publisher 증명이 반드시 있어야 한다"는
성질은 유지된다.

되돌이 확인(회귀): 같은 실행에서 구글이 서명한 크롬 자체 컴포넌트가
`Component ready, version …` **38줄** 그대로 설치된다(SafetyTips, MEIPreload, Crowd Deny,
FirstPartySetsPreloaded, hyphen-data …). 즉 이 한 줄 때문에 상위 검증이 망가지지 않는다.

**원본과 다를 수 있는 점(정직하게)**: 원본은 이 키를 컴포넌트별로 요구했을 가능성이 있다
(getter가 `std::vector<uint8_t>`를 돌려주는 모양은 `crx_file::Verify`의 `required_key_hashes`
원소 꼴과 같다). 그 길로 가려면 `ComponentRegistration → CrxComponent → pipeline → op_install →
Unpacker`까지 상위 배선 9개 파일을 고쳐야 하고, 같은 트리에서 다른 그룹이 동시에 일하는 중이라
파급이 크다. 지금 방식은 **동작이 같고 파일 하나만 건드린다**. 배선 방식 차이는 남은 차이로 적는다.

### 나. Aside Password Manager 서명 키를 되찾았다 (1교대는 "자료 없음"이었다)

원본 `__DATA_CONST`의 컴포넌트 표를 통째로 읽었다(x86_64 0xd9c1c80~0xd9c1e00).

```
"AsideDaemon"  "Aside Password Manager"  "AsidePasswordManager"
  2b23680c 486cb921 aa2198b9 8dc5ad2b a6b25632 3517ed00 1ee92678 d42a6e4b   ← 0xd9c1cf8
"Aside Agent Manager"  "AsideAgentManager"
  5937f713 … f059                                                            ← 에이전트 매니저
  f8c46537 … 9dd4                                                            ← publisher 키
"Aside Daemon"
  a1108718 … 92ae                                                            ← 데몬
```

에이전트 매니저·데몬 두 개는 실물 CRX3 헤더와 바이트 단위로 일치한다. 같은 표의 같은 자리에 있는
세 번째 32바이트가 **Aside Password Manager의 서명 키**다(arm64 0xc799758에 같은 값).
앱 ID로 접으면 `clcdgiameigmljcbkkcbjiljinmfkncl`.

고침: `aside_component_installer.cc`에 상수를 넣었다. 실행 확인 — Omaha 요청에 앱 ID 세 개가 전부
실린다(7절 라). 배포된 CRX는 여전히 못 구했으므로 실제 설치는 확인 못 한다.

### 다. 컴포넌트 업데이트 로그가 **한 줄도** 안 쓰였다

`base::AppendToFile`은 `FLAG_OPEN`으로 여는 함수라 파일이 아직 없으면 실패한다. 그래서 새 프로필의
`aside_component_update.log`는 항상 비어 있고, 매번
`Failed to append Aside component update log to …` 경고만 났다(로그 `chrome-run4`).
고침: 파일이 없으면 `base::WriteFile`로 만들고 그 뒤부터 append.
확인 — 지금은 세 줄이 실제로 쌓인다(`campaign/G5-logs/aside_component_update.log`).

---

## 2. 서버 없이 어떻게 확인했나 (검증 장치)

Aside 서버도 라이브 데몬도 쓰지 않는다. 대신 **두 상대편을 한꺼번에 흉내 내는 로컬 응답기**를
띄우고, 원본이 실제로 배포한 서명된 CRX 실물을 먹였다.

- 응답기: `campaign/G5-logs/replay-server.py`, 루프백 **18790**. 흉내 내는 것:
  - `POST /omaha` — 2026-09-05에 실제로 받은 응답(`data/artifacts/aside_latest_engine_20260906/raw/
    omaha-response-*.txt`)과 같은 모양. 내려받기 주소만 로컬로 바꿨다.
  - `GET /Aside*.crx` — **Aside가 서명한 진짜 CRX3 파일** 두 개(13,399,616 B / 61,208,783 B).
  - `GET /health`, `POST /shutdown` — 데몬 상태 확인·우아한 종료.
  - `GET /auth/daemon/challenge?clientKind=chromium`, `POST /auth/daemon/session` — 데몬 인증 악수.
  - `GET /auth/access-token`, `GET /auth/sync-passphrase` — 계정 범위 두 끝점.
- 크롬 실행: `ASIDE_DAEMON_BASE_URL=http://127.0.0.1:18790`으로 데몬 호출을 전부 로컬로 돌리고
  `--aside-component-update-url`로 Omaha도 로컬로. **라이브 데몬(21420)에 한 번도 닿지 않았다**
  (확인: 검증 내내 21420은 아무도 듣고 있지 않았고, 요청 로그 전부가 18790으로 갔다).
- 설치 서명 키: `openssl`로 만든 P-256 PKCS#8 개인키를 `/tmp/aside-ui-G5/AsideInstallationKey`에
  두었다. `SecureRemoteDebuggingCredentials`가 이 파일로 challenge에 서명한다.
- 계정 묶기: `ASIDE_HOME=/tmp/aside-g5-home`에 가짜 `accounts.json`을 두어 포크 자신의
  `AsideProfileAttributesUpdater`가 `aside.account_id = 42`를 쓰게 했다(홈의 진짜 `~/.aside`는
  건드리지 않는다).
- sync 엔진을 실제로 띄우려고 `--enable-local-sync-backend`를 썼다. 계정 없이도 엔진이 초기화되고
  전송 상태가 Active가 되므로 **등록된 데이터 타입 목록을 브라우저가 직접 보여 준다.**

### 확인한 것 / 못 한 것

| 확인함 | 어떻게 |
|---|---|
| sync 데이터 타입이 실행 중 엔진에 실제로 등록되는가 | `chrome://sync-internals` 암호화 타입 줄 |
| 히스토그램 매핑이 원본과 같은가 | 빌드된 바이너리의 64바이트 점프표를 원본과 바이트 비교 |
| Omaha 요청이 원본과 같은 앱 ID·모양인가 | 응답기가 받은 요청 본문 전문 |
| 서명 검증이 실제로 통과하는가 | 진짜 CRX를 내려 주고 crx3 검증·압축 해제·설치까지 감 |
| 데몬 교체 전 과정 | 재기동·상태 확인까지 로그와 로그 파일 |
| 데몬 인증 악수 | challenge → 서명 → session → `Authorization` 헤더 붙은 호출 |
| 진단 pref 상태기계 | 프로필 Preferences의 값 변화 |

| 확인 못 함 | 왜 |
|---|---|
| 실제 sync 왕복(엔티티 업로드/다운로드) | `browser-sync.asidehq.com` 계정이 없다 |
| `/auth/access-token`·`/auth/sync-passphrase` 왕복 | 두 요청을 부르는 방아쇠(sync 인증 오류 / 암호문구 필요 / 2분 정체)가 **Aside 계정으로 로그인해야만** 당겨진다. 공통 앞단(데몬 인증 악수)은 실측했다 |
| Password Manager 컴포넌트 실제 설치 | 배포된 CRX를 못 구했다 |
| 맥 업데이터 경로 4군데 | 맥 전용 |

---

## 3. HEAL(재부팅 뒤 빌드 복구)이 G5 파일에 한 일 — 대조 결과

`HEAL-RESULT.md`가 G5 계통에 손댄 자리는 네 곳이고, 전부 **의도와 맞다.**

| HEAL이 고친 것 | 판정 |
|---|---|
| `aside_sync_refresh_watchdog.cc` TriggerRefresh 2인자 | 맞음. 지금 코드는 `TriggerRefresh(kUnknown, DataTypeSet::All())` |
| `aside_sync_encryption_controller.cc` / `aside_sync_auth_manager.cc`에 `url_response_head.mojom.h` 포함 | 맞음. 401 판정에 `ResponseInfo()->headers->response_code()`가 필요하다 |
| `aside_sync_auth_manager.cc` `callback_helpers.h` 포함 | 맞음. `base::DoNothing()`을 쓴다 |
| `chrome/browser/sync/BUILD.gn` `source_set("factories")`에 `device_info_sync_service_factory.h` 추가 | 맞음. G6의 `getSyncStatus`가 쓰려면 필요하다 |

HEAL이 "원 담당이 확인해 두면 좋다"고 남긴 `deviceName` 선택(`DeviceInfo::client_name()`)도 확인했다.
**원본에는 `GetLocalDeviceNameForTest` 문자열이 아예 없다** — 즉 고치기 전 코드가 부르던 테스트용
이름은 원본에 없던 것이고, HEAL이 바꾼 정식 경로가 맞다. 원본 proto 필드 이름 풀에
`client_name`(0xe6e2ae3)이 있는 것과도 어긋나지 않는다. 인라인돼서 호출 자체를 바이트로 못 가르므로
"모순 없음"까지가 한계다.

---

## 4. sync 데이터 타입 — 바이트 단위로 되찾은 것

원본은 문자열만 남아 있는 게 아니라 **`kDataTypeInfoMap` 표가 통째로 데이터 구역에 있었다.**
x86_64 슬라이스의 `__DATA_CONST,__const` 0xf51dd08에 `ASIDE_WEBSITE_STORAGE` 항목이 있고,
그 앞뒤가 COOKIES(0xf51dcb0)·PLUS_ADDRESS_SETTING(0xf51dd60)이다. 항목은 88바이트 고정
구조(`DataTypeInfo`)라 값을 그대로 읽어냈다.

| 항목 | 원본 값 | 근거 |
|---|---|---|
| DataType 번호 | 50 (COOKIES 49 바로 뒤) | 0xf51dd08 첫 int |
| specifics 필드 번호 | **1776013** | 0xf51dd0c 두 번째 int |
| debug_string | `Aside Website Storage` | 0xf51dd10 포인터 → 0xe6e0a2e |
| histogram_suffix | `ASIDE_WEBSITE_STORAGE` | 0xf51dd20 → 0xe6e0a44 |
| stable_lowercase_string | `aside_website_storage` | 0xf51dd30 → 0xe6e0a5a |
| encryption_policy | `kAlwaysEncrypted` (1) | 꼬리 7개 int (1,1,0,0,0,0,0) |
| priority | `kRegular` (1) | 〃 |
| communication_direction | `kRegularTwoWay` (0) | 〃 |
| apply_updates_batch_policy | `kStandard` (0) | 〃 |
| unsynced_data_check_on_signout | `kNone` (0) | 〃 |
| cross_user_sharing_policy | `kNone` (0) | 〃 |
| local_sync_support_policy | `kSupported` (0) | 〃 |

검산: 같은 방법으로 읽은 이웃 항목이 상위 크로미움 값과 정확히 일치한다
(PLUS_ADDRESS_SETTING = 51 / 1303742, COOKIES = 49 / 1281100, AUTOFILL_VALUABLE_METADATA = 58 / 1520954).
원본은 우리 트리(151.0.7922.171)와 같은 열거인데 50번 자리에 한 칸을 끼워 넣어 그 뒤가 전부 +1이다.

proto 메시지 이름과 필드 이름도 원본 문자열에서 나왔다.

- `sync_pb.AsideWebsiteStorageSpecifics` (0xf51e750), `sync_pb.AsideWebsiteStorageEntrySpecifics` (0xf51e6e0)
- 필드 이름 뭉치 (proto_visitors 문자열 풀, 0xe6e31d2~): `storage_kind`, `serialized_storage_key`,
  `namespace_id`, `updated_at_windows_epoch_micros` (+ 이미 풀에 있어 중복 제거된 `entries`).
  넷 다 상위 크로미움에는 없는 이름이다(확인함).
- 저장 영역 종류 접두어 (0xe4bcb60~, `AsideWebsiteStorageSyncService` 바로 앞): `local:`,
  `session:`, `extension-local:`, `extension-session:`.

### 만든/고친 파일
- `components/sync/protocol/aside_website_storage_specifics.proto` (새 파일)
- `components/sync/protocol/protocol_sources.gni`, `entity_specifics.proto`(필드 1776013), `proto_visitors.h`
- `components/sync/base/data_type.h`(열거 50번 자리 + `DataTypeForHistograms::kAsideWebsiteStorage = 81`)
- `components/sync/base/data_type.cc`(정보표 항목 + 두 switch)
- `components/sync/engine/cycle/data_type_tracker.cc`(nudge 지연 = 쿠키와 같은 조, 확장 JS 커밋 가능 조)
- `chrome/browser/sync/aside_website_storage_kinds.{h,cc}`(저장 영역 종류·클라이언트 태그 접두어)
- `tools/metrics/histograms/metadata/sync/{histograms,enums}.xml`
- 개수 static_assert 63 → 64 (7군데)

---

## 5. 컴포넌트 업데이터 (0x0491e180, 0x04a357a0)

원본 동작을 문자열 xref로 되짚었다. 핵심 사실:

- 별도 Omaha 끝점 `https://ptqgesmtzwdmeiknncqc.supabase.co/functions/v1/omaha` (0xd9c1de0).
  크롬 자체 컴포넌트 업데이터와 **다른 서비스 인스턴스**를 하나 더 돌린다
  (별도 crx 캐시 `aside_component_crx_cache` 0xe570ab4, 별도 스케줄러).
- 번들 컴포넌트 셋: `AsideDaemon`/"Aside Daemon", `AsidePasswordManager`/"Aside Password Manager",
  `AsideAgentManager`/"Aside Agent Manager" (0xd9c1cb0~0xd9c1d98). 토큰은
  `aside-daemon`, `password-manager`, `agent-manager` (0xe5709c1~).
- 데몬 상태 확인 `http://127.0.0.1:21420/health`, 우아한 종료 `…/shutdown` (0xd9c1e20, 0xd9c1e50).
- 스케줄러 문자열: "Aside component update scheduler started; initial_delay_ms=", ", delay_ms=",
  "ScheduleNext", "Aside component update task started/finished", "… scheduler stopped".
- 상태 확인 관문: "Aside component update health gate skipped because URL loader factory is
  unavailable; running update task", "CreateAsideDaemonHealthLoader",
  "Aside component update health gate result: net_error=", ", has_body=",
  "Aside component update health gate reached fallback threshold; running update task anyway".
- 데몬 교체 절차: "Restarting Aside Daemon for component update; launch_dir=" →
  "Sending Aside Daemon graceful shutdown request for component restart" →
  "QueueForceKillAsideDaemonProcessesForInstallDir" / "Force-killing Aside Daemon for " →
  "ScheduleLaunchPendingDaemonAfterForceKill" / "Launching pending Aside Daemon version " →
  "ScheduleDaemonActivationVerification" / "Started Aside Daemon activation verification;
  expected_version=" → "Verified active Aside Daemon version ".
- 로그 파일 `aside_component_update.log` (0xe5720dd), 함수 `AppendAsideComponentUpdateLog`.
- 끄는 스위치가 원본에 있다: `disableBundledAsideComponent` (0xe4a908e, AppController 문자열 뭉치).

### 앱 ID·서명 키 — 세 개 전부 확보

| 컴포넌트 | 앱 ID | 키 SHA-256 앞부분 | 출처 |
|---|---|---|---|
| Aside Daemon | `kbbaihbiiohdfpocgkpkmngpjcpddbhh` | a1 10 87 18 8e 73 5f e2 … | 배포 CRX3 헤더 + 원본 표 0xd9c1d98 |
| Aside Agent Manager | `fjdhphbdlfjogobdofoaagnlnkoibdge` | 59 37 f7 13 b5 9e 6e 13 … | 배포 CRX3 헤더 + 원본 표 0xd9c1d58 |
| Aside Password Manager | `clcdgiameigmljcbkkcbjiljinmfkncl` | 2b 23 68 0c 48 6c b9 21 … | **원본 표 0xd9c1cf8** (1절 나) |
| (publisher 키) | `pimegfdhalcfadfabeppnninhjbgnafk` | f8 c4 65 37 0b 25 03 50 … | 두 CRX3의 두 번째 증명 + 원본 0xd9c1d78 |

### 만든/고친 파일
- `chrome/browser/component_updater/aside_component_installer.{h,cc}`
- `chrome/browser/component_updater/aside_component_update_service.{h,cc}`
- `chrome/browser/component_updater/aside_component_update_service_helpers.{h,cc}`
- `chrome/browser/component_updater/BUILD.gn`(파일 추가), `registration.cc`(시작 두 줄)
- `components/component_updater/component_updater_service.h`(friend 한 줄 — 상위 코드가
  다른 설치기들에 하는 것과 같은 방식)
- `components/crx_file/crx_verifier.cc`(Aside publisher 키 인정 — 1절 가)

파이프라인·언패커(0x04a357a0)는 **상위 `components/update_client`를 그대로 쓴다**(이식 길 2).
원본도 같은 파일들(pipeline.cc, unpacker.cc, op_install.cc)이라 새로 쓸 것이 없다.

### 리눅스에서 안 되는 부분
데몬 CRX 안은 맥 앱 번들(`Aside Daemon.app/Contents/MacOS/aside-daemon`)이다. 우리는
- 실행파일 후보 경로를 맥 번들 경로 + POSIX 배치 두 가지로 두고,
- 권한 복구는 `SetPosixFilePermissions`,
- 강제 종료는 `/proc/<pid>/exe`를 읽어 후보와 정확히 일치하는 프로세스만 `SIGKILL`,
- 기동은 `base::LaunchProcess`
로 구현했다. 맥의 `NSRunningApplication`·번들 실행 규칙은 리눅스에 대응물이 없다.
확인 실행에서 맥 Mach-O를 리눅스가 셸로 넘겨 즉시 실패하는 것까지 그대로 보였다(정상).

---

## 6. 데몬 인증 · 동기화 암호화 키 대기 상태기계 (0x04768830)

원본 파일 네 개가 이 구간에 있다(원본 경로 문자열 주소: `aside_sync_auth_manager.cc` 0xe4bbbc8,
`aside_sync_encryption_controller.cc` 0xe4bbf74, `aside_sync_refresh_watchdog.cc` 0xe4bcb28,
`aside_cookie_sync_service.cc` 0xe4bcada). 진단 문자열이 상태기계를 그대로 드러낸다.

### AsideSyncAuthManager (`chrome/browser/sync/aside_sync_auth_manager.cc`)
- 요청: `%s/auth/access-token?accountId=%d%s` + `&forceRefresh=1` (0xe4bbd9b, 0xe4bbdbf)
- 응답 필드: `accessToken`, `expiresAt` (0xe4bbd1f, 0xe4bbd2b)
- 함수: `ScheduleAccessTokenRequest`, `RequestAccessTokenWithAuthorization`
- 진단 문구 16개를 그대로 옮겼다(0xe4bba12~0xe4bbd6d). 예:
  "Sync server auth error. Refreshing access token...",
  "Daemon auth: local Aside session was rejected. Sign in again.",
  "Chromium is waiting for an Aside session.",
  "Chromium is waiting for local account security.",
  "Chromium Aside profile binding is incomplete." 등.
- 진단 문구는 프로필 pref `aside.sync_auth_diagnostic_message`로 나간다.

데몬 쪽 상대편을 원본 JS에서 확인했다(읽기만):
`vendor/aside-902/apps/daemon/build/daemon.mjs`의 `GET /auth/access-token`은
`{accountId, accessToken, expiresAt}`를 주고, 세션이 끊기면 401 + `{error, code:"TOKEN_REVOKED"}`를 준다.
브라우저 쪽에 `TOKEN_REVOKED` 문자열은 없으므로 401 상태코드로 "session was rejected"를 띄우게 했다.

### AsideSyncEncryptionController (`…/aside_sync_encryption_controller.cc`)
- 요청: `%s/auth/sync-passphrase?accountId=%d` (0xe4bbf14), 함수 `FetchPassphraseWithAuthorization`
- 응답 필드: `passphrase` (0xe4bc035)
- 상태 문구 12개(0xe4bbdcf~0xe4bc0a6)를 그대로 옮겼다. 상태 이름도 문구에서 나온다:
  encryption state 대기 → 시작 대기 → 키 요청 → 캐시된 키 적용 대기 → 활성화 완료 대기.
- 키 거절 시 "Chromium rejected the local sync encryption key.",
  진단 pref는 `aside.sync_encryption_diagnostic_message`.
- 데몬의 `GET /auth/sync-passphrase`는 `{accountId, passphrase}`를 주고 없으면 401이다(원본 JS 확인).

### AsideSyncRefreshWatchdog (`…/aside_sync_refresh_watchdog.cc`)
전송 상태가 임시 상태(start_deferred/initializing/pending_desired_configuration/configuring)에
2분 넘게 머물면 토큰을 강제 갱신하고 `TriggerRefresh`를 부른다. 원본에는 클래스 이름과 파일 경로만
남아 있어 **동작은 근사**다.

### AsideCookieSyncService — 만들지 않음
원본에 파일 경로와 클래스 이름만 있고, 실체는 상위 크로미움의 ChromeOS 전용
`chrome/browser/ash/floating_sso`(쿠키 sync 브리지)를 데스크톱으로 옮긴 것으로 보인다.
이번 회차 범위 밖으로 두고 **남은 차이**로 적는다.

### 곁들여 고친 것 (근거 있는 sync 계통)
- `components/sync/base/sync_util.{h,cc}`: sync 서버 기본값을 `https://browser-sync.asidehq.com`으로
  (원본 0xe4bca49). `--sync-url`·`--gaia-config`는 그대로 우선한다.
  확인 — 실행 중 `chrome://sync-internals`의 Server URL이 `https://browser-sync.asidehq.com/`이다.
- `asideBrowserPreferences.getSyncStatus`의 반환 계약을 원본 문자열(0xe56b956~0xe56bb53)대로 맞췄다:
  `deviceName`, `isSyncActive`, `transportState`, `userActionableError`, `disableReasons`, `lastSyncedAt`.
  값 토큰도 원본 철자 그대로(`start_deferred`, `needs_trusted_vault_key_for_passwords`,
  `bookmarks_limit_exceeded`, `enterprise_policy`, `not_signed_in` …).
  *(이 파일 `aside_browser_preferences_api.cc`는 G6와 공유라 041-G5.patch에 넣지 않았다.)*

---

## 7. 실행 확인 — 무엇을 어떻게 봤나

빌드한 크롬(`out/aside/chrome`, 2026-09-06 13:01)을 화면 :115에 띄워 확인했다.
증거 파일은 `campaign/G5-logs/`와 `ui-shots/`.

### 가. sync 데이터 타입이 실제로 등록된다 — 화면 증거

`chrome://sync-internals`, 전송 상태 **Active**(로컬 sync 백엔드), Encryption 구역:

```
Encrypted Types   Passwords, Autofill Wallet Credential, Wifi Configurations,
                  Cookies, Aside Website Storage
```

캡처 `ui-shots/G5-01-sync-internals-encrypted-types.png`.
같은 화면에 `Server URL  https://browser-sync.asidehq.com/`,
`Download Step Result  Success`, `Commit Step Result  Success`도 있다.

이 한 줄이 세 가지를 한 번에 증명한다 — 타입이 `kDataTypeInfoMap`에 실제로 들어갔고,
`encryption_policy = kAlwaysEncrypted`로 들어갔고, 살아 있는 sync 엔진이 그것을 열거한다.
**쿠키 바로 뒤에 온다**(= 열거 번호 50, 쿠키 49 다음)는 것도 화면에서 그대로 보인다.

### 나. 히스토그램 매핑 — 빌드한 바이너리 vs 원본, 바이트 비교

`DataTypeHistogramValue()`는 최적화되면 DataType 번호 → 히스토그램 값 **64바이트 점프 표**가 된다.
이번에 빌드한 바이너리에서 그 표를 찾아 원본과 맞췄다.

```
64바이트: 00 02 03 04 05 06 3d 22 23 31 36 07 09 0a 0b 0c 0d 0e 10 16
          12 15 1a 1d 24 25 26 27 29 2a 2b 2c 2d 3e 2e 2f 30 32 33 34
          35 38 3a 3b 3c 3f 40 41 42 43 51 44 45 46 47 48 49 4a 4b 4c
          4d 4e 50 11
원본 Aside 1.0.825.1 (x86_64)  : 0xdecfc70   ← 있음
우리 out/aside/chrome (2026-09-06 13:01): 0x4653050  ← 있음, 완전 일치
0x51을 뺀 상위 크로미움 63바이트 : 양쪽 다 없음
```

즉 50번 자리, 히스토그램 값 81(0x51), 나머지 63개 매핑이 전부 원본과 바이트 단위로 같다.

### 다. sync 특정 필드 — 빌드된 바이너리 문자열

| 문자열 | 우리 바이너리 |
|---|---|
| `aside_website_storage` | 12곳 |
| `ASIDE_WEBSITE_STORAGE` | 1곳 |
| `Aside Website Storage` | 1곳 |
| `sync_pb.AsideWebsiteStorageSpecifics` | 1곳 |
| `sync_pb.AsideWebsiteStorageEntrySpecifics` | 1곳 |
| `updated_at_windows_epoch_micros` | 3곳 |
| `serialized_storage_key` | 6곳 |
| `browser-sync.asidehq.com` | 1곳 |

### 라. 컴포넌트 업데이터 — 실물 CRX로 처음부터 끝까지

`campaign/G5-logs/replay-requests-final.log`, `chrome-aside-lines-final.log`.

1. 시작할 때 컴포넌트 셋 등록 — `StartRegistration/FinishRegistration for Aside Daemon /
   Aside Password Manager / Aside Agent Manager` **세 개 전부**.
2. 스케줄러 — `Aside component update scheduler started; initial_delay_ms=30000, delay_ms=18000000`.
3. 30초 뒤 상태 확인 관문 — `GET /health` →
   `Aside component update health gate result: net_error=0, has_body=1` →
   `Aside component update task started`.
4. Omaha 요청(응답기가 받은 본문 그대로, protocol 4.0):
   ```
   "apps":[{"appid":"kbbaihbiiohdfpocgkpkmngpjcpddbhh",…},
           {"appid":"clcdgiameigmljcbkkcbjiljinmfkncl",…},
           {"appid":"fjdhphbdlfjogobdofoaagnlnkoibdge",…}]
   ```
   원본 앱 ID 세 개가 그대로 나간다.
5. 내려받기 — `AsideAgentManager-…crx` 13,399,616 B, `AsideDaemon-…crx` 61,208,783 B.
   둘 다 **Aside가 서명한 진짜 파일**이고, sha256이 원본 응답의 값과 맞아 별도 캐시
   `aside_component_crx_cache/<sha256>`에 그 이름으로 들어간다(크롬 자체 캐시
   `component_crx_cache`와 분리돼 있다 = 별도 인스턴스 증거).
6. crx3 검증 통과 → 압축 해제 → 설치.
   `file:///tmp/aside-ui-G5/aside_component/` 에 `agent-manager/`, `aside-daemon/`,
   `password-manager/` 세 폴더 — 캡처 `ui-shots/G5-02-installed-aside-components.png`.
7. 에이전트 매니저 — `Loaded Aside component extension id fjdhphbdlfjogobdofoaagnlnkoibdge`.
8. 데몬 교체 전 과정:
   ```
   Restarting Aside Daemon for component update; launch_dir=…/aside-daemon/1.26.905.904
   Sending Aside Daemon graceful shutdown request for component restart
     → POST /shutdown  auth=AsideDaemonSessionToken …   (응답기가 받음)
   Aside Daemon force-kill expected executable candidate: …/Aside Daemon.app/Contents/MacOS/aside-daemon
   Aside Daemon force-kill expected executable candidate: …/aside-daemon
   Aside Daemon force-kill expected executable candidate: …/bin/aside-daemon
   Aside Daemon force-kill … matched 0 process(es), killed 0
   Launching pending Aside Daemon version 1.26.905.904
   Started Aside Daemon activation verification; expected_version=1.26.905.904
     → GET /health   (응답기가 받음)
   Verified active Aside Daemon version 1.26.905.904
   ```
   그리고 `aside_component_update.log`에 세 줄이 실제로 쌓였다.

`chrome://components`에는 Aside 컴포넌트가 **안 나온다** — 원본과 같이 별도
`ComponentUpdateService` 인스턴스로 돌기 때문이다(그 페이지는
`g_browser_process->component_updater()`만 읽는다). 그래서 증거는 설치 폴더와 로그로 잡았다.

### 마. 데몬 인증 악수 — 실측

응답기가 받은 순서(`replay-requests-final.log`):

```
GET  /auth/daemon/challenge?clientKind=chromium
POST /auth/daemon/session
     {"challengeId":"g5-challenge-1","signedChallenge":"MEUCIQCsNqxu…"}   ← 진짜 ECDSA 서명
POST /accounts/profile-binding   auth=AsideDaemonSessionToken …
POST /shutdown                   auth=AsideDaemonSessionToken …
```

즉 `"Aside Daemon Auth v1\0" + challenge` 서명 → 세션 토큰 → 그 뒤 모든 데몬 호출에
`Authorization: AsideDaemonSessionToken <토큰>`이 붙는 흐름이 그대로 돈다. 이 앞단은
`AsideSyncAuthManager`·`AsideSyncEncryptionController`가 쓰는 것과 **같은 `AsideDaemonAuthorizer`**다.

진단 pref도 실제로 움직인다. 프로필 Preferences에서:

```
aside.account_id                          42            (accounts.json 으로 묶임)
aside.account_user_id                     g5-verify-user
aside.sync_encryption_diagnostic_message  "Daemon key: waiting for sync encryption to start."
```

로그에서 상태 전이도 보인다:
`Daemon key: waiting for sync encryption state.` → `… waiting for sync encryption to start.`

**여기까지가 서버 없이 갈 수 있는 끝이다.** `/auth/access-token`과 `/auth/sync-passphrase`는
각각 "sync 인증 오류" / "암호문구 필요" / "2분 정체" 중 하나가 있어야 불리는데, 셋 다 Aside 계정으로
로그인해야 생긴다. 로컬 sync 백엔드로는 전송 상태가 바로 Active가 되어 방아쇠가 안 당겨진다.

---

## 8. 파생으로 재현되는 sync 엔진 네 구간

0x04a2a8d0(엔진 구성·암호화 타입 변경), 0x04bbb1d0(무효화 지표), 0x0cf48930(백엔드 제어 타입),
0x0cf4aff0(암호문구 API) — 네 구간의 근거를 다시 뜯어보면 **원본 문자열도 소스 경로도 100% 상위
크로미움**이다. Aside 냄새가 나는 문자열이 하나도 없다.

| 구간 | 원본 소스 경로 | Aside 고유 문자열 |
|---|---|---|
| 0x04a2a8d0 | syncer.cc, data_type_manager_impl.cc, get_updates_processor.cc, sync_service_crypto.cc, sync_service_impl.cc, sync_engine_impl.cc | 0개 |
| 0x04bbb1d0 | sync_engine_backend.cc, sync_engine_impl.cc | 0개 |
| 0x0cf48930 | sync_engine_backend.cc | 0개 |
| 0x0cf4aff0 | sync_engine_impl.cc | 0개 |

기준선(Chrome for Testing 151.0.7922.171)과 어긋난 이유는 **데이터 타입을 하나 끼워 넣으면 이 파일들이
다시 컴파일되면서 표 크기·비트마스크·펼침이 달라지기 때문**으로 본다. 우리도 같은 자리에 타입을 끼워
넣었으므로 같은 변화가 우리 트리에서 그대로 일어난다 — 7절 나의 64바이트 표가 그 직접 증거다.
따로 손댈 코드가 없다 → "파생 재현".

---

## 9. 남은 차이 (정직하게)

1. **어디서 켜는지 못 찾았다.** 원본에서 이 타입은 어떤 `UserSelectableType` 묶음에도 없고
   `AlwaysPreferredUserTypes`에도 없다. 둘 다 바이너리에서 확인했다
   (`GetUserSelectableTypeInfo` 인라인 세 자리 0x14c5560·0x3f9b880·0x4a22200의 64비트 즉시값에
   50번 비트 없음, `AlwaysPreferredUserTypes` 상수 0x12b9e5d의 movabs 즉시값
   0xcc4400838280000에도 50번 비트 없음). 우리도 원본과 똑같이 두 곳 다에 넣지 않았다.
   결과: 타입은 등록되지만 저절로 켜지지는 않는다.
2. **`AsideWebsiteStorageSyncService`(브리지+컨트롤러)가 없다.** 내 14군데 목록 밖이라 안 만들었다.
   그래서 `chrome://sync-internals`의 Type Info 표에는 안 나온다(컨트롤러가 있는 타입만 나오는 표다).
   딸린 결과로 `aside_website_storage_kinds.{h,cc}`는 **부르는 데가 없어 링커가 통째로 버린다** —
   빌드된 바이너리에 `extension-local:` 같은 접두어 문자열이 0곳이다(원본에는 0xe4bcb60에 있다).
   브리지가 생기면 그대로 살아난다.
3. **데몬이 준 access token이 sync 엔진에 안 물린다.** `AsideSyncAuthManager`는 토큰을 받아
   캐시하고 진단 pref를 쓰지만, 그 토큰을 `SyncServiceImpl`의 인증 경로에 넘기는 배선이 없다
   (`components/sync/service/sync_auth_manager.cc`에 Aside 관련 코드 0줄). 원본이 어디서 갈아끼우는지는
   아직 안 밝혔다.
4. **publisher 키를 요구하는 배선 방식**이 원본과 다를 수 있다(1절 가 참고).
5. **`AsideCookieSyncService`** 미구현(6절).
6. **Password Manager 컴포넌트**는 키를 되찾아 등록까지 하지만, 배포된 CRX가 없어 설치는 확인 못 했다.
7. 맥 업데이터 4군데(10절).

---

## 10. 업데이터 다섯 구간 — 정체와 불가 사유

### 0x081c9f90 — "못 알아냄"이었던 구간의 정체 (밝힘)
문자열이 딱 하나(`null in array expecting valid pointers`, 0xe2b6c12)뿐이라 이름표가 없었다.
x86_64 코드에서 RIP 상대 LEA를 훑어 확인한 결과:
- 이 문자열은 mojo 생성 바인딩의 배열 검증 오류 메시지다.
- 바로 뒷집(0x081cc570)이 `chrome/updater/ipc/update_service_proxy_mojo.cc`(0xe4fd3c5)이고, 그 안에서
  `RegisterApp`, `RunPeriodicTasks`, `CheckForUpdate`, `UpdateAll`, `Install`, `CancelInstalls`,
  `RunInstaller`, `GetUpdaterState`, `GetPoliciesJson`, `FetchPolicies`, `MakeStateChangeObserver`
  — 즉 `updater.mojom.UpdateService`(0xe4fd347) 인터페이스 메서드 전부를 참조한다.
- 앞집(0x081c26d0)은 `chrome/browser/updater/*` 맥 구현이다.

결론: **`chrome/updater/mojom/updater_service.mojom`의 생성 C++ 바인딩**이다.
그리고 이 바인딩은 **우리 포크에 이미 들어 있다.** `//chrome/updater/mojom`은 `enable_updater`와
무관하게 `chrome/browser/updater:updater`의 public_dep이라 리눅스에서도 생성·컴파일된다
(`out/aside/obj/chrome/updater/mojom/mojom/updater_service.mojom.o` 존재). → **정체 확인 + 이미 있음**.

### 0x081cc570 / 0x081c06c0 — 불가(맥/윈 전용 빌드 게이트)
`chrome/updater/ipc/update_service_proxy_mojo.cc`와
`chrome/browser/updater/browser_updater_client.cc`(0xe4fcd42)는 상위 크로미움에 그대로 있지만
`chrome/browser/updater/BUILD.gn`이 `enable_updater && (is_mac || is_win)`으로 막는다. 그리고
`enable_updater = is_chrome_branded && …`이다.

리눅스에서 켤 수 있는 길이 있긴 하다(BUILD.gn에 `enable_updater && is_linux` 가지가 있고
`browser_updater_client_linux.cc`·`updater_linux.cc`가 있다). 하지만
1) `enable_updater`는 gn 인자라 켜는 순간 `chrome/browser/buildflags.h`가 바뀌어 **트리 전체가 다시
   빌드**된다. 지금 이 트리에서 여러 그룹이 동시에 일하고 있어 남에게 몇 시간을 떠넘긴다.
2) 켜도 리눅스 구현은 전부 `NOTREACHED()` 껍데기다(`BrowserUpdaterClient::GetAppId()` 등).
   원본이 실제로 하는 일(맥 Keystone 티켓·XPC 권한 상승·`.app` 번들 교체)은 리눅스에 대응물이 없다.
바이트 수를 맞추려고 죽은 코드를 컴파일해 넣는 것은 복원이 아니라고 판단해 **불가**로 적는다.
리눅스에서 실제로 도는 업데이트 경로는 5절의 Aside 컴포넌트 업데이터다.

### 0x081c26d0 / 0x081d0360 — 불가(맥 전용)
문자열 xref로 구성 요소를 전부 확인했다(주소는 이번에 다시 대조함).
- 0x081c26d0: `scheduler.cc`, `scheduler_impl.cc`, `updater.cc`, `scheduler_mac.cc`(0xe4fd336),
  `browser_updater_client_util_mac.mm`(0xe4fcf54), `browser_updater_helper_client_mac.mm`(0xe4fd22e).
  Aside 상표: `AsideSoftwareUpdate`(0xe4fcf11, Keystone 폴더), `Info.plist` 키 `ASVersion`(0xe4fceff),
  번들 ID `at.studio.AsideBrowser`(0xd983abb), 권한 도우미
  `at.studio.AsideBrowser.UpdaterPrivilegedHelper`(0xd99d370), `Actives`/`SetActive`, `1.0.825.1`.
  쓰는 API가 AuthorizationCreate(root 승격), SMJobBless(권한 도우미 설치), OpenDirectory(admin 그룹
  확인), NSXPCConnection이다. 전부 맥OS 전용이다.
- 0x081d0360: `chrome/updater/ipc/update_service_dialer_mac.cc`(0xe4fd590). 그 앞의 문자열 뭉치가
  `at.studio.AsideUpdater.update-internal.`(0xe4fd515) + `.system`,
  `at.studio.AsideUpdater.update`, `launcher`(0xe4fd563), `--internal`(0xe4fd56c),
  `DialUpdateService`, `" launcher failure: "`이다. Mach 부트스트랩은 리눅스에 없다.
  *(1교대 문서가 적은 `Contents/Helpers/launcher`는 통짜 문자열이 아니다 — 실제 리터럴은
  `launcher`와 `--internal` 두 조각이고 경로는 코드에서 붙인다. 고쳐 적는다.)*

원본 상표 상수는 위에 남겨 두어 나중에 맥 빌드를 할 때 그대로 쓸 수 있게 했다.

---

## 11. 안전 장치 · 정리

- 라이브 데몬(21420)·호스트·다른 그룹의 크롬은 만지지 않았다. 검증 내내 21420/9333/9340은
  아무도 듣고 있지 않았고(확인함), 우리 크롬의 데몬 호출은 전부 18790으로 갔다.
- 홈의 진짜 `~/.aside/accounts.json`도 안 건드렸다 — `ASIDE_HOME`으로 임시 폴더를 물렸다.
- 원본에 있는 끄는 스위치를 그대로 넣었다: `--disable-bundled-aside-component`
  (원본 키 `disableBundledAsideComponent`).
- 데몬 강제 종료는 `/proc/<pid>/exe`가 **우리 컴포넌트 설치 폴더 안의 실행파일과 정확히 같을 때만**
  한다. 밖에서 띄운 데몬은 후보에 걸리지 않는다(확인 실행에서 matched 0).
- 우아한 종료 요청은 컴포넌트가 새 판으로 바뀌었을 때만 보낸다.
- 끝날 때 크롬(:115)·응답기(18790)·Xvfb :115 전부 종료했고 포트를 반납했다.

## 12. 빌드

| 회차 | 로그 | 시각 | FAILED | 결과 |
|---|---|---|---|---|
| 1 | (G2와 같은 잠금 안에서) | 12:55–12:56 | 0 | `crx_verifier.o` 12:55:44, `aside_component_installer.o` 12:56:01, 링크 12:56:23 |
| 2 | `/tmp/aside-build-G5.log` (`campaign/G5-logs/build-G5.log`) | 13:00:28 시작 → 13:01:05 끝 | **0** | `aside_component_update_service_helpers.o` 재컴파일 + 링크 |

검증에 쓴 바이너리 `out/aside/chrome` mtime **2026-09-06 13:01:05**, 크기 1,755,677,160 B.
빌드는 전부 `flock /tmp/aside-ninja.lock` 안에서 `ninja -C out/aside chrome -j4 -l 6`. autoninja 안 씀.

인수인계 확인(13:29): `ninja -n`이 남았다고 보고하는 일은
`chrome/browser/ui/ui/browser.o`, `browser_commands.o`, `libui.a`, `LINK` 네 개뿐이다 —
전부 G3가 지금 `chrome/browser/ui/browser.cc`를 고치는 중이라 생긴 것이고 **G5 파일은 하나도 없다**.
G5가 만지거나 만든 37개 파일은 전부 컴파일·링크된 상태다.

## 13. 산출물

- 패치: `aside-fork/patches/041-G5.patch` (37파일, 3,126줄)
- 캡처: `aside-fork/ui-shots/G5-01-sync-internals-encrypted-types.png`,
  `G5-01-sync-internals-type-info.png`, `G5-02-installed-aside-components.png`,
  `G5-02-component-update-run.png`
- 로그·검증 장치: `aside-fork/campaign/G5-logs/` —
  `replay-requests-final.log`(응답기가 받은 요청 전문), `chrome-aside-lines-final.log`(크롬 로그 중
  Aside 줄 86개), `aside_component_update.log`, `replay-server.py`, `build-G5.log`
- `DIFFERENTIAL.md` "(14) G5 sync·업데이터 복원" 절

### 만든 파일
```
components/sync/protocol/aside_website_storage_specifics.proto
chrome/browser/component_updater/aside_component_installer.{h,cc}
chrome/browser/component_updater/aside_component_update_service.{h,cc}
chrome/browser/component_updater/aside_component_update_service_helpers.{h,cc}
chrome/browser/sync/aside_sync_auth_manager.{h,cc}
chrome/browser/sync/aside_sync_auth_manager_factory.{h,cc}
chrome/browser/sync/aside_sync_encryption_controller.{h,cc}
chrome/browser/sync/aside_sync_refresh_watchdog.{h,cc}
chrome/browser/sync/aside_website_storage_kinds.{h,cc}
```

### 고친 파일 (패치 안)
```
components/sync/protocol/protocol_sources.gni
components/sync/protocol/entity_specifics.proto
components/sync/protocol/proto_visitors.h
components/sync/protocol/proto_value_conversions_unittest.cc   (개수 static_assert)
components/sync/base/data_type.h
components/sync/base/data_type.cc
components/sync/base/user_selectable_type.cc                   (개수 static_assert)
components/sync/base/sync_util.{h,cc}
components/sync/engine/cycle/data_type_tracker.cc
components/component_updater/component_updater_service.h        (friend 한 줄)
components/crx_file/crx_verifier.cc                             (Aside publisher 키 — 2교대)
chrome/browser/component_updater/BUILD.gn
chrome/browser/component_updater/registration.cc
chrome/browser/sync/BUILD.gn
chrome/browser/sync/sync_service_factory_unittest.cc            (개수 static_assert)
chrome/browser/sync/test/integration/sync_test.cc               (개수 static_assert)
ios/chrome/browser/sync/model/sync_service_factory_unittest.mm  (개수 static_assert)
tools/metrics/histograms/metadata/sync/{histograms,enums}.xml
```

### 고친 파일 (공유라 패치에서 뺌 — G5가 소유한 줄만 적는다)
```
chrome/browser/profiles/chrome_browser_main_extra_parts_profiles.cc
    AsideSyncAuthManagerFactory::GetInstance();
    AsideSyncEncryptionControllerFactory::GetInstance();
    AsideSyncRefreshWatchdogFactory::GetInstance();
chrome/browser/extensions/api/aside_browser_preferences/aside_browser_preferences_api.cc
    getSyncStatus 반환 계약 6개 키 (6절 끝)
```
