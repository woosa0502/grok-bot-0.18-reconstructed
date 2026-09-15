# Belmont Memory 2.1 — Memory 2.0 incremental learning loop

기존 커널 보존. **157 tests pass = original 61 unchanged + 96 new.**

구현: SQLite canonical typed learning, time/context preferences, hybrid query path + real cosine sidecar,
multilingual E5 HTTP adapter/service code, episode/source-span navigation, bounded relation graph,
reference action arguments, Aside-compatible experience HTTP ingestion and measured procedure feedback.

**중요: pretrained E5 inference와 실제 Belmont/Aside 배포는 실행하지 않았다.**
HTTP vector tests use labeled geometric test doubles. C/dense ablation rows are sparse fallback,
not semantic quality results. P0 production completion is not claimed.

## 실행

```bash
node --test tests/*.test.mjs       # 사전 빌드 dist, npm 설치 불필요
node bench/ablation.mjs           # GitHub source-derived 38 docs / 32 queries
node bench/closed-loop.mjs        # authored conversations / 20 queries / 8 action cases
node examples/closed-loop.mjs     # learning -> next session -> explicit correction
```

소스 수정 후 `npm install && npm run build && npm run test:prebuilt`.
Node22.16.0에서 실행했다. 실제 Belmont Node26.5.x full CI는 별도다.
신경 모델 설정 후 `BELMONT_REQUIRE_DENSE=1 node bench/ablation.mjs`를 사용하면 모델 미실행 또는 fallback을 평가 성공으로 인정하지 않는다.

## 읽을 파일

- `docs/IMPLEMENTATION.ko.md`: architecture, migration, host wiring, model setup, 10 questions.
- `docs/VALIDATION.ko.md`: 모든 ablation과 한계, 실행 명령.
- `results/verification-manifest.json`, `results/all-current.tap`: 실제 실행 범위/원문.
- `results/repository-ablation.json`, `results/closed-loop-ablation.json`: query-level 결과와 action arguments.
- `patches/upgrade-2.0-to-2.1.patch`: 기존 reference package에 대한 증분 patch.
- `scripts/install-overlay.mjs`: 실제 Belmont 구조에 additive 파일 설치, 기본 dry-run.
- `baseline-2.0/`: 이전 결과. 현재 실행 결과와 혼동하지 말 것.

## 기본값

Planning on; dense/hierarchy/graph off. Dense는 model service와 calibration 이후 명시 활성화한다.
Hierarchy/graph는 이번 평가에서 default adoption을 정당화하지 못했다.
Vector index는 삭제·재생성 가능하다. memory.sqlite 정본을 vector sidecar로 대체하지 않는다.

## 배포 파일 주의

`dist/`는 이 독립 패키지를 npm 없이 검증하기 위한 사전 빌드다. 기존 Belmont 저장소에 generated dist를 커밋하지 않는다.
실제 host overlay installer는 TypeScript source만 복사하며 기존 MemoryService와 runner를 자동 덮어쓰지 않는다.
이 패키지는 GitHub에 push/PR을 만들지 않았다.
