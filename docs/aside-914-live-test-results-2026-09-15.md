# Aside 914 라이브 테스트 결과 (2026-09-15)

브라우저(Aside) 914 엔진을 실서비스로 전환하기 전 라이브 검증. 909는 롤백용으로 손대지 않음.

## 요약 (최종 — 대부분 통과)

| 항목 | 결과 | 비고 |
|---|---|---|
| QuickJS 914 엔진 (914 도입의 목적) | ✅ 5/5 통과 | 격리 harness, 실 WASM 초기화 |
| 914 데몬 코어 부팅 | ✅ | 데몬서버·메모리·훅·지식·수명주기 init 정상 |
| 914 전체 부팅 → ready (실확장 등록) | ✅ **port transport** | `[engine] Aside 1.26.914.1644 ready (real extension)` |
| 914 실브라우징 (example.com 제목 읽기) | ✅ | done, toolCalls 2, modelCalls 3, 결과 "Example Domain" |
| **파이러티 배터리 ★1·3·4·5·6** | ✅ **5/5** | 계정 불필요 세트 전부 통과 (아래 §7, 모델 gpt-5.5) |
| pipe transport 확장 등록 | ❌ 실패 | 릴레이 CDP 서비스워커 검증 문제 (아래 §3) |
| 컴포넌트 리눅스 패치(글리프/옴니박스) | ⏳ 미적용 | 표시용 UX, 등록·브라우징엔 무관 |

**결론: 914는 port transport로 브라우저 전체가 정상 동작한다. run-fork.sh 기본값이 이미 port이므로 운영 기본 경로에서 동작.**
초기 "등록 실패"들은 (1) 윈도우 공식 Aside와 21420 충돌, (2) pipe transport, (3) Aside 종료 직후 소켓 경합 — 세 가지 인공 요인이었고 914 자체 결함이 아니었다.

## 1. QuickJS 엔진 — 통과 (핵심)

`__belmontQuickJsTest` 임시 export로 실번들의 `loadNodeQuickJS` 경로를 격리 실행
(`scratchpad/qjs-live-test.mjs`). import 성공이 아니라 **실제 첫 실행에서 WASM 초기화**를 확인.

- wasm-init: 실제 초기화 6ms, `newContext` 함수 존재
- eval-basic: `1+2=3`, JSON(한글 포함) 정상
- mem-limit: 200KB 한도에서 대량 할당 차단
- infinite-loop-deadline: `while(true){}` interrupt로 1001ms에 중단 (콜백 39339회)
- host-isolation: `process`/`require`/`fetch` 전부 undefined (격리)

readWasm 패치: 비-SEA(WSL)에서 `./quickjs-emscripten-module.wasm`(503KB, 추출본) 로드. WASM magic/버전 유효.

## 2. 914 데몬 코어 — 통과

`startDaemonServer(__belmontServer)` 격리 테스트 + 실부팅에서:
- 데몬 API 서버 바인딩(21420) 정상
- creds / knowledge(AGENTS.md) / hooks(memory_search, sandbox=bubblewrap) / lifecycle reconcile 정상
- fork chrome(스냅샷 검증 통과) 기동, CDP/pipe 모두 크롬 자체는 정상

## 3. transport별 확장 등록 (port ✅ / pipe ❌)

`attachRealExtension`는 `bridge.connections`에서 accountId=0·ws open 후보를 찾고, nativeComponentVersion 모드면
`verifyNativeComponentVersions`(CDP로 서비스워커에서 `chrome.asideAccount.getProfileContext()` 등 평가)로 검증한다.

- **port transport**: CDP 직결(9343). 서비스워커 평가 성공 → 등록 성공 → ready. CDP 진단(`cdp-probe.mjs`)으로
  확인한 914 확장 반환값: `boundAccountId=0`, `profileId=bridgeProfileId` 일치, `agentVersion=1.26.914.1644`,
  `chrome.asideAccount` 존재, `passwordManager.enabled=true` — 전부 정상.
- **pipe transport**: CDP가 릴레이(9341) 경유. 확장은 데몬 브리지에 **연결은 됨**이나 `verifyNativeComponentVersions`가
  릴레이 CDP로 서비스워커 평가/타겟 접근에 실패 → 후보가 계속 skip → 90초 타임아웃 "did not register".
  909는 pipe로 되던 경로라 **914에서 릴레이의 service_worker 타겟 처리 차이**로 추정 (추가 조사 대상, 우선순위 낮음).

**운영 영향 없음**: `run-fork.sh` 기본 transport가 port(line 24). pipe를 강제하지 않는 한 914 정상.

## 4. 부수 발견 (중요)

- **21420 포트 충돌 = 윈도우 공식 Aside 앱**(`C:\Program Files\Aside\Application\1.0.914.1`, 빌드 914).
  현재 WSL 네트워킹이 **mirrored** 모드라 윈도우 공식 Aside 데몬(21420)이 WSL 루프백까지 잡힘 →
  우리 WSL 브라우저 데몬(같은 21420) 및 확장(21420 하드코딩)과 충돌. **동시 사용 불가.**
- 테스트를 위해 공식 Aside를 잠깐 종료 → 테스트 후 **정상 복구**(앱 재기동, 데몬 21420 응답 확인).

## 5. 컴포넌트 리눅스 패치 (2026-09-15 갱신)

- `belmont-browse/vendor/aside-components-914/{agent-manager,password-manager}/1.26.914.1644/`:
  윈도우 공식 914 설치본에서 추출(agent-manager 1232, password-manager 48). `chmod u+w` 후 패치 적용.
