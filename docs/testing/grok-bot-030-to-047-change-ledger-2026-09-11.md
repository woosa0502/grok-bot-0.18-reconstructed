# Grok Bot 0.30 → 0.47 변경 원장 (2026-09-11)

- 기준일: 2026-09-11 KST
- 대상: macOS arm64 Grok Bot desktop package (`app.asar`)
- 방법: 실제 배포 서버에서 0.18 / 0.30 / 0.47 asar 추출·비교 (3자 diff)
- 상태: `VERIFIED_ARTIFACT_LINEAGE / SEMANTIC_DIFF_PARTIAL / BACKEND_E2E_UNVERIFIED`
- 앞 원장: `docs/testing/grok-bot-018-to-030-change-ledger-2026-08-30.md` (0.18→0.30)

---

## 0. 결론

**최신은 0.47.0** (업데이트 서버가 0.47에서 204=최신 확정). 우리 재구성 기준선 0.18 대비 29개
마이너 뒤, 직전 조사(0.30) 대비 17개 뒤.

**핵심: 큰 아키텍처 전환은 0.30까지 끝났고, 0.30→0.47은 "세부 확장"이 중심이다.**
새 대형 의존성은 `@anysphere/canvas-shared` 딱 1개뿐. 나머지는 기존 기능의 심화
(MCP 대폭 확대, 1Password 연동 신설, canvas 2배, routines/skills 확장).

---

## 1. 확보한 아티팩트 (해시)

| 버전 | zip SHA-256 | app.asar SHA-256 | 크기 |
|---|---|---|---|
| 0.18.0 | (repo archive) | `…` (78.5MB asar) | 145 파일 |
| 0.30.0 | — | (414 파일) | — |
| 0.47.0 | `947000c2bbf1f029b1010674e48fdb55e6447ad147a2ef42b5906380f4823c4f` | `8830d98806ded6c73a28f5b860f04532f08a366da1e58a836092e3c885a1d1d7` (34.4MB asar) | 480 파일 |

- 배포 경로 변경: `downloads.cursor.com/**sand**/…/.dmg` → `/**grokbot**/…/.zip` (리브랜딩)
- 업데이트 체크 API는 유지: `api2.cursor.sh/updates/api/update/<plat>/sand/<ver>/<mid>/stable`
- asar 크기 78.5MB(0.18) → 34.4MB(0.47): 번들 최적화(불필요 의존성 정리, `.unpacked` 재배치)
- 파일 수 145 → 414 → 480: 코드 모듈 분화

---

## 2. 의존성 변화 (package.json, 실측)

deps: **0.18=77 → 0.30=83 → 0.47=84**

### 0.30 → 0.47 순증분
| 변화 | 항목 |
|---|---|
| **+ 신규** | `@anysphere/canvas-shared` (canvas 공유 런타임) |
| − 제거 | (없음) |

### 참고: 0.18 → 0.47 누적 신규 (대부분 0.30까지 들어온 것)
`@anysphere/grok-bot-harness`, `grok-bot-voice-call-harness`, `messages-mac`, `mcp-core`,
`metrics`, `otel-proto`, `canvas-shared`, `@lingui/core`·`react`, `@sentry/node-core`
(`@sand/dune`→`@anysphere/dune` 리네임). 제거: `@sentry/node`, `highlight.js`, `rehype-katex`.

---

## 3. 기능 marker 3자 비교 (파일 출현 수)

| marker | 0.18 | 0.30 | 0.47 | 0.30→0.47 해석 |
|---|---|---|---|---|
| **mcp** | 12 | 55 | **99** | MCP 통합 대폭 확대(최대 증가) |
| **canvas** | 12 | 15 | **33** | canvas 2배 심화 + 전용 의존성 신설 |
| **sentry** | 6 | 31 | 42 | 오류수집 확대 |
| **otel** | 16 | 29 | 38 | OpenTelemetry 관측 확대 |
| **routines** | 7 | 13 | **18** | 루틴/자동화 확장 |
| **skills** | 9 | 8 | **14** | 스킬 확장 |
| **onepassword** | 2 | 0 | **5** | **1Password 연동 신설**(0.47) |
| **cookieApprov** | 0 | 0 | **3** | 쿠키 승인 UI(리네임 후 재출현) |
| **chrome-import** | 0 | 1 | **3** | 크롬 데이터 가져오기 확장 |
| virtualCard | 0 | 5 | 6 | (0.30 도입) 소폭 |
| voiceCall | 1 | 5 | 7 | (0.30 도입) 소폭 |
| messages-mac | 0 | 1 | 1 | (0.30 도입) 유지 |
| computerUse | 7 | 5 | 7 | 유지 |

