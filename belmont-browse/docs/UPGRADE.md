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
