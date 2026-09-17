# Grok Bot 0.47 — marker별 "코드 추출 가능" 판정 (2026-09-11)

질문: mcp/canvas/sentry/otel/routines/skills/onepassword 중 **코드 추출이 되는 것과 안 되는 것**.

전제(실측): 0.47 asar에는 **sourcemap 0개, 코드는 전부 minified**.
따라서 "원본 소스 그대로 복원"은 **어느 것도 불가**. 대신 "추출 가능"을 아래 두 층위로 나눠 판정.

- **로직 추출**: minified JS를 읽어 **동작 로직을 재구성**할 수 있는가 (식별자는 죽었지만 흐름은 살아있음)
- **완결성**: 그 기능이 **클라이언트에 완결**돼 있는가, 아니면 **외부(서버/CLI/네이티브)에 로직이 있어** 껍데기만 있는가

---

## 결론 표

| marker | JS파일 | 로직 추출 | 완결성 | 판정 |
|---|---|---|---|---|
| **mcp** | 97 | ✅ 됨 | △ 클라이언트+외부 서버 | **되지만 절반**: MCP 프로토콜/트랜스포트(stdio·클라이언트)는 추출 가능. 실제 도구는 외부 MCP 서버에 있음 |
| **canvas** | 30 | ✅ 됨 | ✅ 자체 로직 | **잘 됨**: 이미지 처리·색양자화·렌더 로직이 번들에 완결. 재구성 가능 |
| **sentry** | 41 | ✅ 됨 | ❌ 외부 SaaS | **껍데기만**: Sentry SDK 코드는 추출되나 로직은 sentry.io로 보내는 것. 자체 가치 없음(끄면 됨) |
| **otel** | 36 | ✅ 됨 | ❌ 외부 수집기 | **껍데기만**: OpenTelemetry 계측 코드뿐. 데이터는 외부 OTLP 수집기로. 자체 로직 아님 |
| **routines** | 18 | ✅ 됨 | ✅ 로컬 실행 | **됨**: 스케줄/트리거/실행 로직이 로컬. 재구성 가능(우리도 이미 유사 보유) |
| **skills** | 14 | ✅ 됨 | ✅ 로컬 정의 | **됨**: 스킬 정의/로더가 로컬. 재구성 가능 |
| **onepassword** | 5 | ✅ 됨 | ❌ 외부 `op` CLI | **껍데기(클라이언트)만**: `op` CLI를 spawn·codesign 검증·vault 조회하는 **연동 코드는 완전히 추출됨**. 단 실제 금고 로직은 1Password CLI/앱(외부)에 있음 |

---

## 상세 근거 (실측)

### ✅ 자체 완결 = 로직까지 추출 가치 있음
- **canvas** (`main-app.cjs` 등 30파일): HTMLCanvas→ImageData→색양자화(`getNearestColor`, uint32 팔레트) 등
  **이미지 처리 알고리즘이 통째로** 번들에 있음. 외부 호출 없이 동작. → 재구성/차용 가치 있음.
- **routines** (18파일): `RoutineSchedule`·cron·트리거·실행 흐름이 로컬. → 추출·이식 가능.
- **skills** (14파일): 스킬 정의/로더 로컬. → 추출 가능.

### △ 클라이언트는 추출, 실체는 외부
- **mcp** (97파일, 프로토콜 구현 6파일): stdio 트랜스포트·JSON-RPC·클라이언트 로직은 **추출 가능**.
  하지만 "무슨 도구가 있나"는 각 **외부 MCP 서버**에 달림 → 프로토콜만 얻고 도구는 못 얻음.
  (0.30→0.47 최대 증가분이라 계약 참고 가치는 높음)

### ❌ 껍데기만 = 추출해도 로직은 밖에 있음
- **onepassword** (5파일): 코드는 다 보임 — `/usr/local/bin/op`·`/usr/bin/op` 탐색, `codesign --verify --strict`로
  바이너리 검증, managed install, biometric unlock 플래그, vault 조회. **연동 코드는 100% 추출됨.**
  그러나 **크리덴셜 저장·복호화 로직은 1Password CLI/데스크톱 앱(외부)에** 있음 → 우리가 얻는 건
  "1Password를 어떻게 호출하는가"뿐, 금고 자체가 아님.
- **sentry** (41파일): 오류를 sentry.io로 전송하는 SDK. 로직=외부 SaaS. 자체 기능 아님(개인용은 제거 대상).
- **otel** (36파일): OpenTelemetry 계측. 데이터는 외부 OTLP 수집기로. 자체 로직 아님(제거 대상).

---

## 한 줄 정리

- **원본 소스 복원**(sourcemap): **전부 ❌** (map 0개, minified).
- **로직 추출/재구성**: **canvas·routines·skills = ✅ 가치 있음**, **mcp = △(프로토콜만)**,
  **onepassword = 연동코드만 ✅ / 금고로직 ❌**, **sentry·otel = 추출돼도 껍데기(외부 SaaS)**.

즉 "추출해서 우리 것에 쓸 만한 것"은 **canvas / routines / skills / (mcp 계약) / 1Password 연동 방식**,
"추출해봐야 의미 없는 것"은 **sentry / otel**(외부 텔레메트리)이다.

---

## 부록: 왜 원본 복원은 안 되나
- asar 안에 `.map`(sourcemap) 파일이 하나도 없고 `sourceMappingURL` 참조도 0.
- 코드는 `!function(){...}` 형태로 압축·식별자 축약(minify)됨.
- 따라서 변수/함수 원래 이름·주석·타입은 소실. **동작 흐름은 읽히나 원본 TypeScript는 못 되돌림.**
- 네이티브(`.node`/`.wasm`)는 tree-sitter·proclist뿐이고, 위 7개 marker와는 무관(전부 JS).
