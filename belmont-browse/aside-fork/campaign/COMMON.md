# 복원 작업 공통 규칙 (2026-09-06, 오케스트레이터 작성)

목표: `usecases/RESTORATION-MAP-2026-09-06.md`의 "안 만듦·덜 만듦·못 알아냄·겉만" 60군데 **전부**와 옛 버전 짝 비교의 추가 후보 6개를 복원한다. 우선순위·핵심·추천으로 몇 개만 하는 것이 아니다. 각 담당은 자기 그룹 목록의 **모든 항목**을 "재현 완료" 또는 "불가(이유)"로 끝낸다.

## 이식 우선 (새로 쓰기 전에 가져오기)
항목마다 아래 순서로 찾고, 어느 길을 썼는지 결과 문서에 적는다.
1. **원본 자원 그대로 가져오기**: 825.1 패키지의 문자열(.pak/grd), HTML/JS/CSS, 아이콘. 위치 `data/artifacts/aside_fork_map_825_20260906/extracted/` (프레임워크 x86_64/arm64, Resources), `aside-fork/original-resources/`, 원본 문자열 근거는 `data/artifacts/aside_fork_map_825_20260906/analysis/patch-map.json` 각 구간의 evidence 필드.
2. **크로미움 상위 코드 이식**: 같은 기능이 ~/chromium/src 안에 이미 있으면(예: 북마크 컨텍스트 메뉴, MultiContentsView 분할 보기, PageInfo 버블, 알림 권한 프롬프트, 프로필 메뉴 조각) 그 클래스를 쓰거나 상속·배선한다. 다시 쓰지 않는다.
3. **새로 쓰기**는 1·2가 없을 때만.
원본 동작 확인: `aside-fork/re-tools/xref.py`, `asdis.py`(작업 폴더에 `aside-arm64.bin` 필요: `data/artifacts/aside_fork_map_825_20260906/extracted/aside/Aside-Framework-1.0.825.1-arm64`를 복사), `strings`. 주소는 arm64 기준과 x86_64 기준이 다르니 문자열로 잇는다.

## 트리와 빌드
- 트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`. **작업 트리 = 실제 포크**(HEAD + 커밋 안 된 149개). git commit/stash/checkout/reset 금지. 다른 그룹 파일 되돌리기 금지.
- 빌드는 반드시 잠금 안에서: `cd ~/chromium/src && flock /tmp/aside-ninja.lock sh -c './third_party/ninja/ninja -C out/aside chrome -j4 -l 6 2>&1 | tee /tmp/aside-build-<그룹>.log | tail -5'`. BUILD.gn을 바꿨으면 같은 잠금 안에서 `gn gen out/aside` 먼저. autoninja 금지. 성공 판정은 로그 `grep -c FAILED` = 0 **그리고** `out/aside/chrome` mtime이 빌드 시작 뒤인지 둘 다 확인(과거에 실패 빌드를 성공으로 오판한 적 있음).
- 공유 파일(chrome/browser/BUILD.gn, chrome/browser/ui/BUILD.gn, browser_prefs.cc, chrome_content_browser_client.cc, chrome_browser_main_extra_parts_profiles.cc 등)은 **편집 직전에 다시 읽고** 최소 hunk만 넣는다. 남의 hunk를 건드리지 않는다. Edit가 실패하면 다시 읽고 재시도.
- 새 파일은 `git add -N <파일>`(intent-to-add)만 한다. 커밋 금지.
- 캐시 버전 규칙: 광고차단 파싱·색인이 바뀌면 `aside_adblock_engine.cc`의 kCacheVersion을 올린다.

## 메모리 (재부팅 사고 뒤 추가 규칙)
- 기계 메모리 16GB. 빌드는 `-j4 -l 6` 초과 금지. 동시에 도는 그룹은 2개까지(오케스트레이터가 조절). 독립 크롬은 그룹당 1개만, 확인 끝나면 바로 종료. 호스트·서비스·전자 앱은 띄우지 않는다.

## 실행 중인 것 절대 금지
호스트, 브라우저 서비스, 라이브 크롬(포트 9333/9340/21420/18777, 화면 :99), tmux 세션. 만지지 않는다.

## UI 확인 방법 (그룹별 전용 화면)
- 자기 화면 번호로 Xvfb를 띄운다: `Xvfb :<번호> -screen 0 1400x900x24 &` (번호: G1=111, G2=112, G3=113, G4=114, G5=115, G6=116).
- 빌드한 크롬을 독립 실행: `DISPLAY=:<번호> ~/chromium/src/out/aside/chrome --no-sandbox --user-data-dir=/tmp/aside-ui-<그룹> --remote-debugging-port=94<그룹번호 두 자리> --window-size=1280,800 <url> &`. **Aside 확장은 로드하지 않는다**(라이브 데몬 21420에 붙어 버린다). 확장이 있어야만 보이는 동작은 코드 근거 + 단위 검증으로 대신하고 결과 문서에 "라이브 확인 필요"로 표시.
- 캡처: `import -display :<번호> -window root <png>` → `aside-fork/ui-shots/<그룹>-<항목>.png`. 조작: xdotool, CDP(9411 등).
- 자기 화면의 프로세스를 끝낼 때 `pkill -f` 패턴이 **자기 명령줄과 겹치지 않게** 앞을 고정(`pgrep -f '^/home/hoon/chromium/src/out/aside/chrome --no-sandbox --user-data-dir=/tmp/aside-ui-G1'`). 과거에 자기 셸을 죽인 사고 있음.

## 산출물 (그룹마다)
1. 코드(트리 안).
2. `aside-fork/campaign/<그룹>-RESULT.md`: 항목별로 — 구간·이름 | 이식 길(1/2/3) | 만든/고친 파일 | 빌드 결과(시각, FAILED 0) | 확인 증거(캡처 경로·명령·출력) | 남은 차이 또는 불가 이유. 60군데 표의 "우리 상태"를 이 결과로 갱신할 수 있게 구간 start_hex를 반드시 적는다.
3. 패치 스냅샷: `git -C ~/chromium/src diff cc5584af0d -- <내가 만든/고친 파일들> > aside-fork/patches/041-<그룹>.patch` (새 파일은 add -N 뒤에 diff에 포함됨).
4. `DIFFERENTIAL.md` 끝에 "(12) <그룹> 복원" 절 짧게.
5. 끝날 때 자기 Xvfb·크롬은 정리. 트리의 빌드는 성공 상태로 남긴다(마지막 빌드가 실패면 고치거나 되돌린다).

보고는 한국어, 쉬운 우리말(CLAUDE.md). 최종 답변에 결과 문서 경로, 항목 수(완료/불가), 마지막 빌드 시각, 쓴 모델 이름.
