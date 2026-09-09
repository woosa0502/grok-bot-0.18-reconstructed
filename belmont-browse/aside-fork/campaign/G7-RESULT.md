# G7-RESULT — 원본 색 이름표 66개 + 그룹 밖 잔여 결함 (2026-09-06)

담당: G7. 앞선 여섯 그룹(G1~G6)이 "그룹 밖"으로 남긴 것을 끝내는 회차.
트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`. 커밋 없음, 새 파일은 `git add -N`만.

## 0. 한눈에

| 항목 | 결과 |
|---|---|
| 1. `kColorAside*` 66개 이름 뽑기 | **재현 완료** — 66/66 |
| 1. 66개 **값** 되찾기(라이트/다크) | **재현 완료** — 66/66, **값 미확인 0개** |
| 1. 트리에 색 id + 믹서 넣기 | **재현 완료** — `chrome/browser/ui/color/aside_color_mixer.{h,cc}` 신규 |
| 1. 근사치 자리를 원본 이름표로 교체 | **재현 완료** — 8개 파일 16자리 (아래 3절) |
| 2. 세로 띠 프로필 발치 바닥 고정 | **재현 완료** — 화면 확인(라이트·다크) |
| 3. 가로 탭 스트립 고정 칩 안 그려짐 | **재현 완료** — 원인 규명 + 수정 + 화면 확인 |
| 4. 각 그룹 잔여 목록 정리 | **완료** — 코드로 끝낸 것 3건, 라이브 확인 필요 10건, 불가 9건 (6·7절) |
| 4. G6 정체 미상 재시도 | **부분** — 1군데(#7) 계통 확정, 1군데(#6) 좁힘, 2군데(#4·#5) 그대로 불가. 이름은 여전히 못 얻음 |

마지막 빌드: **2026-09-06 17:02:50**, `grep -c FAILED /tmp/aside-build-G7b.log` = **0**,
`out/aside/chrome` mtime 17:02:50(빌드 시작 17:02:02 뒤).

---

## 1. 색 이름표 66개 — 어떻게 되찾았나

### 1-1. 이름 (이식 길 1: 원본 자원 그대로)

G3가 찾아 둔 색 이름표(x86_64 `0x0e60f2d8`, 623개, 배열 순서 = `ui::ColorId` 값,
0번 = `kColorRefPrimary0` = `kUiColorsStart`)에서 214~279번 66개를 그대로 뽑았다.

```
python3 -c "
b=open('aside-x64.bin','rb').read(); p=0xe60f2d8; out=[]
while True:
    e=b.find(b'\x00',p); s=b[p:e]
    if not s.startswith(b'kColor'): break
    out.append(s.decode()); p=e+1
