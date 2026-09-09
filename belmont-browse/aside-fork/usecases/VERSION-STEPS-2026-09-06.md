# 같은 크로미움 바탕 위 인접 버전 짝 비교 — 기능 이름표 붙이기 (2026-09-06)

작업 폴더: `/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_version_steps_20260906/`
(원자료 `raw/`, 조각 `extracted/`, 지문·짝비교·이름표 `analysis/`, 종합 `summary.json`, 이어받기 `HANDOFF.md`)

## 결론 먼저

1. **쓸 만하다. 단, 절반만.** 같은 바탕 위 두 버전을 비교하면 바뀐 자리가 400~600 구간으로 좁혀진다.
   그중 **문자열을 참조하는 구간만** 무슨 기능인지 말할 수 있고, 그건 전체의 13% 정도다.
   나머지 87%는 문자열을 안 쓰는 함수라 이 방법으로는 이름을 붙일 수 없다.
2. **"같은 바탕이면 안 맞는 블록은 거의 전부 Aside 변경"이라는 가정은 블록 단위로는 틀렸다.**
   세 걸음 모두에서 똑같이 바뀐 것으로 잡히는 구간이 90개 있는데, 내용이 libvpx·dav1d·webrtc·
   webnn·skia·libjpeg·정책 디코더다. Aside가 손대는 곳이 아니다. 다시 빌드할 때 생기는 잡음이다.
   **구간 단위(문자열 근거가 있는 것)로는 맞다.**
3. **세 걸음의 이름표 성적**: 720.1 = 4건 연결 / 724.1 = 19건 / 813.1 = 9건. 확신 높음만 세면 각각 1 / 9 / 7건.
4. **우리 포크에 없는 원본 기능 6종을 새로 찾았다** (아래 5절). 그중 `chrome://settings`의
   "Aside Account" 구역과 북마크로 대표되는 탭(`bookmark_tab_representation_*`)은 우리 문서에 전혀 없다.

## 1. 입력과 바탕 확인

바탕 크로미움 판은 변경 로그가 아니라 **각 x86_64 조각 안의 문자열**에서 직접 읽었다.

| Aside 판 | 바탕 크로미움 | CRX 크기 | CRX SHA-256 앞 16 | x86_64 조각 크기 |
|---|---|---|---|---|
| 1.0.719.1 | 150.0.7871.129 | (기존 아티팩트 재사용) | 5b3970a876a65da9 | 259,365,888 |
| 1.0.720.1 | 150.0.7871.129 | 411,048,974 | e44882980a6497b4 | 259,374,144 |
| 1.0.724.1 | 150.0.7871.129 | 410,786,061 | a4b4da2682c07742 | 259,394,784 |
| 1.0.811.1 | 151.0.7922.109 | 434,863,123 | f7b74237c25d624b | 262,925,424 |
| 1.0.813.1 | 151.0.7922.109 | 352,321,536 | 71a2fee0724b58f8 | 262,946,064 |

1.0.719.1은 다시 받지 않고 `aside_browser_fork_depth_20260906/analysis/`의 조각을 **읽기만** 했다.
같은 도구·같은 설정으로 다시 지문을 떴더니 그 아티팩트의 `accepted=397204 starts=504288`이
글자 하나까지 재현됐다. 도구 해시도 같다(`e36ec7e4…3938620`).

## 2. 짝별 수치

세 렌즈 중 **operand(숫자를 지운 명령어 렌즈)**가 본 렌즈다. raw(생바이트)는 주소에 민감해
10% 언저리로 무의미하고, mnemonic은 가장 헐겁다.

| 짝 | operand 다중집합 | operand 1:1 고유 | 1:1 천장 대비 | 한쪽에만 있는 블록(왼/오) | 구간(왼/오) |
|---|---|---|---|---|---|
| 719.1 → 720.1 (같은 바탕) | 99.8414% | 68.9573% | **99.78%** | 612 / 618 | 403 / 407 |
| 720.1 → 724.1 (같은 바탕) | 99.7900% | 68.9023% | **99.70%** | 821 / 844 | 546 / 553 |
| 719.1 → 724.1 (두 걸음 합) | 99.7558% | 68.8744% | 99.66% | 939 / 968 | 579 / 592 |
| 811.1 → 813.1 (같은 바탕) | 99.8464% | 69.9026% | **99.78%** | 602 / 622 | 406 / 409 |
| 719.1 ↔ CFT 150.0.7871.129 (참고) | 97.5159% | 66.8231% | 96.69% | — | — |
| 724.1 → 811.1 (바탕 150→151, 대조군) | 73.1720% | 47.7273% | **69.06%** | 96,269 / 97,933 | 8,609 / 8,428 |

