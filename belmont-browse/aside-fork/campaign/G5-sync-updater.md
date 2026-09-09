# G5-sync-updater — 담당 구간 14개, 406,400 B

원자료: data/artifacts/aside_fork_map_825_20260906/analysis/patch-map.json (start_hex로 찾기). 상태: 미재현=안 만듦, 부분=덜 만듦, 미확인=못 알아냄, 재현(표면)=겉만.

| # | 구간(x86_64) | 크기 | 상태 | 하위 계통 | 이름표 |
|---|---|---|---|---|---|
| 1 | 0x0a6f77e0–0x0a713cb0 | 113,680 | 미재현 | sync | sync 프로토콜 엔티티 (AsideWebsiteStorage 포함) |
| 2 | 0x0491e180–0x04930530 | 72,560 | 미재현 | component-updater | 컴포넌트 업데이터 — Aside Daemon 배포·기동·강제종료 |
| 3 | 0x04768830–0x0477b300 | 71,728 | 부분 | daemon-auth/sync | 데몬 인증·동기화 암호화 키 대기 상태기계 |
| 4 | 0x04a2a8d0–0x04a346f0 | 37,616 | 미재현 | sync | sync 엔진 — 데이터 타입 구성·암호화 타입 변경 |
| 5 | 0x04a20f90–0x04a2a000 | 34,976 | 미재현 | sync | sync 특정 필드 — 결제·contextual_task·aside_website_storage |
| 6 | 0x081c26d0–0x081c7c40 | 19,888 | 미재현 | updater | Aside 자체 업데이터 클라이언트(mac) |
| 7 | 0x04a357a0–0x04a3a650 | 13,808 | 미재현 | component-updater | 컴포넌트 업데이터 파이프라인·언패커 |
| 8 | 0x081cc570–0x081cee30 | 9,616 | 미재현 | updater | 업데이터 mojo 프록시 |
| 9 | 0x04bbb1d0–0x04bbd420 | 8,000 | 미재현 | sync | sync 무효화(invalidation) 지표 |
| 10 | 0x081c9f90–0x081cc040 | 7,168 | 미확인 | updater | (미확인, 업데이터 인접) |
| 11 | 0x0cf48930–0x0cf4a510 | 6,144 | 미재현 | sync | sync 엔진 백엔드 제어 타입 |
| 12 | 0x081c06c0–0x081c1ca0 | 4,944 | 미재현 | updater | 업데이터 등록·버전 확인 |
| 13 | 0x0cf4aff0–0x0cf4c140 | 3,872 | 미재현 | sync | sync 엔진 암호문구 API |
| 14 | 0x081d0360–0x081d0e70 | 2,400 | 미재현 | updater | 업데이터 번들 경로 — at.studio.AsideUpdater |