print([(i,n) for i,n in enumerate(out) if 'Aside' in n])"
```
→ 623개 중 `Aside`가 든 것 정확히 66개, 번호 214~279 연속.

### 1-2. 값 (이식 길 1: 원본 믹서 함수 역어셈블)

이름만으로는 반쪽이라 **믹서 함수 자체**를 찾아 읽었다. 찾은 길:

1. `__text` 전체에서 `mov e??, imm32`(옵코드 B8~BF)의 즉시값이 214~279인 자리를 모아
   4 KB 창으로 묶었다. 66개가 **전부** 든 무리가 일곱 곳 나왔다.
2. 그중 `0x035f9312`~`0x035fce33` 무리를 디스어셈블하니
   `mov rdi, rbx ; mov esi, <색번호> ; call 0x113470` 66번이 정확히 214~279를 한 번씩 쓴다.
   `0x113470` = `ui::ColorMixer::operator[](ColorId)`, 뒤따르는 `call 0x67740` = 레시피 대입.
3. 함수 머리는 **`0x035f9240`**, 인자는 `(ColorMixer&, bool)`. 부르는 곳 두 군데
   (`0x0398c0f2`, `0x039d93c2`)가 모두
   `mov eax,[rsi] ; cmp eax,1 ; sete bl`(= `key.color_mode == kDark`)로 그 bool을 만든다
   → **두 번째 인자는 "다크인가"**. `AddMixer()`(`0x42fee0`) 바로 뒤에 불린다.
4. 각 레시피는 40바이트 콜백 객체 하나를 만들고 `+0x24`에 값을 넣는다. `+8`의 함수 포인터가
   - `0xd18800` → 값이 **리터럴 SkColor** (58개)
   - `0xd187f0` → 값이 **다른 색 id**(별칭) (8개)
   다크/라이트가 다른 색은 `cmp byte[rbp-0x80],0 ; mov eax,<다크> ; mov r14d,<라이트> ; cmovne`
   꼴로 갈린다. 값을 스택 칸에 캐시해 뒤 레시피가 다시 쓰는 자리가 있어 작은 기호 실행기를
   붙여 레지스터·스택 칸을 따라갔다.
5. **알파 혼합·`BlendForMinContrast` 같은 변환은 하나도 없다.** 66개 전부 항이 한 개다.
   그래서 우리 믹서도 1:1로 옮길 수 있었다.

극성 검증(추측 아님): `kColorAsideTooltipBackground`가 라이트 `0xFFFAFAFA`(거의 흰색) /
다크 `0xFF18181B`(거의 검정). 반대로 읽었다면 라이트 툴팁이 검정이 된다.

### 1-3. 66개 표

값은 `0xAARRGGBB`. "우리 트리에서 쓰는 자리"가 `—`인 색은 이름표·값만 들어와 있고
아직 부르는 코드가 없다는 뜻이다(원본에는 있으나 그 기능이 아직 이식 안 된 자리).

| # | 이름 | 라이트 | 다크 | 되찾은 방법 | 우리 트리에서 쓰는 자리 |
|---|---|---|---|---|---|
| 214 | `kColorAsideSurfacePrimary` | `0xFFFFFFFF` | `0x14FAFAFA` | 믹서 리터럴 SkColor | — |
| 215 | `kColorAsideSurfaceBorder` | `0x1A0A0A0A` | `0x26FAFAFA` | 믹서 리터럴 SkColor | 화면 공유 선택기 테두리 |
| 216 | `kColorAsideSurfaceBorderStrong` | `0x260A0A0A` | `0x33FAFAFA` | 믹서 리터럴 SkColor | — |
| 217 | `kColorAsideAdjacentPaneBorder` | → `kColorAsideSurfaceBorderStrong` | → `kColorAsideSurfaceBorderStrong` | 믹서 별칭(레시피가 다른 색 id 하나) | — |
| 218 | `kColorAsideSurfaceSecondary` | `0xD9FFFFFF` | `0x0FFAFAFA` | 믹서 리터럴 SkColor | — |
| 219 | `kColorAsideSurfaceTertiary` | `0x8CFFFFFF` | `0x0AFAFAFA` | 믹서 리터럴 SkColor | — |
| 220 | `kColorAsideSurfaceQuarternary` | `0x140A0A0A` | `0x14FAFAFA` | 믹서 리터럴 SkColor | — |
| 221 | `kColorAsideSurfacePrimaryForeground` | `0xD90A0A0A` | `0xD9FAFAFA` | 믹서 리터럴 SkColor | 북마크 줄 글자 / 프로필 메뉴 선택 아이콘 |
| 222 | `kColorAsideSurfaceSecondaryForeground` | `0x8C0A0A0A` | `0x8CFAFAFA` | 믹서 리터럴 SkColor | 북마크 빈 상태 문구 |
| 223 | `kColorAsideSurfaceTertiaryForeground` | `0x400A0A0A` | `0x40FAFAFA` | 믹서 리터럴 SkColor | — |
| 224 | `kColorAsideSurfaceInactiveForeground` | `0xBF0A0A0A` | `0xBFFAFAFA` | 믹서 리터럴 SkColor | — |
| 225 | `kColorAsideBaseForeground` | `0xFF0A0A0A` | `0xFFFAFAFA` | 믹서 리터럴 SkColor | — |
| 226 | `kColorAsideBaseBorder` | `0x1A0A0A0A` | `0x1AFAFAFA` | 믹서 리터럴 SkColor | — |
| 227 | `kColorAsideShadow` | `0x1A000000` | `0x1A000000` | 믹서 리터럴 SkColor | — |
| 228 | `kColorAsideShadowSubtle` | `0x0D000000` | `0x0D000000` | 믹서 리터럴 SkColor | — |
| 229 | `kColorAsidePinnedTabInactiveBackground` | `0x0FFAFAFA` | `0x0FFAFAFA` | 믹서 리터럴 SkColor | — |
| 230 | `kColorAsideHorizontalPinnedTabGroupBackground` | `0x8CFFFFFF` | `0x0FFAFAFA` | 믹서 리터럴 SkColor | — |
| 231 | `kColorAsidePinnedTabInactiveBorder` | `0x260A0A0A` | `0x26FAFAFA` | 믹서 리터럴 SkColor | — |
| 232 | `kColorAsideMutedForeground` | `0x8C0A0A0A` | `0x8CFAFAFA` | 믹서 리터럴 SkColor | 작업 상태점 기본 / 세로탭 상태 문구 |
| 233 | `kColorAsideWindowBackground` | `0x80FFFFFF` | `0x80171717` | 믹서 리터럴 SkColor | — |
| 234 | `kColorAsideTransparentWindowBackground` | `0x00000000` | `0x00000000` | 믹서 리터럴 SkColor | — |
| 235 | `kColorAsideBrowserWindowDimOverlay` | `0x66DEDEDE` | `0x33606060` | 믹서 리터럴 SkColor | — |
| 236 | `kColorAsideWebContentsOverlay` | `0xCCFFFFFF` | `0xCC171717` | 믹서 리터럴 SkColor | — |
| 237 | `kColorAsideHoverCardBackground` | `0xFFFFFFFF` | `0xFF1F1F1F` | 믹서 리터럴 SkColor | 화면 공유 선택기 목록판·미리보기 배경 |
| 238 | `kColorAsideTabSwitcherBackground` | `0xB8F8F8F8` | `0xB3171717` | 믹서 리터럴 SkColor | 탭 전환기 패널 배경 |
| 239 | `kColorAsideTabSwitcherItemBackgroundFocused` | `0x140A0A0A` | `0x14FAFAFA` | 믹서 리터럴 SkColor | 탭 전환기 선택 항목 배경 |
| 240 | `kColorAsideFloatingSidebarBackground` | `0xFFF3F4F6` | `0xFF24272B` | 믹서 리터럴 SkColor | — |
| 241 | `kColorAsideSidebarItemBackgroundHover` | → `kColorAsideSurfaceQuarternary` | → `kColorAsideSurfaceQuarternary` | 믹서 별칭(레시피가 다른 색 id 하나) | — |
| 242 | `kColorAsideMenuItemBackgroundHover` | `0x140A0A0A` | `0x1AFAFAFA` | 믹서 리터럴 SkColor | — |
| 243 | `kColorAsideMenuItemBackgroundSelected` | `0x1A0A0A0A` | `0x20FAFAFA` | 믹서 리터럴 SkColor | — |
| 244 | `kColorAsideUpdatePromptBackground` | `0x99FFFFFF` | `0x9918181B` | 믹서 리터럴 SkColor | — |
| 245 | `kColorAsideUpdateBadgeBackground` | `0x1A0284C7` | `0x3338B6F6` | 믹서 리터럴 SkColor | 업데이트 배지 배경 |
| 246 | `kColorAsideUpdateBadgeForeground` | `0xFF0EA5E9` | `0xFF38B6F6` | 믹서 리터럴 SkColor | 업데이트 배지 글자·아이콘 |
| 247 | `kColorAsideActionAccentBackground` | `0x3338BDF8` | `0x3338BDF8` | 믹서 리터럴 SkColor | — |
| 248 | `kColorAsideActionAccentForeground` | `0xFF38BDF8` | `0xFF38BDF8` | 믹서 리터럴 SkColor | — |
| 249 | `kColorAsideFocusedLocationBarBackground` | `0xFFFFFFFF` | `0xFF373737` | 믹서 리터럴 SkColor | — |
| 250 | `kColorAsideTooltipBackground` | `0xFFFAFAFA` | `0xFF18181B` | 믹서 리터럴 SkColor | — |
| 251 | `kColorAsideTooltipForeground` | `0xFF0A0A0A` | `0xD9FAFAFA` | 믹서 리터럴 SkColor | — |
| 252 | `kColorAsideTooltipBorder` | `0x1A0A0A0A` | `0x26FAFAFA` | 믹서 리터럴 SkColor | — |
| 253 | `kColorAsideTooltipKbdBackground` | `0x0D0A0A0A` | `0x14FAFAFA` | 믹서 리터럴 SkColor | — |
| 254 | `kColorAsideTooltipKbdForeground` | `0xD90A0A0A` | `0xD9FAFAFA` | 믹서 리터럴 SkColor | — |
| 255 | `kColorAsideControlProminentBackground` | `0xD90A0A0A` | `0xD9FAFAFA` | 믹서 리터럴 SkColor | 상단 로딩바 진행분 |
| 256 | `kColorAsideControlProminentForeground` | `0xD9FAFAFA` | `0xD90A0A0A` | 믹서 리터럴 SkColor | — |
| 257 | `kColorAsideControlSubtleBackground` | → `kColorAsideSurfaceTertiary` | → `kColorAsideSurfaceTertiary` | 믹서 별칭(레시피가 다른 색 id 하나) | 상단 로딩바 바탕 |
| 258 | `kColorAsideControlSubtleBorder` | → `kColorAsideSurfaceBorder` | → `kColorAsideSurfaceBorder` | 믹서 별칭(레시피가 다른 색 id 하나) | — |
| 259 | `kColorAsideControlSubtleForeground` | → `kColorAsideSurfacePrimaryForeground` | → `kColorAsideSurfacePrimaryForeground` | 믹서 별칭(레시피가 다른 색 id 하나) | — |
| 260 | `kColorAsideControlSubtleForegroundDisabled` | → `kColorAsideSurfaceSecondaryForeground` | → `kColorAsideSurfaceSecondaryForeground` | 믹서 별칭(레시피가 다른 색 id 하나) | — |
| 261 | `kColorAsideControlHoverOnProminent` | `0x1AFFFFFF` | `0x1A0A0A0A` | 믹서 리터럴 SkColor | — |
| 262 | `kColorAsideControlHoverOnSubtle` | → `kColorAsideSurfaceQuarternary` | → `kColorAsideSurfaceQuarternary` | 믹서 별칭(레시피가 다른 색 id 하나) | — |
| 263 | `kColorAsideControlPressedOnSubtle` | `0x1A0A0A0A` | `0x26FAFAFA` | 믹서 리터럴 SkColor | — |
| 264 | `kColorAsideControlSuccess` | `0xFF16A34A` | `0xFF16A34A` | 믹서 리터럴 SkColor | — |
| 265 | `kColorAsideControlSuccessSubtleBackground` | `0x3316A34A` | `0x3316A34A` | 믹서 리터럴 SkColor | — |
| 266 | `kColorAsideControlWarning` | `0xFFFACC15` | `0xFFFACC15` | 믹서 리터럴 SkColor | — |
| 267 | `kColorAsideControlWarningSubtleBackground` | `0x33FACC15` | `0x33FACC15` | 믹서 리터럴 SkColor | — |
| 268 | `kColorAsideControlInvalid` | `0xFFFB7171` | `0xFFFB7171` | 믹서 리터럴 SkColor | 작업 상태점 error |
| 269 | `kColorAsideControlInvalidSubtleBackground` | `0x33FB7171` | `0x33FB7171` | 믹서 리터럴 SkColor | — |
| 270 | `kColorAsideControlOnSuccessForeground` | `0xFFFAFAFA` | `0xFFFAFAFA` | 믹서 리터럴 SkColor | — |
| 271 | `kColorAsideTaskAttentionBadgeBackground` | `0x1A16A34A` | `0x1A16A34A` | 믹서 리터럴 SkColor | — |
| 272 | `kColorAsideTaskAttentionBadgeForeground` | `0xFF16A34A` | `0xFF22C55E` | 믹서 리터럴 SkColor | 작업 상태점 awaiting-* |
| 273 | `kColorAsideTaskCompletedIndicator` | `0xFF0284C7` | `0xFF38B6F6` | 믹서 리터럴 SkColor | 작업 상태점 finished-unread |
| 274 | `kColorAsideTabGroupForeground` | `0xFF090B0C` | `0xFFFAFAFA` | 믹서 리터럴 SkColor | — |
| 275 | `kColorAsideTabGroupCountChipBackground` | `0x4D090B0C` | `0x4DFAFAFA` | 믹서 리터럴 SkColor | — |
| 276 | `kColorAsideToggleThumb` | `0xFFFFFFFF` | `0xFFFFFFFF` | 믹서 리터럴 SkColor | — |
| 277 | `kColorAsideToggleThumbHover` | `0xFFE5E5E5` | `0xFFD4D4D8` | 믹서 리터럴 SkColor | — |
| 278 | `kColorAsideToggleTrackOff` | → `kColorAsideSurfaceBorder` | → `kColorAsideSurfaceBorder` | 믹서 별칭(레시피가 다른 색 id 하나) | — |
| 279 | `kColorAsideToggleHover` | `0x1F0A0A0A` | `0x1F0A0A0A` | 믹서 리터럴 SkColor | — |

**값 미확인: 0개.** 66개 모두 원본 믹서에서 라이트·다크 값을 직접 읽었다.

---

## 2. 트리에 넣은 것 (이식 길 2: 상위 크로미움 구조 그대로)

원본은 이 색들을 `ui/color/color_id.h` **안에** 214~279번으로 끼워 넣었다(그래서 상위 색
번호가 전부 밀린다). 우리는 상위 색 번호를 하나도 건드리지 않기 위해 **크롬 구간 뒤에 붙였다**.

| 파일 | 무엇 |
|---|---|
| `chrome/browser/ui/color/chrome_color_id.h` | `ASIDE_COLOR_IDS` 매크로(66줄, 원본 열거 순서 그대로)를 새로 두고 `CHROME_COLOR_IDS`에 이어 붙였다. `E_CPONLY(...)` 방식은 상위와 같다 |
| `chrome/browser/ui/color/aside_color_mixer.{h,cc}` | **신규.** `AddAsideColorMixer(provider, key)` — 상위 `projects_panel_color_mixer.cc`와 같은 꼴. 66줄이 원본 믹서와 1:1 |
| `chrome/browser/ui/color/chrome_color_mixers.cc` | `AddChromeColorMixers()` 맨 앞에서 부른다(원본도 첫 믹서) |
| `chrome/browser/ui/color/BUILD.gn` | `mixers` 타깃 sources에 두 파일 추가 |

색 이름 조회(`ui::ColorIdName`)는 `CHROME_COLOR_IDS`를 도는 기존 표에 자동으로 들어가므로
`chrome://theme` 같은 도구에서도 이름이 뜬다.

