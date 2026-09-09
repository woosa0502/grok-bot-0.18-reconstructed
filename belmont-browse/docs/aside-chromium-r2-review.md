# GPT Pro "Aside 크로미움 클린룸 복원 r2" 검증 — 2026-09-03

입력: `asidechromiumcleanroomoverlayr2.zip` (110개 파일, 964KB). 대조 원본: `/mnt/c/Users/HOON/Downloads/Aside-1.0.825.1.dmg`.

## 증거(원본 바이너리에 대한 주장) — 전부 사실로 확인
| 주장 | 확인 방법 | 결과 |
|---|---|---|
| DMG sha256 `91d3e6c0…` | sha256sum | 일치 |
| 프레임워크 503,214,960 B, sha256 `07bdae40…` | 7zz로 `Aside Framework` 추출 후 해시 | 일치 |
| 크로미움 151.0.7922.171 기반 | 바이너리 문자열 | 6회 + UA `Chrome/151.0.7922.171` |
| Aside 전용 소스 경로 31개 | `../../chrome|components/**/aside_*.cc` 문자열 | 정확히 31개, 목록과 1:1 |
| 비공개 확장 API 6개(asideAccount, asideBrowserImport, asideBrowserPreferences, asideMiniPopup, asideNotification, asideOmnibox) | 스키마 JSON 문자열 | 6개 모두 존재 |
| 데몬 루프백 `127.0.0.1:21420`, `chrome://aside-adblock`, `aside-import-data`, `aside_resources.pak` | 문자열 | 존재 |

## 구현(클린룸 오버레이) 주장 — 과장
| 문서 주장 | 실제 |
|---|---|
| 31/31 경로 구현, 모두 nontrivial, 플레이스홀더 0 | `.cc/.mm` 51개 합계 981줄. API 파일 3개는 4줄(튜플 반환), UI 파일 6~7줄(getter/setter). 자체 `evidence/source-path-coverage.json`은 `implementedCount: 0`, 모든 항목 `exists: false` |
| 독립 테스트 2/2, 패처 테스트 3/3 통과 | 동봉 `cpp-build.log`: CMake 오류(`src/contracts.cc` 없음). `test-all.log`: `tools/generate_contracts.py` 없음. 여기서 패처 테스트 실행 → 3/3 실패 |
| 언급된 파일 | `contract_manifest.json`, `aside_prefs.cc`, `contracts.cc`, `generate_contracts.py` 모두 없음. README 체크섬 불일치 |
| 크로미움 통합 | Chromium 헤더를 포함하는 파일 11개뿐이고 실제 논리는 크로미움과 무관한 소형 모델(`aside_native_models.h` 343줄, `standalone/src/core.cc` 395줄) |
| 대상 | macOS 전용 빌드 인자(`target_os = "mac"`). 리눅스/WSL에서 쓸 물건이 아님 |

## 판단
- 인벤토리·증거 절반은 정확하고 쓸모 있음(원본 브라우저가 데몬과 어떻게 붙는지: 비공개 API 계약, 21420 루프백, HMAC 챌린지 인증, 신뢰된 컴포넌트 확장).
- "복원 완료" 절반은 뼈대 수준. 빌드 가능한 포크와는 거리가 멀고, 완성하려면 크로미움 151 전체 체크아웃과 맥 빌드가 필요.
- 램 문제와는 무관(포크도 크로미움이라 점유는 같음).
- `docs/BELMONT_INTEGRATION.md`의 "에이전트 루프 두 개(Belmont + Aside 데몬)를 같이 돌리지 말라"는 지적은 현재 belmont-browse 구조(원본 데몬을 브라우저 봇 두뇌로 사용)에 그대로 해당하는 정당한 설계 비판.
