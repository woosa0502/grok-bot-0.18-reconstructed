# Aside Chromium 디자인 복원 검토·실행 계획 — 2026-09-07

상태: **PLAN_REVIEWED / 검토·실행 계획 작성 완료 / 이 작업의 제품 구현 미착수**.

**먼저 원본과 같은 화면 조건을 고정하고, 사이드바 구역과 하단 프로필 구성을 바로잡은 뒤 프레임·주소창·메뉴·분할 화면을 맞춘다.** 현재 코드는 원본 팔레트·Geist 등록 경로를 이미 포함한다. 색을 새로 정하는 것보다 각 화면의 구조와 기존 스타일 적용 여부를 확인하는 일이 먼저다.

이 문서는 “디자인은 왜 달라?”, “할 수는 있니?”, “뭘 해야 되는지 검토해서 문서화해라”에 대한 후속 계획이다. 목표는 **원본 Aside의 관측 가능한 디자인 복원**이다. 원본 906 데몬 로직을 WSL에서 재사용하는 방향은 유지한다. 이 문서로 데몬 교체, 계정 변경, 제품 소스 수정이나 서비스 재시작을 수행하지 않는다.

## 1. 판정과 근거 범위

- `direct_observation`: 이번에 직접 읽은 현재 소스·프로세스와 직접 본 기존 이미지의 내용. 이미지의 내용 확인은 현재 바이너리 재실행 증명이 아니다.
- `documented_prior_claim`: 이전 빌드·실행·추출 보고서. 새 검증 없이 이번 실행 결과로 승계하지 않는다.
- `inference`: 이미지와 소스를 연결한 설명·작업 우선순위. 구현 후 검증이 필요하다.
- `unverified`: 같은 조건의 원본/포크 대조, 현재 화면별 실제 로드 확장, 원본과의 수치 허용오차.

**가확정(PROVISIONAL) 진단:** 현재 구조와 기존 포크 캡처에는 원본과 비교해야 할 사이드바 순서, footer 밀도, 프레임·메뉴·split 구성 차이가 있다. 일부는 설정·버전·캡처 조건 차이일 수 있다. 아직 같은 상태의 캡처 쌍이 없으므로 픽셀 일치율·제품 복원율을 산정하지 않는다.

자료:

- [구성 고정·소스 차이 보고서](aside-restoration-baseline-and-differences-2026-09-07.md), [전체 복원 계획](aside-restoration-plan-2026-09-07.md).
- [이번 조사와 실행 체크리스트](../data/artifacts/aside-design-restoration-plan_20260907T080835Z/README.md).
- [이미지 목록·해시·관측·제한](../data/artifacts/aside-design-restoration-plan_20260907T080835Z/inventory/visual-references.json), [소스 경계 지도](../data/artifacts/aside-design-restoration-plan_20260907T080835Z/inventory/source-map.md).

## 2. 현재 상태와 비교 대상

이번 작업 시작 시각은 2026-09-07 08:08 UTC다. 호스트 QEMU PID 7850과 Orca PID 36754가 실행 중이고, 조회한 포크 관련 포트 9333·9340·21420에는 listener가 없었다(`direct_observation`). 원본 guest 내부의 현재 상태는 이번에 새로 조회하지 않았다. PID를 다음 작업의 고정 식별자로 사용하지 말고 명령·시작 시각·소유권을 다시 확인한다.

[앞서 보존한 구성](../data/artifacts/aside-restoration_20260907T041632Z/baseline/baseline-manifest.json)은 원본 앱 **1.0.825.1**, 데몬 **1.26.906.1714**, 설정 파일이 선택한 AgentManager **1.26.906.1714**다(`documented_prior_claim`). 앱과 컴포넌트 버전은 별개다. 그 기록도 모든 확장 JS의 실제 실행 및 각 과거 스크린샷의 로드 버전을 증명하지 않는다.