---

## 3. 근사치 → 원본 이름표 교체 (8개 파일, 16자리)

증거 등급을 붙였다. **A = 원본의 그 함수를 직접 읽음**, **B = 원본 구간(patch-map region)에
그 색만 있음**, **C = 이름 대응(구간 증거 보조)**.

| 파일 | 바뀐 것 | 원본 이름표 | 등급 | 근거 |
|---|---|---|---|---|
| `views/desktop_capture/desktop_media_tab_list.cc` | `ui::kColorSysSurface4` ×2 → | `kColorAsideHoverCardBackground` | **A** | 다시 칠하는 함수 `0x04895880`에 `mov eax,0xed`(=237) |
| 〃 | `ui::kColorSysNeutralOutline` → | `kColorAsideSurfaceBorder` | **A** | 같은 함수 `mov eax,0xd7`(=215) |
| `views/frame/top_container_loading_bar.cc` | `ui::kColorSysPrimary` → 바탕/진행분 두 색 | `kColorAsideControlSubtleBackground` + `kColorAsideControlProminentBackground` | **A** | `TopContainerLoadingBar::OnPaint` `0x04c855a0`: `GetColor(0x101)` 전체 `FillRect` → `GetColor(0xff)` 진행분 `FillRect` (클래스 이름표 `0x0e8d6dcc`가 `0x04c85ba0`에서 참조됨) |
| `views/frame/aside_tab_switcher_view.cc` | `SkColorSetA(kColorSysSurface, 0.85)` → | `kColorAsideTabSwitcherBackground` | **A** | `0x04c3079b` `mov esi,0xee` 뒤 알파 조작 없음(색에 알파가 이미 들어 있다) |
| 〃 | `SkColorSetA(kColorSysOnSurface, 0.25)` → | `kColorAsideTabSwitcherItemBackgroundFocused` | **A** | `0x04c30d09` `mov esi,0xef` |
| `views/tabs/aside_update_badge_button.cc` | `ui::kColorSysPrimary` → | `kColorAsideUpdateBadgeBackground` | **B** | 구간 `0x04855d90`(업데이트 배지 버튼)의 유일한 `GetColor` 색 `0x0485a21b` |
| 〃 | `ui::kColorSysOnPrimary` ×2 → | `kColorAsideUpdateBadgeForeground` | **B** | 같은 구간의 ColorVariant 저장 2자리 |
| `views/frame/aside_task_views.cc` | 상태점 4색 → | `kColorAsideMutedForeground` / `kColorAsideControlInvalid` / `kColorAsideTaskAttentionBadgeForeground` / `kColorAsideTaskCompletedIndicator` | **B** | 구간 `0x04cff670`(작업 배지·스로버·상태점)에 TaskAttentionBadge 두 색, 바로 앞 `0x04cf7e80`(작업 섹션 상태 문구)에 ControlInvalid·TaskCompletedIndicator·MutedForeground |
| `views/frame/aside_bookmarks_section_view.cc` | `ui::kColorPrimaryForeground` → | `kColorAsideSurfacePrimaryForeground` | **B** | 구간 `0x04ce90e0`(세로탭 북마크 섹션 헤더)에 Primary/SecondaryForeground 각 2자리 |
| 〃 | `ui::kColorLabelForegroundSecondary` → | `kColorAsideSurfaceSecondaryForeground` | **B** | 〃 |
| `views/frame/aside_vertical_tab_strip_additions.cc` | `ui::kColorLabelForegroundSecondary`(상태 문구) → | `kColorAsideMutedForeground` | **B** | 구간 `0x04cf7e80` |
| `views/profiles/aside_profile_menu_view.cc` | `ui::kColorButtonBackgroundProminent` ×2(선택된 아이콘 색) → | `kColorAsideSurfacePrimaryForeground` | **C** | 구간 `0x04bd8b00`(프로필 메뉴 본문·아이콘 선택기)에 Primary/SecondaryForeground 각 4자리. 원래 값은 *배경*색을 아이콘에 쓰던 임시방편이었다 |

