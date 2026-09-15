# Belmont Memory 2.1 실행 검증 보고서

작성일: 2026-09-11. 기존 Memory 2.0에 대한 증분 구현이며, 이전 결과는 `baseline-2.0/`에 보존했다.

## 1. 판정

**157/157 테스트 통과, 실패·skip 0. 기존 61개 회귀 테스트의 네 파일은 SHA-256까지 동일하다. 추가 테스트는 96개다.**

이 결과는 reference kernel과 실제 localhost HTTP 계약 테스트의 결과다. Belmont 전체 앱, 실제 Aside 브라우저, 실제 사이트 작업을 검증한 결과가 아니다. 특히 **실제 다국어 신경 임베딩 추론은 실행하지 못했으므로 dense의 의미 검색 개선량은 미측정(null)** 이다. 커널의 폐쇄 루프는 실행되지만 요청한 P0 전체를 production 완료로 판정하지 않는다.

환경: Node v22.16.0, TypeScript Version 5.8.3, Linux. 실제 저장소가 요구하는 Node 26.5.x와 `npm run check`, `npm run frontend:build`는 실행하지 않았다.

## 2. 테스트 범위

기존 61개는 transaction/CAS, explicit 보호, tombstone, lineage 삭제, outbox, migration, frozen prompt, 절차 평가 기준을 그대로 검사한다. 신규 테스트는 원문 span 추출·분류, 5종 기억, 시간 수정, 관계/규칙 누적, 중복, context 분리, 다중 절의 불확실성, DB 재오픈, actual vector SQL/HTTP, fallback, 모델 변경, hierarchy/graph, Aside ingestion, 절차 승격/실패, action argument 적용을 검사한다.

실제 HTTP 요청을 사용한 테스트와 실제 서비스 검증을 구분한다. 임베딩 HTTP 테스트 서버는 `test-geometric-vectors-NOT-a-semantic-model`이라는 명시적 테스트 대역이다. 이 결과로 한국어 의미 검색의 성능을 주장하지 않는다. 항공 도구 HTTP 서버도 reference contract이며 실제 항공사/API가 아니다.

Python E5 서버는 syntax compile만 실행했다. 모델 로딩, tokenizer 실행, torch forward는 미실행이다. `BELMONT_REQUIRE_DENSE=1` 평가 실행은 모델이 없어서 의도대로 exit 1로 끝났으며 `results/strict-dense-gate.txt`에 남겼다. 이를 정상 dense 평가 통과로 계산하지 않았다.

## 3. 비교 방법

A는 현재 GitHub에서 확인한 `knowledge-store.ts`의 query 생성·CJK·prefix·BM25 가중치를 옮긴 호환 구현이다. 실제 Belmont host 프로세스는 아니다. A1은 이전 2.0 커널의 FTS 경로다. A와 A1의 token/prefix 차이를 숨기지 않기 위해 모두 남겼다. B와 A1이 query planning의 직접 비교다.

모든 모드는 같은 canonical corpus, 같은 qrels, 동일한 packet/evidence 구조와 4,096 추정 토큰 예산을 사용한다. Recall/nDCG는 반환 memory ID 기준, evidence precision은 실제 context packet에 확장된 memory의 정답 비율을 answerable 질의에서 macro-average한 값이다. 문장별 entailment를 독립 판정한 지표는 아니다. 기권은 unanswerable 질의에서 후보가 빈 결과인 비율이다. 생성 모델의 정답/기권 성능은 측정하지 않았다.

각 질의 1회 warm-up 후 3회 실행했다. p50/p95는 전체 warm query 측정의 분위수다. in-memory SQLite, 작은 corpus이며 모델 cold start·네트워크·디스크·실서비스 동시부하는 제외된다. 토큰은 UTF-8 bytes/4 추정값으로 실제 LLM tokenizer 토큰이 아니다. nDCG@10과 질의별 결과는 JSON에 포함했다.

**C의 숫자가 B와 같다는 것은 dense 개선이 0이라는 뜻이 아니라, 모델이 없어 sparse fallback을 실행했다는 뜻이다. D/E도 dense가 없는 상태에서 hierarchy/graph만 추가한 측정이다. 완전한 dense ablation은 아직 없다.**

