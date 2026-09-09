# 맥 가상머신 사용법 + Aside 프로젝트 경로 (2026-09-07, Codex 개별 분석용)

## 0. 지금 상태
- 맥OS Sonoma 14.8.9 가상머신이 QEMU/KVM으로 떠 있다. 안에 원본 Aside 1.0.825.1이 설치·로그인돼 있다(계정 woosa0619@gmail.com, 무료 요금제).
- 실행 판 확인: 앱 번들 1.0.825.1, 실제 돌아가는 데몬·확장·비밀번호관리자 컴포넌트 **1.26.906.1714**(업데이터가 첫 실행 1분 안에 받음), 계정 화면의 "824"는 앱에 딸려 온 판.
- 맥 계정: belmont / belmont. 화면 잠금·잠자기 꺼 둠.
- 메모리: 가상머신 6GB. WSL 16GB 안에서 **크로미움 빌드나 벨몬트 호스트를 같이 띄우면 위험**(재부팅 3회 겪음). 캐시 비우기 프로세스가 2분마다 돎(`cache-drop.sh`, pid `cache-drop.pid`).

## 1. 켜기·끄기·확인
| 할 일 | 명령 |
|---|---|
| 살아 있나 | `pgrep -x qemu-system-x86 && echo alive` (`pgrep -f`는 자기 셸을 잡으니 쓰지 말 것) |
| 끄기 | `/home/hoon/mac-vm/stop.sh` (맥 안에서 `sudo shutdown -h now`가 더 안전) |
| 켜기 | `cd /home/hoon/mac-vm && (setsid nohup ./boot.sh --no-install > logs/boot-run.log 2>&1 < /dev/null &)` — 약 1분 뒤 OpenCore 선택기 → `./pick2.sh 2 return`(2 = macintosh hd). 설치 미디어 붙여 켜려면 `--no-install` 빼기 |
| KVM 없다고 나오면(WSL 재시작 뒤) | `sudo modprobe kvm_amd && sudo chmod 666 /dev/kvm` |
| Xvfb 소켓 오류(WSL 재시작 뒤) | `sudo mount -o remount,rw /tmp/.X11-unix && sudo chmod 1777 /tmp/.X11-unix` (가상머신엔 불필요, 포크 크롬 띄울 때만) |
| CPU 옵션 | `boot.sh`의 `CPU_MODEL="IvyBridge"` + `MY_OPTIONS=+avx2,+bmi1,+bmi2,+fma,+movbe,+abm,+f16c,+xsaveopt,check`. **바꾸지 말 것**(Haswell은 전원관리 이중결함, Penryn은 리프7 미판독으로 부팅 실패. 부검은 `aside-fork/usecases/MAC-VM-RUN-2026-09-06.md`) |

## 2. 보기·조작
| 방법 | 명령 |
|---|---|
| 브라우저로 보기(noVNC) | `./novnc.sh` 후 `http://127.0.0.1:6090/vnc.html?host=127.0.0.1&port=6090&autoconnect=true&resize=scale` (윈도우 브라우저에서도 열림) |
| VNC 직접 | `127.0.0.1:5905` |
| 화면 캡처(조작 안 하고) | `printf 'screendump /home/hoon/mac-vm/share/s.ppm\n' \| socat - UNIX-CONNECT:/home/hoon/mac-vm/qemu-monitor.sock; convert /home/hoon/mac-vm/share/s.ppm out.png` 또는 `./cap.sh <이름>` |
| 마우스·키 | `MACVM_VNC=127.0.0.1::5905 python3 drive.py <(printf 'move 640 300\nclick\nkey return\n')` — 명령: move X Y / click / doubleclick X Y / key NAME(return esc tab up down left right cmd-… ctrl-…) |
| 글자 입력 | `python3 typer.py '문장'` (drive.py의 type은 shift를 안 눌러 대문자·기호가 깨짐). **한글은 안 됨** → 아래 SSH+pbcopy |
| 요령 | 클릭 전에 마우스를 1픽셀 움직여야 눌림. 우클릭은 **ctrl+왼클릭**. 버튼에 ↵ 있으면 return이 확실. 스크롤은 pgdn/pgup. `key backspace`는 이름을 못 알아들음 → cmd-a 뒤 바로 타이핑 |

## 3. SSH (제일 빠른 길)
- `ssh -p 2299 -i /home/hoon/.ssh/macvm belmont@127.0.0.1` (비번 없이). sudo 비번 belmont.
- 파일 넣기/꺼내기: `scp -P 2299 -i /home/hoon/.ssh/macvm <파일> belmont@127.0.0.1:~/` / 반대 방향도 같음.
- 한글 지시문을 Aside 채팅에 넣기: `ssh … 'LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 pbcopy' < 문장.txt` 후 채팅 입력칸에서 `key cmd-v`. LANG 없이 보내면 깨짐(답은 맞아도 시간·토큰 2~7배).
- 맥 안 유용한 명령: `defaults read at.studio.AsideBrowser`, `sqlite3 "<데몬홈>/state.db" .tables`, `log show --predicate 'process CONTAINS "Aside"' --last 1h`.
- 호스트↔맥 공유 폴더: 호스트 `/home/hoon/mac-vm/share` = 맥에서 `smb://10.0.2.4/qemu`(Finder → Go → Connect to Server).

