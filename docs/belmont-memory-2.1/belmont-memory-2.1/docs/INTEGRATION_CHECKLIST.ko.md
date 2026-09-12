# Belmont 통합·검증 체크리스트

## 병합 전 정합성

- [ ] GitHub에서 검토한 file blob과 현재 checkout diff 확인. 변경이 있으면 재검토한다.
- [ ] `agent-state.ts`의 model-origin write가 explicit를 자칭하지 못한다.
- [ ] phone/UI와 확인된 사용자 지시만 payload-bound explicit 경로로 들어간다.
- [ ] caller scope는 host membership에서 유도하고 요청마다 정책 회수를 반영한다.
- [ ] agent/user/project scope별 읽기와 삭제의 의미가 UI에서 구분된다.
- [ ] source ID와 parent lineage를 모델의 자진 신고만으로 신뢰하지 않는다.
- [ ] 현재 synth verifier/abort/deadline/provider routing 계약을 유지한다.
- [ ] synthesis evidence가 재시작 후에도 추적 가능하고 승인 전에 revoke를 재검사한다.
- [ ] generation CAS의 경합 시 LLM 재호출/재시도에 상한과 backoff가 있다.
- [ ] request idempotency key는 안정적이며 target/version 변경은 별도 intent다.

## 삭제와 캐시

- [ ] empty scope clear도 epoch가 증가한다.
- [ ] frozen-memory snapshot의 compaction-only 형식을 무효화한다.
- [ ] 삭제/권한 회수 시 메모리 render, rerank cache, packet cache가 무효화된다.
- [ ] 진행 중 inference와 tool action에서 stamp를 재확인한다.
- [ ] ANN 늦은 upsert가 더 높은 delete version 뒤에 살아나지 않는다.
- [ ] source document deletion이 연결된 evidence/span으로 전파된다.
- [ ] cross-scope 공유 projection의 삭제 propagation 범위를 명시한다.
- [ ] 백업 복원 후 최신 deletion ledger를 재적용한다.
- [ ] logical erasure와 WAL/백업/원격 cache 물리 삭제를 분리하여 문서화한다.
- [ ] 동일 내용을 다시 기억하는 사용자 승인 정책을 별도로 정의한다.

## 마이그레이션

- [ ] writer/synthesis를 중지한 일관된 snapshot과 원본 manifest를 보관한다.
- [ ] 모든 agent/user/project shard를 inventory에 포함한다.
- [ ] `.dreaming/tombstones`를 facts보다 먼저 scope별로 이관한다.
- [ ] SHA1 legacy ID와 NFKC/HMAC 새 규칙을 혼동하지 않는다.
- [ ] old explicit는 protected legacy로 이관한다.
- [ ] unrecognized line, invalid date, permission error를 숨기지 않는다.
- [ ] source count = imported + tombstoned + quarantined + explicitly excluded가 성립한다.
- [ ] 재실행·중단·재시작 시 중복을 만들지 않는다.
- [ ] shadow-read 상태에서 충분한 replay를 수행한다.
- [ ] single-writer cutover 및 삭제를 보존하는 rollback을 검증한다.

## 평가와 출시

- [ ] Node 26.5.x에서 전체 `npm run check`와 `npm run frontend:build`를 실행한다.
- [ ] actual Korean/mixed-language corpus에서 기존 sparse 대비 비열등성을 평가한다.
- [ ] answerable/absent, direct/implicit, exact/entity/time subgroup을 별도로 본다.
- [ ] 동일 모델·budget에서 dense/hierarchy/graph의 증분 이득을 분리한다.
- [ ] 공개 QA benchmark와 실제 tool argument/action benchmark를 혼동하지 않는다.
- [ ] paired/cluster bootstrap을 사용하고 test set으로 threshold를 조정하지 않는다.
- [ ] Aside 실제 계약을 확인하고 sandbox에서 procedure를 평가한다.
- [ ] critical action failure를 tokens/latency 절감으로 상쇄하지 않는다.
- [ ] telemetry에 원문·민감 query·source URL을 기본 기록하지 않는다.
- [ ] feature flag로 canary scope부터 전환하고 실패 원인을 reason code로 추적한다.