**mnemonic 렌즈**도 같은 순서다: 같은 바탕 99.79~99.85%, 바탕 바뀌면 73.84%.
**raw 렌즈**: 같은 바탕 10~11%, 바탕 바뀌면 5.06%. 주소가 조금만 밀려도 무너지니 참고용이다.

### 1:1 고유 수치는 "천장"과 같이 봐야 한다

이 바이너리들은 **블록의 30.9%가 자기 자신 안에서 다른 블록과 지문이 겹친다**(정규화 충돌).
그래서 1:1 고유는 아무리 완벽해도 **69.1%를 못 넘는다**. 68.9%라는 숫자가 낮아 보이는 건 착시다.

| 짝 | 자기 안 중복 지문 블록 비율 | 1:1 천장 | 실제 1:1 | 천장 대비 | 다중집합 중 애매한 몫 |
|---|---|---|---|---|---|
| 719.1 → 720.1 | 30.8894% | 69.1106% | 68.9573% | 99.78% | 30.93% |
| 720.1 → 724.1 | 30.8905% | 69.1095% | 68.9023% | 99.70% | 30.95% |
| 811.1 → 813.1 | 29.9450% | 70.0550% | 69.9026% | 99.78% | 29.99% |
| 719.1 ↔ CFT .129 | 30.8894% | 69.1106% | 66.8231% | 96.69% | — |
| 724.1 → 811.1 | 30.8887% | 69.1113% | 47.7273% | 69.06% | 34.77% |

"애매한 몫"은 다중집합 일치 중 **중복 지문 때문에 1:1로 인정 못 하는 비율**이다. 약 31%.
즉 99.84%라는 다중집합 수치는 **31%만큼 부풀려 읽힐 여지가 있고**, 그 부풀림을 걷어낸 게
천장 대비 99.78%다. 두 수치가 같은 결론을 준다.

### 같은 바탕 짝의 차이 규모 vs 719.1↔CFT 차이 규모

| 비교 | 안 맞는 블록 수 | 배수 |
|---|---|---|
| 같은 바탕 한 걸음 (719→720) | 618 | 1× |
| 같은 바탕 한 걸음 (811→813) | 622 | 1× |
| 같은 바탕 한 걸음 (720→724) | 844 | 1.4× |
| 719.1 ↔ CFT 150.0.7871.129 | 9,867 (397,204 − 387,337) | 16× |
| 바탕 150 → 151 | 97,933 | **158×** |

같은 바탕 한 걸음은 CFT 대비 차이의 **1/16**, 바탕 갈아타기의 **1/158**이다.
가정의 방향은 맞다. 다만 크기가 0은 아니다 — 다음 절이 그 이유다.

## 3. 잡음 바닥 (가정을 그대로 믿으면 안 되는 이유)

세 걸음은 서로 독립이고, 그중 둘은 크로미움 대판이 다르다.
**같은 문자열 묶음을 참조하는 구간이 세 걸음에 모두 나타나면** 그건 그 걸음의 변경일 수 없다.

| 걸음 | 문자열이 잡히는 구간 | 세 걸음 공통 | 비율 |
|---|---|---|---|
| 719.1 → 720.1 | 183 | 90 | **49.2%** |
| 720.1 → 724.1 | 274 | 90 | **32.9%** |
| 811.1 → 813.1 | 194 | 90 | **46.4%** |

공통 90개의 내용: libvpx(`Failed to allocate PC_TREE`), dav1d, webrtc VP8/H264 인코더,
services/webnn, skia 래스터 파이프라인, libjpeg-turbo 3.1.0, `components/policy` proto 디코더,
`cpu_measurement_monitor.cc`. **Aside가 고칠 이유가 없는 곳**이다. 다시 빌드하면서 생긴
인라인·PGO 차이로 본다.

