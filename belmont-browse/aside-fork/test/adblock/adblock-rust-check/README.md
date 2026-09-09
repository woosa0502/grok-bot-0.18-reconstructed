# 원본 엔진(adblock-rust)으로 남은 규칙 72줄 대조 (2026-09-05)

포크가 "unsupported selector"로 거부하던 EasyList 72줄(`:has(…:has-text())` 중첩 65 + `:-abp-properties` 7)을
원본이 쓰는 엔진 **adblock-rust 0.13.3**(crates.io 최신)에 그대로 넣어 봤다. `cargo` 프로젝트: `Cargo.toml` + `main.rs.txt`(→ `src/main.rs`).

```
cargo build --release && ./target/release/abrs rejected.txt
```

결과(`result-adblock-rust-0.13.3.txt`): **72줄 전부 accepted, 거부 0, procedural_actions 0** — 전부 `hide_selectors`(일반 CSS 선택자 문자열)로 나온다.
이유는 `src/filters/cosmetic.rs::validate_css_selector`: 절차 연산자 검사가 최상위 compound만 훑고 `:has()` 안쪽은 보지 않아
"절차 연산자 없음 → 일반 CSS"로 분류한다. 원본 요소 숨김 스크립트는 이 문자열을 `CSSStyleSheet.replaceSync`에 넣고, 브라우저 CSS 파서가
`:has-text`/`:-abp-properties`를 모르는 의사클래스로 버린다(`reviewStandardSelectors`의 `querySelectorAll` 예외 → 선택자 삭제).
즉 원본도 이 72줄을 **실행하지 못하지만, 오류로 세지도 않는다**.

포크도 같게 맞췄다(`aside_adblock_procedural.cc`): 최상위 절차 연산자가 없으면 일반 선택자로 통과. 분류 도구 거부 EasyList 72 → 0.

## 버전 의존성 확인 (원본이 어느 버전을 쓰는지 바이너리에 안 남아 있음)

| adblock-rust | 실행 결과(72줄) | 근거 |
|---|---|---|
| 0.13.3 | 72 plain hide · 0 procedural · 0 거부 | 실행 |
| 0.12.1 | 72 plain hide · 0 procedural | 실행 |
| 0.11.0 | 72 plain hide · 0 procedural | 실행 |
| 0.10.0 · 0.9.0 | 같은 `validate_css_selector`(최상위만 검사) + `NegatedDocument` 존재 | 소스 대조 |

0.9.0부터 최신까지 판정 논리가 같다. 원본이 그 사이 어느 버전이어도 결론은 바뀌지 않는다.
