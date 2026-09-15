# Belmont 팀 정식 세팅 가이드 (2026-09-14)

> 목적: Belmont(비서실장/유일 창구) + 실무 봇 5명으로 구성된 "회사 같은 팀"의 정식 운영 세팅.
> 새 기능을 만든 게 아니라, 이미 있는 Aside/Grok-bot 게이트웨이 안에서 최적 세팅을 정한 것.
> 원칙 근거: OpenAI 블로그 "rethinking skills and prompts for GPT-6 Astra" + 각 모델 공식 특성 + GPT Pro 자문.

---

## 1. 결론 — 팀 한 장 요약

| 봇 | 모델 / effort | 한 줄 역할 | id(앞 8자리) |
|---|---|---|---|
| **Belmont** | gpt-6-astra / xhigh | 비서실장·유일 창구. 우선순위·배정·마무리 책임 (직접 손발 X, 팀을 굴림) | 40fb61e3 |
| **Steward** | gpt-5.6-luna / medium | 일상·살림 총괄 — 식단·장보기·생필품 재주문·나들이/외식 후보·예약 초안·리마인더 (고기 선호, 콩 제외, 쿠팡·대형마트) | 8ab6bb82 |
| **Ledger** | gpt-5.6-luna / medium | 3거래소(업비트·빗썸·바이낸스) 잔고 대조 장부. 읽기·기록만 | b5d93ee7 |
| **Quant** | gpt-5.6-sol / high | 투자·트레이딩 가설 검증·전략 연구 (실집행 X) | a5f60ebb |
| **Dev** | gpt-5.5 / high | Belmont·시스템 코드·설정 구현/시험 | bc0fa054 |
| **Auditor** | gpt-5.6-sol / high | 중요 결과(코드·자산·전략)의 독립 검증 | 6ca22315 |

- **고정 로스터**(6명)로 시작. 봇이 봇을 무한 생성하는 방식은 쓰지 않는다 — 필요하면 Belmont가 사용자 승인 후 추가.
- 사용자 창구는 **Belmont 하나**. 나머지 5명은 Belmont하고만 대화한다.

---

## 2. Belmont 운영 원칙 (Astra 최적화)

**핵심 정의: Belmont는 "직접 손발을 움직이는 분신"이 아니라 "팀의 손발을 움직여 일을 끝내는 분신".**
(저장소 전체 검색·파일 수십 개 읽기·코드 수정 같은 무거운 도구 작업은 워커 몫. Belmont가 그걸 다시 반복하면 분업 이점이 사라진다.)

| 축 | Belmont | 실무 봇 |
|---|---|---|
| 목표 | 사용자 의도 이해 → 무엇을 끝낼지 결정 | 맡은 목표를 산출물로 완성 |
| 계획 | 우선순위·담당자·순서·완료기준 결정 | 담당 업무의 실행 방법 결정 |
| 실행 | 배정·취소·재배정·승인요청 | 검색·브라우저·파일·계산·코딩 |
| 검증 | 근거·검수 결과로 완료 판단 | 시험 실행·원문 대조·계산 검증 |
| 보고 | 종합해 사용자에게 결론+판단 | Belmont에 결과·근거위치·누락·위험 |

**Belmont가 직접 하는 것**: 몇 번의 도구 호출로 끝나는 조회·판단·초안, 건강·아들 교육 같은 민감한 판단, 그리고 모든 최종 결정.
**워커에 맡기는 것**: 위 표의 전문 작업. 일상·살림 legwork(식단·장보기·생필품·나들이·예약초안·리마인더)는 Steward가 실행하고 Belmont가 골라 마무리한다.
**끝까지 책임**: "실행해줘"는 실행·확인·수정까지가 요청. 워커가 실패해도 그대로 사용자에게 넘기지 않고, 승인된 범위에서 재배정하거나 대안으로 마무리한다. 결제·외부연락 같은 경계만 사용자에게 올린다.

**권한(safe-zone 방식)**: 승인된 읽기·조사·계산·초안·개인폴더 수정·비파괴 시험은 스스로. 되돌리기 어려운 것 — 결제·매매·이체·외부연락·게시·예약·운영환경 변경·파괴적 삭제 — 만 "이렇게 할게요" 한 줄 확인.

**Astra 원칙 적용**: 사전작업 체크리스트·중복 검증 독려 제거(Astra는 스스로 검증), 과잉 명세 제거, 매 작업마다 전체 저장소 선로딩 금지(필요한 것만 읽음), 종료조건 명시(일찍 멈추지 않게).

---

## 3. 모델 배치 근거

