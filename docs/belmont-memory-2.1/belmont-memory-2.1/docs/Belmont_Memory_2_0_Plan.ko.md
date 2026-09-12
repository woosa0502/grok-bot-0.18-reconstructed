# Belmont Memory 2.0 — 최종 설계·구현·검증 계획

작성 기준: 2026-09-11 / 상태: 설계안 + 실행 검증한 독립 reference kernel / 원격 저장소 변경 없음

## 1. 최종 결정

**Belmont를 단일 논리적 메모리 권한 주체로 두고, 먼저 정확성·권한·삭제·근거 보존을 완성한다. 검색은 현재 FTS5/CJK를 기준선으로 유지한 뒤, 작업 의도 확장 → dense → 계층 검색 → 필요할 때만 제한된 그래프 순으로 검증한다. Multi-vector와 RL 메모리 관리자는 초기 출시 범위에서 제외한다.**

여기서 단일 권한 주체란 모든 데이터를 같은 권한으로 합친다는 뜻이 아니다. 사용자, 프로젝트, 개인 에이전트의 공개 범위와 접근 정책은 계속 분리한다. Aside는 브라우저 경험 제공자 및 절차 평가자로 연결하되, 사용자 프로필의 직접 쓰기 권한을 갖지 않는다.

성공은 ‘저장한 기억 수’나 ‘검색 점수’가 아니라 **사용자의 최신 제약을 올바른 행동 인자에 적용하면서, 삭제·권한·근거를 위반하지 않는 비율**로 판단한다. 기억은 행동을 위한 참고 정보이지 송금·결제·예약·파일 삭제의 승인이 아니다.

### 이번 산출물의 정확한 범위

제공한 코드는 실행 가능한 독립 TypeScript/SQLite 커널이다. 실제 저장·정책·출처 연결·수정·삭제·FTS·복구·검색 경계 테스트가 있다. Belmont의 모든 호출부를 교체한 완성 PR은 아니다. Electron/기존 UI/runner/Aside/실제 embedding 서버에 연결되지 않았다. 기존 전체 저장소의 `npm run check`, `npm run frontend:build`는 실행하지 않았다. 접근 가능한 GitHub에서 실제 Belmont 파일은 읽었으나 Aside 저장소는 확인하지 못했다.

## 2. 실제 코드 감사 결과

검토한 소스는 `woosa0502/Belmont`의 main에서 읽었다. 아래 파일과 함수가 판단의 근거다. 파일 SHA는 `repository-audit.json`에 GitHub 응답값 그대로 남겼다. 완전한 checkout/commit 단위 재현을 주장하지 않는다.

| 우선순위 | 확인한 코드 | 실제 의미 | 제안 |
|---|---|---|---|
| P0 | `extensions/memory/agent-state.ts`의 `remember()`가 `addMemory(..., "explicit")` 호출 | update_state를 통한 에이전트 쓰기와 직접 사용자 지시가 이 경계에서 구분되지 않는다 | host 인증/사용자 확인 경로와 agent proposal 경로를 분리한다 |
| P0 | `runner/sand-memory.ts`의 frozen snapshot은 compactionEpoch만 비교 | 삭제/접근권한 변경이 별도 무효화에 연결되지 않으면 과거 render가 재사용될 위험 | scope epoch/generation + principal + policy epoch를 캐시 키에 포함한다 |
| P0 | FileMemoryStore는 Markdown과 `.dreaming` marker들을 각각 갱신 | 파일 하나의 atomic write와 전체 memory transaction은 다르다 | SQLite 트랜잭션으로 기억·이력·FTS·outbox를 함께 커밋한다 |
| P0 | synthesis의 sourceEvidenceIds는 검증에 사용되나 저장된 fact에는 연결되지 않음 | 나중에 왜 기억했는지, 어떤 삭제가 파생 기억을 무효화해야 하는지 추적이 어렵다 | 지속 evidence ledger와 memory_evidence/dependency를 보존한다 |
| P0 | 삭제 marker는 content hash 기반, 사용자/프로젝트 기억은 에이전트 shard를 합쳐 조회 | 한 shard 삭제만으로 다른 shard의 동일 기억까지 없어지는 것은 아니다 | 사용자 삭제의 범위·동일 근거 파생물·공유 projection을 명시한다 |
| P1 | `knowledge-store.ts`의 열람은 realpath 검사, 재귀 색인은 statSync로 symlink 추적 | 열람과 색인의 경로 정책이 다르며 외부 파일 색인/순환 경로 위험 | 동일 root confinement, visited 집합 적용 |
| P1 | 파일 읽기 오류를 빈 문자열로 처리하는 경로 | 손상·권한 오류와 빈 기억을 혼동할 위험 | 쓰기/마이그레이션은 실패를 오류로 표면화한다 |

