# Aside 원본 대비 포크 개선 인수인계 — 2026-09-07

상태: **구현·범위 검증 완료 / 쇼핑 전체 요구 PARTIAL**. 팝업 종료 재현, 지식 경로, 숫자 입력, 실제 local websearch 복구는 아래 범위에서 검증했다. 마지막 쇼핑 재실행은 상세 3개·본품 옵션·이미지 사양 읽기까지 진행했지만, 사양 4칸과 일부 조건·배송·리뷰 근거가 남았다. 전체 제품 동일성이나 100% 재현을 선언하지 않는다.

최종 원시 근거와 독립 판정은 캠페인 `REPORT.md`, `raw/replay-final-e-independent-verdict.json`, `raw/replay-final-d-independent-verdict.json`을 따른다. Root가 해당 원시 출력과 이미지, 실제 네이티브 완료 화면을 다시 읽고 관측했다. 테스트용 프로세스는 정리했고 원본 VM과 guest Aside daemon은 유지했다.

## 1. 먼저 읽을 경로와 근거 구분

저장소 기준 경로는 `/home/hoon/_roots/labs/work/Belmont`이다. 아래에서 캠페인 경로는 `data/artifacts/aside-parity-improvement-20260907T010326Z/`를 뜻한다.

- 캠페인 `REPORT.md`, `PREREG.json`, `status.json`: 목적, 사전 기준, 최종 판정과 담당 프로세스 정리 기록.
- `worker/README.md`, `worker/focused-tests.tap`, `worker/native-permissions-{824,902}.json`: 메모리 경로와 숫자 입력 변경.
- `worker-web-search/README.md`, `worker-web-search/sha256.json`, `worker-web-search/focused-tests.tap`: 최종 local websearch 소스와 검사.
- `raw/native-independent-verdict.json`, `raw/replay-2-independent-verdict.json`: native UI 및 이전 실제 쇼핑 라운드의 독립 검토.
- `replay-3-final/README.md`, `status.json`, `actions.jsonl`, `raw/`, `shots/`, `logs/`: 완료된 최종 실제 UI 확인. 이전 `replay-1`, `replay-2`, 실패한 E를 포함한 `replay-3`는 보존한다.

근거 라벨은 다음처럼 구분한다.

- `direct_observation`: 이 작업자가 직접 읽은 소스·원시 출력 또는 실행한 검사.
- `documented_prior_claim`: root나 다른 검토자의 캠페인 문서·판정에 기록된 결과. 이 문서 작성자가 해당 UI를 다시 조작해 확인한 것은 아니다.
- `inference`: 관측과 일치하는 설명이나 인과 추정.
- `unverified`: 현재 범위에서 아직 확인하지 않은 항목.

## 2. 원본과 포크의 비교 경계

`documented_prior_claim`: 원본은 macOS VM의 Aside daemon `1.26.906.1714`, 모델 경로 `aside/gpt-5.6-terra/high`였다. 이번 포크의 실제 실행 대상은 Linux Chromium 및 daemon `1.26.902.1713`, `openai-codex/gpt-5.6-terra/high`이다.

모델 이름과 effort가 같더라도 provider, daemon 버전, OS, 브라우저 상태와 당시 사이트 응답이 다르다. 따라서 이 작업의 목표는 직접 드러난 기능 차이의 개선이며, 출력·속도·검색 순위의 동일성이나 원본에 있는 모든 기능의 재현이 아니다. daemon 824는 일부 패치 회귀의 호환성 검사 대상이고, 최종 실제 UI 실행 대상으로 간주하지 않는다.

원본 직접 사용 근거는 `data/artifacts/aside-original-interactive-20260906T232726Z/REPORT.md`, 개선 전 포크 비교는 `data/artifacts/aside-fork-parity-20260907T000901Z/REPORT.md`에 있다.

## 3. 변경한 동작

### Native Chromium patch 045