### 바꾸지 않고 남긴 근사치 (근거 부족 — 정직하게)

| 자리 | 왜 안 바꿨나 |
|---|---|
| `vertical_tab_strip_region_view.cc` `CrossSectionDragPreview::OnPaint`의 `kColorSysPrimary` | 원본의 같은 클래스 코드 자리(`0x04d0c8f0` 부근, 클래스 이름표 `0x0e8d7263` 참조가 `0x04d0dc4d`)를 훑어도 **`kColorAside*` 색이 한 자리도 없다.** 원본도 상위 색을 쓴다고 보고 그대로 뒀다 |
| `location_bar_view.cc`의 `SkColorSetA(kColorOmniboxResultsBackgroundSelected, 0x66)` | 주소창 구간(`0x047ed7c0`)에서 나온 Aside 색은 `kColorAsideControlInvalid` 하나뿐이라 이 칠과 이어지지 않는다 |
| `multi_contents_view_drop_target_controller.cc`의 `kColorBubbleBackground/Border` | 분할 보기 구간(`0x04c6d1f0`)에 Aside 색이 여럿 있으나 어느 것이 드롭 타깃 것인지 1:1로 못 좁혔다 |
| `aside_agent_control_banner.cc`의 `kColorSubtleEmphasisBackground` | 대응 구간을 못 찾았다 |
| 벡터 아이콘의 `ui::kColorIcon` 여러 자리 | 원본도 상위 `kColorIcon`을 쓸 가능성이 높고(66색에 "아이콘" 색이 없다) 근거가 없다 |