이는 정적 코드 감사와 독립 커널 테스트 결과다. 실제 운영 환경에서 공격 또는 장애가 발생했다는 주장은 아니다.

### 보존해야 할 기존 장점

기존 `applySynthesis()`는 일괄 유효성 검증, 명시적 기억 보호, snapshot fingerprint 검사, 삭제 대상의 줄 번호 재해석, 원래 대상들을 먼저 제거하는 처리 등을 이미 갖고 있다. synthesis 서비스에는 별도 검증 단계, deadline, retry, dispose 시 취소 경계도 있다. 이를 없애거나 ‘검증기가 없다’고 가정해서는 안 된다. [C1–C4]

기존 `clearMemories()`는 tombstone 디렉터리를 통째로 지우지 않는다. 또한 파일 쓰기가 동기식이므로, 같은 이벤트 루프에서 임의의 await 경합이 있다고 단정하지 않는다. 핵심 위험은 여러 파일에 걸친 crash consistency, 외부 프로세스/편집기와의 동시 접근, 삭제 후 다른 파생 경로의 재노출이다. [C1]

기존 knowledge 검색은 `node:sqlite`, FTS5, 한국어 CJK bigram, title/alias/body/ngram 가중 BM25를 사용한다. 이를 벡터 DB로 일괄 교체할 근거는 없다. [C5]

## 3. 제시된 연구 주장에 대한 판단

| 연구/주장 | 검증 및 해석 | Belmont 적용 |
|---|---|---|
| AgeMem, ACL 2026 | 메모리 연산의 tool-action 통합과 RL 학습이 확인된다 | 연산 추상화는 채택, RL은 데이터가 쌓인 뒤 별도 실험 |
| HiGMem, Findings ACL 2026 | event-turn 계층 및 제시된 adversarial F1 0.54→0.78은 저자 초록에 있다 | summary는 탐색, 원 evidence는 판단의 근거 |
| Cognitive Scaffold, ACL 2026 | 구조화 snapshot 및 해당 과제의 5.3% compression hallucination 보고 확인 | 숫자·entity·부정문을 원문 span과 함께 보존 |
| LightMem v4 | online/offline 분리 아이디어는 유효. 확인한 본문은 특히 memory-bank construction 효율을 평가 | 제시문의 83ms/581ms/+2.5 F1 묶음은 해당 원문에서 확인되지 않아 SLA 근거로 사용하지 않음 |
| PAMU, Findings ACL 2026 | sliding window와 EMA를 이용한 선호 업데이트 | 행동 추정치의 변화 감지에만 사용, 명시적 수정은 즉시 우선 |
| GAM / Nemori, ACL 2026 | event/association 분리, episodic 통합·distillation 방향 | 별도 거대 시스템을 그대로 도입하기보다 작은 원자 연산으로 번역 |
| Experience-following 연구 | 유사한 과거 경험을 재현하면서 잘못된 행동이 전파될 수 있음 | procedure에 실패·환경 버전·금지 조건도 저장 |
| BGE-M3 | 다국어 dense/sparse/multi-vector 지원은 검증 가능한 baseline | 한국어 비교군 중 하나. 2026 최적 모델이라고 단정하지 않음 |
| LongMemEval / LoCoMo-Plus / Mem2ActBench | 장기 QA, 암묵적 제약, tool argument 적용은 서로 다른 평가 축 | 검색 결과와 행동 성공을 별도로 평가 |
| 최신 memory poisoning preprint | 지속 메모리가 공격 지속 경로가 될 수 있다는 위협 근거 | 검토 전 연구 수치를 독립 실증처럼 사용하지 않음 |

논문별 모델·context budget·데이터 분할·judge·지연 측정 범위가 다르므로 수치를 한 표의 동일 조건 성능처럼 더하지 않는다. 특히 QA F1 개선을 예약 성공률 개선으로 읽지 않는다. 출처는 말미 R1–R14에 있다.

## 4. 목표 아키텍처

```text
Host-authenticated user UI / message confirmation ───┐
Agent update_state proposals ────────────────────────┤
Aside browser observations / verified outcomes ─────┤
                                                    ▼
                          Caller-bound Memory API + Policy
                          scope / consent / lineage / epochs
                                                    ▼
                                  Canonical SQLite ledger
                   evidence / items / revisions / links / delete barriers
                                    │                │
                        transactional FTS        transactional outbox
                                    │                ▼
                                    │       versioned derived indexes
                                    │       dense / summaries / graph
                                    └──────┬─────────┘
                                           ▼
                          Query plan → scope-filtered candidates
                         → RRF → current-version revalidation
                         → bounded evidence packet → agent
                                           │
                                   outcome / correction feedback
```