보조 근거 세 가지가 이 잡음 해석을 뒷받침한다.

- **문자열 집합 차이**: 같은 바탕 한 걸음에서 `__cstring`이 **1~7개**만 바뀐다(4절).
  블록은 600~800개가 흔들리는데 문자열은 몇 개뿐이다.
- **꾸러미(CRX) 차이**: 719.1 → 720.1에서 **내용이 실제로 바뀐 구성원은 프레임워크 바이너리 하나뿐**
  (+16,416 바이트). 리소스·pak·확장 JS 전부 그대로. 변경 로그의 "새 기능 없음, 안정성만"과 일치.
- **`.pak` 파일**: 세 걸음 모두 224개 pak 중 **바뀐 것 0개**. 이 세 판은 새 화면 문구를 넣지 않았다.

결론: **블록 개수를 변경량으로 읽으면 안 된다.** 문자열 근거가 있는 구간만 이름표를 붙일 수 있다.

## 4. 문자열 집합 차이 (가장 깨끗한 신호)

| 걸음 | 추가 | 삭제 |
|---|---|---|
| 719.1 → 720.1 | 1 | 1 |
| 720.1 → 724.1 | 7(+`kAsideHomeIcon`) | 4(−`kNavigateHomeTouchOldIcon`) |
| 811.1 → 813.1 | 4(+`aside.vertical_tabs.bookmarks_section_expanded`) | 4 |
| 724.1 → 811.1 (대조군) | 4,359 | 1,624 |

**719.1 → 720.1**: 판 번호 문자열 하나만 바뀐다. 새 문자열이 0개.

**720.1 → 724.1** 새 문자열과 그 뜻:

| 문자열 | 읽는 법 | 연결되는 변경 로그 |
|---|---|---|
| `OnCompositingDidCommit`, `SchedulePendingProfilePageSwitchAfterCompositorCommit` | 화면 합성이 끝난 뒤에 프로필 페이지를 넘기도록 바꿈 | Smoother Profile Switching |
| `{WeakPtr<Profile>…}` ← `{raw_ptr<Profile,…kMayDangle>}` | 프로필 포인터를 약한 참조로 교체 = 매달린 포인터 크래시 수정 | 프로필 전환 크래시 |
| `' FROM logins'` + `' WHERE id = ?'` ← `'SELECT * FROM logins WHERE id = ?'` | SQL을 조각내 조립하도록 바꿈 | 비밀번호 DB 손상 시 자동완성 크래시 |
| `kAsideHomeIcon` ← `kNavigateHomeTouchOldIcon` | 툴바 홈 아이콘을 Aside 자체 아이콘으로 | 툴바 아이콘 사용자 설정 수정 |
| `vertical_tab_strip_region_view.cc::276::kRenameChatFieldId` ← `::274::` | 그 파일 274줄 위쪽에 2줄이 들어감 | 세로탭 영역 파일이 실제로 바뀌었다는 증거 |

**811.1 → 813.1** 새 문자열:

| 문자열 | 읽는 법 |
|---|---|
| `aside.vertical_tabs.bookmarks_section_expanded` | 북마크 구역 펼침 상태 pref가 **다시 생김** |
| `vertical_tab_bookmarks_view.cc::142/143/144::…` ← `::141/142/143::` | 그 파일 141줄 위에 1줄 추가 |

### 새로 밝혀진 사실: `bookmarks_section_expanded`는 811.1에서 사라졌다가 813.1에 돌아왔다

| 판 | `bookmarks_section_expanded` | `bookmarks_section_enabled` |
|---|---|---|
| 719.1 / 720.1 / 724.1 | 있음 | 있음 |
| **811.1** | **없음** | 있음 |
| 813.1 | 있음 | 있음 |

811.1의 "사이드바 재설계"(채팅 구역을 위로 올림)에서 북마크 구역의 접기 기능이 빠졌고,
813.1의 "Added a collapsible Bookmarks section"은 **새 기능이 아니라 되돌리기**다.
813.1 변경 로그가 "Added"라고 쓴 이유가 이걸로 설명된다.

## 5. 이름표 붙인 구간