---

## 4. 항목 2 — 세로 띠 프로필 발치 바닥 고정 (재현 완료)

**증상**(G3 1·2·8절): 탭이 적으면 발치가 목록 바로 밑에 붙어 창 위쪽에 뜨고, 발치에
`BOTTOM_LEFT`로 붙는 프로필 메뉴가 창 위로 잘린다(발치 위 여백 296 px < 메뉴 350 px).

**원인**: `VerticalTabStripRegionView`의 세로 FlexLayout에서 남는 높이를 가져가는 것이
`bottom_button_container_`(`MaximumFlexSizeRule::kUnbounded`) 하나인데, 그 칸은 **발치보다
아래**에 있다. 그래서 남는 높이가 전부 발치 *아래*에 쌓이고 발치는 위에 남는다.

**고친 방법**: 조직 섹션과 발치 사이에 빈 칸(`aside_footer_spacer_`)을 하나 넣고
flex 순서 1(= 우선)로 남는 높이를 먹게 했다. 바닥 버튼 칸은 순서 2로 내렸다
(`FlexSpecification(...).WithOrder(2)`). 빈 칸의 기본 크기는 **1×1 DIP**로 줬다 —
`flex_layout.cc`의 `FilterZeroSizeChildreIfNeeded`가 기본 크기 0인 자식을 주 배분 패스에서
빼 버리기 때문이다(0으로 뒀을 때 실제로 아무 일도 안 일어났다. 첫 빌드에서 확인).

**확인**: `ui-shots/G7-01-light-vertical.png`(발치 "Your Chromium"이 창 바닥, 그 아래 새 탭 줄),
`G7-02-light-profile-menu.png`(메뉴 머리부터 "Incognito Window"까지 **잘림 없이 전부** 보임),
다크도 같음 — `G7-08-dark-vertical.png`, `G7-09-dark-profile-menu.png`.

---

## 5. 항목 3 — 가로 탭 스트립 고정 칩 (재현 완료, 원인 규명)

**증상**(G1 9절): 칩 뷰는 붙어 있고 배치에서 폭도 차지하는데 **그려지지도, 마우스에 잡히지도
않고**, UI DevTools 뷰 트리에도 안 나온다.

**원인**: `HorizontalTabStripRegionView`는 `GetChildrenInZOrder()`를 **재정의**해서 그릴 자식을
손으로 나열한다. 크로미움 `views::View`는 이 목록으로 **그리기와 히트 테스트를 둘 다** 한다.
G1이 붙인 `aside_pinned_entries_`가 이 목록에 없었다. 그래서
"배치에는 들어가고(폭 차지) / 그리기·마우스·뷰 트리에는 없다"는 세 증상이 한꺼번에 설명된다.
G1이 의심했던 레이어·여백 문제가 아니었다(그쪽으로 시도한 배치 변경은 되돌린 게 옳았다).

**고친 방법**: 목록 맨 앞(= 가장 아래 층)에 칩 뷰를 넣었다. 앞쪽 버튼들은 자기 레이어에
그리므로 여전히 그 위에 온다. 파일 한 곳, 6줄.

```cc
views::View::Views HorizontalTabStripRegionView::GetChildrenInZOrder() {
  views::View::Views children;
  if (aside_pinned_entries_) {
    children.emplace_back(aside_pinned_entries_.get());
  }
  if (tab_strip_) { ... }
```