최초 로컬 단일 호스트에서는 SQLite를 사용한다. `node:sqlite`는 현재 프로젝트가 이미 사용하는 계열이다. 다중 장치·클라우드 동기화는 별도 제품 요구가 확인되기 전까지 이 설계가 자동으로 해결한다고 가정하지 않는다. 별도 DB 서버 도입보다 권한 주체와 commit 경계의 일관성을 먼저 확보한다. [C5, R15–R16]

### 정본과 파생물을 구분한다

정본은 증거·기억 상태·변경 이력·삭제 의도다. FTS, dense vector, entity adjacency, episode summary는 재생성 가능해야 한다. 검색 문서 ID는 `memory_id + version + index/model version`에 연결한다. 삭제되거나 이전 버전인 항목은 벡터 캐시에 남아 있어도 최종 hydrate에서 사용하지 않는다.

관계 중 provenance/dependency는 정합성에 필요한 정본 연결이다. LLM이 추출한 관계 그래프는 별도 가설/파생 index다. 이 둘을 같은 ‘graph’로 취급하지 않는다.

### 메모리 종류와 저장 계층

Working은 현재 실행 상태로 둔다. 장기 ledger에는 episodic, semantic, preference, procedural, knowledge를 둔다. User/self는 semantic subtype으로 확장 가능하다. STM/MTM/LTM은 수명·처리 단계이고, 위 종류는 업데이트 정책의 차이다.

미래 약속·대기·deadline은 automation/task 서비스의 상태를 정본으로 둔다. 메모리에는 task ID와 설명의 projection만 둔다. ‘내일 예약해 주기로 함’이라는 기억만으로 예약이 완료되었다고 바꾸지 않는다. 계획과 실행 결과는 다른 evidence다.

## 5. 권한·근거·삭제 불변식

### 권한은 점수가 아니다

`source reliability`, `user consent`, `scope`, `confidence`, `actor capability`를 분리한다. 신뢰할 수 있는 도구가 반환한 잔액 정보는 정확할 수 있어도 사용자 선호를 변경할 권한은 없다. 외부 자료가 reranking 점수에서 authority bonus를 얻었다고 개인 프로필을 수정해서는 안 된다.

LLM tool arguments에 `actor=user`, `authority=USER_EXPLICIT`, `scope=다른 프로젝트`를 넣어서 권한을 얻을 수 없어야 한다. host가 요청별 principal과 허용 scope를 만든다. 현재 reference session factory는 이 host 내부 경계이며, 네트워크 인증 서버가 아니다.

제공한 정책은 사용자 직접 확인 경로에서만 explicit를 만들며, agent의 개인 사실/선호 추론은 review_required로 반환한다. Aside의 개인 프로필 쓰기는 거부한다. 브라우저 provenance를 가진 parent에서 파생된 기억은 그 출처를 계승한다. 단, 모델이 누락한 parent를 코드가 마술처럼 추론하지 않는다. production에서는 orchestrator가 실제 사용한 evidence 목록을 강제로 붙여야 한다.

`review_required`는 현재 커널에서 반환되는 결정이다. 영속 quarantine queue, 검토 UI, 승인된 proposal에 대한 서명/소비는 후속 통합 구현 범위다.

### 삭제는 데이터베이스 한 행의 삭제가 아니다

삭제 시 동일 트랜잭션에서 현재 payload, 과거 revision, FTS, 관련 receipt, 미처리 upsert job, 근거 payload와 파생 기억을 정리하고 delete job과 scope epoch를 기록한다. 오래된 snapshot 및 capture 작업은 epoch 검사로 차단한다. 빈 scope의 clear도 epoch를 올린다.

이번 구현은 공유 evidence를 사용하는 기억을 보수적으로 함께 삭제한다. 한 대화 전체를 한 evidence로 쓰면 관련 없는 사실까지 과삭제될 수 있다. 따라서 production에서는 발화 전체 복제보다 **source document ID + immutable span + content digest** 단위가 바람직하다. 현재 구현은 짧은 원문을 SQLite에 직접 저장하므로 이 최적화가 필요하다.

HMAC tombstone은 정확히 정규화된 내용을 재기록하지 못하도록 돕는다. **모든 의미적 패러프레이즈를 잊는 의미적 unlearning을 보장하지 않는다.** 새로운 근거·다른 출처가 동일 사실을 다시 알려주는 경우와 사용자가 재기억을 승인하는 경우는 별도 정책이 필요하다. reference는 tombstone이 있으면 사용자 재기억도 자동 허용하지 않는다.

SQLite secure_delete/FTS cleanup은 백업, WAL snapshot, 디스크 snapshot, 이미 전송된 LLM context까지 지우는 보장이 아니다. 운영에서 암호화 저장, 키 수명, checkpoint/VACUUM 정책, 백업 만료, 캐시 무효화, cloud sync 삭제 영수증을 따로 설계한다. 과거 백업을 복원할 때도 최신 삭제 barrier를 다시 적용해야 한다.

### frozen prompt와 진행 중 행동

