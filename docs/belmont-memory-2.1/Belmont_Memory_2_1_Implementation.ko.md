# Belmont Memory 2.0 → 2.1 증분 구현·적용 계획서

작성일: 2026-09-11. 목적은 정합성 계층을 다시 만드는 것이 아니라 **경험→기억→검색→행동 인자→결과 학습**의 실행 경로를 기존 커널에 더하는 것이다.

## 1. 최종 판정과 산출 범위

기존 커널에 실행 가능한 dreaming, hybrid 검색 경로, action grounding, Aside 경험 API·procedure loop를 추가했다. **157개 테스트 통과(기존 61개 그대로 + 신규 96개)**. 로컬 reference loop와 HTTP 계약은 실행됐다.

다만 실제 다국어 pretrained model 추론, 실제 Belmont host/runner 배선, 실제 Aside/browser 실행은 하지 못했다. 따라서 P0 전체의 production 완료가 아니라, **검증된 bounded reference implementation + 미실행 production adapter + 실제 host 배선 후보**다. 실제 dense semantic 향상 수치는 없다.

## 2. 유지한 것

Belmont canonical authority, SQLite ledger, evidence/revision/dependency/tombstone, transaction/CAS/idempotency, transactional outbox, 기존 FTS5/CJK/BM25, legacy tombstone 우선 이관, explicit와 inferred 구분, frozen prompt 삭제 key를 유지했다. 기존 61개 테스트 소스 파일은 변경하지 않았다. 전체 커널을 교체하지 않고 기존 repository에 optional structured details와 keyset scan을 추가했다.

기존 policy를 없애지 않았다. 신뢰된 host consolidator에 한해, 사용자 원문으로 재검증 가능한 직접 진술을 `agent_inference + assertion:stated`로 저장한다. `explicitMemory`는 agent tool argument가 아니라 host가 확인한 사용자 동의 경로에서만 true가 되어야 한다. 실제 host 배선이 이 계약을 강제해야 한다. 임의의 inferred personal attribute는 기존 review 경로를 유지한다.

## 3. 저장소 감사 결과와 변경 경계

현재 GitHub에서 `agent-state.ts`, `knowledge-store.ts`, `sand-memory.ts`, `AGENTS.md`를 다시 읽었다. SHA와 이전 감사 자료의 freshness는 `docs/repository-audit.json`에 남겼다. 기존 remember의 explicit 표시, FTS5/CJK 가중치, prompt 구조는 그대로 확인되었다. 이번에 다시 읽지 않은 이전 source는 새 감사로 표시하지 않았다.

`AGENTS.md`의 Node 26.5.x, `npm run check`, `npm run frontend:build`가 최종 host 병합 기준이다. 이번 환경은 Node22이고 full checkout/CI를 실행하지 않았다. Aside 연결 저장소 검색은 두 페이지 모두 결과가 없었다. 추측한 learn/measure 파일을 수정한 것처럼 표시하지 않는다.

## 4. 증분 architecture

```text
인증된 Belmont 사용자 turn
  → MemoryLearningHostHooks (episode buffer / epoch)
  → DreamingEngine
  → extractive atomic facts + temporal resolution
  → 기존 MemoryKernel transaction
  → evidence / item / revision / details / FTS / outbox

Query + authenticated scope + task context
  → intent / type / as-of plan
  → 기존 sparse + optional E5 dense index
  → weighted RRF / literal pin / deterministic rerank
  → canonical revalidation
  → original evidence/span packet
  → field-whitelisted action grounder
  → reference tool dispatch

Aside trajectory/outcome
  → scope-bound HTTP ingestion
  → canonical episode / site knowledge / candidate evidence
  → trusted paired measurement → procedure gate
  → accepted/rejected procedure
  → outcome feedback / failure conditions → next execution selection
```

Working memory는 host의 일시적 turn buffer이며 durable item으로 자동 승격하지 않는다. automation/task lifecycle은 기존 scheduler 정본에 남긴다. 이번 모듈은 task를 자동 생성하거나 계획을 완료된 사건으로 바꾸지 않는다.

## 5. 실제 변경 파일