유지할 패치는 `belmont-browse/aside-fork/patches/045-native-parity-lifetime-and-defaults.patch`이다. 실제 Chromium 소스는 `/home/hoon/chromium/src`이며, 변경한 여덟 경로는 캠페인 `raw/native-edited-files.json`에 기록돼 있다. 이 패치는 해당 캠페인의 변경 전 파일에 대한 증분이므로 다른 Chromium 트리에 바로 적용하면 안 된다.

`documented_prior_claim`:

- 다섯 controller가 widget 활성화·닫힘 callback이 끝날 때까지 객체를 유지하고, 한 번 사용하는 close override를 재설정하며, 파괴를 지연한다. 외부 action callback 호출 전에 필요한 값을 복사한다.
- Toast 닫힘에서 timer를 중단하고, AgentTabs가 부모 teardown 중 observer를 해제한다.
- 별도 attention section은 `AsideTaskAttentionSection` 뒤에서 기본 비활성화한다. 해당 작업은 recent chats에 남는다. 기능을 켠 fixture에서도 실제 popover/toast를 검사했으므로 숨기기만으로 충돌 수정을 판정한 것은 아니다.
- Footer search는 `BOTTOM_LEFT`, header search는 기존 `TOP_LEFT` 방향을 사용한다. 기록된 1280×800 창에서는 입력창과 결과가 보였다.

보존된 이전 binary의 profile menu 닫힘에서 SIGSEGV가 기록됐고, 새 binary는 기록된 controller 조작을 통과했다. 해제된 객체 수명 문제라는 설명은 stack·poison 값·소스와 일치하는 `inference`이며, 정확한 callback의 debugger/ASAN 입증은 없다. 모든 재진입 순서, 모든 부모 파괴 순서, 다른 화면 크기·긴 검색 목록은 `unverified`다.

캠페인에 기록된 최종 native binary SHA256은 `ae0f593b526995aa072ce55666dfc3a5e3e5e2b7c9b74f1eb3f06559a9a8dd4f`이다. `replay-2/raw/runtime-identity.json`이 당시 실제 실행 파일과 연결한다. 최종 `replay-3-final/raw/runtime-identity.json`에서도 실제 PID214443의 실행 파일 hash가 같은 값임을 확인했다. 해당 테스트 프로세스는 이후 종료했다.

### 지식 경로와 account bootstrap

`direct_observation`: `belmont-browse/src/session.mjs`가 account의 `memory/sites` symlink가 설정된 canonical `knowledge/sites` 디렉터리로 해석되는지 확인한 뒤, 원래 daemon의 SettingsStore callback과 file lock으로 그 디렉터리만 readable roots에 추가한다.

- 기본 지식 저장소: `.cache/belmont-wsl-profile/sand-data/knowledge`; `BELMONT_KNOWLEDGE_DIR`로 지정할 수 있다.
- 존재하지 않는 링크, 깨진 링크, 다른 대상 링크, 실제 디렉터리를 근거로 권한을 추가하지 않는다.
- 기존 tool rules, writable roots, outside 정책과 sandbox 설정을 보존한다. account의 명시적 `outsideRead: deny`는 추가를 건너뛴다.
- direct session에 전체 `KNOWLEDGE_DIR`를 무조건 허용하던 별도 경로를 제거하고, native/direct session이 account의 검증된 roots를 상속하게 했다.

원본과 초기 포크의 기본 permission 값 자체가 달랐다는 결론은 아니다. 캠페인 기록상 문제는 symlink 대상 위치와 native-session bootstrap에 있었다. session의 outside-read 정책은 이미 합쳐진 허용 roots의 밖에서 적용되는 upstream 의미를 그대로 가진다.

### 숫자 입력 readback

`direct_observation`: `belmont-browse/tools/patch-daemon.py`의 유지되는 `--refresh-numeric-fill` 경로가 pinned 824/902 bundle의 정확한 anchor에 적용된다. 알려지지 않은 anchor는 쓰기 전에 거부하며, 재적용은 동일 결과를 유지한다.

