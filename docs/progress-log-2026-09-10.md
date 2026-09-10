# 진행 일지 — 2026-09-10 (시간순, 맨 아래가 최신)

앞 날: `docs/progress-log-2026-09-09.md`. 상세 근거는 `docs/audit-remediation-2026-09-09.md`, 살아 있는 프로세스와 첫 명령은 `NEXT_SESSION.md`.

| 시각 | 한 일 | 결과 | 근거 |
|---|---|---|---|
| 00:0x | Windows 데몬 구성요소(909) 내용 설명 | exe·네이티브 모듈·샌드박스 helper·스킬 | 대화 |
| 00:3x | 909 데몬 JS를 Windows·macOS 실행 파일에서 꺼내 비교 | 두 플랫폼 JS 동일. 907→909 마이그레이션 3개·함수 이름 변경·도구 교체. 우리 패치 체인 2곳 실패 | `docs/aside-909-daemon-comparison-2026-09-10.md` |
| 00:4x | 깨끗한 909 번들을 research-archives(LFS)에 등록 | artifacts.json·SHA256SUMS 갱신, research-archives 테스트 통과 | `research-archives/aside/original/AsideDaemon-win-x64-1.26.909.1820.mjs` |
| 00:4x | 사용자 상태 백업(`data/artifacts/backups/state-before-909-20260910T0042Z.tgz`, 캐시 제외 683MB), 909 vendor 디렉터리 준비, 패치 도구 5개를 909에 맞게 확장 | 907 체인은 여전히 vendor와 바이트 동일 | commit 89114d6 |
| 00:5x | 909 번들 조립·설치, 상태 복사본으로 Xvfb에 전체 스택 기동해 검증 | 엔진 준비·확장 등록·메모리 native·마이그레이션 v13~15·실제 작업(example.com 제목) 15초 완료 | `data/artifacts/aside-909-20260909/verify/` |
| 00:57 | **사용자 Aside를 909로 전환**(홈 `aside-home-907` → `aside-home-909` 복사 후 기동) | daemon 22786 / Chrome 22823, 세션 33개 유지, health ready·memory native | logs/primary-relaunch-20260910T0056Z-* |

## 지금 상태

- 사용자 Aside: daemon 22786 / Chrome 22823 (00:57 기동, **엔진 1.26.909.1820**, 홈 `aside-home-909`). 되돌리기: `BELMONT_BROWSE_ENGINE=907 bash run-fork.sh`(907 홈 그대로 있음). Belmont 호스트: tmux `belmont-bot`.
- 909 적용 완료. 전수 테스트 문서는 버전 표기만 909로 읽으면 된다(경로·도구 동일).