현재 Chromium 소스는 `/home/hoon/chromium/src`, HEAD는 `1d00f53b564d073e80d6c90be81fb1ac0f90327f`, 공개 기준 parent는 `cc5584af0df9786f00efdb71f666c6664f836c2d`다. HEAD 밖의 변경이 있으므로 HEAD만 checkout해서는 현재 구현을 재현할 수 없다. [기존 소스 보존 목록](../data/artifacts/aside-restoration_20260907T041632Z/inventory/native-file-manifest.json)을 함께 사용한다. 기존 overlay·patch 파일이 현재 소스 전체와 동일하다고 가정하지 않는다.

현재 확인한 `belmont-browse/vendor/aside-ext/AsideAgentManager/manifest.json`은 824다. 별도 906 후보가 있다고 해서 그 경로가 모든 실행의 확장 경로가 되는 것은 아니다. 디자인 검증에서는 **실행한 chrome 파일 + 실제 로드한 확장 경로/해시 + 설정**을 새로 연결해야 한다.

보존 대상: 원본 VM, Orca, 사용자 프로필·로그인·DB, 현재 Chromium 변경분, 기존 증거, 이번 과제와 무관한 Belmont 변경. 이번에 만든 것은 문서와 조사 자료뿐이다.

## 3. 왜 다르게 보이는가

### 3.1 UI를 그리는 경계가 여러 개다

- **네이티브 Chromium Views:** 창 프레임, 세로탭, 북마크 구역, profile footer/menu, 주소창, split 주변 UI, toast 등의 C++ 구현. 우선 수정 대상이다.
- **원본 extension/WebUI:** 새 탭, 채팅·설정, tab search·mini popup의 HTML/CSS/JS와 일부 내부 페이지. 먼저 올바른 버전의 원본 자산이 실제로 열리는지 확인한다.
- **데몬·native API:** 작업 목록·로딩·attention·오류 등 화면 상태의 데이터와 사용자 조작 계약. 화면이 예뻐져도 API가 빈 값을 반환하면 기능 복원은 미통과다.
- **OS·compositor:** macOS 창 장식·그림자·글꼴 rasterization과 WSLg/Linux 창 관리. 앱 내부 여백·버튼 구성과 구분해서 계측한다.

Belmont의 `frontend/` React 파일을 고쳐도 이 native Chromium 화면이 바뀐다는 근거는 없다. 이번 계획의 주 작업 경로로 삼지 않는다.

### 3.2 이미 가져온 자산과 다시 구현한 배치가 섞여 있다

`aside_color_mixer.cc`의 팔레트와 `aside_fonts.cc`의 Geist 등록·선택 함수가 존재한다. 믹서는 `chrome_color_mixers.cc`에 연결되어 있다(`direct_observation`). 원본 추출 출처는 소스 주석과 [G7 기록](../belmont-browse/aside-fork/campaign/G7-RESULT.md)에 남아 있다. 이번에는 그 모든 값의 바이너리 원문 출처를 다시 계산하지 않았다.

하지만 토큰 존재는 모든 View가 그 값을 사용한다는 뜻이 아니다. 폰트 파일 등록도 실제 각 label/WebUI의 사용 글꼴 증명은 아니다. 사용처·fallback·weight와 상태별 배경을 확인해야 한다.

현재 `vertical_tab_strip_region_view.cc`의 최종 재배치는 additions → 일반 tab strip → organizer 순서를 만든다. additions에는 New Chat·Tidy/Organizer가 있고 organizer에는 Tab Groups·Bookmarks·Tasks·Recent Chats가 있다. 기존 원본 캡처 O01/O02에서는 Bookmarks → Chats → Tabs가 보인다. **구조부터 대조해야 한다는 판단은 이 두 근거의 연결이다**(`inference`). 모든 설정에서 원본 순서가 같다는 주장은 아니다.

### 3.3 기존 캡처는 조사 자료이며 합격용 정답 쌍은 아니다

이번에 목록화한 13개 이미지 모두 직접 관측했다. 원본 1280×800과 과거 포크 1400×900 등이 섞여 있고, PNG 크기는 client 영역의 DIP 크기를 증명하지 않는다. 아래 관측은 해당 이미지의 내용에 한정된다.