INPUT의 `text`, `search`, `tel`에서만, 입력한 ASCII 정수 문자열이 사이트에 의해 올바른 쉼표 천 단위 표기로 표시됐고 쉼표 제거 결과가 입력과 정확히 같을 때 허용한다. 예: `200000` → `200,000`. 숫자 형변환을 하지 않으므로 선행 0과 큰 정수의 정밀도를 보존한다. 값 변경, 잘못된 grouping, textarea/contenteditable 및 다른 input type은 기존 실패·정확 일치 의미를 유지한다.

### Site playbook과 runtime visual guidance

`documented_prior_claim`: root는 프로젝트가 관리하는 다음 세 지식 파일을 수정했다. 이 문서에는 파일 내용이나 계정 지시를 복사하지 않는다.

- `.cache/belmont-wsl-profile/sand-data/knowledge/sites/naver.com.md`
- `.cache/belmont-wsl-profile/sand-data/knowledge/sites/search.naver.com.md`
- `.cache/belmont-wsl-profile/sand-data/knowledge/rules/aside-agents.md`

두 site playbook은 Shopping 제한 뒤 통합검색 카드만으로 끝내던 흐름을 후보 탐색 후 동일 모델의 공식·판매자 상세 확인, 사양 펼치기, 실패 단계의 명시로 바꿨다. 상품 이름·정답 가격·기대 결과는 주입하지 않았다. 변경 근거와 diff는 `raw/site-playbook-refinement.json`, `site-playbook-change.patch`다.

runtime guidance에서는 실제 모델 prompt에 들어가 있던 screenshot 근거 금지 문구를 수정했다. 원본 VM에는 같은 금지가 없다는 비교가 기록돼 있다. 공개 API `display(await page.screenshot())`로 직접 본 이미지 근거를 허용하고, 불완전한 snapshot을 사실의 부재와 구분하도록 했다. 이는 제품 runtime 지식 파일이며 Codex global/repository AGENTS 변경이 아니다. 근거는 `raw/runtime-guidance-in-model-prompt.json`, `raw/runtime-guidance-refinement.json`, `runtime-guidance-change.patch`다.

이 지침이 누락된 이미지 사양에 영향을 주었다는 설명은 `inference`이며 단독 원인이나 개선 효과 크기는 입증되지 않았다. 최종 `replay-3-final/raw/actual-prompt-rules.json`에서 기존 금지 문구가 빠지고 새 시각 확인 규칙이 들어갔음을 확인했다. D3의 실제 이미지84에서 아이닉의 사용시간을 읽었다. 이 변화의 단독 인과 효과를 분리한 실험은 아니다.

### Local websearch

`direct_observation`: local 실행에서 native websearch가 비활성 Aside endpoint `http://127.0.0.1:9`의 `/search`를 호출하던 경로를 보완했다.

- 새 `belmont-browse/src/web-search.mjs`와 `session.mjs` hook, 유지되는 patcher의 `--refresh-local-web-search`를 사용한다. tool 이름·등록 목록은 유지한다.
- 정확한 비활성 endpoint일 때 daemon 902의 현재 session browser로 Google SERP를 읽는다. 명시적인 cloud endpoint의 원래 request/response 경로는 유지한다.
- daemon 824 local 경로는 browser/network 동작 전에 명시적으로 unsupported를 반환한다. 824 cloud 경로는 보존한다.
- local tool은 sequential mode이며 browser별 queue도 둔다. native runner의 같은 batch에서 다른 tool과 병렬 실행되지 않는다.
- 새로 반환된 owned tab만 사용한다. stable 상태를 기다린 뒤 Google HTTPS `/search`와 query를 확인하고 HTML을 읽는다. capture 전후 URL이 달라지면 중단한다. CAPTCHA/consent에서는 재시도하지 않는다.
- native Google parser를 우선 사용하고, 필요하면 결과 `h3`를 포함하는 link를 읽는다. 결과의 source ID는 원래 native citation builder가 생성한다.
- `retrieval: browser-serp`, `evidence_scope: search-result-snippets`를 표시한다. advanced deep retrieval과 같다고 하지 않는다.