전체 표는 `analysis/step-labels.json`. 여기엔 확신 **높음·중간**만 싣는다.

### 719.1 → 720.1 — 이름표 11구간(연결 4, 미확인 7) / 미이름표 396구간

| 구간 | 크기 | 근거 문자열 | 변경 로그 | 확신 |
|---|---|---|---|---|
| `0x0792ee00`–`0x07930380` | 3,168 B / 7블록 | `aside_profile_attributes_updater.cc`, `AsideProfileAvatar`, `RefreshAccountsState`, `last_downloaded_gaia_picture_url_with_size` | 시작할 때 프로필 사진이 안 뜨던 문제 | **높음** |
| `0x0c83ae60`–`0x0c83b0b0` | 592 B / 1 | `multi_contents_view_delegate.cc`, `WebContentsFocused` | Split View가 빠른 포커스 변경 뒤 엉뚱한 창을 켜던 문제 | 중간 |
| `0x07a50b60`–`0x07a50f80` | 848 B / 2 | `profile_launch_observer.cc`, `MaybeActivateProfile` | 시작·프로필 전환·종료 중 크래시 | 중간 |

미확인 중 큰 것: `0x03daa2e0`(39,584 B, 거대 단일 블록에 북마크·프로필 순서 pref가 섞임),
`0x03c0adb0`(27,328 B, `profile_network_context_service.cc`), `0x072c81f0`(11,152 B, 앱 서비스 문자열).

### 720.1 → 724.1 — 이름표 37구간(연결 19, 미확인 18) / 미이름표 516구간

| 구간 | 크기 | 근거 문자열 | 변경 로그 | 확신 |
|---|---|---|---|---|
| `0x0c89c0a0`–`0x0c8a4630` | 29,424 B / 8 | `vertical_tab_strip_region_view.cc`, `OnCompositingDidCommit`(신규), `SchedulePreloadVisibleProfilesForProfilePager`, `ScheduleCaptureProfilePageSnapshot` | Smoother Profile Switching | **높음** |
| `0x0c894aa0`–`0x0c89a390` | 19,872 B / 7 | 같은 파일, `SchedulePendingProfilePageSwitchAfterCompositorCommit`(신규) | Smoother Profile Switching | **높음** |
| `0x0c579500`–`0x0c57dfb0` | 12,800 B / 2 | `browser.cc`, `SwitchProfileInPlaceForAside`, `PostClearTabStripEmptySuppressionForAsideProfileSwitch` | Smoother Profile Switching | **높음** |
| `0x07c54eb0`–`0x07c5cd40` | 25,008 B / 8 | `toolbar_view.cc`, `kAsideHomeIcon`(신규) | 툴바 아이콘 사용자 설정 / Ask Aside 버튼 오른쪽 고정 | **높음** |
| `0x06bda880`–`0x06bdf610` | 18,608 B / 8 | `login_database.cc`, SQL 조각내기(신규) | 비밀번호 DB 손상 시 자동완성 크래시 | **높음** |
| `0x040a4360`–`0x040a8040` | 15,264 B / 2 | `login_database.cc` 초기화·변환 경로 | 같은 항목 | **높음** |
| `0x023578d0` / `0x02894e40` | 1,296 / 1,024 B | `GetAutofillableLogins`, `GetAllLogins` | 같은 항목 | **높음** |
| `0x0c7c3360`–`0x0c7c6420` | 12,080 B / 12 | `aside_tab_switcher.cc`, `aside_tab_switcher_view.h`, `HandleTabAccelerator` | 탭 스위처가 닫히는 중 활성 탭이 바뀌면 나던 크래시 | **높음** |
| `0x03622000`–`0x03622b20` | 2,848 B / 1 | `vertical_tab_strip_state_controller.cc`, `vertical_tabs.strip_uncollapsed_width` | 세로탭 사이드바 너비가 재시작 후 초기화되던 문제 | **높음** |
| `0x03540a90`–`0x03542b30` | 8,352 B / 2 | `profile_manager.cc`, `InitProfileUserPrefs` | 프로필 전환 / 계정 순서 바인딩 | 중간 |
| `0x0c7e6a30` / `0x0c83e700` / `0x0c804ca0` | 5,632 / 4,240 / 2,816 B | `browser_view.cc OnActiveTabChanged`, `multi_contents_view_delegate.cc`, `contents_container_view.cc OnDidChangeFocus` | Split Tabs가 엉뚱한 탭을 켜던 문제 | 중간 |
| `0x0c597170` / `0x02fdf2a0` | 1,968 / 5,328 B | `browser_tabrestore.cc CreateRestoredTab`, `browser_tabstrip.cc SessionRestore` | 복원 가능한 탭이 없는 세션 복원 크래시 | 중간 |
| `0x01b75f80`–`0x01b76e60` | 3,808 B / 1 | `location_bar_view.h` | 자동완성이 뜰 때 주소창 높이·테두리가 바뀌던 문제 | 중간 |
| `0x03347610` / `0x02973ab0` | 1,872 / 3,712 B | `toolbar_actions_model.cc`, `aside_password_manager_toolbar_pin_initialized` | 툴바 버튼이 안 보이거나 안 눌리던 문제 / 프로필 전환 후 확장 버튼 상태 | 중간 |