**확인**: 가로 모드로 바꿔(`vertical_tabs.enabled=false`) 탭 하나를 "Pin" 한 뒤 —
`ui-shots/G7-04-light-horizontal-pinned-chip.png`에 스트립 맨 왼쪽에 칩이 **그려져 있고**,
그 위에 커서를 올리면 호버 음영 + 도구 설명 **"Switch to Example Domain"**이 뜬다
(`G7-05-light-chip-tooltip.png`). 분할 보기까지 켠 상태에서 칩 두 개가 나란히 보인다
(`G7-07-light-split-view.png`).

---

## 6. 항목 4 — 그룹별 잔여 목록 통합

### 6-1. 이번에 코드로 끝낸 것 (3건)

| 출처 | 무엇 | 어떻게 |
|---|---|---|
| G3 그룹 밖 ① | `kColorAside*` 66개가 통째로 없음 | 1·2·3절 |
| G3 그룹 밖 ② | 프로필 발치 바닥 고정 | 4절 |
| G1 9절 | 가로 스트립 고정 칩 | 5절 |

추가로 G3 그룹 밖 ③의 절반을 끝냈다:

| 출처 | 무엇 | 어떻게 |
|---|---|---|
| G3 그룹 밖 ③ | 프로필 전환 뒤 **북마크 구역**이 옛 프로필을 계속 본다 | `AsideBookmarksSectionView`의 프로필 결속을 `BindToProfile()`로 뽑아내고 `Browser::RegisterAsideProfileSwitched()`를 구독해 다시 결속(BookmarkModel 옵저버 갈아끼우기 + `pref_registrar_.Reset()` + 탭 대표 헬퍼 재생성 + `Rebuild()`) |

같은 ③의 나머지 둘은 **고칠 것이 없다**고 확인했다:
- 고정 항목(`AsidePinnedEntriesView`)은 프로필에 묶인 것을 캐시하지 않는다. 북마크 모델은
  `IsEntryBookmarked()` 안에서 그때그때 `browser_->profile()`로 가져온다.
- 탭 전환기(`AsideTabSwitcherView`)는 띄울 때 `WebContents` 목록을 받아 만드는 일회용 팝업이다.

### 6-2. 라이브 확인 필요 — 통합본 (10건)

전부 **Aside 확장 또는 외부 서비스가 있어야 화면에 나오는 것들**이다. COMMON.md가 확장 로드를
금지(라이브 데몬 21420에 붙음)해서 이번 회차에도 못 띄웠다. 오케스트레이터가 호스트를 올려서 볼
때 쓸 확인 방법을 같이 적는다.

| # | 출처 | 무엇 | 확인 방법 |
|---|---|---|---|
| L1 | G2 1번 | `AiTabsCountBadgeView`(에이전트 탭 그룹 개수 배지) | 확장으로 에이전트 탭 그룹을 만들면 `tab_group_header_view`에 스파클+개수 배지가 뜬다. `aside::IsAgentTabsGroup()`이 참일 때만 |
| L2 | G2 이관 A | `AsideAiTabsViewport` | 에이전트 탭이 있어야 Emulation 명령이 나간다. CDP `Emulation.setDeviceMetricsOverride` 로그로 확인 |
| L3 | G2 이관 B | `FloatingTabDragView`(탭 끌기 미리보기 카드) | 진짜 마우스로 세로탭 행을 잡아 분할 드롭 타깃 위로. X11 합성 드래그는 탭을 새 창으로 떼어 내 버려 안 된다 |
| L4 | G3 8번 | 알림 인박스 종단(권한 → 알림 → SQLite 행 1개) | Aside 확장 필요(`IsExtensionEnabled()` 관문). `<프로필>/AsideInbox` DB의 `inbox_entries` 행 수 확인 |
| L5 | G3 9번 | 웹스토어 테마 설치 차단 대화상자 | `webstorePrivate.beginInstallWithManifest3`은 웹스토어 출처에서만 불린다. 진짜 웹스토어에서 테마 "추가" 클릭 |
| L6 | G4 47번 | 미니팝업 창 실제 토글 | 확장 + 전역 단축키. 창이 뜨는지 + 프로필 전환이 되는지 |
| L7 | G4 33번 | Firefox·Safari 실제 데이터 이관 | 이 기계에 Firefox 프로필도 Safari 내보내기 ZIP도 없다. 실물 프로필이 있는 기계에서 |
| L8 | G6 10번 | 비밀번호 관리자 툴바 버튼 자동 고정 pref | 확장이 pref를 켤 때 툴바에 버튼이 붙는지 |
| L9 | G6 11번 | 확장 페이지 배경색 측정 | 확장 페이지를 띄우고 `contents_web_view.cc:216` 경로가 도는지 |
| L10 | G7(이번) | `AsideTabSwitcherView` 새 팔레트 화면 확인 | 전환기를 띄우는 경로가 확장·단축키에 걸려 있어 이번에 못 띄웠다. 코드는 원본과 같은 `GetColor(kColorAsideTabSwitcher*)` 두 자리 |

### 6-3. 불가 — 코드로 못 끝내는 것 (9건)