최초 실제 UI E smoke에서는 정상 Google 결과가 있어도 local 결과가 0개였다. `replay-3/raw/independent-serp.html`에는 결과 h3 anchor 9개가 모두 opaque `/goto?url=...` 링크였고, 기존 external-only 필터가 이를 제거했다. frozen HTML SHA256은 `8b5d3ed905eefe38d685777756d086fc40ee840fe59d216212bbb4222d57825b`다.

보완 후 같은 HTML에서 첫 5개의 관측 href·제목·snippet을 반환한다. `/goto`는 HTTPS `www.google.com`의 실제 h3 result anchor이며 비어 있지 않은 url parameter인 경우에만 보존한다. 반환 결과와 `details.sources` 모두 `url_kind: search-result-redirect`, `final_url_verified: false`를 표시한다. 도착 주소를 표시용 cite에서 추정하거나 opaque 값을 임의 해독하지 않는다. 이 도구가 결과를 자동으로 따라가지 않으며, 모델이 선택한 결과를 정상 browser로 열어 최종 URL과 본문을 확인해야 한다.

원시 근거는 `worker-web-search/frozen-serp-before.json`, `frozen-serp-after.json`, `frozen-serp-native-902.json`이다. frozen HTML 내부 일부 private script에 전체 주소도 있지만, 이번 수정에는 해당 구조를 해석하는 decoder를 추가하지 않았다. 최종 production `web-search.mjs` SHA256은 `742429f52d0e3c754edfa7002cc874aad83c888a23c8d87e6963dff6a733f455`이며 다른 production hash는 `worker-web-search/sha256.json`에서 확인한다.

## 4. 검사 결과와 실제 작업의 남은 차이

`direct_observation`:

- 최종 focused 77/77 통과, 실패·skip 0. 이전 메모리/숫자 48개와 local search 검사 및 선택적으로 주입한 실제 frozen SERP를 포함한다. frozen 입력 없이도 상시 direct/redirect, 내부 탐색 제외, citation metadata 회귀가 실행된다.
- parser, native tool 생성, permission 평가, citation builder, AsyncLocalStorage 및 stored approval cancellation은 실제 bundle 코드를 사용했다. open/content/close는 통제된 browser primitives다. 이 검사를 실제 사이트 전체 작업 성공으로 해석하지 않는다.
- native pending approval abort는 정확한 tool call ID의 suspension을 종료하고 browser 작업을 시작하지 않았다. deny, queue 취소, 탭 반환 후 취소, cleanup과 제3 target 선택 보존 사례를 기록했다.
- 최종 `npm run check` exit 0: main 568 pass, mobile 120 pass 및 기존 1 skip. `npm run frontend:build` exit 0. 로그와 상태는 `worker-web-search/project-check-{check,frontend-build}.log`, `project-check-status.json`이다.
- Node 26.8.1로 검사했다. 정확한 `.node-version` 26.5.0은 설치돼 있지 않았고, package engines `>=26.5.0 <27` 범위는 만족한다. dependency 설치는 없었다. frontend의 기존 runtime URL·비효과적 dynamic import·chunk-size 경고는 남는다.

`documented_prior_claim`: `adversarial-numeric-live/results.json`의 독립 Chrome 145 실제 DOM/CDP 검사는 두 daemon의 올바른 grouping 허용, 변경값·잘못된 grouping 거부, textarea 의미 보존을 확인했다. 이는 실제 Naver filter 적용 검사가 아니다.

이전 실제 라운드의 제한도 유지한다.