## 4. 실제 저장소 내용 기반 평가

GitHub에서 다시 읽은 네 파일의 38개 발췌문과 사람이 작성한 32개 질의(28 answerable, 4 absent)를 사용했다. 각 발췌문에 source path/blob SHA가 있다. 질의는 독립 holdout이 아니라 개발용 fixture다. 사용자의 개인 대화나 실제 운영 메모리 데이터가 아니다.

| 구성 | Recall@5 | Recall@10 | nDCG@5 | 근거 precision | 기권 | p50/p95 ms | 문맥 토큰 추정 |
|---|---:|---:|---:|---:|---:|---:|---:|
| A 기존 Belmont FTS 동작 호환 포트 | 0.7143 | 0.7500 | 0.6879 | 0.3372 | 0.50 | 0.561/2.217 | 1259.3 |
| A1 기존 2.0 커널 FTS | 0.7143 | 0.7143 | 0.6832 | 0.2177 | 0.25 | 1.117/2.790 | 1475.8 |
| B + query planning | 0.8571 | 0.8571 | 0.8261 | 0.5512 | 0.75 | 0.855/1.800 | 570.5 |
| C + dense 요청 → 미가용/fallback | 0.8571 | 0.8571 | 0.8261 | 0.5512 | 0.75 | 0.807/1.743 | 570.5 |
| D + hierarchy (dense 미가용) | 0.8571 | 0.8929 | 0.8129 | 0.5554 | 0.75 | 1.777/4.073 | 595.4 |
| E + graph (dense 미가용) | 0.8571 | 0.8929 | 0.8129 | 0.5554 | 0.75 | 1.838/4.517 | 595.4 |


A→B Recall@5는 71.43%→85.71%, **+14.29 percentage points**다. 이것은 query planning/호환 rerank의 이득이지 신경 dense의 이득이 아니다. Exact fact 범주는 A와 B 모두 Recall@5=1.0이다.

Hierarchy는 Recall@10에 일부 이득이 있지만 nDCG@5가 내려간다. Graph의 추가 recall 이득은 없다. 두 기능을 기본 활성화할 근거는 부족하다.

## 5. 학습·다중 세션 평가

16개 작성 대화 turn으로 13개 episode segment, 14개 memory commit을 만들었다. 이 숫자는 활성 기억 수가 아니라 commit 수이며 이후 temporal 종료도 포함한다. 추가 긴 원문 fixture와 측정 절차 fixture도 별도로 넣었다. 질의 20개는 16 answerable/4 absent이며 exact, Korean lexical/morphology/paraphrase, semantic paraphrase, temporal, relation, procedure, action cue를 포함한다.

| 구성 | Recall@5 | Recall@10 | nDCG@5 | 근거 precision | 기권 | p50/p95 ms | 문맥 토큰 추정 |
|---|---:|---:|---:|---:|---:|---:|---:|
| A 기존 Belmont FTS 동작 호환 포트 | 0.6562 | 0.6562 | 0.6047 | 0.4427 | 0.75 | 0.209/0.750 | 260.9 |
| A1 기존 2.0 커널 FTS | 0.5938 | 0.5938 | 0.5778 | 0.4271 | 0.75 | 0.384/0.979 | 279.4 |
| B + query planning | 0.7500 | 0.7500 | 0.6988 | 0.4729 | 1.00 | 0.372/1.844 | 331.0 |
| C + dense 요청 → 미가용/fallback | 0.7500 | 0.7500 | 0.6988 | 0.4729 | 1.00 | 0.438/1.862 | 331.0 |
| D + hierarchy (dense 미가용) | 0.7500 | 0.7500 | 0.6758 | 0.4729 | 1.00 | 0.529/2.048 | 331.0 |
| E + graph (dense 미가용) | 0.7500 | 0.7500 | 0.6708 | 0.4417 | 1.00 | 0.528/2.244 | 348.8 |


A→B Recall@5: 65.62%→75.00% (**+9.38pp**). 그러나 영어 semantic paraphrase 3개와 한국어 paraphrase 1개에서는 B도 Recall@5=0이다. 어휘 cue와 조사 정규화만으로 의미적 간극을 해결하지 못한다는 실제 실패 사례다. 이 실패를 테스트 fixture에서 제거하지 않았다.