캐시 키는 compactionEpoch 외에 `(principal, policyEpoch, scope 목록, 각 epoch/generation)`을 포함한다. 이전 형식 snapshot은 강제 재생성한다. 삭제 후 빈 기억도 새 snapshot으로 저장하여 예전 render가 남지 않도록 한다.

host는 inference dispatch 직전에 stamp를 재검사하고, 실행 중 삭제/권한 회수가 발생하면 가능한 요청은 취소한다. 이미 모델/도구에 전달한 내용은 되돌릴 수 없으므로 후속 tool action 직전에도 현재 권한과 근거를 확인한다. 제공된 helper만 복사해서 모든 인플라이트 경로가 연결되었다고 간주하지 않는다.

## 6. 데이터 모델과 원자적 연산

실제 executable schema는 `src/schema.ts`, 읽기용 SQL은 `docs/schema.sql`이다.

| 테이블 | 용도 |
|---|---|
| scope_state | 삭제 epoch, 모든 변경 generation |
| evidence | source class, source reference HMAC, 발생/기록 시각, 근거 payload, revoke |
| memory_item | stable UUID, 종류, scope, 현재 내용, 권한, version, 유효 기간 |
| memory_evidence / dependency | 원 evidence 및 파생 관계 |
| revision | 수정 전후 상태의 버전 이력; forget 시 payload 제거 |
| tombstone / legacy_tombstone | 새 HMAC 삭제 barrier와 기존 SHA1 규칙 호환 |
| receipt | caller별 idempotency key와 요청 fingerprint |
| memory_event | 내용 없는 최소 변경 감사 이벤트 |
| outbox | 정본 커밋과 함께 저장되는 index 갱신/삭제 작업 |
| memory_fts | 재생성 가능한 FTS5 view |

제안 커밋은 `BEGIN IMMEDIATE` 안에서 snapshot의 scope epoch/generation 및 target version을 검사하고, policy/evidence/tombstone을 검사한 후 revision·FTS·outbox까지 함께 커밋한다. 배치 일부가 review/거부되면 나머지도 rollback한다. idempotency 요청 fingerprint는 새 snapshot 발급만으로 충돌하지 않도록 내용/대상/근거 등 intent를 기준으로 한다.

수정은 내용의 content-hash를 ID로 사용하지 않고 안정된 UUID와 revision으로 표현한다. `supersede`는 역사 보존이고 `forget`은 재사용 금지 및 payload 제거다. 이 둘을 같은 DELETE로 구현하지 않는다.

reference는 valid_from/to 및 기록 시각과 revisions를 갖지만, 완전한 bitemporal 질의 엔진은 아니다. ‘2025년 10월의 선호’와 ‘2026년 1월에 알고 있던 2025년 10월의 선호’를 모두 지원하려면 revision의 transaction-time 구간과 당시 entity/context resolution을 명시적으로 더해야 한다.

## 7. 검색 설계 및 비용 통제

1차 배포에서는 현재 sparse 검색과 타입/시간/권한 필터를 보존한다. 매 질문마다 모든 검색 엔진을 병렬 실행하지 않는다.

```text
질문·현재 tool schema
 → 필요한 memory dimension 정의(사실 생성 아님)
 → 허용 scope/type/time 범위 확정
 → sparse + 필요한 경우 dense
 → RRF(점수 크기 대신 rank 융합)
 → 현재 version/삭제/권한 재검사
 → 작은 reranker 또는 relevance/abstention 판단
 → episode anchor에서 필요한 원 evidence 확장
 → 모델 tokenizer 기준 budget 내 evidence packet
```

성능 최적화보다 먼저 권한 필터를 적용한다. 최종 필터만 쓰면 허용되지 않은 데이터가 후보군, reranker, 로그 또는 외부 embedding 서버로 이미 나갈 수 있다. 제공한 DenseProvider 계약은 backend scope prefilter를 요구하지만 실제 backend가 준수하는지는 별도 통합 시험이 필요하다.

reference의 dense 검색은 provider interface, timeout/fallback 및 결과 재검증까지 구현했다. 실제 embedding 계산/ANN/reranker는 없다. LLM을 호출하지 않는 deterministic tool별 query expansion 예제가 있다. 항공권 검색에서 좌석·비행 제약을 조회하되, 조회용 cue를 사용자 사실로 저장하지 않는다.

한국어는 공백·조사·활용 때문에 unicode61 단독과 CJK bigram을 비교할 가치가 있다. 그러나 bigram OR 검색은 의미가 다른 부분 일치를 늘릴 수 있다. 검색 일치와 답변 가능성을 구분하고, 부정문·금액·entity·날짜의 일관성을 확인한다. 민감 식별정보에는 별도의 명시적 열람 정책과 exact lookup을 둔다.