- Replay-1 C 뉴스: 8개 매체의 8개 기사와 본문 수치가 기록됐다. 두 월간 수치는 일치했으나 한 기사의 1–8월 범위는 문맥 추론이며 완전한 전재·중복 제거는 미검증이다.
- Replay-1 D 쇼핑: 상세 1개와 요청한 무게·runtime 근거 부족으로 상세 근거 동일성은 거부됐다.
- Replay-2 D: 판매자 상세 3개와 실제 base option 선택까지 진행했으나 무게·runtime 6개 항목, 가격의 coupon 조건, 배송과 Naver 가격 filter가 남아 **PARTIAL**이다.
- Replay-2의 다른 모니터 과제: 상세 3개, 일부 사양 및 판매자/공식 사양 충돌의 명시가 기록됐다. 지역 배송 예외, 전체 SKU 대응 일부와 가격 조건은 남았다. 한 번의 관측이며 성공률·일반화·지침만의 인과 효과는 아니다.
- Replay-3 첫 E: bad-port 경로는 벗어났지만 local 결과 0건이었다. 모델의 이후 일반 browser fallback과 local websearch 성공을 혼동하지 않는다.
- **Replay-3-final E: 검색 복구 범위 VERIFIED.** native `websearch` 결과12개·citation12개와 실제 공식 CDP/W3C 문서 읽기를 확인했다. 모델이 본 이미지17/39를 root와 독립 검토자가 직접 관측했다. 일부 설명 조건 누락, 선택하지 않은 스니펫2개의 JS/CSS 혼입, operational tmp 쓰기는 남았다. advanced cloud 검색 동등성은 아니다.
- **Replay-3-final D: PARTIAL.** 세 번째이자 마지막 hard shopping replay는 02:53:50–03:08:03 UTC에 자연 종료했다. 원래 prompt SHA256 `93e18393ece53b04d23e0eb39fe810db56a186cb81005f88ebfbdf9f555b6660`은 동일하다. 상세3개·아이닉 본품 옵션을 확인했고 사양6칸 중 원시 수치2개만 확보했다. 아이닉 사용시간의 `약/1단` 조건은 최종에서 빠졌고 4칸은 미확인이다. 자세한 판정은 마지막 절을 따른다.

## 5. 재현 명령

다음은 검사·빌드 명령이다. live replay를 자동 재실행하거나 실행 중인 서비스를 교체하는 명령이 아니다.

```sh
cd /home/hoon/_roots/labs/work/Belmont/belmont-browse
/home/hoon/.nvm/versions/node/v26.8.1/bin/node --test --test-reporter=tap test/aside-parity-bootstrap.test.mjs test/numeric-fill-parity.test.mjs test/local-web-search-native.test.mjs
```

실제 frozen SERP를 포함한 검사:

```sh
cd /home/hoon/_roots/labs/work/Belmont/belmont-browse
BELMONT_FROZEN_SERP_HTML=/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside-parity-improvement-20260907T010326Z/replay-3/raw/independent-serp.html /home/hoon/.nvm/versions/node/v26.8.1/bin/node --test --test-reporter=tap test/aside-parity-bootstrap.test.mjs test/numeric-fill-parity.test.mjs test/local-web-search-native.test.mjs
```

패치 재생성은 대상 bundle을 수정한다. 실행 중 replay의 복사본에 적용하지 말고 유지보수 대상과 pinned anchor를 먼저 확인한다.

```sh
cd /home/hoon/_roots/labs/work/Belmont/belmont-browse
python3 tools/patch-daemon.py --refresh-numeric-fill vendor/aside-824/apps/daemon/build/daemon.mjs
python3 tools/patch-daemon.py --refresh-numeric-fill vendor/aside-902/apps/daemon/build/daemon.mjs
python3 tools/patch-daemon.py --refresh-local-web-search vendor/aside-824/apps/daemon/build/daemon.mjs
python3 tools/patch-daemon.py --refresh-local-web-search vendor/aside-902/apps/daemon/build/daemon.mjs
```

