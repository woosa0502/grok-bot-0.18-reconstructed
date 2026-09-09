# belmont-browse

2026-09-09 사용자 요청으로 소스·패치·테스트를 Git에 포함했다.
실행 데이터와 다운로드한 vendor 번들은 계속 로컬에 보존한다.
현재 native 소스는 [누적 스냅샷](aside-fork/snapshot/README.md),
검사 결과와 외부 입력은 [소스 인계](../docs/aside-source-publication-2026-09-09.md)를 기준으로 읽는다.
아래 내용은 개발 이력을 포함하며 당시의 실행 상태를 설명한다.

Aside 데몬(복원한 원본 번들)을 그대로 실행해서, Belmont 옆에서 "Aside 방식 브라우저 에이전트"가
어느 정도 성능이 나는지 확인하는 1단계 실험 도구. Belmont 앱 코드는 전혀 건드리지 않는다.

## 구조

| 경로 | 출처 | 역할 |
|---|---|---|
| `vendor/aside-824/daemon.original.mjs` | Aside.dmg에서 복원 (SEA 번들, 10MB) | 원본 그대로 보관 |
| `vendor/aside-824/apps/daemon/build/daemon.mjs`, `vendor/aside-902/...` | 원본 + 패치 3곳 (`tools/patch-daemon.py`) | CDP 주소 환경변수, 요소 스크린샷 margin 버그 수정(원본 버그), 내부 심볼 `__belmont` 게터 노출 |
| `vendor/aside-824/apps/daemon/src/skills/builtin/*/SKILL.md` | dmg에서 카빙 (42개) | 내장 스킬 (경로는 번들의 `SOURCE_ROOT` 규칙에 맞춤) |
| `src/cdp-mini.mjs` | 우리 코드 | 브리지 흉내에 쓰는 초소형 CDP 클라이언트 |
| `src/chrome.mjs` | 우리 코드 | Xvfb `:99`에 일반 Chrome을 CDP 9333으로 띄움 |
| `src/bridge-shim.mjs` | 우리 코드 | Aside 확장 프로그램 흉내: `Aside.*` 명령을 CDP로 처리 |
| `src/credentials.mjs` | 우리 코드 | Belmont의 Codex OAuth(`pi-auth.json`) ↔ Aside `credentials.json` 동기화 |
| `src/session.mjs` | 우리 코드 | 계정 부트스트랩(sqlite 스키마, 시드 파일, 스킬 동기화) + 세션 생성 |
| `src/run.mjs` | 우리 코드 | 실행기: 작업 한 건 돌리고 시간/토큰/도구 호출 요약 |
| `.state/` | 실행 산출물 | `aside-home/`(ASIDE_HOME), `chrome-profile/`, 로그 |

## 실행

```bash
./run.sh --task "https://example.com 열고 제목 알려줘" --auto-approve --verbose
./run.sh --task "..." --mode guard          # 승인 카드(서스펜션) 흐름 확인, 터미널에서 y/N
./run.sh --task "..." --model gpt-5.5 --thinking medium
```

- 모델: `openai-codex` (Belmont와 같은 ChatGPT OAuth 토큰을 복사해서 사용, 실행 후 최신 토큰을 다시 Belmont 쪽에 되돌려 씀)
- Node 26.8.1 필요 (`node:sqlite`, 전역 WebSocket)

## 원본에서 대체한 것 (1단계)

- Aside 브라우저의 확장 프로그램 22개 명령 → `bridge-shim.mjs`가 CDP로 흉내 (탭 열기/닫기/목록/소유 확인/창 정보/알림 무시). 다운로드 대기, 비밀번호 관리자, 히스토리 검색은 미지원.
- `Browser.ensureProfile` 은 호출되지 않도록 세션 바인딩에 `windowId`를 미리 넣음.
- 클라우드(api.aside.com), posthog는 `ASIDE_API_URL`을 닫힌 포트로 돌려 즉시 실패시킴.

## Belmont 연동 (2026-09-03)

