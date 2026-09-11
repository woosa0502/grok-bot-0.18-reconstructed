# Aside 데몬 새 버전 올리기 (belmont-browse)

1. **받기**: 브라우저의 Omaha 컴포넌트 서비스에서 데몬 CRX를 받는다. 앱 ID `kbbaihbiiohdfpocgkpkmngpjcpddbhh`, 요청 본문은
   `data/artifacts/aside_latest_engine_20260902/raw/omaha-request-aside-daemon.json` (SHA-256이 응답과 맞는지 확인).
2. **풀기**: CRX는 crx3 헤더 뒤가 zip. `Aside Daemon.app/Contents/Resources/`에서 SEA 실행 파일의 `NODE_SEA` 구역을 뽑아
   JavaScript 번들을 얻고 `export{createServer};`에서 자른다(`node --check`로 확인). 내장 스킬은 `static/skills/builtin/**`을 통째로 복사.
3. **패치**: `python3 tools/patch-daemon.py <원본.mjs> vendor/aside-<ver>/apps/daemon/build/daemon.mjs <버전>`.
   패치는 6곳이고 각 앵커가 정확히 1번 잡히지 않으면 assert로 멈춘다. 새 버전에서 앵커가 바뀌면 그 패치만 정규식을 손본다.
   - #1 `globalCdpClient`가 `BELMONT_CDP_URL`을 봄 · #2 요소 스크린샷 margin 버그 · #3 `__belmont` 게터
   - #4 `BELMONT_BROWSE_NO_BASH` 셸 제거 옵션 · #5 memory_search → FTS5 훅 · #6 리눅스 샌드박스 훅
4. **스킬 경로**: 번들의 `SOURCE_ROOT`(번들 위치의 세 단계 위) 규칙 때문에 `vendor/aside-<ver>/apps/daemon/build/daemon.mjs`와
   `vendor/aside-<ver>/apps/daemon/src/skills/builtin/`을 그대로 둔다.
5. **엔진 등록**: `src/session.mjs`의 `ENGINES`에 항목 추가(번들 경로, 계정 홈 폴더, 버전). 계정 홈은 버전별로 분리한다.
6. **검증 순서**: `./run.sh --engine <ver> --task "https://example.com 제목"` → 부산 날씨 → 구글 콘솔(로그인 필요). 걸음 수·오류 수를
   이전 버전 표와 비교한다. 승인 흐름은 `--mode guard`로 한 번.
7. **서비스 전환**: `BELMONT_BROWSE_ENGINE=<ver>`로 `src/serve.mjs` 재시작. Belmont 앱은 건드릴 필요 없음.

확인된 함정: 계정 폴더의 `settings.json`에 기본 모델을 써 두지 않으면 Aside 클라우드 모델이 기본값이 된다. `credentials.json`은
Belmont의 `pi-auth.json`과 같은 형식이라 `credentials.mjs`가 복사·되돌리기를 한다.


## 2026-09-10: 907 → 909 실제 적용 기록

- 구성요소는 Omaha 요청을 **protocol 4.0 + os 필드**로 보내야 준다(3.1이나 os 없이 보내면 noupdate). 요청 예: `docs/aside-909-daemon-comparison-2026-09-10.md` §1.
- Windows·macOS 데몬의 JS는 동일하다. `aside-daemon.exe`에서도 같은 규칙(`import{createRequire}from"node:m` 앞 8바이트가 길이)으로 뽑힌다.
- 체인 순서(907 vendor를 바이트 단위로 재현하는 순서): `patch-daemon.py <원본> <출력> 1.26.909.1820` → `patch-password-session.py <출력> <출력> 1.26.909.1820` → `patch-daemon-linux.py <출력>`(**입력을 제자리에서 덮어씀**, 원본 사본에 돌리지 말 것) → `patch-daemon-lifecycle.py <입력> <출력>` → `patch-daemon-active-workloads.py <입력> <출력>`.
- 909에서 바뀐 앵커: 메모리 라우터 입력의 zod 이름(`string$3`), `memory_search` 설명이 템플릿 리터럴로 인라인(줄바꿈 포함), backfill 함수 이름 `*SessionTurnMemoryBackfill`, `agent.turn.completed` 훅 이름, 확장 연결 키와 `reconcileSessionTabs`에 `browserMode` 인자, orphan 탭 재시도 클로저 이름(`ii`). 도구는 907·909 둘 다 받는다.
- 계정 홈은 `aside-home-909`. 원본 데몬이 첫 기동에 v13/v14/v15 마이그레이션을 돌리므로 **907 홈을 복사한 뒤** 909로 띄운다(907 홈은 되돌리기용으로 남는다). 되돌리기: `BELMONT_BROWSE_ENGINE=907 bash run-fork.sh`.
- 확장 자산 2개(주소창)는 `patch-omnibox-generation.py`에 909 항목을 추가해 같은 변환을 적용했다(비교 함수 이름 en→Jr, tn→en, 변수 p→f).