| 경로 | 역할 | 이번 실행 |
|---|---|---|
| `src/repository.ts`, `schema.ts`, `types.ts`, `policy.ts` | 기존 커널의 additive details/migration/typed commit | 기존+신규 테스트 |
| `src/semantic/embedding.ts` | model/revision/recipe 검증 HTTP adapter | 실제 HTTP + geometric 대역 |
| `services/e5_server.py` | 실제 E5 tokenizer/torch mean-pooling/L2 | syntax만; 모델 추론 미실행 |
| `src/semantic/vector-index.ts` | SQLite float32 cosine, rebuild, outbox | 실제 SQL/동기화 테스트 |
| `src/semantic/planner.ts`, `retriever.ts` | 의도/시간/cue, RRF, rerank, packet | 두 benchmark |
| `src/semantic/navigation.ts` | episode anchor와 bounded typed graph | 테스트/ablation; 기본 off |
| `src/learning/extract.ts`, `validate.ts`, `dreaming.ts` | 원문 span/분류/검증/시간 변화 | 다중 세션 테스트 |
| `src/learning/action.ts` | action field 적용, source binding | 실제 localhost tool HTTP |
| `src/learning/runtime.ts`, `host-hooks.ts` | host composition/lifecycle hook | reference 통합 |
| `src/experience/loop.ts`, `http.ts` | 경험 수집/평가/피드백/API | 실제 localhost HTTP |
| `integration/source/.../memory-learning-runtime.ts` | Belmont 경로에 맞춘 additive overlay | layout fixture typecheck |
| `integration/aside/belmont-experience-client.mjs` | Aside용 executable HTTP client | 동일 API 계약; 실제 Aside 미연결 |

## 6. Schema와 migration

기존 schema version 1에 `memory_details(item_id, payload)` 한 개의 STRICT 테이블을 추가하고 meta version을 2로 올린다. `MemoryKernel` constructor가 transaction 안에서 실행한다. 구조화 payload는 canonical item의 일부이며 별도 독립 truth가 아니다. revision snapshot에도 details가 들어가고 forget/delete는 기존 closure와 함께 details를 제거한다. 기존 item은 details 없이 읽을 수 있다.

`docs/schema-v2.sql`은 실행 코드에서 추출한 schema이고 `docs/migration-v1-v2.sql`은 참고용이다. 수동 SQL보다 constructor upgrade를 우선한다. 기존 Markdown 이관 방향, protected legacy/explicit 승격 제한, legacy hash tombstone 우선 처리, 백업과 삭제 barrier 재적용은 바꾸지 않는다.

예시 atomic payload는 다음 형태다. 실제 사용자 사실이 아니라 예시다.

```json
{
  "kind": "atomic", "subject": "user", "predicate": "flight.seat",
  "value": "aisle", "context": {"distance": "long-haul"},
  "observedAt": 1775005200000, "confidence": 0.9,
  "assertion": "stated", "episodeId": "derived-episode-id",
  "extractorVersion": "extractive-ko-en-v1",
  "spans": [{"evidenceId":"e1","start":0,"end":20,"quote":"exact source span"}]
}
```

예시 span offset은 schema 설명용 placeholder다. 실제 코드는 문자열 offset과 quote 일치를 검사한다. validFrom/validTo, authority는 기존 item field에 유지한다. `supersedesId`, `contradictsIds`는 과거 item을 참조한다. source evidence ID를 대신하여 summary text를 근거로 쓰지 않는다.

## 7. Hybrid retrieval 구현과 채택 조건

query planner는 한국어/영어 task cue와 제한된 조사 정규화를 사용한다. 확장어는 query 목록에만 존재하며 저장 API를 호출하지 않는다. scope/type/validity는 sparse SQL과 dense 검색에서 제한한다. retrieval 이후에도 canonical 상태를 다시 읽는다. context는 applicability 판단에서 엄격하게 확인한다.

기존 FTS 채널에 weight 1, expansion 채널 0.3, dense 1 등으로 rank-based fusion을 수행한다. 원래 query의 literal/identifier 매치는 pin하고 sparse 순서를 보존한다. 작은 결정적 compatibility reranker를 사용하며 검색마다 LLM을 호출하지 않는다. sparse가 lexical precision, dense가 paraphrase recall을 담당하도록 경로를 구현했으나 후자의 실측은 아직 없다.