graph는 entity resolution과 evidence link가 검증된 뒤 최대 hop/노드 수/시간 범위를 제한하여 도입한다. ‘지난달 반복된 문제’와 같은 다중 사건 분석에만 우선 실험한다. 그래프가 외부 자료를 사용자 사실로 바꾸는 경로가 되어서는 안 된다. multi-vector는 어려운 문서 질의에서 실제 추가 이득을 보이고 메모리/지연 예산을 통과할 때만 채택한다.

## 8. dreaming과 preference/procedure

기존 propose→verify와 취소/재시도 경계는 유지한다. 앞단에 내구 evidence queue와 episode segmentation을 붙이고, 뒷단의 applySynthesis를 transactional proposal batch로 바꾼다. sourceEvidenceIds는 검증용 한 번 읽는 값이 아니라 ledger에서 계속 추적한다.

원자 추출 결과에는 subject/predicate/value/context, 부정 여부, 원문 span, 유효 시점, 불확실성을 포함한다. 요약의 숫자/날짜/entity가 원문과 일치하는지 deterministic 검사를 먼저 하고 모호한 함의만 모델에게 맡긴다. assistant의 문장은 사용자 지시의 증거로 사용하지 않는다.

preference는 explicit constraint와 inferred trend를 분리한다. ‘이제부터 가격 우선’은 즉시 적용한다. EMA는 이전 취향의 관성 때문에 이를 약화시키면 안 된다. leisure/business 등 context를 분리하고, 결론을 내리기에 관찰 수가 적으면 가설로 남긴다. reliability×novelty×utility를 임의 곱한 숫자는 보정된 확률이 아니므로, 학습 전에는 해석 가능한 reason code가 낫다.

procedure에는 task/domain/preconditions/steps/failures 외에 browser 버전, locale, 로그인 상태, 사이트 구조 fingerprint, 평가 task set, baseline/candidate outcome을 저장한다. success만 기록하지 않는다. 명백한 결제·권한 위반은 latency 이득과 교환하지 않는다.

`procedures.ts`는 paired trials의 성공률 불확실성과 비용 개선을 확인하는 보수적 오프라인 gate 예제다. 최소 200 pair, critical failure 0, 성공률 차이 lower bound ≥ -0.02, median latency 또는 tokens 10% 개선을 기본 실험 조건으로 썼다. 이는 보편적 통계 기준이 아니라 조정 가능한 초기 정책이다. 같은 페이지를 200번 재시도한 결과는 200개의 독립 증거가 아니다. 사이트/사용자/task cluster 단위 분할과 bootstrap을 production 평가에 추가한다.

Aside의 learn/learn-measure 실제 파일은 접근하지 못했다. 따라서 해당 인터페이스와 측정값은 사용자 제공 설명에 기반한 **연동 제안**이며, 현재 코드에 바로 맞는 adapter라고 단정하지 않는다.

## 9. 기존 데이터 마이그레이션 — 반드시 지킬 순서

현재 원천은 agent memory, user-memory/agents, projects/<slug>/memory/agents, knowledge 디렉터리다. 자동으로 전부 user scope에 합치지 않는다. [C1–C2, C5]

**Freeze → inventory → deletion barriers → baseline import → validation → shadow read → single-writer cutover** 순서를 사용한다.

단계 A: 기존 writer/synthesis를 중지한 일관된 snapshot을 만든다. 원본 Markdown과 `.dreaming` metadata를 함께 보관하고 파일 해시·크기·소유 scope·허용 형식을 inventory로 남긴다. 깨진 날짜, 인식 못한 줄, 읽기 실패를 건너뛰지 않는다. `inspectLegacyMarkdown`는 dry-run parser이며 원본을 변경하지 않는다.

단계 B: **기존 tombstone부터** scope별로 들여온다. 현재 `.deleted`는 원문 없는 16자리 SHA1 ID이므로 새 HMAC으로 그냥 바꿀 수 없다. 기존 `normalize → 500자 truncate → lower-case → SHA1 → 앞16자리` 규칙을 별도 버전으로 유지한다. `importLegacyTombstones`가 이를 구현한다. barrier를 사실보다 나중에 넣는 호출은 거부한다. old hash의 사전 대입 가능성은 유지되는 부채이므로 암호화 저장/수명 정책이 필요하다.

단계 C: explicit/synthesized marker를 inventory에 보존하되, **기존 explicit를 검증된 사용자 consent로 승격하지 않는다.** 현재 agent write도 explicit로 표시될 수 있기 때문이다. 초기 이관 기억은 보호된 legacy baseline로 들이고, UI 재확인 또는 신뢰된 사용자 메시지 연결이 생기면 권한을 갱신한다.