- **글리프 패치: 완료.** 914는 이 영역을 리팩터링 → 단축키 글리프(c()/f())가 이미 isMac 분기라 리눅스는
  자동으로 Ctrl 텍스트(909보다 개선). **남은 버그는 파일탐색기 라벨 `p()` 1곳**(`/win/`만 체크 → 리눅스가
  Finder 라벨). `patch-linux-platform-glyphs.py`에 914 항목(`platform-CX_yPATJ.js`, 단일 편집) 추가 +
  버전 안 맞는 파일은 건너뛰도록 수정. 적용 후 **패치된 컴포넌트로 재부팅→등록·ready 정상 확인**.
- **옴니박스 패치: 보류(권장).** 914는 page 자산 앵커 5개 전부 드리프트(minify 변수명 변경) → 이식은 큰
  RE 작업. 게다가 옴니박스 검색 결과 바인딩은 **사람이 주소창에 타이핑하는 UI 전용**이고, belmont-browse는
  봇이 serve API로 작업을 넣는 방식이라 이 UI를 안 씀 → 우리 용도엔 가치 거의 없음. 필요 시 별도 착수.

## 6. 914를 운영 전환하려면 남은 것 (전체 복원 착수 — 사용자 결정)

914 브라우저 자체는 port로 동작 확인됨. "실사용 전환"까지 마무리 항목:

1. ✅ **엔진 핀 등록**: `artifacts.json`에 914 patched-daemon-bundle sha 추가 완료(native-identity 검증됨).
2. ✅ **컴포넌트 배선**: `run-fork.sh` 매핑에 `914) echo 1.26.914.1644` 추가 완료. `vendor/aside-components-914`
   추출 + glyph 패치 적용 완료.
3. ✅ **글리프 패치**: 완료(§5). 옴니박스는 보류 권장(§5, 우리 용도 무관).
4. **엔진 파이러티 배터리**: ✅ ★1·3·4·5·6 5/5 통과(§7) + 쿠팡 실동적사이트 실시간 가격 확인(DOM 대조 일치).
5. ✅ **909 핀 드리프트 해소**: 트리 909가 archive(8a5655c4)보다 최신(dream-procedures-v 포함)이라 재핀
   (aaa13d12)으로 native-identity 통과. archive는 `patched/aside-909-daemon.mjs`에 보존.
6. **pipe transport(선택)**: 릴레이 CDP의 914 service_worker 검증 경로 조사. port(운영 기본) 쓰면 불필요.
7. **리눅스 보안저장소 패치(검증)**: 914 keychain SKIP은 등록/브라우징을 막지 않음(설치키
   `.state/aside-installation-key.der` 경로로 성립). 세션 저장 필요 기능 쓸 때 재확인.

**★상시 운영 결정(미정)**: WSL mirrored 네트워크에서 윈도우 공식 Aside(21420)와 WSL 브라우저(21420)는 동시 불가.
- (a) **권장** 공식 Aside를 비교용으로만(평소 끔) — 무비용, 지금 방식.
- (b) WSL 브라우저 포트 이전 — 확장 7파일 + **fork 바이너리(21420 하드코딩, ASIDE_PORT 미지원) 바이트 패치**
  + 신원 재기록 필요. 동시 실행이 꼭 필요할 때만.

## 재현/도구 (scratchpad)
- `qjs-live-test.mjs` — QuickJS 5종 검증
- `ds-test.mjs` / `serve-min3.mjs` — 데몬서버 21420 바인딩 격리 테스트
- `boot-914-fork2.sh` — 914 데몬 + 914 원본 컴포넌트 fork 부팅 (확장 등록 실패 재현)

## 7. 파이러티 배터리 결과 (2026-09-15, 914 / port / 실확장 / gpt-5.5)

계정 불필요 세트(★1~6)를 914 브라우저에 라이브 실행. ★2(구글 검색)는 봇탐지 불안정로 보류.
로컬 픽스처 서버(18777, `aside-fork/test/adblock/page/`)로 ★4·★5 수행.

| 과제 | 결과 | 도구/모델호출 | 시간 | 핵심 |
|---|---|---|---|---|
| ★1 HN 상위3 요약 | ✅ | 6 / 5 | 51s | 최신 3건 한국어 요약+요점2+출처+인용 |
| ★3 example.com 3줄 | ✅ | 2 / 3 | 18s | TITLE/SUMMARY/LINKS 형식 정확 |
| ★4 폼 채우고 제출금지 | ✅ | 6 / 7 | 155s | 전 칸 채움 + **제출 안 함** 확인 (guard 동작) |
| ★5 로컬 index 읽기전용 점검 | ✅ | 2 / 3 | 45s | 제목·H1·이미지·가로스크롤·콘솔 전 항목 PASS |
| ★6 5페이지 제목+첫문단 표 | ✅ | 9 / 10 | 109s | github/HN/MDN/ko.wiki/tailwind, HN `<p>`없음까지 정확 |

**결론: 914는 탐색·읽기·폼입력·제출차단·다중페이지·요약을 909과 동등하게 수행. 5/5 통과.**

### 부팅 주의 (재현 팁)
- fork chrome CDP 타임아웃(20s, 코드 상수)은 **꼬인 Xvfb 디스플레이**에서 발생 → 크래시가 누적된 디스플레이 말고 **새 디스플레이**에서 부팅할 것.
- 프로세스 종료는 `kill -9 <pid>` 직접 지정만 확실히 동작(pkill/패턴은 이 환경에서 exit 144).