VectorIndex는 canonical item ID/version/scope/type/validity와 normalized float32 vector를 저장하는 **재생성 가능한 SQLite sidecar**다. brute-force cosine이므로 O(Nd)이며 ANN 구현이라고 부르지 않는다. outbox를 읽고 canonical 재검증 후 ack한다. model/revision/recipe 변경 시 rebuild하고 오래된 writer가 다른 모델의 index를 덮어쓰지 못하도록 identity를 검사한다. 여러 independently consuming index가 생기면 지금의 단일 outbox consumer 계약을 재검토해야 한다.

모델 후보는 `intfloat/multilingual-e5-small`이다. official model card의 query/passage prefix, masked mean pooling, L2 normalization, 최대 512 tokens 레시피를 코드로 구현했다. index version은 `cosine-flat-f32-v1`, recipe는 `e5-prefix-mean-l2-512-v1`이다. 이는 최신 최고 모델이라는 주장이 아니라 재현 가능한 multilingual baseline 선택이다. 실제 inference/품질은 미검증이다.

모델 다운로드 가능한 환경에서 실행하는 방법:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r services/requirements.txt
export BELMONT_EMBED_MODEL=intfloat/multilingual-e5-small
export BELMONT_EMBED_REVISION=fd1525a9fd15316a2d503bf26ab031a61d056e98
export BELMONT_EMBED_DIM=384
export BELMONT_EMBED_URL=http://127.0.0.1:8765/embed
python services/e5_server.py
# 별도 터미널에서 위의 환경변수를 동일하게 설정한 뒤:
BELMONT_REQUIRE_DENSE=1 node bench/ablation.mjs
BELMONT_REQUIRE_DENSE=1 node bench/closed-loop.mjs
```

제시한 revision은 공식 모델 저장소의 immutable commit이며 로컬에서 로드해 검증한 revision은 아니다. 일반 benchmark는 실패 시 sparse fallback을 기록하지만 strict mode는 모델/질의 실패를 nonzero exit로 처리한다. threshold 0.86, batch size, timeout은 실제 holdout latency/기권 평가로 calibration해야 한다. 512 token보다 긴 문서의 chunking은 별도 미구현이다.

## 8. Dreaming: 작동 범위와 비범위

`segmentEpisodes`는 session, 30분 gap, 추출 가능한 주제 전환으로 grouping한다. 실제 원문 evidence는 그대로 보관하고 episode anchor는 현재 canonical atomic contents에서 재생성한다. 별도 LLM summary를 truth로 저장하지 않는다.

지원하는 직접 진술은 좌석·가격 tradeoff, 출장/휴가 호텔 우선순위, 카페인 cutoff, 제한된 직업, 동료/친구/배우자, 프로젝트 담당/역할, 명시적 프로젝트/사이트 규칙, 완료/해결/실패 사건이다. episodic/semantic/preference/procedural/knowledge 5종이 실행 코드에 있다. 날짜·숫자·entity·부정 표현은 quote에 보존하며 생성된 personal value는 같은 extractor로 재검증한다.

단일값 slot(예: 같은 context의 좌석 선호)은 이전 validTo를 닫고 새 item을 원자적으로 만든다. 서로 다른 프로젝트 규칙, 여러 동료, 서로 다른 시점의 사건은 누적한다. 같은 slot/value는 중복 commit을 억제한다. explicit correction은 unconfirmed 변화보다 우선하며 이미 보호된 기억에 대한 추론 변경은 deferred다. out-of-order 충돌도 임의 overwrite하지 않는다.

통로석과 창가를 한 문장 안에서 서로 다른 긍정/부정 절로 말한 경우 지금은 해석하지 않고 보류한다. 사용자 의도를 추측해 긍정 선호를 발명하는 것보다 낫다. 카페인 시간도 현재 grammar의 제한된 표현만 처리한다. 모든 자연어 취향·판단 방식·관계를 이해하는 모델은 아니다.

이 구현은 bounded deterministic extractor이지 일반 학습된 NLU 또는 LLM atomic extractor가 아니다. confidence=0.9는 규칙의 표시값이고 empirical calibration 확률이 아니다. 일반적인 preference EMA/latent utility learning, vague temporal resolution, 자동 entity resolution은 미구현이다.

## 9. 실제 행동 적용

`groundAction`은 검색 hits 전체가 아니라 **원문 evidence까지 budget 안에 확장된 packet**만 사용한다. canonical ID/version/time를 다시 확인하고 현재 요청 argument가 이미 있으면 덮어쓰지 않는다. 적용 field는 seatPreference/avoidSeat/pricePriority, hotel priority, recipientName, measured browser steps 등 whitelist다.

장거리 여부는 host/tool이 제공하는 context다. “뉴욕”이라는 단어만 보고 출발지 없이 장거리라고 가정하지 않는다. 이메일·예산 금액을 기억에 없는데 만들어 넣지 않는다. 통로석에 더 지불하겠다는 tradeoff는 seat=aisle context로 저장하여 명시 수정 후 창가에도 무조건 적용하지 않는다.

이 field 이름들은 reference schema다. 실제 Belmont tool registry의 필드로 변환하는 adapter를 연결해야 하며, 지금의 테스트가 실예약 성공을 뜻하지 않는다. 결제·송금 등 행동 권한은 기존 host confirmation을 우회하지 않는다.

## 10. Aside 경험 루프

Aside는 browser trajectory, outcome, siteKnowledge, procedure candidate만 제출한다. `POST /v1/experience`는 서버가 scope/principal을 고정하고 입력으로 authority·approval·trial arrays를 받지 않는다. 후보는 evidence에 남으며 바로 개인 프로필이나 accepted procedure가 되지 않는다.

Belmont trusted evaluator는 기존 `evaluateProcedure`를 사용한다. 기본 gate는 200개 paired input, 충분한 successful pair, 성공 비열화/Wilson 조건, 10% 이상 latency 또는 token improvement, critical failure 제한을 보존한다. 새 절차는 domain/task/precondition/steps/shortcuts/failure conditions/environment/site revision, 성공·실패 count/rate, 측정 median, 검증 시간, supersedes를 가진다.

`measure()`는 caller가 제공하는 실제 executor callback을 AB/BA 순서로 실행하고 wall-clock latency를 잰다. 이것은 실제 Aside evaluator에 붙일 수 있는 코드지만, 이번 200쌍 데이터는 fixture이며 live-site runner를 연결하지 않았다.

feedback는 canonical tool outcome evidence를 추가하고 success/failure·lastVerified·금지조건을 갱신한다. 두 번 이상 실패하거나 critical failure가 있으면 deprecate한다. UI environment가 바뀌면 재사용하지 않는다. median 비용은 현재 최초 paired evaluation의 median이며 rolling 운영 median은 구현하지 않았다. 운영 outcome 개별 latency/token은 evidence에 남는다.

## 11. P1 채택 판단

Hierarchy는 episode anchor→atomic→original span 경로를 구현했다. 긴 evidence fixture에서 85.59% bytes 절감은 확인했으나 전체 query nDCG가 떨어져 기본 off다. span expansion의 장점과 episode routing의 이득을 동일시하지 않는다.

Graph는 semantic relation/project edge만 대상으로 2-hop/32-edge 제한을 둔 derived index다. 이번 ablation에서 뚜렷한 추가 성능은 없고 일부 noise가 증가하므로 기본 off다. semantic dense가 실행되지 않은 상태라 완전한 +dense+graph interaction도 미측정이다.

Multi-vector, RL manager, 별도 graph DB를 추가하지 않았다.

## 12. Host 연결 계획: 완료 상태와 실제 다음 병합 단위

`node scripts/install-overlay.mjs --repo /path/Belmont`는 dry-run이다. `--apply`는 기존 파일을 덮어쓰지 않고 `source/host/extensions/memory/kernel/`과 `memory-learning-runtime.ts`를 설치한다. 설치 경로와 strict TS typecheck는 별도 layout fixture에서 실행했지만 실제 full source checkout 검증은 아니다.

실제 호출 연결은 아직 남아 있다. authenticated user turn에서 host hook을 호출하고, session/episode 종료에서 consolidation을 실행한다. tool dispatch 직전에 `beforeToolAction` 또는 `DigitalSelf.execute`를 연결한다. Aside 완료 hook에서 experience client를 호출하고 trusted evaluator만 paired measurement를 요청한다. 기존 MemoryService façade/UI contract는 유지한다.

처음에는 shadow read/learn scope로 연결해 기존 writer와 충돌하지 않게 한다. 기존 Markdown write와 새 canonical write를 동시에 독립 truth로 운영하지 않는다. rollout 시 기존 migration/import와 단일 writer cutover를 적용하고, 동작과 rollback에서 deletion barrier를 유지한다.

## 13. 미구현/미검증 목록

실제 E5 forward/semantic recall, general natural-language extractor, 개인 데이터 holdout, 실제 host tool schema mapping, actual Aside/browser execution, persisted episode queue/rejected-candidate work queue, raw evidence retention 정책, learned salience/preference trend, 대규모 ANN/cold latency, tokenizer 정확한 cost, 자동 실패 원인으로 새 절차 생성은 미완료다.

Raw evidence는 기존 ledger에 기록되지만 trivial turn의 장기 보관/만료 sweep은 없다. host의 episode buffer도 메모리 내이므로 crash 이후 재구성은 실제 conversation store와 연결해야 한다. 이 부분을 전체 consolidation engine의 완성으로 과장하지 않는다.

## 14. 질문 10개에 대한 판정

| 질문 | 판정 |
|---|---|
| 1. 그대로 유지한 것 | canonical SQLite/evidence/revision/dependency/tombstone/transaction/outbox/FTS/migration/explicit 정책과 기존 61개 테스트 |
| 2. 새로 구현한 것 | hybrid 경로·실제 vector index/HTTP adapter·E5 서비스 코드·dreaming·typed temporal atoms·action grounder·Aside ingestion/evaluation/feedback·hierarchy/graph |
| 3. FTS 대비 hybrid 개선량 | 실제 dense gain 미측정. repository A→planning Recall@5 +14.29pp, authored dialogue +9.38pp는 별개 |
| 4. 어떤 경험이 durable해지는가 | 검증 가능한 선호·제약·직업·관계·프로젝트 규칙·완료/실패 사건·측정 승인 절차. trivial/future/모호한 복합문은 보류 |
| 5. 다음 세션 검색 | DB 물리 재오픈 및 새 caller session 테스트 통과 |
| 6. tool argument 적용 | 실제 localhost reference tool에 인자 전달. 작성 action 8/8, 동일 grounder의 원본 FTS 6/8 |
| 7. Aside→Belmont | 실제 HTTP 계약→canonical commit 검증. 실제 Aside executable lifecycle 연결은 미완료 |
| 8. 실패 경험 활용 | 금지 조건 학습 후 같은 조건의 절차 dispatch 차단. 자율 수리 성공을 주장하지 않음 |
| 9. mock/interface 영역 | geometric embedding/사이트 trial은 테스트 대역, real model 미실행, 실제 host 배선·도구 schema·브라우저 executor 미연결 |
| 10. 완성도 | **6/10**, 엔지니어링 판단. 작동하는 bounded loop는 있으나 semantic/generalization/live integration 미검증으로 production digital-self라고 할 수 없음 |

## 15. 출처·재현성

프로젝트 정보는 `docs/repository-audit.json`의 GitHub path/blob SHA를 사용한다. 모델 정보는 공식 `intfloat/multilingual-e5-small` model card와 pinned model tree를 기준으로 한다. 모델 보유·실행 여부는 별개다. 신규 성능 수치는 동봉된 query-level JSON에서만 가져왔다. 연구 논문의 향상 수치를 Belmont 측정값으로 사용하지 않았다.

공식 모델 참고 주소:
```text
https://huggingface.co/intfloat/multilingual-e5-small
https://huggingface.co/intfloat/multilingual-e5-small/tree/fd1525a9fd15316a2d503bf26ab031a61d056e98
```