단계 D: 이관 ID mapping `(source scope, source file, legacy ID) → canonical UUID`를 유지한다. parser의 정규화 차이(NFKC 등)를 기록하고 원문/기존 hash를 잃지 않는다. 동일 내용이라도 scope가 다르면 합치지 않는다. 내용 중복은 하나의 원인을 의미하지 않으므로 근거를 삭제하지 않는다.

단계 E: 원본 fact 수, 제외된 tombstone 일치 수, rejected/quarantined 수, scope별 import 수가 정확히 일치하는지 검증한다. 이름·부정·날짜·숫자를 표본이 아닌 자동 비교로 보존 확인한다. 이 단계가 실패하면 writer를 전환하지 않는다.

단계 F: legacy를 읽는 production에 canonical shadow read만 붙인다. 두 저장소에 독립적으로 수정하는 dual authority는 만들지 않는다. 변경 동기화가 필요하면 한쪽 commit log에서 다른 쪽으로 단방향 projection한다.

단계 G: 승인된 canary scope부터 canonical 단일 writer로 전환한다. Markdown은 호환용 export/view로 남기고 직접 편집은 explicit import proposal로 보낸다. 실패 시 rollback은 최신 삭제 barrier를 유지한 projection을 만들어 수행한다. 오래된 백업 복원만으로 되돌리지 않는다.

reference에는 parser와 barrier import primitive가 있으며, inventory/backup/전체 shard importer/복원 운영 도구는 구현되지 않았다. production 마이그레이션을 실행하기 전 별도 PR과 회귀 테스트가 필요하다.

## 10. 파일별 적용 계획과 PR 단위

| PR | 실제 수정 지점 | 완료 기준 |
|---|---|---|
| 1. 권한·캐시 경계 | `extensions/memory/agent-state.ts`, `runner/sand-memory.ts`, 연결 host 호출부 | 에이전트가 explicit를 자칭할 수 없음; 삭제/권한 회수 후 frozen render 재사용 0 |
| 2. SQLite shadow kernel | 새 memory-kernel 모듈, `memory-service.ts` façade | 저장/삭제/복구/CAS 테스트, legacy API 결과 형식 유지, UI 연결 오류 없음 |
| 3. 근거·dreaming | `memory-synthesis-service.ts`, `production.ts` | source IDs 영속화, queue 재시작/abort/retry 안전성, explicit/legacy 보호 |
| 4. 마이그레이션 | 새 migration 서비스 및 rollback 도구 | 모든 shard·metadata 검증, tombstone 우선 이관, 재실행 중복 0 |
| 5. sparse 경계·baseline | `runner/knowledge-store.ts`, 새 `knowledge-paths.ts` | symlink escape/cycle 차단; 기존 Korean 검색 회귀 없음 |
| 6. hybrid/hierarchy | 검색 planner/provider/episode view | 동일 budget에서 baseline 대비 실질 이득, timeout 시 sparse fallback |
| 7. Aside procedure | host-bound IPC/HTTP adapter, outcome ingestion | 실제 Aside 계약 확인 후 연결; profile write 불가; paired evaluation 통과 |
| 8. 선택적 graph | typed relation index, bounded traversal | multi-hop subset의 증분 이득과 전체 비용 예산 충족 |

`patches/knowledge-root-confinement.patch`는 확인한 knowledge-store hunk를 대상으로 만든 작은 패치다. 원본에 대한 전체 빌드가 아니라 재구성한 동일 context에서 git apply 검사를 했다. 최신 checkout에서 `git apply --check`를 다시 실행한다. 커널 자체는 독립 패키지이므로 무조건 copy/paste하고 기존 서비스를 제거하면 안 된다.

## 11. 실제 실행한 테스트와 결과

실행 환경: Linux x64, Node v22.16.0, SQLite 3.49.1, TypeScript 5.8.3, 로컬 @types/node 25.1.0. 원본 저장소의 권장 Node 26.5.x와 다르다. [C6]

이번 패키지의 strict TypeScript build와 **61개 node:test 회귀 테스트를 실행했고 61개가 통과, 실패·skip 0**이었다. 정확한 TAP은 `results/test-output.tap`이다. 설치된 도구 체인을 이용했으며 깨끗한 네트워크 의존성 설치, npm ci, 실제 Belmont 전체 빌드는 실행하지 않았다.

검증 범위는 source spoof/explicit 경계, cross-scope 접근, evidence reference, batch rollback, stale epoch/version, idempotency, 두 DB connection의 CAS, 트랜잭션 중 자식 프로세스 종료 후 복구, logical payload 삭제, source replay 차단, FTS rebuild, 한국어 검색, dense timeout/stale/forget race, 예산 제한, legacy barrier 호환, frozen prompt 무효화, symlink 경계, procedure gate다.

프로세스 강제 종료 테스트는 전원 차단과 저장장치 장애를 완전히 재현하지 않는다. logical SQL payload에서 문자열이 없다는 검사는 디스크 이미지·백업의 forensic erasure 보장이 아니다.