| # | 출처 | 무엇 | 왜 불가 |
|---|---|---|---|
| X1 | G4 7번 | pq_v1 서명 알맹이 | 맥OS 26 ML-DSA + 키체인 접근 그룹 전용. 리눅스에 만들 수 있는 물건이 아니다 |
| X2 | G5 10절 | 맥 업데이터 `0x081cc570` / `0x081c06c0` | `chrome/browser/updater/BUILD.gn`이 `enable_updater && (is_mac \|\| is_win)`. `enable_updater`를 켜면 buildflags가 바뀌어 트리 전체 재빌드 |
| X3 | G5 9절 1 | AsideWebsiteStorage 동기화 타입을 **어디서 켜는지** | 원본도 어느 묶음에도 안 넣는다(바이너리로 확인). 우리도 같다. 결함이 아니라 원본 그대로 |
| X4 | G5 9절 2 | `AsideWebsiteStorageSyncService` 브리지·컨트롤러 없음 | G5 범위 밖. 만들면 `aside_website_storage_kinds`가 링커에 안 버려진다 |
| X5 | G5 9절 3 | 데몬 access token이 sync 엔진에 안 물림 | 원본이 어디서 갈아끼우는지 아직 못 밝힘 |
| X6 | G5 9절 5 | `AsideCookieSyncService` 미구현 | G5 범위 밖 |
| X7 | G6 3절 4번 | `0x045dd200` (10,160 B) 정체 미상 | 7절 |
| X8 | G6 3절 5번 | `0x049ca150` (7,728 B) 정체 미상 | 7절 |
| X9 | G6 3절 6·7번 | `0x047c51f0`, `0x0d145880` 정체 미상 | 7절 — 계통은 좁혔으나 이름은 못 얻음 |

### 6-4. 이미 해결돼 있어 손 안 댄 것

- G2 2번의 "원본은 `gfx::Animation`+`Tween::EASE_OUT`으로 부드럽게 잇는다" — 값·색이 바이너리에
  안 나온다고 적혀 있으나, 이번에 되찾은 팔레트에 그 색(투명도 0x66)은 없다. 애니메이션 보간은
  색 문제가 아니라 G2 범위의 남은 차이로 그대로 둔다.
- G5 0x081c9f90(업데이터 mojo 바인딩) — 이미 트리에 있다고 G5가 확인.
- G6 2번(0x04c65910) — `aside_pinned_entries_view.*`로 이미 들어와 있고, 이번 5절의 수정으로
  가로판까지 실제로 보인다.

---

## 7. G6 정체 미상 네 군데 — 다시 시도한 결과

G6는 `-fno-rtti` 때문에 vtable에서 이름을 못 얻고 멈췄다. 이번에 **그 vtable의 *다른* 칸**을
써 봤다: 구간을 가리키는 `__DATA_CONST` 슬롯 둘레(±8칸)의 다른 포인터를 풀어, 각각을
`aside825_text_path_refs.jsonl.gz`(원본 __text의 소스 경로 참조 15,872자리)로 귀속시켰다.
맥 링커는 같은 번역 단위의 vtable을 붙여 놓으므로, 이웃 vtable의 주인이 곧 후보 계통이다.

| 구간 | 구간을 가리키는 슬롯 | 이웃 vtable 주인 (상위 3) | 판정 |
|---|---|---|---|
| #4 `0x045dd200` | 24 | `web_applications/commands/internal/callback_command.cc` 10 · `ui/search/search.cc` 10 · `mojo/.../sync_call_restrictions.h` 10 | **불가 그대로.** 한 계통으로 안 모인다 |
| #5 `0x049ca150` | 326 | `base/observer_list.h` 248 · `webapps/isolated_web_apps/reading/signed_web_bundle_reader.cc` 210 · `ui/menus/simple_menu_model.cc` 140 | **불가 그대로.** 슬롯이 326개라는 것은 작은 vtable이 잔뜩 모인 자리라는 뜻이고, 이웃도 흩어진다 |
| #6 `0x047c51f0` | 11 | `base/observer_list.h` 20 · `picture_in_picture/auto_picture_in_picture_safe_browsing_checker_client.cc` 7 · `remote_cocoa/app_shim/window_move_loop.mm` 4 | **좁힘.** G6가 찾은 "`auto_pip_setting_overlay_view.cc` 근처를 20번 호출"과 합치면 **자동 PiP 계통**이다. G6의 "해시맵 템플릿 인스턴스화 덩어리" 가설은 **약해졌다**(관찰자 목록을 가진 진짜 클래스가 있다). 이름은 여전히 못 얻음 |
| #7 `0x0d145880` | 93 | `ui/views/extensions/extensions_request_access_button.cc` **207** · `ui/views/extensions/extensions_toolbar_button.h` **159** · `toolbar/pinned_action_toolbar_button.h` 16 | **계통 확정.** `chrome/browser/ui/views/extensions/`의 **툴바 버튼 계열 클래스**다. G6가 "확장 툴바와 찾기 막대 양쪽에 걸쳐 있다"고 남긴 애매함이 풀렸다 — 찾기 막대 쪽이 아니라 확장 툴바 버튼 쪽이다. 이름은 여전히 못 얻음 |

**여전히 이름을 못 얻는 이유는 하나다**: 이름표(문자열)도 RTTI도 없다. 다음에 뚫으려면 G6가
적어 둔 길(같은 리비전 크로미움을 맥 x86_64로 직접 빌드해 오브젝트 단위 배치 비교)뿐이다.
이 트리에서는 맥 빌드를 돌릴 수 없다.

부수적으로 확인한 것: 원본 프레임워크는 **심볼이 벗겨져 있다**
(`llvm-nm --defined-only`가 `_ChromeMain` 등 3개만 낸다). 심볼 표로 푸는 길은 없다.

---

## 8. 빌드와 확인

