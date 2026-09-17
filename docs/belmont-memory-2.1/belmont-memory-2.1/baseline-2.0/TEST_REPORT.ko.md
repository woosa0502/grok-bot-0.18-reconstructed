# Belmont Memory 2.0 — 실행 검증 보고서

기준일: 2026-09-11. 이 결과는 제공된 독립 reference kernel에 대한 결과이며, 기존 Belmont 전체 앱 또는 Aside의 통합 결과가 아니다.

## 실행 요약

| 검사 | 결과 |
|---|---|
| Strict TypeScript compile | 통과 |
| node:test 회귀 | 61 통과 / 0 실패 / 0 skip |
| Source-only dependency install | 미완료; 사전 설치 도구 체인 사용 |
| 압축 패키지의 설치 없는 재실행 | 아래 packaging-check.txt 참조 |
| 원본 Belmont npm run check | 미실행 |
| 원본 Belmont npm run frontend:build | 미실행 |
| 실제 embedding/ANN 모델 | 미실행; adapter/fallback만 검증 |
| 공개 LongMemEval/LoCoMo/Mem2ActBench | 미실행 |
| Aside 연결·실제 브라우저 task | 미실행 |
| GitHub 원격 변경 | 없음 |

환경: Linux x64, Node 22.16.0, SQLite 3.49.1, TypeScript 5.8.3, @types/node 25.1.0. 원본 Belmont 권장 Node 26.5.x는 별도 검증 대상이다.

## 회귀 범위

권한/source 위조, 개인 프로필 쓰기 제한, scope 접근, explicit 보호, evidence lineage, stale snapshot/epoch, optimistic target version, idempotency, batch rollback, 두 connection의 CAS, process exit 중 트랜잭션 복구, 삭제 전파, logical SQL payload 제거, source replay 차단, FTS 재색인, 한국어 검색, dense timeout/오래된 결과/삭제와 경합, evidence budget, legacy tombstone 알고리즘, frozen prompt epoch/ACL 무효화, knowledge symlink escape/cycle, procedure 평가 gate.

process exit는 실제 전원 손실 및 스토리지 firmware 장애를 모두 모사하지 않는다. SQL payload에서 문자열이 제거되었다는 검사는 WAL/백업까지의 물리 삭제 증명이 아니다. 선언된 parent lineage의 계승은 검사하지만 모델이 누락한 parent를 자동 복원하는 기능은 없다.

## 합성 검색 결과

522개 record; 질의 26개 중 22개 answerable/4개 absent; 모드별 timed query 780회. Warm in-memory 측정.

| 모드 | Recall@5 | nDCG@5 | absent empty rate | p50 ms | p95 ms |
|---|---:|---:|---:|---:|---:|
| unicode61_only | 0.3636 | 0.3636 | 1.00 | 0.132 | 0.233 |
| cjk_bigram | 0.9091 | 0.9091 | 0.75 | 0.175 | 0.326 |
| cjk_plus_action_queries | 0.9545 | 0.9545 | 0.75 | 0.181 | 0.697 |

이 숫자는 운영 SLA도, 기존 Belmont 대비 개선율도 아니다. CJK와 query expansion에서 recall이 늘었지만 정답 없는 질의 4개 중 1개에 불필요한 결과가 나왔다. LLM의 최종 기권 성능은 측정하지 않았다. 이 작은 fixture로 한국어 전반 또는 실제 사용자의 memory action 성공률을 일반화할 수 없다.

## 재현

```bash
node --test tests/*.test.mjs
node bench/retrieval.mjs
node examples/demo.mjs
```

`results/test-output.tap`, `retrieval-benchmark.json`, `verification-manifest.json`, `patch-check.txt`가 원시 결과다. knowledge 패치는 원본의 확인된 hunk context를 재구성한 환경에서만 git apply 검사했고 최신 전체 checkout에서는 아직 검증하지 않았다.