## 4. 맥 안 Aside 위치
| 무엇 | 경로 |
|---|---|
| 앱 본체(dmg와 1,776파일 전부 동일) | `/Applications/Aside.app` (번들 `at.studio.AsideBrowser`) |
| 프로필·컴포넌트(크로미움식) | `~/Library/Application Support/Aside/` — `Local State`, `Default/`(Preferences, 세션 등), 컴포넌트 폴더들, `aside_component_crx_cache`·`component_crx_cache`(받은 crx 원본) |
| 데몬 홈(state.db·settings.json·memory·skills·logs) | 위 폴더 안 데몬 데이터 — 정확한 하위 경로는 `aside-fork/usecases/MAC-VM-RUN-2026-09-06.md` 10절·13절과 `share/state/installed-inventory.md` |
| 맥 기본설정 | `~/Library/Preferences/at.studio.AsideBrowser.plist` |
| 자동 실행 등록 | `~/Library/LaunchAgents/at.studio.*`(업데이터·keystone) |
| 복구 키 파일(맥 안) | `~/Downloads/aside-recovery-key-2026-09-06` |
| 원본 단축키 표 | 설정 → Appearance 아래(캡처 `ui-shots/MACVM-127-settings-keyboard-shortcuts.png`) |

## 5. 호스트에 이미 떠 놓은 원본 상태 사본 (민감정보 0)
- `/home/hoon/mac-vm/share/state/01~06-*` — 단계별 Preferences/Local State/데몬 설정 스냅샷 + `snapdiff.py`로 차이 계산
- `/home/hoon/mac-vm/share/state/logs/` — 로그 16개 (온보딩 tRPC 순서 포함)
- `/home/hoon/mac-vm/share/state/installed-inventory.md`, `inventory/` — 설치 파일 목록·해시·출처(dmg/업데이터/생성)
- `runs.json`·`sess.json`·`tabs.json` — 실제 작업 결과 원문(state.db의 session_runs 등)
- 주의: Preferences 사본에 계정 이름·이메일이 들어 있다. 밖으로 옮길 땐 그 두 키를 지울 것.
- 복구 키(호스트): `/home/hoon/mac-vm/aside-recovery-key.txt`(600 권한). 계정 비밀번호는 어디에도 안 적음.

## 6. Aside 프로젝트 경로 (호스트)
| 무엇 | 경로 |
|---|---|
| 벨몬트 저장소(호스트 앱) | `/home/hoon/_roots/labs/work/Belmont` (main 858c16f) |
| 브라우저 연결 서비스·포크 실행 | `…/Belmont/belmont-browse/` — `run-fork.sh`(:99), `src/{core,session,serve}.mjs`, `.state/`(serve.json·프로필·설치키), `vendor/aside-902`(데몬 JS+패치), `vendor/aside-ext`(확장 824.2151) |
| 포크 문서·검사·패치 | `…/Belmont/belmont-browse/aside-fork/` — `README.md`(첫머리 링크), `HANDOFF-2026-09-05.md`(7차 절), `DIFFERENTIAL.md`(1)~(19), `usecases/`(RESTORATION-MAP·MAC-VM-RUN·MAC-VM-PLAN·PARITY-*·USE-CASES·API-HISTORY·FORK-MAP-825·VERSION-STEPS·ENGINE-905), `campaign/`(G1~G7·HEAL·LIVE 결과), `patches/041-*`, `042-full-fork-2026-09-06.patch`(548파일 전체), `ui-shots/`(우리 G*·LIVE, 원본 MACVM-01~140), `re-tools/`, `original-resources/`, `test/` |
| 크로미움 포크 트리 | `~/chromium/src` 브랜치 `aside-remediation-20260906`(HEAD 1d00f53b = 일부, **작업 트리가 실제 포크**, 미커밋 448개 = 패치 042). 빌드 `out/aside/chrome`(18:09). 빌드는 `flock /tmp/aside-ninja.lock … ninja -C out/aside chrome -j4 -l 6` |
| 원본 자료 | `…/Belmont/data/artifacts/` — `aside_fork_map_825_20260906`(825.1 crx3·CFT·지문·patch-map.json·arm64/x86_64 조각), `aside_latest_engine_20260906`(905 crx·후보 데몬), `aside_component_history_20260906`(804~905 24개 버전 JS·API 시간표), `aside_version_steps_20260906`, `aside_browser_fork_depth_20260906`(719.1), `aside_latest_engine_20260902`(902 추출 기록) |
| 원본 dmg | `/mnt/c/Users/HOON/Downloads/Aside-1.0.825.1.dmg` |
| Aside CLI(리눅스) | `~/.aside/cli/aside`(1.26.902.1732) |

## 7. 대조 결과 요약 (분석 출발점)
- 화면 25항목: 같음 4 / 다름 20 / 대조 불가 1. 설정 키 `aside.*` 21개: 같음 3 / 다름 18(뜻 있는 차이 12). 상세는 `MAC-VM-RUN-2026-09-06.md` 11~14절.
- 큰 차이: 설정 화면(원본 자체 15구역 vs 우리 크로미움 설정), 사이드바 구조·색, 에이전트 탭 표시·결과 위치, 툴바, 세로탭 pref 키 이름(`vertical_tabs.strip_collapsed`/`strip_uncollapsed_width`=280 vs 우리 `collapsed_state`/`uncollapsed_width`=240), 데몬 `settings.json` 기본값 30여 개(권한 기본 allow, agentTabs.closeAfterIdleMinutes=15, compaction.keepRecentTokens=20000, 모델 aside/gpt-5.6-terra).