- `src/serve.mjs`: 로컬 HTTP 서비스(127.0.0.1:9340, 토큰은 `.state/serve.json`). 세션 id = Aside 세션 id라 서비스를 재시작해도 이어감. 엔드포인트: `POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/answer|continue|steer|stop`, `GET /health`.
- `src/core.mjs`: `run.mjs`의 세션 생성·프롬프트·서스펜션 감시를 라이브러리로 뗀 것. 큐(동시 1개), 활동 로그, 이어가기(continue).
- Belmont 쪽 확장 `source/host/extensions/browse-runtime/` (깃에 커밋됨, 플래그 `SAND_ASIDE_BROWSE=1`): Task 도구에 `aside-browse` 하위 봇 종류를 추가. 하위 봇의 두뇌가 이 서비스의 Aside 세션이 된다. 승인·질문은 `[approval needed]`/`[question]` 텍스트로 부모에게 돌아가고, 부모가 사용자에게 카드로 물은 뒤 `Task(resume=..., prompt=답)`로 이어간다.
- 실행 순서: ① `node src/serve.mjs`(환경변수 `BELMONT_BROWSE_ENGINE=902 BELMONT_BROWSE_MODEL=gpt-5.5 BELMONT_BROWSE_MODE=guard`) ② Belmont 앱을 `SAND_ASIDE_BROWSE=1`로 실행.
- (2026-09-06) 호스트에 `SAND_ASIDE_BROWSE=1`이 없으면 봇이 Aside를 안 쓰고 벨몬트 자체 도구로 답한다 — 증상만 보면 "미러링이 안 됨". 실행: `tmux new-session -d -s belmont-bot -c <repo> 'SAND_ASIDE_BROWSE=1 npm run wsl:start'`(소스가 바뀌면 먼저 `npm run wsl:setup`).
- (2026-09-06) `core.mjs` stage: 실행 중 가장 최근에 바뀐 페이지 탭을 앞으로 올려 봇 화면이 에이전트를 따라간다(`BELMONT_BROWSE_STAGE=0`으로 끔). 실행 전 세션 browserBinding을 현재 프로필·창으로 갱신한다(Aside 화면/CLI에서 만든 채팅도 탭을 열 수 있게).
- (2026-09-06) 검사 도구: `aside-fork/test/parity/drive.mjs`(지시 보내고 답 기다림), `watch.mjs --run=<루틴id>`(루틴 즉시 실행 관찰). 결과: `aside-fork/usecases/PARITY-RESULTS-2026-09-05.md`.
- 주의: guard 모드의 `bash` 도구는 macOS 샌드박스 전제라 리눅스에서는 제한 없이 돈다. 서비스에 붙일 때는 bash를 끄거나 read-only 모드로 두는 게 안전하다.

## 봇 목록의 보통 봇으로 쓰기 (2026-09-03)

- 봇 `profile.json`에 `"runtime": "aside-browse"`를 넣으면 그 봇의 사용자 턴을 Aside 세션이 처리한다(확장 `aside-bot-runner.ts`, 실행기 생성 지점 `sand-host.ts`에서 감쌈). 이름·아바타·대화 기록·카드는 Belmont 것 그대로.
- 대화 하나 = Aside 세션 하나. 연결 정보는 `agents/<id>/browse-runtime.json`. 대화를 지우면 다음 메시지부터 새 세션.
- 승인·질문은 위젯 카드로 뜨고, 카드의 답이 다음 턴으로 들어와 같은 세션의 서스펜션을 푼다.
- 만든 봇: "브라우저" (`.state/browser-bot-id`).

## 보안 손질 (2026-09-03)

- **CDP 포트 없음**: 서비스가 Chrome을 `--remote-debugging-pipe`(fd 3/4, NUL 구분 JSON)로 자식 프로세스로 띄우고, `src/cdp-relay.mjs`가 토큰 검사하는 `ws://127.0.0.1:9341/cdp?token=…` 중계를 제공한다. Aside CDP 클라이언트는 ws:// 주소를 받으면 `/json/*` 조회도 소켓으로 하므로 데몬 패치 없음. 토큰 없는 접속은 401. 기존 포트 방식은 `--transport port`.
- **bash 도구 제거**: `BELMONT_BROWSE_NO_BASH=1`이면 패치 4번이 셸 도구를 도구 목록에서 뺀다(리눅스에는 Aside 샌드박스 백엔드가 없어 guard 모드에서도 bash가 제한 없이 돌기 때문). 2단계에서 bubblewrap 백엔드로 대체 예정.
- **측정 실행기**: 서비스가 떠 있으면 `run.sh`는 `serve.json`의 `cdpWsUrl`로 같은 Chrome에 붙는다(프로필 공유 충돌 방지).
- **봇 간 위임**: Belmont 매니저가 브라우저 봇에게 보낸 메시지는 숨은 턴(`[agent]` 큐)으로 오며, 확장이 이를 작업으로 실행하고 `transcript.sendToAgent`로 답을 되돌린다.