### 합성 검색 microbenchmark

522개 합성 memory, 26개 질의(정답 있음 22 / 없음 4), 각 모드 780회 timed query. 동일 fixture를 사용했다. `results/retrieval-benchmark.json`에 case별 결과가 있다.

| 모드 | Recall@5 | nDCG@5 | 정답 없는 질의에서 empty 반환 |
|---|---:|---:|---:|
| unicode61_only | 0.3636 | 0.3636 | 4/4 |
| cjk_bigram | 0.9091 | 0.9091 | 3/4 |
| cjk_plus_action_queries | 0.9545 | 0.9545 | 3/4 |

각 answerable case에 관련 문서가 하나이며 이번 fixture에서는 적중 시 첫 순위였기 때문에 Recall과 nDCG가 같았다. 실제 질의의 일반적 성질이 아니다. query expansion은 추가 한 case를 맞혔고 일부 paraphrase는 여전히 놓쳤다. bigram이 늘린 recall은 한 absent case의 불필요한 결과를 동반했다.

지연은 warm in-memory microbenchmark다. 최신 측정 JSON에 p50/p95가 있지만 서비스 SLA로 사용하지 않는다. 기존 Belmont와 직접 비교한 실험도 아니며, 공개 benchmark나 실제 multilingual embedding 실험도 아니다. empty 반환률은 LLM의 최종 기권 정확도가 아니다.

## 12. production 평가 방법

고정된 테스트 집합을 먼저 만든다. 익명화/동의된 실제 replay, 한국어·영어·혼합 언어, 사용자 수정, temporal update, 말하지 않은 정보에 대한 기권, 다른 프로젝트 동명이인, 비슷한 제목의 외부 문서, 웹 poisoning, 삭제 직후 tool 실행을 포함한다. task/session/time 순서로 분리하여 미래 evidence가 과거 질의에 누출되지 않게 한다. synthetic fixture는 빠른 회귀 시험일 뿐 충분한 성능 증명이 아니다.

모든 비교군에 동일한 안전 정책을 적용한다. 기존 제안처럼 governance를 마지막 F군에만 넣으면 안전 개선과 검색 개선이 뒤섞인다. 별도로 원래 시스템의 replay baseline을 남기되 배포 후보 실험에서는 governance를 항상 켠다.

| 실험 | 변경 요소 | 고정할 요소 |
|---|---|---|
| B0 | 기존 Belmont replay | 같은 원문/질의/모델/실행 조건 기록 |
| B1 | canonical + sparse | policy, evidence budget, judge 고정 |
| B2 | B1 + action query expansion | 동일 candidate/evidence 상한 |
| B3 | B2 + dense | embedding/model version 기록 |
| B4 | B3 + episode hierarchy | 원 evidence 총 token 상한 고정 |
| B5 | B4 + bounded graph | multi-hop subset과 전체 모두 측정 |

별도 실험으로 consolidation on/off, verifier 및 source-granularity를 비교한다. 안전 장치를 production에서 꺼서 성능을 높이는 실험으로 만들지 않는다.

검색: Recall@5/10, nDCG@5/10, evidence precision, invalid/stale hit 비율, 한국어 subgroup. 인지: 명시적 수정 적용, 오래된 선호 미적용, temporal accuracy, answerable/absent 별 precision·recall. 행동: tool name/argument가 근거와 최신 constraint를 만족하는지, 실제 sandbox outcome, 사용자 교정률. 운영: warm/cold p50/p95, 느린 embedding timeout, 주입 token, DB/index 크기, outbox lag, 복구 시간. 보안: scope 침범, 삭제 후 재노출, provenance 위조, 승인 없는 explicit 승격.

초기 수용 기준은 다음 **제안값**이다. 측정 완료 성능이 아니다.

- 안전 고정 suite에서 scope leakage, explicit 승격, 삭제 재노출 0건. 유한 테스트 0건은 보편적 안전 증명이 아니다.
- 안전한 기준선 대비 실제 Korean Recall@10 비열등, 주요 action success는 개선 목표 +5 percentage points. paired bootstrap/cluster CI로 우연 여부를 보고 표본 수는 baseline과 변동성으로 산정한다.
- target hardware에서 sparse p95 150ms, hybrid p95 300ms를 초기 전체 retrieval budget으로 검토하되 embedding remote 왕복과 evidence expansion을 포함한다. 환경 측정 전 고정 계약으로 약속하지 않는다.
- explicit memory overwrite, expired/future evidence 누출, 삭제 취소 없는 restore, unknown source ID는 CI release blocker.

## 13. 운영 관측성과 실패 대응

로그에는 원문 대신 request ID, scope hash, policy version, epoch, retrieve 채널, evidence ID/version, refusal reason, token count, 지연, outbox lag를 남긴다. 검색 query와 source URL도 개인정보가 될 수 있으므로 기본 telemetry에서 제외한다. 디버그 원문 수집은 별도 동의·기간 제한이 필요하다.