미확인 중 큰 것: `0x0c5eb010`(33,776 B, 설정 화면 문자열표 — 5절 참조),
`0x0c87e340`(20,944 B, AsideTask 관련), `0x0c588b90`(12,368 B, `browser_command_controller.cc`),
`0x03c67fe0`·`0x0c812aa0`·`0x085b4580`(계정 비밀번호 팝업 3곳, 합 19,424 B),
`0x07f80b40`(5,968 B, `asideOmnibox` 세션), `0x0c7f0ae0`(3,792 B, `aside-import-data`).

### 811.1 → 813.1 — 이름표 15구간(연결 9, 미확인 6) / 미이름표 394구간

| 구간 | 크기 | 근거 문자열 | 변경 로그 | 확신 |
|---|---|---|---|---|
| `0x04c85f10`–`0x04c8d0b0` | 21,872 B / 7 | `vertical_tab_bookmarks_view.cc`, `expanded_bookmark_folder_ids`, 식별자 줄 141~143 → 142~144 | 접히는 북마크 구역 추가 | **높음** |
| `0x04cd5b80`–`0x04cda6d0` | 18,768 B / 9 | `vertical_tab_strip_region_view.cc`, `AsideSectionView`, `AsideSectionHeaderButton` | 같은 항목 | **높음** |
| `0x04cbbfb0`–`0x04cbfcc0` | 12,384 B / 2 | `bookmarks_section_enabled`, `account_auth_paused` | 같은 항목 | **높음** |
| `0x04c9ddc0`–`0x04c9fd70` | 8,112 B / 2 | `bookmarks_section_expanded`(부활), `ScheduleRefreshTabsRepresentedByBookmarks`, `BookmarkDragPreview` | 같은 항목 | **높음** |
| `0x04ca6d20` / `0x04cdb0d0` / `0x04cce640` | 2,816 / 1,568 / 1,376 B | `AsideSectionClipView`, `AsideSectionDivider`, 북마크 pref 2종 | 같은 항목 | **높음** |
| `0x04bc7df0`–`0x04bcc800` | 17,088 B / 2 | `browser.cc`, `StashTabsForAsideProfileSwitch`, `RestoreTabsForAsideProfileSwitch`, `ScheduleSessionRebuildAfterAsideProfileSwitch`, `MoveTabsPreservingCollections` | 프로필 사이로 옮길 때 그룹·Split View 탭 신뢰성 개선 | **높음** |
| `0x04cc3760`–`0x04cc52b0` | 5,472 B / 2 | `StartToolbarCollapseButtonHoverMonitorTimer` | 접힌 사이드바 미리보기가 포인터가 가장자리에 있는데도 닫히던 문제 | 중간 |

미확인 중 큰 것: `0x07f73c50`(44,672 B / 24블록, `extensions/api/tabs/tabs_api.cc` — 가장 큰 미확인),
`0x04be8e70`(8,576 B, 구간 안에는 문자열이 없고 바로 옆에 `aside_profile_indicator_icon`), `0x034339c0`(7,744 B, aside 계정 pref 등록부).