- **O01/O02 ↔ F01:** 원본은 Bookmarks·Chats·Tabs와 작은 하단 avatar/search 구성이 보인다. 포크는 상단 New Chat·Tidy·Organizer, 아래쪽 Bookmarks·Recent Chats와 넓은 profile 표시가 보인다.
- **O03 ↔ F02/F03:** 원본의 compact profile menu와 포크의 menu/footer 배치·밀도에 대조할 항목이 있다. 서로 다른 메뉴 페이지·프로필 수이므로 정밀 치수 비교에는 새 쌍이 필요하다.
- **O04 ↔ F05:** 원본 split 선택 화면에는 pane별 주소창과 합쳐진 탭 행이 보인다. 과거 포크 split 캡처에는 공통 toolbar와 별도 chip들이 보인다. 현재 동작의 결함으로 확정하기 전에 같은 split 상태를 재현한다.
- **O06:** 별도 floating mini popup이 실제로 보이는 원본 참고 이미지다. O05는 파일명에 `minipopup`이 있지만 본문은 메인 채팅 화면이므로 mini popup 정답으로 제외한다.
- **O07:** Appearance 설정에 theme·tab style 선택이 보인다. San Francisco/New York 등의 설정 차이를 고정하지 않고 layout 차이를 전부 코드 결함으로 돌리지 않는다.
- **F06:** 미니 창의 경계가 분명하지 않은 전체 창 캡처다. mini popup 합격 근거로 쓰지 않는다. 이 캡처 하나로 구현 실패를 확정하지도 않는다.
- **F03/F04:** popup 수명·기존 작업 상태를 확인하는 참고 자료다. 테스트용 프로필/페이지, infobar, 표시 내용이 섞였으므로 원본 디자인 정답으로 승격하지 않는다.

이미지 파일은 원본 위치에서 보존했고 편집·재압축하지 않았다. 파일 mtime을 실제 촬영 시각 증명으로 쓰지 않는다. 일부 캡처의 계정 표시를 문서 예시 데이터로 복제하지 않는다.

## 4. 해야 할 작업과 순서

각 작업의 상세 입력·상태·완료 조건은 [work-items.json](../data/artifacts/aside-design-restoration-plan_20260907T080835Z/inventory/work-items.json)에 있다. 아래 순서는 계획이며 구현 완료 표시가 아니다.

### V00 — 비교 화면과 소스·실행 출처 고정 (선행 필수)

- 보호 중인 원본 VM은 유지한다. 상태를 바꿔야 하는 검사는 별도로 소유한 검증용 원본 환경/프로필을 준비한 뒤 수행한다. 준비되지 않으면 해당 정답 확보를 미실행으로 남긴다.
- 원본/포크의 client bounds(DIP), screenshot pixels, DPR·OS scale·page zoom, window mode, theme, tab style, locale, profile 수, tabs/bookmarks/tasks 데이터와 focus/hover 상태를 맞춘다.
- 실행 chrome 경로·SHA, 소스 HEAD·전체 diff/추가 파일 해시, build args·로그, 실제 PID, 로드 extension ID/경로/manifest·asset 해시를 기록한다. 데몬은 사용한 화면에 필요할 때 버전·설정을 연결한다.
- 첫 기준은 **light 기본 새 탭 + 같은 탭/북마크가 있는 sidebar + compact footer**, 다음은 dark와 profile menu다. 한 상태를 원본에서 반복 촬영하여 자연 변동을 파악하고, 구성요소별 허용오차를 구현 전에 고정한다.

완료: 실제 로드·좌표·설정·데이터가 연결된 비교 쌍과 사전 기준이 있다. 현재 자료만으로 이 단계가 통과한 것은 아니다.

기록 양식: [capture-record.template.json](../data/artifacts/aside-design-restoration-plan_20260907T080835Z/inventory/capture-record.template.json). 아직 관측하지 않은 값은 비워 뒀으며 실제 실행에서 채운다.

### V01 — 사이드바 구역·행·버튼 구성 (첫 구현 묶음)

담당 경계: `vertical_tab_strip_region_view.cc`, `aside_vertical_tab_strip_additions.cc`, `aside_bookmarks_section_view.cc`, `tabs/vertical/`.