outbox는 at-least-once 소비를 전제로 index upsert/delete를 version/sequence 조건으로 만든다. delete v4 처리 뒤 늦은 upsert v3가 와도 살아나지 않아야 한다. 현재 커널은 durable outbox와 최종 조회 검증까지 제공하며 실제 ANN consumer는 구현하지 않았다.

키 유실 시 tombstone HMAC 비교가 불가능하므로 조용히 새 키로 초기화하지 않는다. 커널은 key mismatch에 실패한다. production 키는 OS keychain 또는 보호된 host secret store에서 관리하며 key ID/rotation/restore 정책을 문서화한다. 코드의 테스트 고정 key는 합성 test 전용이다.

## 14. 실행 절차

압축을 푼 독립 패키지에서 사전 빌드 산출물은 설치 없이 검증할 수 있다.

```bash
cd belmont-memory-2.0
node --test tests/*.test.mjs
node bench/retrieval.mjs
node examples/demo.mjs
```

소스 변경 후에는 잠긴 버전의 TypeScript/타입 의존성을 설치하고 다시 빌드한다. 이 reference에는 npm lockfile이 없으므로 팀의 의존성 검증 절차에서 lockfile을 생성·검토해야 한다.

```bash
npm install
npm run build
npm run test:prebuilt
```

Belmont에 연결한 PR에서는 저장소 지침의 Node 26.5.x와 잠긴 의존성을 사용한다. 아래 마지막 두 검사는 이번 독립 실행으로 대체되지 않는다. [C6]

```bash
npm ci
npm run check
npm run frontend:build
```

## 15. 남은 구현과 출시 판단

아직 필요한 것은 host 인증/IPC 및 mutable membership 검증, UI 확인·quarantine workflow, 모든 legacy shard의 inventory/import/rollback, durable consolidation queue, 원 evidence span 저장, 진짜 dense provider와 ANN consumer, hierarchy/temporal graph, production tokenization, frozen snapshot 모든 호출부 교체, 백업/암호화/다중 장치 삭제 전파, Aside 실제 계약 연결, 전체 Belmont CI다.

이 공백을 감추고 ‘Memory Fabric 완성’으로 배포하지 않는다. 반대로 그래프나 RL이 없다는 이유로 핵심 정확성 개선을 미루지도 않는다. **첫 병합은 update_state의 explicit 권한 분리, 삭제 epoch의 frozen prompt 연결, legacy tombstone 호환 보존**이 가장 적절하다.

## 부록 A. 근거 목록

GitHub 확인 파일: C1 `extensions/memory/memory-service.ts`; C2 `extensions/memory/agent-state.ts`; C3 `extensions/memory/memory-synthesis-service.ts`; C4 `extensions/memory/production.ts`; C5 `runner/knowledge-store.ts`; C6 `AGENTS.md`; C7 `runner/sand-memory.ts`. `source/host/` 아래 경로는 상대 표기다. SHA와 검토 지점은 `repository-audit.json` 참조.

R1 AgeMem, ACL 2026 — `https://aclanthology.org/2026.acl-long.981/`

R2 HiGMem, Findings ACL 2026 — `https://aclanthology.org/2026.findings-acl.1690/`

R3 Cognitive Scaffold, ACL 2026 — `https://aclanthology.org/2026.acl-long.1170/`

R4 LightMem v4 — `https://arxiv.org/html/2510.18866v4`

R5 PAMU, Findings ACL 2026 — `https://aclanthology.org/2026.findings-acl.38/`

R6 GAM, ACL 2026 — `https://aclanthology.org/2026.acl-long.1600/`

R7 Nemori, ACL 2026 — `https://aclanthology.org/2026.acl-long.1607/`

R8 Experience-following, ACL 2026 — `https://aclanthology.org/2026.acl-long.27/`

R9 BGE-M3 official documentation — `https://bge-model.com/bge/bge_m3.html`

R10 LongMemEval — `https://arxiv.org/abs/2410.10813`

R11 LoCoMo-Plus — `https://arxiv.org/abs/2602.10715`

R12 Mem2ActBench — `https://arxiv.org/abs/2601.19935`

R13 Poison Once, Exploit Forever, preprint — `https://arxiv.org/abs/2604.02623`

R14 Utility Under Attack, preprint — `https://arxiv.org/abs/2608.21230`

R15 SQLite FTS5 official documentation — `https://sqlite.org/fts5.html`

R16 Node.js SQLite official documentation — `https://nodejs.org/api/sqlite.html`

검증은 해당 HTML/초록/공식 문서에 접근하여 수행했다. 모든 논문 실험을 독립 재현하거나 제공문에 언급된 모든 연구를 전수 검증한 것은 아니다.
