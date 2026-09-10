# 진행 일지 — 2026-09-10 (시간순, 맨 아래가 최신)

앞 날: `docs/progress-log-2026-09-09.md`. 상세 근거는 `docs/audit-remediation-2026-09-09.md`, 살아 있는 프로세스와 첫 명령은 `NEXT_SESSION.md`.

| 시각 | 한 일 | 결과 | 근거 |
|---|---|---|---|
| 00:0x | Windows 데몬 구성요소(909) 내용 설명 | exe·네이티브 모듈·샌드박스 helper·스킬 | 대화 |
| 00:3x | 909 데몬 JS를 Windows·macOS 실행 파일에서 꺼내 비교 | 두 플랫폼 JS 동일. 907→909 마이그레이션 3개·함수 이름 변경·도구 교체. 우리 패치 체인 2곳 실패 | `docs/aside-909-daemon-comparison-2026-09-10.md` |
| 00:4x | 깨끗한 909 번들을 research-archives(LFS)에 등록 | artifacts.json·SHA256SUMS 갱신, research-archives 테스트 통과 | `research-archives/aside/original/AsideDaemon-win-x64-1.26.909.1820.mjs` |
| 00:4x | 사용자 상태 백업(`data/artifacts/backups/state-before-909-20260910T0042Z.tgz`, 캐시 제외 683MB), 909 vendor 디렉터리 준비, 패치 도구 5개를 909에 맞게 확장 | 907 체인은 여전히 vendor와 바이트 동일 | commit 89114d6 |
| 00:5x | 909 번들 조립·설치, 상태 복사본으로 Xvfb에 전체 스택 기동해 검증 | 엔진 준비·확장 등록·메모리 native·마이그레이션 v13~15·실제 작업(example.com 제목) 15초 완료 | `data/artifacts/aside-909-20260909/verify/` |
| 00:57 | **사용자 Aside를 909로 전환**(홈 `aside-home-907` → `aside-home-909` 복사 후 기동) | daemon 22786 / Chrome 22823, 세션 33개 유지, health ready·memory native | logs/primary-relaunch-20260910T0056Z-* |
| 01:1x | 909 전환 후 실제 작업 1건(example.com 제목) 15초 완료. 주소창 자산 검사 테스트를 909용으로 추가(비교 함수·헬퍼 이름 매핑), 회귀 테스트 통과 | 도구·문서 커밋 | `belmont-browse/tests/omnibox-consumer-generation-909.test.mjs` |
| 13:3x | WSL GPU 조사. 시스템 전체가 CPU 렌더링(llvmpipe)이던 원인은 Mesa가 D3D12 가상 GPU 드라이버를 스스로 고르지 않는 것. `GALLIUM_DRIVER=d3d12` + Chromium `--ignore-gpu-blocklist`로 해결 | 측정(:0): 캡처 126→41ms, 무거운 WebGL 소프트웨어는 3분 내 미완 → GPU 98ms/프레임, 스크롤 17→20ms. 내장 AMD가 RTX 5070 Ti보다 이 작업엔 빠름(NVIDIA는 374ms/프레임·캡처 136ms). Xvfb(봇 화면)는 이득 없음. 격리 UI 점검 2종 크래시 0 | `run-fork.sh`(:0에서만 기본 켬, `BELMONT_BROWSE_GPU=0`으로 끔) |
| 13:59 | 사용자 Aside GPU 켜서 재기동 | daemon 44335 / Chrome 44370, 렌더러 "D3D12 (AMD Radeon)" 확인, health ready | logs/primary-relaunch-20260910T0459Z-* |
| 14:5x | Windows 컴퓨터 유즈 현황 조사. Codex 데스크톱 앱(MSIX 26.903)이 Windows에 설치돼 있고 컴퓨터 유즈 런타임이 로컬에 있음: `AppData\Local\OpenAI\Codex\runtimes\cua_node\…\node_modules\@oai/{cua,sky,browser-desktop}` + `bin/windows/codex-computer-use.exe`(1.5MB). 설계: 모델에게 `cua_repl`(JS REPL) 하나를 주고 접근성 트리(요소 번호)+캡처로 `click/typeText/setValue/pressKey/scroll` 등 호출, 브라우저는 탭 객체(goto/back/…)와 WebMCP, 확인 정책 문서(손 떼기/항상 확인/사전 승인 3단계). Grok(Belmont) Computer 도구는 가상 화면 전용이고 Aside Windows 데몬에도 화면 조작은 없음 | **판단**: OpenAI 전용 구성요소라 우리 봇이 가져다 쓰지 않는다. 설계 참고만. 봇용 Windows 도우미는 UI Automation 접근성 트리 우선 + 캡처 폴백 + 같은 3단계 확인 정책으로 우리가 만든다 | 대화 기록 |
| 17:0x~19:3x | Codex 컴퓨터 유즈 조사 마무리: 런타임 팩 zip을 바탕화면에 만들고, 다른 모델의 정적 분석 묶음을 실제 파일과 대조(전부 일치), 오픈소스 cua 드라이버 문서와 비교, Codex 문서 층(30개)과 Aside 909 REPL 설명서·스킬 34개를 항목별로 대조 | 실행 층은 cua 드라이버, Codex는 문서(확인 정책·REPL 규칙·완료 기준·탭 넘기기·봇 차단 분류)만 참고. Aside에는 글 4개만 보태면 됨. 결정 3건 대기 | `docs/codex-computer-use-review-2026-09-10.md`, `data/artifacts/codex-cua-20260910/` |
| 20:2x | 문서 커밋(18ab588) 뒤 CI 실패 확인. 원인은 문서와 무관: 909 구성요소 압축(`components-909.tgz`)은 `AsideAgentManager/1.26.909.1820/assets` 구조인데 등록 정보의 확인 경로와 909 주소창 테스트가 CRX를 그냥 푼 평평한 `AsideAgentManager/assets`를 기대. 압축을 등록한 89114d6 이후 CI가 계속 실패 중이었음 | 등록 정보 경로를 버전 폴더로 고치고 테스트는 두 구조 모두 허용. 로컬에도 압축을 풀어 CI와 같은 구조 확보. 9764f95 CI 성공(run 34470397301) | `research-archives/aside/artifacts.json`, `belmont-browse/tests/omnibox-consumer-generation-909.test.mjs` |

## 지금 상태

- 사용자 Aside: daemon 44335 / Chrome 44370 (13:59 기동, **엔진 1.26.909.1820**, 홈 `aside-home-909`, **GPU 렌더링 켬**). 되돌리기: `BELMONT_BROWSE_ENGINE=907 bash run-fork.sh`(907 홈 그대로 있음). Belmont 호스트: tmux `belmont-bot`.
- 909 적용 완료. 전수 테스트 문서는 버전 표기만 909로 읽으면 된다(경로·도구 동일).