---

## 4. 0.30 → 0.47 실제 변경 (판정)

### ① electron-main 신규 파일
| 파일 | 역할 | 판정 |
|---|---|---|
| `onepassword-connection-service.cjs` | **1Password 데스크톱 앱/CLI 연동** — `op` CLI + biometric unlock + vault에서 크리덴셜 가져오기. 문자열: "No verified 1Password CLI is ready", "connecting to desktop app", "vault name", OP_BIOMETRIC_UNLOCK_ENABLED | `PACKAGE_IMPLEMENTED` (신규) |
| `chrome-import-worker.cjs` | 크롬 데이터 가져오기 전용 워커 | `DIRECT_ARTIFACT` |
| `main-app.cjs` / `main-core.cjs` / `proto.cjs` | 기존 단일 main 번들을 app/core/proto로 **분화**(모듈화) | `BINARY_CHANGED_ONLY` (구조 변경) |

### ② 심화된 기능
- **MCP**: 55→99 파일 — 0.30→0.47 최대 변화. MCP 서버 관리·도구 확대가 이 구간의 주축.
- **Canvas**: 15→33 + `@anysphere/canvas-shared` 신설 — canvas(문서/그리기) 기능 대폭 강화.
- **Routines/Skills**: 각각 13→18, 8→14 — 자동화·스킬 계속 확장.
- **1Password + cookie approval + chrome-import**: 크리덴셜/브라우저 데이터 통합 강화.

### ③ 유지(0.30에 이미 들어온 것)
virtual card·voice-call harness·macOS Messages — 0.30에서 처음 관찰됐고 0.47까지 유지(구현 규모 소폭 증가). 이 구간의 신규 아님.

---

## 5. 한계 (정직하게)

- **per-version(0.31~0.46) 세부는 미분해.** 이 원장은 0.30/0.47 두 끝점 diff라 각 버전이 무엇을
  더했는지는 좁히지 못한다. 좁히려면 중간 버전 asar를 추가로 받아 marker FIRST_OBSERVED를 재야 함
  (0.45는 403, 0.21처럼 접근불가).
- **minified 번들**이라 marker 파일-수는 근사치(리네임 시 흔들림 — cookieApprov가 0.30에서 0으로
  잡힌 게 예). 의미 확정은 파일 수보다 "신규 파일/의존성"이 더 신뢰도 높음.
- **서버·계정·rollout flag는 설치파일로 확정 불가** (BACKEND_E2E_UNVERIFIED).
- xAI는 데스크톱 앱 per-version 공식 changelog를 공개하지 않음(커뮤니티/포럼 확인).

---

## 6. Belmont(0.18 재구성) 관점 시사

우리는 0.18을 로컬 Codex 런타임으로 재구성 중. 0.30→0.47 신규 중 **개인용에 의미 있는 것**:

| 0.47 신규 | 개인용 가치 | 비고 |
|---|---|---|
| **1Password 연동** | 중~높음 | 우리 password vault(Aside)와 겹침 — 통합 or 대체 검토 가치 |
| **MCP 대폭 확대** | 높음 | 우리도 MCP 경로 있음. 최신 도구 계약 참고 가치 |
| canvas 강화 | 중 | 문서/그리기 UI |
| routines/skills 확장 | 중 | 자동화 경로 |
| virtual card·voice call·mac Messages | 낮음 | 앞 원장대로 개인 로컬용엔 제외 대상(결제·음성 backend 필요) |

---

## 부록: 재현

```bash
# 최신 확인
curl -s "https://api2.cursor.sh/updates/api/update/darwin-arm64/sand/0.30.0/00000000-0000-0000-0000-000000000000/stable"
# → {"url":".../grokbot/stable/darwin-arm64/0.47.0/Grok_Bot_0.47.0.zip","name":"0.47.0"}

# 받기 + asar 추출
curl -fsSL ".../grokbot/stable/darwin-arm64/0.47.0/Grok_Bot_0.47.0.zip" -o g047.zip
unzip g047.zip
npx @electron/asar extract "Grok Bot.app/Contents/Resources/app.asar" ext047
```