| 봇 | 모델 | 왜 이 모델 |
|---|---|---|
| Belmont | gpt-6-astra / **xhigh** | 최상위 조율·판단. xhigh가 가성비 최적(커뮤니티 합의). 실패 반복·다단계 재배정 판단이 필요할 때만 max로 올린다. |
| Steward, Ledger | gpt-5.6-luna / medium | 정형 업무(일상·살림 정리·잔고 표 만들기). 추론모델이지만 난이도가 낮아 medium으로 토큰 절약. |
| Quant, Auditor | gpt-5.6-sol / high | 가설 검증·독립 검수는 논리·반례가 핵심 → 더 강한 추론(sol) + high. |
| Dev | gpt-5.5 / high | 코드 구현·시험. 코딩 안정성 위주. |

> 원래 사용자 요청: "Belmont=Astra, 나머지는 OpenAI 모델로만." Grok은 못 쓰므로 전 봇을 OpenAI 계열로 채움.
> gpt-6-astra는 게이트웨이 기본 목록에 없어 `scripts/ensure-astra-model.mjs`로 추가함(§6).

---

## 4. 봇 ↔ Belmont 토큰 프로토콜 (누락 없이, 폭증 없이)

전송은 `SendToAgent`(텍스트, 비동기 fire-and-forget). 큰 데이터를 본문에 그대로 넣으면 토큰이 폭증한다. 규칙:

1. **원자료는 파일에 저장, 본문엔 참조만.** 워커는 결과 원문을 파일로 저장하고 Belmont에는 **결론 + 근거 파일 위치 + 누락/위험**만 보낸다. Belmont는 필요할 때만 그 파일을 연다.
2. **본문 = job 봉투(envelope).** 위임은 `[job:<짧은id>]`로 시작, 목표·완료기준·권한·자료참조·반환형식만 담는다. 회신도 같은 태그.
3. **완전성 표기 의무.** "세 곳 중 두 곳 확인"처럼 빠진 것을 반드시 밝힌다. 실패를 성공이나 0으로 합치지 않는다.
4. **후속 1회 제한.** 결과가 부족하면 같은 태그로 한 번만 되묻고, 그래도 부족하면 Belmont가 직접 끝내거나 무엇이 빠졌는지 보고.
5. **폴링 금지.** 전송 수락 ≠ 완료. 결과는 별도 턴으로 온다.

---

## 5. 세션 관리 정책 (캐시 히트 ↑, 맥락 무손실, 자동)

Belmont가 사용자 무신경하게 자동 판단:

| 롤오버 기준 | 동작 |
|---|---|
| 작업 경계(한 job 묶음이 닫힘) | 새 세션 시작에 자연스러운 지점 |
| 맥락이 길어져 응답이 느려질 때 | job 장부(open/returned/approved/closed) + 요약을 남기고 새 세션으로 이월 |
| 안정 프리픽스 유지 | 시스템 프롬프트·팀 구성 같은 고정부는 그대로 둬 캐시 히트를 살림 |

- **무손실 이월**: `update_state`의 job 상태 + 짧은 요약으로 넘긴다. 원자료는 이미 파일에 있으니 다시 안 옮긴다.
- "몇 턴마다 무조건 새 세션" 같은 마법 숫자는 쓰지 않는다 — 위 신호로 판단.

---

## 6. 재현 / 유지보수

| 항목 | 명령 / 파일 | 비고 |
|---|---|---|
| astra 모델 목록 추가 | `npm run codex:astra` (= `scripts/ensure-astra-model.mjs`) | **npm install / wsl:setup 후 반드시 재실행** (기본 목록이 복원됨). 이후 게이트웨이 재시작. |
| 워커 로스터 생성 | `belmont-browse/tools/eval-verify/create-roster.py` | 멱등(clientNonce). 이름·모델·프롬프트의 정본. |
| Belmont 매니저 지정 | `npm run belmont:manager` | `manager.json`에 Belmont id 기록(현재 40fb61e3). |
| 게이트웨이 재시작 | `npm run wsl:start` | 재시작 시 discovery 포트가 바뀜(gateway.json 확인). |

- Belmont `updateAgent`는 profile에 **name도 함께** 보내야 한다(description만 보내면 500).
- 워커 회신 읽기: 답변은 `kind:"send-message"`의 `message.content`에 들어감(top-level content 아님).

---

## 7. 테스트 초기화 (완료)

**유지(6)**: Belmont, Steward, Ledger, Quant, Dev, Auditor.

**삭제 완료(13, 테스트/중복 봇)**: 브라우저, 모바일 테스트 봇, 모바일 테스트 그룹, Tech Demos, Personal Tech Demos Verification, 딥시크, QA Bot, Scribe, Clerk, Research Bot, Coding Bot, New Agent(subagent), Grok.