## 2단계 (2026-09-03)

- **기억 검색 대체** (`src/memory-search.mjs`): `memory/**/*.md`를 SQLite FTS5로 색인. 한글은 두 글자 조각(bigram) 열을 따로 두어 "부산 날씨" 같은 짧은 말도 잡힌다(MyLife의 tsvector 조각 방식 차용). 제목 6·별칭 4·본문 1·조각 1.5 가중치의 bm25. 데몬 패치 #5가 `memory_search`를 이 훅으로 돌린다.
- **셸 샌드박스** (`src/bwrap-backend.mjs`): bubblewrap. 전체 파일 시스템 읽기 전용, 홈은 빈 tmpfs로 숨기고 읽기 전용, Aside의 readableRoots는 읽기 전용·writableRoots는 쓰기 가능으로 되묶음. `/tmp`는 tmpfs, 네트워크는 `networkMode`에 따름. 데몬 패치 #6이 리눅스에서 이 백엔드를 쓴다(824에 있던 원본 LinuxSandboxBackend는 시스템 경로를 안 묶어 실행이 안 됐고 902는 제거됨). 이제 `BELMONT_BROWSE_NO_BASH` 없이 bash를 켜 둔다.
- **새 버전 절차**: `docs/UPGRADE.md`.

## 지식 저장소 (Belmont 소유, 2026-09-03)

- 위치: `Belmont/.cache/belmont-wsl-profile/sand-data/knowledge/` (`sites/`, `rules/`, `lessons/`, `drafts/`). 환경변수 `BELMONT_KNOWLEDGE_DIR`(서비스) / `SAND_KNOWLEDGE_DIR`(Belmont 앱)로 옮길 수 있다.
- Belmont 앱 쪽(커밋 `2267dba`): `source/host/runner/knowledge-store.ts`가 같은 FTS5+한글 조각 색인으로 `knowledge_search` 내장 도구를 모든 봇에 제공하고, 시스템 프롬프트 기억 절에 저장소 안내문을 넣는다. `SAND_KNOWLEDGE_STORE=0`이면 끔. 봇의 Read는 sand-data를 거부하므로, 페이지 본문은 `knowledge_search`에 `read_path`를 넘겨 받는다(커밋 `d70bba5`).
- 브라우저 봇 쪽: Aside 계정의 `memory/sites`는 이 폴더의 심볼릭 링크, `AGENTS.md`는 `rules/aside-agents.md`에서 복사, 세션 읽기 권한에 폴더 포함.
- 훈련 바퀴: `src/learn.mjs`(채굴·초안) → `src/learn-measure.mjs`(A/B 측정 후 채택/기각, 기록은 `lessons/measurements.log`).

### 기본 모델과 재시도 (2026-09-03)
- 서비스 기본 모델은 `gpt-5.6-luna` / `max` (가장 싼 토큰). 시작 예: `.state/scripts/restart-browse.sh` (Chrome을 봇 화면 `:99`에 띄움 — 폰 컴퓨터 화면과 Belmont Computer 도구가 같이 봄. WSLg 화면으로 되돌리려면 `BELMONT_BROWSE_DISPLAY=:0 .state/scripts/restart-browse.sh`)
- Belmont 브라우저 봇(커밋 `3fd1a21`)은 새 작업이 `error`로 끝나면 `gpt-5.5/high`로 한 번 다시 시도하고 사용자에게 알린다. 끄기: `SAND_ASIDE_BROWSE_FALLBACK_MODEL=off`, 바꾸기: `SAND_ASIDE_BROWSE_FALLBACK_MODEL`, `SAND_ASIDE_BROWSE_FALLBACK_THINKING`.
- 학습 루프: `learn.mjs`는 하위 도메인을 기존 페이지가 있는 상위 도메인으로 접고(search.naver.com → naver.com), `--after <ISO>`로 수정 이전 세션을 증거에서 뺀다. `--domain` 실행은 `<날짜>-mined-<도메인>.md`에 쓴다. `learn-measure.mjs`는 기본 2회씩 돌려 중앙값으로 채택을 판정한다.
- 서비스 재시작 뒤 옛 세션 `continue`가 `msgs is not iterable`로 500을 내던 문제 수정(`core.mjs` hydrate: 메시지 목록이 배열일 때만 마지막 답을 복구). Belmont 봇은 그래도 실패하면 새 세션으로 자동 전환(커밋 `6c3d44b`).