- 고정한 원본의 Bookmarks/Chats/Tabs 순서, 각 header와 New Chat/New Tab 위치, divider, 행 높이·inset·선택 상태를 맞춘다.
- Tidy/Organizer·Tab Groups·별도 Tasks의 노출 조건은 원본 상태 증거로 결정한다. 캡처에서 보이지 않는다는 이유만으로 기능을 삭제하지 않는다.
- empty/populated, pinned/unpinned, collapsed/expanded, 긴 제목, scroll, attention 상태를 대조한다.

완료: 사전 지정한 상태에서 구역 순서·텍스트·조작 위치와 표시 조건이 일치한다. 북마크 이동·탭 선택·작업 선택·스크롤이 유지된다.

### V02 — 하단 프로필·검색·새 탭 구성 (V01과 함께)

담당 경계: `aside_profile_footer_view.cc`, `aside_profile_menu_view.cc`, `vertical_tab_strip_bottom_container.cc`.

- 원본 상태에 따라 avatar·chevron·dots·search 위치와 표시 이름·padding을 맞춘다. Chromium의 큰 `+` 버튼이 원본의 어떤 새 탭 조작에 대응하는지 확정한 뒤 위치/크기를 조정한다.
- 프로필 1개/여러 개, 이름이 긴 상태, 메뉴 열기·전환·닫기와 footer anchoring을 함께 검증한다.
- profile switch의 pref observer 재결속, popup close 재진입 방어·지연 삭제는 유지한다.

완료: footer/menu 첫 화면의 geometry·색·문구·focus와 profile 전환 동작이 지정 원본 상태에 대응한다.

### V03 — 프레임·주소창·공통 스타일 적용

담당 경계: `browser_view_tabbed_layout_impl.cc`, `browser_view.cc`, `toolbar_view.cc`, `location_bar_view.cc`, `layout_constants.cc`, `aside_color_mixer.cc`, `aside_fonts.cc`.

- sidebar 폭, toolbar 높이, content inset, pane seam, corner, 주소창 배경·border·icon 간격을 client 좌표로 측정한다.
- 기존 색 토큰의 실제 consumer를 연결하고, label별 Geist 사용·weight·fallback을 확인한다. 근거 있는 원본 값에 임의의 디자인 토큰을 덮어쓰지 않는다.
- 일반/focused/입력 중/결과 선택/loading/error, light/dark를 각각 확인한다. 진행 표시 색은 기존 G7에서도 근거가 덜 확보된 항목이므로 새 원본 관측이 필요하다.

완료: 구조가 고정된 화면의 주요 좌표·글꼴·색이 사전 기준을 통과하고 주소창 입력·결과 선택이 정상이다.

### V04 — 탭·프로필 메뉴의 나머지 상태

담당 경계: `tabs/vertical/`, `aside_profile_menu_view.cc`, native menu·tab switcher 관련 Views.

- tab hover/selected/drag, context menu, icon picker, profile edit, tab switcher의 행·아이콘·tooltip·선택 표시를 원본 상태별로 맞춘다.
- 정적 첫 화면만 검사하지 않고 keyboard focus, Esc, 밖 클릭, 메뉴 페이지 전환과 긴 목록을 확인한다.

완료: 해당 상태의 관측 가능한 구성과 조작이 맞고 clipping·겹침·focus 유실이 없다.

### V05 — 검색 popup·mini popup·toast

담당 경계: `aside_tab_search_bubble.cc`, `mini_popup_service.cc`, `mini_popup_view.cc`, `aside_task_views.cc`, 원본 extension의 해당 페이지.

- native 껍데기의 크기·anchor·shadow·corner와 extension 내부 layout을 나눠 수정한다.
- native 껍데기 작업은 먼저 진행할 수 있지만, 내용까지 합격하려면 V07의 실제 확장 자산 라우팅 확인도 필요하다.
- floating mini popup은 별도 창 bounds와 실제 창 캡처로 비교한다. compact/expanded/입력/focus 복원을 나눈다.
- 상단 search는 아래로, 하단 search는 위로 보이게 한 기존 anchor 수정과 창 내부 가시성을 보존한다. 원본과 geometry를 맞추더라도 다시 화면 밖으로 나가면 실패다.
- toast는 idle/running/attention/completed/error의 실제 표시 조건과 action을 확인한다. 미확인 원본 상태는 별도 pending으로 남긴다.

