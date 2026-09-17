# Belmont Memory 2.0 — reference implementation

2026-09-11 · 분석 대상: woosa0502/Belmont · 원격 수정 없음

**권장 읽기 순서:** `docs/Belmont_Memory_2_0_Plan.ko.md` → `src/host-bridge.ts` → `tests/` → `results/`.

이 패키지는 Belmont 소스를 검토하여 만든 **독립 실행 가능한 TypeScript/SQLite 메모리 커널**이다. 실제 Belmont 전체 앱에 통합한 완성 PR이 아니다. Aside 저장소는 연결에서 확인하지 못했다.

## 바로 실행

검증된 환경은 Node **22.16.0**, SQLite **3.49.1**, Linux x64이다. 원본 Belmont의 권장 버전은 **Node 26.5.x**이며 그 버전의 전체 앱 빌드는 별도로 검증해야 한다. `node:sqlite` experimental warning은 이 실행 환경에서 정상적으로 나타날 수 있다.

```bash
node --test tests/*.test.mjs
node bench/retrieval.mjs
node examples/demo.mjs
```

`dist/`의 빌드 결과와 모든 테스트를 포함했다. 위 명령은 npm 패키지 설치나 API key, 외부 LLM 호출 없이 실행된다. 테스트의 데이터/키는 합성 데이터 전용이다. 테스트는 임시 DB 및 별도 in-memory DB만 사용하고 실제 Belmont 메모리를 열지 않는다.

소스 수정 후:

```bash
npm install
npm run build
npm run test:prebuilt
```

빌드는 로컬에 제공된 TypeScript 5.8.3 / @types/node 25.1.0으로 실행했다. 깨끗한 dependency install은 실행하지 못했으며 lockfile을 포함하지 않는다. 팀의 검토 절차로 lockfile을 생성한 뒤 CI에서는 npm ci를 사용한다.

## 구성

| 위치 | 내용 |
|---|---|
| `src/repository.ts`, `schema.ts` | SQLite 트랜잭션, scope/CAS/idempotency, evidence, revision, delete barrier, FTS, outbox |
| `src/policy.ts`, `types.ts` | caller-bound 권한과 보수적인 memory proposal 정책 |
| `src/retrieval.ts`, `text.ts` | CJK 검색, RRF, dense adapter 계약/timeout, evidence packet, legacy hash 호환 |
| `src/frozen-prompt.ts` | 삭제·권한·scope 변경을 반영하는 frozen prompt 키 |
| `src/legacy-import.ts` | 실제 dated Markdown 형식 dry-run 검사; 전체 migration orchestrator 아님 |
| `src/host-bridge.ts` | 직접 사용자 확인과 update_state agent proposal의 분리 예제 |
| `src/procedures.ts` | paired trial 기반 오프라인 절차 평가 gate |
| `src/knowledge-paths.ts` | 지식 색인의 realpath 경계와 symlink cycle 처리 |
| `tests/` | 총 61개 node:test 회귀 테스트 |
| `bench/retrieval.mjs` | 522개 합성 record / 26개 질의 microbenchmark |
| `patches/` | 실제 knowledge-store 코드의 root confinement 개선 패치 |
| `results/` | TAP, benchmark JSON, demo 출력, patch 검사 범위, 환경 manifest |
| `docs/` | 한국어 최종 계획, SQL schema, 코드 감사 manifest, 통합 체크리스트 |

## 이번 검증

Strict TypeScript build 성공. 회귀 테스트 **61 passed / 0 failed / 0 skipped**. 트랜잭션 도중 자식 프로세스를 종료한 뒤 DB를 다시 여는 테스트를 포함한다. 실제 전원 차단이나 스토리지 손상 fault matrix를 모두 시험한 것은 아니다.

검색 fixture에서 Recall@5는 unicode61 0.3636, CJK 0.9091, CJK+action queries 0.9545였다. CJK 모드들은 정답 없는 4개 질의 중 1개에도 결과를 돌려주었다. 기존 Belmont, 공개 LongMemEval/LoCoMo, 실제 dense 모델에 대한 성능 결과가 아니다. 지연은 warm in-memory microbenchmark이며 서비스 SLA가 아니다.

## 통합 전 반드시 읽을 제한

Principal/session factory는 **신뢰된 host 내부** 전용이다. LLM이 actor/capabilities/scopes를 전달하게 만들면 권한 모델이 무너진다. production host가 인증과 실제 사용자 동의를 확인하고 최신 membership을 적용해야 한다. 타입 선언만으로 원격 인증이 구현되는 것이 아니다.

`review_required`는 영속 quarantine 저장이나 사용자 승인 UI를 제공하지 않는다. 개인 사실/선호 추론과 절차 후보는 검토 요청으로 반환되며, 현재 커널은 이를 자동 승격하지 않는다.

DenseProvider는 계약과 fallback만 있다. 실제 embedding, ANN worker, graph, hierarchy, reranker, RL은 포함하지 않는다. outbox의 version-guarded index consumer는 별도 구현해야 한다.

Forget은 논리적 payload 정리 및 evidence/dependency 기반 보수적 cascade를 구현한다. 의미적으로 같은 모든 표현, 다른 source/다른 scope, 파일 백업, 이미 LLM에 전달한 context를 완전히 지우는 기능이 아니다. 공유 evidence의 과삭제 가능성이 있으므로 production은 evidence span 단위를 세분화해야 한다.

기존 `.deleted` 파일의 16자리 SHA1 barrier는 별도 알고리즘으로 보존한다. 이를 원문 없이 새 HMAC으로 전환할 수 없다. 기존 `.explicit` marker는 사용자 동의의 증명으로 승격하지 않는다.

제공된 knowledge 패치는 확인한 source excerpt에서 적용 형식을 검사했을 뿐, 완전한 checkout에서의 적용/빌드 결과는 아니다. 최신 저장소에서 먼저 `git apply --check`하고 기존 지침대로 다음을 실행한다.

```bash
npm ci
npm run check
npm run frontend:build
```

**현재 시작점:** update_state의 explicit 경계 분리 → frozen prompt 삭제 무효화 → tombstone 우선 이관. 전체 전환은 최종 계획서의 single-writer migration gate 통과 후 진행한다.