- **백업(복원 가능)**: `~/belmont-roster-backup-2026-09-14/` (tar + MANIFEST + Grok 메모리 readable). 복원은 tar를 sand-data에 풀고 게이트웨이 재시작.
- **Grok**: "실메모리"를 확인해보니 전부 테스트/데모 로그(날씨 데모·approval-test 파일·파이썬 튜토리얼)라 개인 정보 아님 → Belmont 이관 없이 백업만 보관 후 삭제.

---

## 8. 폭주 방지 · 안전 모델 (코드로 강제되는 것 vs 프롬프트뿐)

> GPT 검토 원칙: "강제 못 하는 제한을 '설정 완료'라 표시하지 마라." 아래는 소스 코드를 직접 확인한 결과.

**코드로 실제 강제되는 것**
| 상한 | 근거 |
|---|---|
| 봇 총 **50개** 초과 차단 | `session-materialization.ts` `MAX_AGENTS_PER_USER=50` → 초과 시 409. (서브에이전트는 미집계) |
| 서브에이전트는 **자식을 못 낳음**(재귀 증식 원천 차단) | `turn-toolset.ts` — 서브에이전트 턴엔 Task 도구 자체를 안 줌(하드 게이트) |
| computerUse 데스크톱 **동시 1개** | `agent-adapters.ts` 단일 창 락 |
| **워커는 영구 봇 생성·타봇 수정 불가** ← 이번에 설정 | 워커 5명에 `agentToolPolicyByAgentId` = `["CreateAgent","UpdateAgent"]` 적용. `turn-toolset.ts:1824`가 매 턴 이 목록으로 도구를 거름(파일을 매번 새로 읽어 재시작 불필요) |

**워커 차단**: `CreateAgent`, `UpdateAgent` (영구 봇 만들기·남의 봇 수정).
**워커 유지**: `Task`(브라우저 일꾼 aside-browse 등 하청 — 로그인 사이트 탐색에 필요), `CheckSubagent`/`MessageSubagent`/`StopSubagent`(자기 하청 관리), `SendToAgent`(→Belmont 회신), `SendMessage`(코드가 보호), `WebSearch`/`WebFetch`/브라우저 직접 도구.
→ Ledger(거래소 계정)·Steward(쿠팡 탐색)가 스스로 브라우저를 쓰고, 회신·오케스트레이션은 정상.

**웹 접근 경로 정리**
- 간단한 웹(검색·단일 페이지) = `WebSearch`/`WebFetch` (워커 직접).
- 복잡한 웹(로그인·메뉴 탐색·표/대시보드·폼·계정 페이지) = **aside-browse 브라우저 일꾼**(Task로 띄우는 하청, `SAND_ASIDE_BROWSE=1`로 켜져 있음). 이게 "우리한테 물려있는 aside".

**아직 프롬프트뿐 (정직하게 표기)**
- 서브에이전트/브라우저 **동시 실행 수는 코드 상한 없음** — 워커 프롬프트("필요한 만큼만, 팬아웃 금지")와 Belmont 프롬프트(한 작업당 한 명)로만 억제. 단 **재귀(하청이 또 하청)는 코드로 불가**라 눈덩이 폭발은 막혀 있음.
- Belmont↔워커 **재위임·재시도 반복** 코드 상한 없음 — 프롬프트로만 억제.

---

## 9. aside-codemode 도입 판단 (지금은 보류)

GPT 검토 결론: 유용한 "묶음 검색" 도구지만 폭주를 해결하지도, "Aside 50배"를 보장하지도 않음. **현재 Belmont에 설치돼 있지 않음**(저장소·npm·`~/.aside/u/0` 어디에도 없음) → 당장의 위험 없음.

도입한다면 순서와 조건:
1. **자동 등록 스크립트 실행 금지** — 기존 허용 폴더를 홈 전체로 덮어씀(검증된 동작: `roots:["/home/demo/approved-project"]` → `["/home/demo"]`). 운영 프로필에 절대 실행하지 않음.
2. **승인된 프로젝트만 roots**로 명시(`--config`+`--cwd`), 홈·인증 폴더 금지.
3. **반환량 제한** 시작값: 출력 16KiB, 실행 30초, 검색 결과 수 제한.
4. **읽기 전용은 OS/샌드박스로 강제** — codemode의 excludeGlobs·vm은 보안 경계가 아님. 쓰기/편집 API 존재.
5. 도입은 "Aside 전역 대체"가 아니라 "**승인된 프로젝트의 묶음 검색 스킬**"로 좁게. 단일 파일 확인엔 강제하지 않음.

부속 초안: 검토 zip의 `BATCH_SEARCH_SKILL.md`(제한된 로컬 묶음 검색 스킬 초안), `codemode.config.example.json`(roots를 실제 승인 경로로 교체해 사용).