## 6. 행동 적용 평가

동일하게 학습된 원자 기억·동일 grounder를 유지하고 retriever만 교체했다. 따라서 아래 FTS 6/8은 기존 Belmont agent의 실제 행동 점수가 아니다.

| 비교 | 통과/사례 |
|---|---:|
| 기억 없음 | 2/8 |
| 원본 FTS 호환 포트 + 같은 grounder | 6/8 |
| 2.0 커널 FTS + 같은 grounder | 6/8 |
| query planning + 같은 grounder | 8/8 |
| dense 요청/fallback | 8/8 |
| hierarchy | 8/8 |
| graph | 8/8 |

8개는 최신 명시 수정, 단/장거리 context, 현재 요청 우선, 불명확한 context의 적용 보류, 출장/휴가 호텔, 관계 continuity, 측정된 절차 재사용이다. 별도 unit/integration 테스트는 실제 HTTP 항공 도구 인자에 통로석/가격 tradeoff를 전달하고, 명시 수정 후 창가로 변경하는 것까지 검사한다. 항공편 예약·결제는 하지 않는다.

주요 수정: 통로석에 한해 더 지불한다는 근거를 창가 선호로 수정한 뒤에도 무조건 적용하지 않는다. tradeoff에 seat context를 보존하고 선택된 좌석과 일치할 때만 전달한다.

## 7. 경험 피드백과 문맥 축소

Aside 호환 클라이언트→실제 localhost API→canonical evidence/episode/knowledge→trusted evaluator→procedure 경로를 실행했다. 200쌍 procedure evaluation 입력은 결정적 fixture이지 실제 사이트 200회 측정이 아니다. 측정 runner의 callback 실행 및 AB/BA 교대는 별도 테스트했다.

실패 condition을 기록하기 전에는 절차 재사용이 허용됐고, `selector_missing` 실패 후 동일 조건에서는 dispatch가 차단됐다. 이것은 **나쁜 절차의 재현 방지**이지 자동으로 새 절차를 발명하여 작업 성공을 복구했다는 뜻은 아니다.

긴 evidence 한 건에서 같은 memory ID를 유지하며 원문 span만 확장한 packet은 6,870→990 bytes, **85.59% 감소**했다. 반복적인 주변 문장이 많은 하나의 fixture이며 전체 long-session hierarchy 개선율로 일반화하지 않는다.

## 8. 실제 실행 명령

```bash
# 배포 ZIP에 포함된 dist로, npm 설치 없이 실행
node --test tests/*.test.mjs
node bench/ablation.mjs
node bench/closed-loop.mjs
node examples/closed-loop.mjs

# 소스 수정 이후
npm install
npm run build
npm run test:prebuilt

# 신경 모델 검증을 강제. 모델 미가용/timeout이면 실패한다.
BELMONT_REQUIRE_DENSE=1 node bench/ablation.mjs
```

빌드/테스트 원문은 `results/all-current.tap`, 결과별 query/qrels/ranking은 두 `*-ablation.json`, 실행 범위는 `results/verification-manifest.json`을 기준으로 한다. UUID와 warm latency는 실행별로 달라질 수 있다.

## 9. 남은 검증 gate

실제 pinned E5 서비스로 두 benchmark를 실행하고, independent held-out 개인 replay에서 B→C의 semantic recall 이득·exact 비열화·기권을 동시에 검증해야 한다. threshold 0.86은 현재 임시 설정이지 E5에 대해 calibration을 마친 값이 아니다. 모델 이름만 붙인 성공 판정은 금지한다.

실제 Belmont host hook/도구 schema adapter 연결, Aside executor 연결, browser end-to-end, Node26.5.x 전체 회귀는 별도 미완료 항목이다. 문서와 코드에 이 경계를 표시했다.

최종 패키지 검사: ZIP을 별도 디렉터리에 풀고 node_modules/npm 설치 없이 사전 빌드 코드로 157개 테스트를 재실행하여 통과했다. 파일별 SHA-256 검증도 통과했다. 증분 patch를 변경하지 않은 2.0 패키지에 적용하고 재빌드한 경우도 157개 테스트가 통과했다.
