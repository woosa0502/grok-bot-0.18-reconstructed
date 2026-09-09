# 진행 일지 — 2026-09-10 (시간순, 맨 아래가 최신)

앞 날: `docs/progress-log-2026-09-09.md`. 상세 근거는 `docs/audit-remediation-2026-09-09.md`, 살아 있는 프로세스와 첫 명령은 `NEXT_SESSION.md`.

| 시각 | 한 일 | 결과 | 근거 |
|---|---|---|---|
| 00:0x | Windows 데몬 구성요소(909) 내용 설명 | exe·네이티브 모듈·샌드박스 helper·스킬 | 대화 |
| 00:3x | 909 데몬 JS를 Windows·macOS 실행 파일에서 꺼내 비교 | 두 플랫폼 JS 동일. 907→909 마이그레이션 3개·함수 이름 변경·도구 교체. 우리 패치 체인 2곳 실패 | `docs/aside-909-daemon-comparison-2026-09-10.md` |
| 00:4x | 깨끗한 909 번들을 research-archives(LFS)에 등록 | artifacts.json·SHA256SUMS 갱신, research-archives 테스트 통과 | `research-archives/aside/original/AsideDaemon-win-x64-1.26.909.1820.mjs` |

## 지금 상태

- 사용자 Aside: daemon 931697 / Chrome 931737 (9/9 21:15 기동, 907 수정 빌드). Belmont 호스트: tmux `belmont-bot`.
- 909 업그레이드는 사용자 결정 대기. 전수 테스트 문서는 907 기준으로 작성돼 있음.
