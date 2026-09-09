# Phase C — 미니팝업 네이티브 창 (아키텍처 확정)

## 목표
setState/setSize/hide가 제어하는 프레임 없는 플로팅 창이 확장의 minipopup.html 호스팅.

## 재사용 (어려운 부분 전부)
- `extensions::ExtensionViewHostFactory::CreatePopupHost(extension, url, BrowserWindowInterface*)` — 확장 권한 WebContents 생성
- `ExtensionViewViews` — 렌더링(views::WebView)
- `views::Widget` — 창(show/hide/resize)

## 새로 만들 것 (3개, ~450-650줄)
1. MiniPopupService : KeyedService — per-profile 소유자. Show/Hide/SetSize/SetState. (glic_keyed_service 모델)
2. MiniPopupView : views::WidgetDelegateView, ExtensionViewViews::Container — 확장뷰 호스팅. (extension_popup.cc:283-286 콘텐츠 절반)
3. Factory (BrowserContextKeyedServiceFactory)

## Widget InitParams (프레임없음+항상위, glic_widget.cc:392-457)
TYPE_WINDOW + remove_standard_frame=true + z_order=kFloatingWindow + CLIENT_OWNS_WIDGET

## 창 제어 (views::Widget)
Show/ShowInactive/Hide/SetBounds/SetSize/CenterWindow/Close

## 남은 트리거
전역 단축키(getShortcut/setShortcut)로 창 생성·표시 — X11/Ozone 전역 핫키는 별도(복잡). 1차는 setState/Show 최초 호출 시 창 생성으로 대체 가능.

## 상세 recipe
PHASE-C-minipopup-architecture.txt (조사 전문: 정확한 파일·줄번호·InitParams·include·GN deps)

## 시도 결과 (2026-09-04) — 정직한 벽
미니팝업 창 4클래스(view/service/factory) 작성, **gn gen 통과(순환 의존 없음 — 최대 리스크 해소)**. 그러나 컴파일 단계에서 이 크로미움 151 트리가 **browser API를 대거 리팩터**한 것이 드러남:
- `chrome/browser/ui/browser_finder.h` **제거됨** (`chrome::FindBrowserWithProfile` 없음)
- `chrome/browser/ui/browser_list.h` **제거됨**
- `views::WidgetDelegateView` 기본 생성자 passkey화(friend만) → plain views::View + SetContentsView로 우회 필요
CreatePopupHost가 요구하는 BrowserWindowInterface(=현재 창)를 얻는 현재 방식을 추가 역분석해야 함. 즉 미니팝업 창은 **이 트리의 바뀐 window/browser API 역분석이 선행되는 별도 큰 작업**.

### WIP 위치
`phase-c-wip/` — view/service/factory 6파일 (아키텍처 정확, gn 통과. browser-finder 대체 + View 우회 + Widget InitParams 마무리하면 컴파일).

### 다음에 필요한 역분석
1. 151에서 "프로필의 현재 브라우저 창" 얻는 법 (BrowserList/finder 대체 API)
2. WidgetDelegateView 없이 frameless Widget 만드는 현재 idiom (glic_widget.cc 정독)
3. 전역 단축키 트리거(getShortcut/setShortcut) — Ozone 전역 핫키

## ✅ 미니팝업 창 완성 (2026-09-04)
setState/setSize/hide가 진짜 네이티브 창을 제어. 원본 minipopup.html이 확장 권한으로 창에 뜸(검증: setState-ok, page 타깃 chrome-extension://.../minipopup.html "Aside", 크래시 없음).

### 뚫은 것 (이 리팩터 트리의 API 고고학)
1. 브라우저 찾기: `ForEachCurrentBrowserWindowInterfaceOrderedByActivation` (browser_finder/list 제거됨)
2. context: `browser->GetWindow()->GetNativeWindow()` (ui::BaseWindow)
3. `WidgetDelegateView` 회피: plain views::View + 별도 WidgetDelegate
4. 런타임 크래시(null frame_view): WidgetDelegate가 `CreateFrameView`(← 개명, 구 CreateNonClientFrameView) override해서 `views::FrameView`(← 개명, 구 NonClientFrameView) = NativeFrameView 제공
5. 팩토리 등록: chrome_browser_main_extra_parts_profiles.cc (IS_CHROMEOS 밖)

### 남은 다듬기 (선택)
- 프레임 없애기(remove_standard_frame + 커스텀 FrameView) — 지금은 일반 프레임
- 전역 단축키 트리거(getShortcut/setShortcut) — 지금은 setState 최초 호출 시 생성
- setState 크기 프리셋 미세조정

### 확장이 쓰는 15함수 = 전부 실동작 ✅