저장소 필수 검사 및 기존 native 트리 증분 빌드:

```sh
cd /home/hoon/_roots/labs/work/Belmont
PATH=/home/hoon/.nvm/versions/node/v26.8.1/bin:$PATH npm run check
PATH=/home/hoon/.nvm/versions/node/v26.8.1/bin:$PATH npm run frontend:build
cd /home/hoon/chromium/src
./third_party/ninja/ninja -C out/aside chrome -j2
```

Native patch 045를 다른 revision에 적용하는 범용 명령은 제공하지 않는다. patch의 기준 파일과 `raw/native-edited-files.json`, build log를 먼저 대조한다. 실제 replay 명령은 각 `replay-*/launch.py`, `submit.mjs`, `observe.mjs`, `collect.py`에 보존돼 있다. 실행 전 해당 라운드의 PID·display·port 소유권을 확인한다.

## 6. 유지해야 할 제한과 보호 대상

- 실제 E의 일부 미선택 스니펫에 Google JS/CSS가 섞였다. D 부모와 child가 긴 opaque 링크를 옮겨 적다가 URL을 잘못 입력한 사례도 있다. 반환 링크의 정확성과 모델의 다음 조작을 구분한다.
- 검색 예산은 고유 query 최대 4개, query당 결과 5개, 전체 고유 URL 12개, 전체 serialized tool result 25,000자, HTML 5 MiB 문자, 제목 512자, excerpt 1,600자, URL 4,096자다. 검색결과 순위·가용성과 Google redirect의 장기 유효성은 보장하지 않는다.
- Native approval cache는 session/toolCallId 단위다. URL·action마다 별도 승인을 보장하는 새 정책으로 바뀐 것이 아니다.
- Native create가 ID 반환 전에 실패하면 그 tab 소유권은 알 수 없다. 다른 새 tab을 추측해 닫지 않는다. 반환돼 새 owned임을 확인한 ID만 cleanup한다.
- 이미 시작한 native create/content/close는 완료 경계까지 cancellation이 지연될 수 있다. extension fallback에 보편적인 30초 timeout이 있는 것은 아니며 새 전체 취소시간 보장은 없다. permission/queue 대기는 abort-aware다.
- 닫힘 중 사용자가 제3 target을 선택하면 보존한다. native close의 자동 선택 대상과 정확히 같은 target을 동시에 사용자가 고른 경우에는 API에 actor/revision이 없어 구별되지 않는다.
- close 실패는 성공으로 숨기지 않는다. 실패 fixture에서는 owned tab이 남는 한계도 기록했다. 실제 run의 최종 tab/process 상태는 root가 따로 정리한다.
- 원본 QEMU **PID 7850**, 원본 Aside 상태, Orca 및 무관한 작업은 **DO NOT TOUCH**다. PID는 기록이며 후속 실행 전 현재 소유권을 재조회한다. 이 문서 작성 중 VM·browser·daemon·profile을 조작하지 않았다.
- 새 프로필에서 온보딩 창만 표시되고 기본 창이 숨겨진 시작 상태를 관측했다. 테스트 전 해당 온보딩 창을 닫고 같은 profile의 일반 Chrome `--new-window`로 메인 창을 표시했다. 초기 온보딩 무개입 통과로 보지 않는다.
- 캠페인 display `:98` 및 ports `19333/19340/21420`은 캠페인 소유 작업용이다. 현재 담당 PID는 캠페인 `status.json`과 각 replay의 `pids.json`을 읽는다. 재시작·종료·포트 재사용을 추정으로 수행하지 않는다.
- task evidence DB, auth, runtime profiles는 각 `replay-*/`와 worker fixture 아래의 인수인계 경로만 보존한다. 그 내용은 이 문서에 복사하지 않았으며 배포·commit 대상이 아니다. 이전 실패 라운드와 프로필을 덮어쓰거나 지우지 않는다.
- 지식 저장소는 `.cache` 아래의 환경별 runtime 입력이다. daemon source 수정만 다른 환경으로 옮기면 site/runtime 지침까지 자동 배포된다고 가정하지 않는다. campaign diff와 실제 설정된 지식 경로를 대조해야 한다.