완료: 내용·컨테이너가 모두 기준을 통과하고 밖 클릭·Esc·부모 종료·중복 close에서 crash와 중복 action이 없다.

### V06 — split·agent viewport·control banner (별도 구조 작업)

담당 경계: `multi_contents_view.cc`, split/tab 모델 및 관련 toolbar, `multi_contents_view_drop_target_controller.cc`, `aside_agent_control_banner.cc`, `top_container_loading_bar.cc`.

- pane별 toolbar/주소창, split 선택 화면, 합쳐진 tab 행이 원본의 어떤 상태인지 먼저 재현한다. 필요하면 pane별 toolbar와 tab 모델 연결을 별도 구현 항목으로 설계한다.
- separator·drag target·focus·resize·닫기·Take over·loading을 대조한다. 단순 CSS 조정으로 끝나는 작업으로 추정하지 않는다.
- agent viewport/device metrics는 자동화 좌표 계약이다. 시각 오차를 가리려고 화면 크기 메트릭을 임의 변경하지 않는다.

완료: 화면 배치와 pane별 탐색·focus·drag·분할 해제·agent 제어가 함께 검증된다. 정적 screenshot만으로 통과하지 않는다.

### V07 — 새 탭·채팅·Settings·원본 WebUI 라우팅

담당 경계: 실제 로드할 AgentManager 원본 자산, manifest, native API binding, WebUI resource 등록.

- blank/대체 페이지가 나타나면 먼저 URL·실행 확장·resource 등록·API 오류를 확인한다. 원본 HTML/CSS/JS가 있는데 화면을 다시 작성하는 방향으로 바로 가지 않는다.
- 기본 새 탭 Search/Ask, chat empty/loading/error, Appearance와 mini popup 설정을 고정 원본과 비교한다.
- 빈 stub으로 API 오류를 숨긴 화면은 기능 합격으로 처리하지 않는다. 필요한 native 계약을 별도 실패로 남긴다.
- native Geist와 WebUI의 자체 font stack은 구분한다. 원본 WebUI의 글꼴을 일괄 Geist로 바꾸지 않는다.

완료: 지정 버전의 실제 자산이 로드되고 해당 화면·설정·이벤트 왕복이 확인된다. 데몬 인증은 static frame/sidebar 작업의 선행 조건이 아니다.

### V08 — 통합 관측과 독립 판정

- 먼저 local fixture로 상태와 native UI를 반복 재현한다. fixture 성공과 실제 데몬 작업 성공은 따로 기록한다.
- 원본에서 확인한 기능 계약에 맞는지, 해당 수정의 기존 회귀 검사가 무엇인지 정한다. 정적 UI에 모델 호출을 요구하지 않는다.
- agent 관련 UI의 최종 확인에는 소유한 환경에서 실제 906 작업 한 흐름을 실행하고 로드 경로·상태 전이·화면을 연결한다. 인증 미해결이면 이 부분만 보류하고 나머지 검증을 진행한다.
- 검토자는 구현자의 비교 코드를 재사용하지 않고 원시 이미지·좌표·상태 기록과 새 조작 시나리오로 반박한다. 작성자는 검토자의 원시 결과를 읽고 불일치를 수정한다.

완료: 선언한 모든 필수 상태가 관측됐고 실패·미실행 항목이 남지 않는다. 합격 범위는 이 화면/상태 목록이며 전체 Aside 기능 동일성으로 확대하지 않는다.

## 5. 합격 기준 — 결과를 보고 기준을 낮추지 않는다

다섯 축을 모두 통과해야 한다. 평균 점수로 누락된 구역이나 실패한 조작을 상쇄하지 않는다. 상세 기록 형식은 [rubric.json](../data/artifacts/aside-design-restoration-plan_20260907T080835Z/inventory/rubric.json)에 있다.