**813.1 변경 로그 중 근거를 못 찾은 항목**: 숫자 탭 단축키(Ctrl/Cmd+1~9)가 사이드바 접힘 상태에서
안 되던 문제, 확장 하위 메뉴가 상위 메뉴를 닫던 문제, 페이지가 흰 화면에서 멈추던 문제.
이 셋은 문자열을 참조하지 않는 함수에 들어 있어 이 방법으로는 못 찾는다.

## 6. 우리 포크(DIFFERENTIAL/UI-PLAN)와 대조

### 이미 재현한 것 (이름표가 기존 문서와 맞음)

| 원본 기능 | 처음 나타난 판 | 포크 상태 |
|---|---|---|
| `AsideSectionView/HeaderButton/ClipView/Divider` 세로탭 구역 | 719.1 이전 | 재현 완료 (UI-PLAN 증분 1·5) |
| `aside.vertical_tabs.bookmarks_section_enabled/expanded/expanded_bookmark_folder_ids` | expanded는 813.1에 부활 | 재현 완료 (증분 5) |
| `aside_tab_switcher.cc` 탭 전환기 | 719.1 이전 | 재현 완료 (증분 4) |
| `MaybeShowNewAsideTaskPopover` / `ScheduleAsideTasksPoll` | 719.1 이전 | 재현 완료 (증분 6) |
| `aside_profile_attributes_updater.cc` 프로필 아바타 | 719.1 이전 | 재현 완료 |
| `kAsideHomeIcon` | **724.1 신규** | 아이콘은 825.1에서 뽑아 보유 |
| `RestartExpandOnHoverTimer` / `MaybeExpandTasksSectionForAttention` | 719.1 이전 | 재현 완료 |

### 우리 문서에 **아예 없는** 원본 기능 (새 발견)

| 원본 증거 | 처음 확인된 판 | 무엇인가 | 포크 |
|---|---|---|---|
| `asideAccountBadgeLabel`, `asideAccountSignedInLabel`, `asideAccountSettingsRowLabel`, `manageAsideAccount`, `asideAccountNotSyncedYet`, `asideAccountWaitingForFirstSync`, `asideAccountSyncErrorPrefix`, `asideAccountSettingsUrl` | 719.1에 이미 있음, 724.1에 그 구간이 바뀜 | **`chrome://settings` 안의 "Aside Account" 구역** — 로그인 상태·동기화 상태·오류·계정 설정 링크 | 없음 |
| `bookmark_tab_representation_node_id`, `bookmark_tab_representation_host`, `ScheduleRefreshTabsRepresentedByBookmarks` | 719.1에 이미 있음 | **열린 탭을 북마크가 대표하도록 표시** — 세로탭에서 북마크 항목과 탭을 잇는 구조 | 없음 |
| `aside_password_manager_toolbar_pin_initialized` | 719.1에 이미 있음 | Aside 비밀번호 관리자 툴바 버튼을 **처음 한 번 자동 고정**하는 pref | 없음 (pref 목록에도 없음) |
| `ScheduleTargetExtensionBodyBackgroundProbe` | 719.1에 이미 있음 | 확장 페이지의 `body` 배경색을 재어 브라우저 크롬 색과 맞추는 장치 | 없음 |
| `StartToolbarCollapseButtonHoverMonitorTimer` | 719.1에 이미 있음, **813.1에 변경** | 툴바 접기 버튼 호버 감시 타이머 | 없음 |
| `aside_profile_indicator_icon` (인접 문자열만 — 그 구간 안에는 문자열 없음) | 719.1에 이미 있음, 813.1에 인접 구간 변경 | 프로필 지시 아이콘 (DIFFERENTIAL B4에 "지시 아이콘 선택기 미구현"으로만 적힘) | 없음 |

### 문서에 "미구현"으로 적혀 있고, 이번에 **구조가 구체화**된 것

DIFFERENTIAL B3(프로필 페이저)는 문자열 4개만 알고 있었다. 이번에 **동작 뼈대**가 드러났다.

- **724.1에서 추가**: `SchedulePendingProfilePageSwitchAfterCompositorCommit` +
  `OnCompositingDidCommit`. 프로필 페이지 전환을 **화면 합성 커밋 이후로 미룬다**.
  `raw_ptr<Profile, kMayDangle>` → `WeakPtr<Profile>` 교체가 같이 왔다.