## 7. 최종 실제 실행 판정과 다음 검증 경계

Root와 `/root/parity_refuter`가 `replay-3-final/raw/messages-tHB9CP6x1wAbtQrQ.jsonl`의 최종136행을 앞선 원시 출력·이미지와 대조했다.

- 아이닉 i50: 53→54행에 `i50 itower 본품` 선택과 상품총액299,000원. 이미지84에는 **최대 약65분, 1단 사용 시**가 보인다. 최종의65분 표기는 조건을 누락했다. 무게는 미확인이다.
- 아이닉의 리뷰1,064는48행에서 개별 리뷰 앞에 나오는 숫자이며 총계 표시로 검증되지 않았다. 실제 browser52/58행은 `리뷰(-)`다. 배송 역시 기본3,000원·무료배송 문구·60,000원 기준 조각만 함께 있어 선택 구성에 적용된 배송비/배송포함 총액은 미확인이다.
- 샤크 CS150KRAE: 98/102/104/106행에 표시393,900원·배송포함·리뷰139·**청소기 본체1.9kg**가 있다. 사용시간과 회원 자격·구매조건은 별도 미확인이다.
- 쿠쿠 CVC-ANLEM1420W: 119행에 판매399,000원·택배배송0원·합계399,000원·리뷰15. 관측한 이미지123/127/131에는 요청한 사양 수치가 없었다. 무게·사용시간 수집 미완료이며 사이트에 정보가 없다는 뜻은 아니다.
- 네이버 가격필터는 실제 적용하지 못했고 최종에서 이를 명시했다. 이 실패는 고친 numeric-fill 회귀 통과와 구분한다.

D의 primary는 `gpt-5.6-terra/high`이고 모델이 스스로 띄운 native child는 `gpt-5.4-mini/medium`이다. Child `1ziX52UEyWfWQKyd`의 두 후보는 최종에 채택되지 않았으며 parent/child 모두 idle로 종료했다. Parent에 정답을 넣거나 ordinary local-read 승인을 대신 처리하지 않았다.

실행 중 parent/child가 task account의 operational tmp에 증거를 저장했으므로 엄격한 파일 변경0을 주장하지 않는다. Child screenshot API의 session 경로 제한과 일반 filesystem 도구의 공유 account root 허용 범위도 달랐다. 도구 전체가 같은 session 파일격리 정책을 가진다는 주장은 하지 않는다. 다른 채팅 탭 조작은 관측되지 않았고 E의 두 공식 문서 탭은 최종 목록에 남았다.

최종 전달 source/test/patch/runtime 지식 hash는 `raw/final-change-hashes.json`, 실제 완료 UI는 `shots/replay-3-final-completed-ui.png`, 프로세스 정리는 `replay-3-final/raw/final-cleanup.json`에 있다. 캠페인-owned daemon/browser/observer/Xvfb/Openbox가 모두 종료됐고 19333/19340/21420은 비었다. 원본 QEMU7850, guest Aside daemon8888, SSH2299/VNC5905/noVNC6090은 유지됐다. 이전 실패 라운드·DB·프로필·이미지·로그는 보존했다.

다음 검증은 남은 사양을 안정된 렌더 영역에서 읽기, 실제 선택 배송 상태와 리뷰 총계 확인, 조건 누락 방지, 새 unseen 과제로 전이 확인 순서다. 온보딩 시작 상태는 별도 검증이 필요하다. 이번 세 번의 개선 라운드만으로 일반적인 성공률이나 전체 동일성 수치를 만들지 않는다.