| 회차 | 시각 | 결과 |
|---|---|---|
| 1 | 16:44–16:46 | FAILED 1 — `aside_profile_menu_view.cc`에서 `ChromeColorIds`와 `ui::ColorIds`를 삼항 연산자로 섞어 `-Wdeprecated-enum-compare-conditional`. 양쪽을 `static_cast<ui::ColorId>`로 맞춰 해결 |
| 2 | 16:46–16:58 | **FAILED 0**, `out/aside/chrome` 16:58:23 |
| 3 | 17:02–17:02:50 | **FAILED 0**, `out/aside/chrome` **17:02:50** (발치 빈 칸 1×1 + 북마크 재결속) |

명령: `flock /tmp/aside-ninja.lock sh -c './third_party/ninja/ninja -C out/aside chrome -j4 -l 6 …'`.
`BUILD.gn`을 바꿨으므로 ninja가 `build.ninja` 재생성 규칙으로 gn을 스스로 돌렸다
(내가 부른 `gn gen`은 PATH에 gn이 없어 rc=127로 아무것도 안 했고, 그래도 새 파일이 정상
컴파일·링크된 것으로 재생성이 확인된다).

확인 환경: `Xvfb :117 -screen 0 1400x900x24`, 독립 크롬 1개(`--user-data-dir=/tmp/aside-ui-G7`,
CDP 9417). Aside 확장 안 올림. 끝나고 크롬·Xvfb 모두 정리(`pgrep -af 'out/aside/chrome'` 0건,
Xvfb pid 17262 종료 확인).

### 캡처

| 파일 | 보이는 것 |
|---|---|
| `ui-shots/G7-01-light-vertical.png` | 라이트 세로 띠 — 발치가 **창 바닥**, 그 아래 새 탭 줄 |
| `ui-shots/G7-02-light-profile-menu.png` | 프로필 메뉴 **잘림 없음**(머리 "Your Chromium"부터 "Incognito Window"까지) |
| `ui-shots/G7-03-light-horizontal-tabs.png` | 가로 모드 기본 상태(고정 탭 없음) |
| `ui-shots/G7-04-light-horizontal-pinned-chip.png` | 탭 하나 Pin 후 — 스트립 맨 왼쪽에 **칩이 그려짐** |
| `ui-shots/G7-05-light-chip-tooltip.png` | 칩 호버 — 음영 + "Switch to Example Domain" |
| `ui-shots/G7-06-light-page-info.png` | 페이지 정보 버블 |
| `ui-shots/G7-07-light-split-view.png` | 분할 보기 + 칩 두 개 |
| `ui-shots/G7-08-dark-vertical.png` | 다크 세로 띠 — 발치 바닥 고정 |
| `ui-shots/G7-09-dark-profile-menu.png` | 다크 프로필 메뉴 잘림 없음 |
| `ui-shots/G7-10-dark-tab-switcher.png` | (Ctrl+Tab은 전환기가 아니라 탭 순환이었다 — L10 참고) |
| `ui-shots/G7-11-dark-media-picker.png` | **팔레트 실물 1**: 화면 공유 선택기 목록판 = `kColorAsideHoverCardBackground`(다크 `0xFF1F1F1F`) + `kColorAsideSurfaceBorder`(`0x26FAFAFA`) / 세로 띠에 **업데이트 배지**(`0x3338B6F6` 바탕 + `0xFF38B6F6` 글자) |
| `ui-shots/G7-12-light-media-picker.png` | **팔레트 실물 2**: 같은 것의 라이트 — 판은 불투명 흰색(`0xFFFFFFFF`), 테두리 `0x1A0A0A0A`, 배지는 `0x1A0284C7` 바탕 + `0xFF0EA5E9` 글자 |

업데이트 배지는 `--aside-debug-update-prompt`로 띄웠다.

---

## 9. 만든/고친 파일

신규 2개: `chrome/browser/ui/color/aside_color_mixer.{h,cc}`.
`git add -N`: 위 2개 + 앞 회차에서 빠져 있던
`views/frame/aside_tab_switcher_view.{h,cc}`, `views/tabs/aside_update_badge_button.{h,cc}`.

고친 것: `chrome/browser/ui/color/{chrome_color_id.h, chrome_color_mixers.cc, BUILD.gn}`,
`views/desktop_capture/desktop_media_tab_list.cc`,
`views/frame/{top_container_loading_bar.cc, aside_tab_switcher_view.cc, aside_task_views.cc,
aside_bookmarks_section_view.{h,cc}, aside_vertical_tab_strip_additions.cc,
horizontal_tab_strip_region_view.cc, vertical_tab_strip_region_view.{h,cc}}`,
`views/tabs/aside_update_badge_button.cc`, `views/profiles/aside_profile_menu_view.cc`.

패치 스냅샷: `aside-fork/patches/041-G7.patch` (19개 파일).

## 10. 지도(RESTORATION-MAP) 갱신용

| 구간 start_hex | 새 상태 |
|---|---|
| `0x035f9240`(원본 Aside 색 믹서 — 지도에 없던 자리) | **재현 완료** — 66색 이름·값 전부, 트리에 믹서 이식 |
| `0x04892a00` 화면 공유 선택기 | 색까지 원본 이름표로 (G3의 "남은 차이" 해소) |
| `0x04c6a630` 가로 고정 탭 칩 | **재현 완료** (G1 미해결 해소) |
| `0x04c855a0` 상단 로딩바 | 바탕+진행분 두 색 · `FillRect` 구조까지 원본대로 |
| `0x04855d90` 업데이트 배지 | 원본 배지 색 |
| `0x04cab230` 세로탭 스트립 | 발치 바닥 고정 (G3 그룹 밖 ② 해소) |
| `0x04ce90e0` 북마크 섹션 | 프로필 전환 재결속 + 원본 글자색 |