- **811.1에서 추가**(151 바탕): `StashTabsForAsideProfileSwitch` /
  `RestoreTabsForAsideProfileSwitch` / `ScheduleSessionRebuildAfterAsideProfileSwitch` /
  `MoveTabsPreservingCollections`. **한 `Browser` 안에서 탭을 치웠다가 되돌리는** 방식이다.
  포크는 `profiles::SwitchToProfile`(창 자체를 바꿈)을 쓰므로 구조가 다르다.
- **813.1에서 그 구간이 다시 변경** → 변경 로그의 "그룹·Split View 탭 신뢰성 개선"과 일치.

즉 원본의 프로필 전환은 "창 바꾸기"가 아니라 **한 창 안에서 탭 뭉치를 갈아끼우기**다.
포크가 B3를 하려면 이 이름들이 출발점이다.

## 7. 판정과 한계

### 판정: 조건부로 쓸 만함

**쓸 만한 경우** — 그 판의 변경이 (가) Aside 고유 문자열이나 (나) `chrome/browser/...` 소스 경로
문자열을 건드릴 때. 이때는 구간·크기·기능이 한 번에 확정된다. 813.1의 북마크 구역,
724.1의 프로필 전환·비밀번호 DB·툴바 아이콘이 그 예다. 9건이 "높음"으로 붙었다.

**못 쓰는 경우** — 문자열을 안 쓰는 함수의 변경. 전체 구간의 87%가 여기다.
813.1 변경 로그 세 항목은 근거를 못 찾았다.

### 한계 (정직하게)

1. **블록 개수는 변경량이 아니다.** 문자열이 잡히는 구간의 33~49%가 세 걸음 공통 = 재빌드 잡음.
   문자열이 없는 87%의 잡음 비율은 **모른다**. 더 높을 수도 있다.
2. **정규화 충돌 31%.** 다중집합 99.8%는 그만큼 부풀 여지가 있다. 천장 대비 수치를 같이 봐야 한다.
   (부풀림을 걷어내도 99.7~99.78%라 결론은 안 바뀐다.)
3. **compact unwind는 모든 함수를 경계 짓지 않는다.** 한 "블록"에 함수 + 뒤따르는 잎 함수가
   같이 들어갈 수 있다. `0x0c5eb010`처럼 33 KB짜리 단일 블록은 사실상 "이 거대 함수 어딘가"라는 뜻이다.
4. **문자열 근거는 인접성이지 소유가 아니다.** 어떤 구간이 `login_database.cc`를 참조한다고 해서
   그 구간 전체가 그 파일은 아니다. 인라인된 다른 코드가 섞일 수 있다.
5. **x86_64만 봤다.** arm64 조각은 안 봤다. 포크 재현 문서의 주소는 arm64 기준이라
   여기 주소와 직접 비교되지 않는다 — 문자열로만 이었다.
6. **1.0.728.1을 안 받았다.** 150 바탕 사슬이 724.1에서 끊긴다.
7. **데몬·확장 JS는 안 봤다.** 720.1 → 724.1에서 데몬이 +12.6 MB, `AsidePasswordManager/background.js`가
   +291 KB 늘었다. 813.1에서도 background.js가 +43 KB. 그쪽은 다른 담당 몫이다.
8. **두 번째 디스어셈블러로 확인 안 함.** 구간 경계는 compact unwind 하나에만 기댄다.

### 다음 한 수 (제안, 실행 안 함)

1. **1.0.728.1**을 받아 150 바탕 사슬을 한 칸 늘린다. 728.1 변경 로그로 이름표를 하나 더 검증.
2. 미이름표 87%를 줄이려면 **호출 그래프**가 필요하다. 이름표 붙은 구간에서 호출되는 이웃 함수를
   따라가면 문자열 없는 구간에도 이름이 번진다.
3. `chrome://settings`의 "Aside Account" 구역은 pak에 문구가 없고 코드 문자열에만 있다.
   **설정 화면 WebUI(`settings_localized_strings_provider.cc` 대응)**를 포크에 심을 때
   여기 문자열 8개가 그대로 계약이 된다.