## 2026-09-10 리눅스 개선 (909·907 공통)

- **폴더 열기**: 원본 `openSystemPath`는 win32(네이티브 helper)·darwin(`open`)만 있고 그 외는 throw라서 채팅 메뉴 "Open folder", 프로젝트 "Open Project Folder", 메모리 "Open folder"가 500이었다. `patch-daemon-linux.py`가 리눅스 분기를 넣는다: WSL(`WSL_DISTRO_NAME`/`WSL_INTEROP`/`/proc/version`)이면 `wslpath -w`로 바꾼 경로를 `/mnt/c/Windows/explorer.exe`(파일 reveal은 `/select,`)에 넘기고, 일반 리눅스는 `xdg-open`. 체인을 다시 돌려 `patched/aside-909-daemon.mjs`(59976fd7…)·`patched/aside-907-daemon.mjs`(11e03255…)를 새로 고정했다.
- **단축키·파일 탐색기 표기**: 확장은 macOS/Windows만 구분해 리눅스에서 ⌘ 글리프와 "Finder" 문구가 나왔다. `tools/patch-linux-platform-glyphs.py --assets vendor/aside-components-909/agent-manager/1.26.909.1820/assets`가 `appearance-BlPq6qs7.js`(Ctrl 표기)와 `platform-CH1yjH9T.js`(Ctrl+ 글리프, File Explorer 문구)를 고친다(해시 고정, 멱등; 테스트 `tests/linux-platform-glyphs-909.test.mjs`). 909 vendor를 새로 만들 때 주소창 패치 다음에 이 도구도 돌린다.
- **포크(Chromium)**: `aside://` 스킴을 표준 스킴으로 등록하고 `chrome://`로 다시 쓰는 핸들러(`HandleAsideSchemeRewrite`)·주소창 분류를 추가, `asideBrowserImport.getImportSources`가 배열을 돌려주도록 수정(설정 Import 오류 화면 해결), 리눅스 가속기 Ctrl+S(사이드바)·Ctrl+E(Ask Aside)·Ctrl+Shift+E(새 작업)·Ctrl+Shift+C(URL 복사)·Ctrl+Shift+-(분할 탭) 추가(`IDC_ASIDE_*`). 빌드 뒤 `regenerate-source-checkpoint.py` → `native-build-identity.mjs record`.

## 2026-09-11 사이트 지식 배달 패치

- 체인 마지막에 `python3 tools/patch-daemon-site-knowledge.py <출력>`(제자리 덮어쓰기, 표식 `belmont-browse-site-knowledge`). 원본 두 결함: 스킬 키워드 자동 주입이 ASCII `\b` 기준이라 한글 키워드 불일치; 메모리 워커 4곳이 Dirent 기준이라 `memory/sites` 심볼릭 링크 미색인. 적용 뒤 `research-archives/aside/artifacts.json` 909 핀과 LFS 사본을 갱신하고 `native-build-identity.mjs verify`로 확인한다.

- 2026-09-11: `patch-daemon-dream-procedures.py`(v2) — dreaming 프롬프트 Page shape 에 "사이트 페이지는 절차도 담아야 하며, 근거가 있는데 절차가 없으면 미완성" 규칙 1개. 체인 마지막에 site-knowledge 다음으로. v1의 부드러운 표현은 dream 이 무시했음.
