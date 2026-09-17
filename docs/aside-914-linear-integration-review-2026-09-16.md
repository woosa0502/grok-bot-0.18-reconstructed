# 914를 리니어에 붙이는 방법 — 검토 (2026-09-16)

용어: **리니어** = grok-bot 런타임(게이트웨이·박스·Belmont+8봇·메모리·PWA). **브라우저** = belmont-browse가 돌리는 복원 Aside 데몬. 914 = 브라우저의 새 Aside 엔진.

## 결론

리니어는 **이미 914를 쓸 수 있는 구조**다. 리니어 host의 `browse-runtime` 확장이 belmont-browse(serve.mjs)를 발견해 **"브라우저 워커"를 Task 서브에이전트 타입으로 제공**하고, 엔진은 belmont-browse가 뭘 띄우냐로 정해진다(리니어에 엔진 하드코딩 없음). 따라서 "붙이기" = **belmont-browse를 914로 띄우고 + 리니어에서 켜기(SAND_ASIDE_BROWSE=1)**.

단 **결정적 갭 1개**: 리니어는 브라우저가 `memoryAuthority:belmont / protocolVersion:1`을 보고해야 받아준다. 이건 belmont-browse가 **canonical-memory 파생본(daemon.memory-2.1.mjs)**을 로드할 때만 나오는데 **914엔 그 파생본이 없다**(909엔 있음). 만들어야 한다.

## 연결 구조 (현재)

```
리니어 host
  └ browse-runtime 확장 (opt-in: SAND_ASIDE_BROWSE=1)
        │  serve.json으로 발견 (SAND_ASIDE_BROWSE_STATE 또는 belmont-browse/.state/serve.json)
        ▼
  belmont-browse serve.mjs (127.0.0.1:9340, bearer 토큰)  ← 엔진 909/914 선택 지점
        │  /health(engine, memoryAuthority) · POST /sessions · continue/steer/stop · /memory/context
        ▼
  Aside <engine> 세션 = 브라우저 워커의 "두뇌" (fork Chrome on Xvfb)
```

- Belmont/봇이 `Task(브라우저 워커)`를 스폰 → 그 두뇌가 belmont-browse 뒤의 Aside 세션.
- `browse-client.health()`가 engine을 반환 → 리니어는 붙은 엔진을 그대로 사용(교체 자유).
- `browse-client`는 memory-context 시 `memoryAuthority!=="belmont" || protocolVersion!==1`이면 **MEMORY_AUTHORITY_MISMATCH로 거부**(browse-client.ts).

## 붙이기 위한 요건 (체크리스트)

| # | 항목 | 상태 |
|---|---|---|
| 1 | **★914 canonical-memory 파생본 생성** — `BELMONT_ASIDE_CANONICAL_MEMORY_ENGINE=914 npm run bootstrap:aside` → `vendor/aside-914/apps/daemon/build/daemon.memory-2.1.mjs`. 없으면 리니어가 메모리 권한 불일치로 거부. (914 핀·아카이브는 준비됨) | ❌ 미생성 (갭) |
| 2 | belmont-browse serve.mjs를 **엔진 914 + belmont 메모리**로 기동: `BELMONT_BROWSE_ENGINE=914 BELMONT_MEMORY_AUTHORITY=belmont ./run-fork.sh` (port transport, 914 컴포넌트, Xvfb). → /health가 engine 914 + belmont/1 보고, serve.json(9340) 기록 | ⬜ |
| 3 | **21420 비우기** — 윈도우 공식 Aside 종료(WSL 미러링 충돌) 또는 포트 이전 | ⬜ 결정 필요 |
| 4 | **리니어에서 켜기** — host env `SAND_ASIDE_BROWSE=1`로 재기동 → 브라우저 워커 서브에이전트 제공 | ⬜ |
| 5 | **발견 경로 확인** — `SAND_ASIDE_BROWSE_STATE` 지정 또는 기본 `belmont-browse/.state/serve.json` 도달 확인 | ⬜ |

## 이미 된 것 (재사용)

- 914 데몬/컴포넌트 빌드, native-identity 914 핀 검사(방금 추가), glyph 패치, QuickJS 5/5, 파이러티 5/5, 쿠팡 실시간가격 — 브라우저 자체 동작 검증 완료.
- serve.mjs API(/sessions 등)는 909와 동일 계약 → browse-runtime 클라이언트 그대로 호환.
- port transport에서 914 확장 등록·부팅 정상(pipe는 안 됨 — run-fork 기본이 port라 무관).

## 결정 필요

1. **상시 운영 vs 온디맨드**: 윈도우 공식 Aside와 WSL 브라우저는 21420 공유(미러링) → 동시 불가. (a) 공식 Aside를 평소 끄고 브라우저 워커 쓸 때만 belmont-browse 914 기동, (b) 브라우저를 다른 포트로 영구 이전(확장 7파일+fork 바이너리 패치, 취약). → 온디맨드면 (a)로 충분.
2. **914 canonical 파생본 생성 지금 할까** (요건 1). 생성 후 2~5를 이어 실제 링크 시연 가능.

## 권고

- 온디맨드 (a) 채택 + **요건 1(914 canonical 파생본) 생성**부터. 그다음 belmont-browse 914 기동(요건 2) → 리니어 SAND_ASIDE_BROWSE=1(요건 4) → Belmont에서 브라우저 워커 Task 1건으로 end-to-end 시연.
- 909는 검증본 그대로 폴백 유지(엔진 스위치는 belmont-browse 기동 인자 하나).