1. **비교 조건:** 버전·실제 로드·DIP/DPR·theme/tab style·데이터·focus를 설명할 수 있다. 불명확하면 `UNQUALIFIED_REFERENCE`이며 정밀 동일성 판정에 사용하지 않는다.
2. **구조·내용:** 사전 지정한 구역 순서, 텍스트, 버튼, 표시/숨김 조건, pane별 control이 일치한다. 동적 문구는 동일 fixture를 사용한다.
3. **치수·타이포그래피:** 기준 anchor의 bounding box, 행 높이·간격·baseline·줄바꿈, font family/weight를 비교한다. 원본 반복 캡처의 자연 변동을 먼저 측정하여 요소별 허용오차를 고정한다. 현재 미측정 숫자를 합격선으로 발명하지 않는다.
4. **색·자산:** 원문 근거가 있는 토큰·아이콘·font를 보존하고 실제 consumer를 확인한다. 이미지 overlay/diff는 오차 위치를 찾는 도구이며 단독 판정기는 아니다.
5. **상태·수명·동작:** hover/focus/pressed/disabled/loading/empty/error와 open/close/parent destroy, 탭·프로필·설정·action 효과를 함께 검사한다. crash·화면 밖 popup·잘못된 선택·중복 action은 실패다.

macOS traffic lights, OS shadow, font antialiasing 등 플랫폼 차이는 **영역·이유·대체 동작을 사전 명시**한다. sidebar 전체, 메뉴 전체, 앱 내부 여백을 일괄 예외 처리하지 않는다. 비교 실패 후 tolerance나 mask를 넓히면 새 기준 버전과 이유를 남기고 기존 실패 판정도 보존한다.

과적합 방지: 기본 light 화면을 조정할 때 다른 창 폭·dark·긴 제목/여러 프로필 상태 중 최소 두 상태는 조정에 사용하지 않고 마지막에 확인한다. 원본 상태를 확보하지 못하면 holdout 검사도 미실행이다.

holdout 실패를 보고 구현을 수정했다면 그 상태는 회귀 사례로 전환한다. 독립 검토자가 구현자의 튜닝에 노출되지 않은 새 상태를 동결해 최종 검사하고, 새 원본 상태나 검증 예산이 없으면 최종 판정은 보류한다.

## 6. 구현·빌드·검증 방법과 보존할 수정

첫 구현 범위는 **V00 완료 후 V01/V02**로 제한한다. 하나의 화면 상태를 수정 → native build → 소유한 새 프로필에서 실행 → 실제 화면 관측 → 독립 반박 순서로 진행한다. clean render가 나오면 동일 상태를 이유 없이 다시 촬영하지 않는다. 실패하면 차이의 원인을 기록하고 한 경계를 고친 뒤 재검사한다.

시작 시 읽기 전용 확인 명령:

```bash
git -C /home/hoon/chromium/src rev-parse HEAD
git -C /home/hoon/chromium/src status --short
git -C /home/hoon/chromium/src diff --stat
cat /home/hoon/chromium/src/out/aside/args.gn
```

실제 build output 경로가 바뀌었으면 실행 기록과 맞는 경로를 먼저 찾는다. 별도 checkout은 공개 기준 + 보존된 전체 변경분/추가 파일을 적용해 구성하고 파일 목록을 비교한다. 이전 overlay를 그대로 덮어쓰거나 현재 변경분을 버리지 않는다. 승인된 구현 작업에서 기존 toolchain으로 native `chrome` target을 빌드하되, output directory·명령·환경·소스 해시·로그·완성 바이너리 해시를 남긴다. 기존 실행 중 바이너리를 덮어쓰는 경로는 피한다.

현재 보존해야 할 동작:

- 045의 popup close 재진입 방어, observer detach, 지연 삭제와 profile 전환 재결속.
- footer search의 위쪽 anchor, header search의 아래쪽 anchor와 화면 내부 배치.
- omnibox 결과 세대(`resultSequenceId`) 검증과 stale 선택 거부.
- 기존 attention 분리 기본값 및 Recent Chats 표시 정책. 원본의 같은 상태 근거 없이 반전하지 않는다.
- 숫자 입력 검증, native API 이벤트·action 횟수, mini popup 크기·focus 계약, agent viewport 좌표 계약.

[045 검증 기록](../data/artifacts/aside-parity-improvement-20260907T010326Z/REPORT.md)은 제한된 기존 결과다. 변경한 경계에 맞는 회귀를 새 실행과 연결한다. launch infobar 등 테스트 환경 차이는 캡처 조건 문제로 분리하며, diff 점수를 올리기 위해 UI에서 숨기는 수정을 하지 않는다.

저장소 공유 전 `npm run check`와 `npm run frontend:build`도 실행한다. 이는 Belmont 저장소 검사이며 **native Chromium 빌드나 원본 디자인 동일성 증거가 아니다**. 실제 native 실행에서는 screenshot을 생성하는 데서 멈추지 않고 사람이 볼 수 있는 이미지와 console/crash log를 직접 읽는다.

## 7. 이번 문서 작업의 검사

`npm run check`, `npm run frontend:build`는 2026-09-07 08:21–08:22 UTC에 모두 exit 0으로 끝났다. 설치된 Node **26.8.1**을 사용했으며 저장소 요구 **26.5.x** 환경 검증은 남아 있다. [실행 기록](../data/artifacts/aside-design-restoration-plan_20260907T080835Z/inventory/repository-validation.json)에 명령·시각·로그를 남겼다. 이 결과는 native Chromium 화면 합격을 뜻하지 않는다.

이번에는 제품 코드·서비스·원본 VM 상태를 변경하지 않았고 native build나 새 브라우저 촬영을 수행하지 않았다. 기존 이미지를 직접 관측하고 소스와 대조했으며 문서의 파일 경로·JSON·링크를 검사했다.

[독립 검토](../data/artifacts/aside-design-restoration-plan_20260907T080835Z/adversarial/plan-review.json)는 계획의 범위와 핵심 근거를 확인했다. popup 내용의 V07 의존성과 holdout 소모 후 새 미노출 상태를 확보하는 조건을 반영했고 남은 필수 수정은 없다. 작성자는 검토자의 원시 이미지 무결성·소스 앵커·의존성 결과를 읽고 판정을 대조했다. 이는 계획서 검토 통과이며 실제 디자인 복원 합격은 아니다.

## 8. 인계·완료·판정 변경 조건

각 구현 묶음에는 다음을 남긴다: source diff·변경 파일, 입력 fixture와 원본 출처, build/runtime manifest, 원본/후보 screenshot, 좌표 비교·플랫폼 예외, 조작/console/crash 기록, 독립 검토 원시 결과, 실패/미실행 항목, 실행 중 작업 소유자와 정지 방법.

다음 작업자는 이 문서 → 이번 source map/work items → 원본 reference 목록 → 기존 baseline과 045 기록 순서로 읽는다. **첫 행동은 V00의 동일 조건 reference와 후보 실행 출처 확보**다. 화면 첫 수정은 V01/V02다. 인증 문제 해결이나 전체 데몬 교체를 디자인 작업의 시작 조건으로 삼지 않는다.

이번 문서 작업의 완료 조건은 근거 목록, 코드별 작업, 순서, 검증 기준, 보존 경계, 독립 검토와 인계 자료 작성이다. 제품 디자인 복원 완료는 V00–V08을 실제 수행한 뒤에만 판정한다.

판정을 바꿀 근거: 같은 조건에서 현재 포크가 이미 일치하면 해당 수정 항목을 생략하고 근거를 남긴다. 원본 버전/설정이 달랐으면 reference를 별도 판으로 다시 고정한다. 원본의 다른 상태가 현재 배치를 요구하면 기능을 삭제하지 않고 표시 조건을 수정한다. 실제 906 WebUI/API 계약이 예상과 다르면 해당 경계를 수정한 뒤 관련 화면을 다시 검증한다.
