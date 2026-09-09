# EasyList / EasyPrivacy 규칙 분류 (A1, 2026-09-05)

포크 엔진이 버리는 규칙을 **전수** 분류한 결과. 도구는 엔진과 같은 파서 경로를 그대로 쓰는
오프라인 실행파일 `aside_rule_classifier`(크로미움 트리 `components/subresource_filter/tools/aside_rule_classifier_main.cc`,
`ninja -C out/aside aside_rule_classifier`)이고, 집계는 `aggregate.py`.

```
./out/aside/aside_rule_classifier easylist.txt easyprivacy.txt > classified.tsv   # file, line, verdict, reason, token, line
python3 aggregate.py classified.tsv > summary.md
```

입력은 포크가 실제로 내려받아 쓴 목록 사본(`.state/chrome-profile/Default/AsideAdBlock/Subscriptions/*.txt`,
EasyList 81,650줄 / EasyPrivacy 56,803줄, 2026-09-05).

## 결과 — 확장 전 (패치 035 엔진)

| 목록 | 거부 | 내용 |
|---|---|---|
| EasyList | 3,172 | `$popup` 2,938 · `$generichide` 168 · 정규식 규칙 29 · `$rewrite` 7 · `$csp` 3 · 절차형 선택자(`#?#`·`:-abp-`·`:has-text`) 27 |
| EasyPrivacy | 49 | `$redirect`/`$redirect-rule` 22 · `$important` 10 · 정규식 7 · `:style()` 4 · `$csp` 2 · `$rewrite` 1 · `$method` 1 · `~document` 1 · `:has-text` 1 |

전달 문서의 추정("`$redirect`·`$csp`·`$removeparam`·정규식·절차형 선택자")과 달리, 거부의 93%는
**`$popup`**이고 파서가 아니라 `url_pattern_index`(팝업 element type·generichide/elemhide activation을
색인하지 않음)가 버리는 것이었다. `$removeparam`은 두 목록에 한 줄도 없다.

## 결과 — 확장 후 (이번 세션 엔진: 옵션 전처리 + 보조 색인 + RE2)

| 목록 | 거부 | 남은 내용 |
|---|---|---|
| EasyList | 3,172 → 294 → 72 → **0** | 마지막 72(`:has(…:has-text())` 중첩 65 · `:-abp-properties` 7)는 원본 엔진 adblock-rust 0.13.3에 직접 넣어 보니 전부 "일반 선택자"로 통과시킨다(`adblock-rust-check/`). 포크도 같게 통과 → 브라우저 CSS 파서가 조용히 버림(원본과 동일) |
| EasyPrivacy | 49 → 6 → **1** | `~document,~subdocument` 1줄 — adblock-rust도 `NegatedDocument`로 거부한다. 포크도 거부(동일) |

(`#?#` 줄 255개가 URL 규칙으로 잘못 파싱되던 것을 `##`로 정규화해 선택자로 다루도록 고침. 정규식 `$popup` 4건도 지원.
절차형 227줄은 `aside_adblock_procedural.cc`가 원본 스크립트의 규칙 JSON으로 변환 — `has-text`·`matches-attr`·`matches-css(-before/-after)`·
`matches-path`·`min-text-length`·`upward`·`xpath` + 동작 `style`·`remove`·`remove-attr`·`remove-class`, 원본 스크립트의 ALLOWED_OPERATORS/ACTIONS 그대로.)

## 새로 처리하는 문법 → 구현 위치

| 문법 | 처리 | 위치 |
|---|---|---|
| `$popup` (2,938+4) | 보조 색인(popup→subdocument) + 정규식. 열린 창의 첫 탐색에서 평가, 차단 시 창 닫음 | `aside_adblock_navigation_throttle.cc` `EvaluatePopup` |
| `$generichide` / `$elemhide` (168) | 보조 색인(→`$document` 활성화). generic 선택자만/전부 끔 | `Engine::HidingStylesheet` |
| 정규식 `/…/` (36+4) | RE2(대소문자 무시), 옵션(type·third-party·domain)은 파서 결과 사용 | `Engine::RegexRuleMatches` |
| `$important` (10) | 별도 색인, 예외보다 먼저 판정 | `Engine::Evaluate` 1단계 |
| `$redirect` / `$redirect-rule` / `$rewrite=abp-resource:` (30) | 내장 자원(noopjs·nooptext·noopjson·noopcss·noopmp3/mp4·1x1.gif·2x2/3x2/32x32.png…) 또는 manual 디렉터리 `resources.json`(adblock-rust 형식)으로 응답 | `aside_adblock_resources.h`, 프록시 `ResourceLoader` |
| `$csp=` (5) | 문서 응답 헤더에 `Content-Security-Policy` 추가(탐색 URLLoaderFactory 프록시) | 프록시 `NavigationClient` |
| `$method=` (1) | 별도 색인 + 요청 method 대조 | `Engine::Evaluate` 3단계 |
| `#?#` | `##`로 정규화(절차형 의사클래스는 여전히 거부) · `#$#`/`#%#`는 unsupported feature | `NormalizeCosmeticRule` |

근사(정직 표기): 대리 스크립트(`chartbeat.js`·`googletagmanager_gtm.js`·`fingerprint2.js` 등 uBO surrogate)는 내장하지 않고
빈 스크립트로 응답 — 원본은 adblock-rust 자원 라이브러리를 씀. `resources.json`을 manual 디렉터리에 두면 그대로 덮어쓸 수 있다.
