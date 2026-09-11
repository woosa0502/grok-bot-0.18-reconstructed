# 진행 일지 2026-09-11

| 시각(KST) | 한 일 | 결과 | 근거 |
|---|---|---|---|
| 00:08 | Belmont 호스트 재기동(git head 가 달라 `wsl:setup` 재빌드 후) + 폰 PWA(4173) 기동 | 게이트웨이 42447, aside-browse 연결, PWA 200 | `belmont-browse/.state/logs/host-restart-20260910T1510Z.log` |
| 07:30 | 폰에서 "응답 후 처리 중"이 안 사라지는 이유 조사 | 메일 확인 턴은 중간 보고 뒤 49초 실제 작업; "test" 턴은 답 뒤 빈 마무리 왕복 | 게이트웨이 상태 폴링, `store.db` 시각 |
| 07:40 | 테스트 봇 실측 | 답 뒤 꼬리 7.4초 | `docs/final-send-turn-close-2026-09-11.md` |
| 08:02 | `SendMessage final: true` 구현·테스트·재빌드·재기동, 재실측 | 꼬리 0.3초, 단위 테스트 1033/1035(실패 0) | 같은 문서 |
| 08:04 | 이전 호스트가 남긴 Electron 창(140714) 정리 | 창 하나만 남음 | — |
| 10:34 | 사용자 Aside 언어 ko-KR 우선으로 (프로필 Preferences) 후 재기동 | `navigator.language` ko-KR | `belmont-browse/.state/logs/serve-fork-20260911T0134Z.log` |
| 10:54~11:42 | 쿠팡 결정 횟수 A/B 12회 (규칙·스킬·데몬 패치·URL 이동) | 중앙값 ~15 불변, 마지막 2회 쿠팡 차단 | `docs/aside-decision-count-2026-09-11.md`, `knowledge/lessons/measurements.log` |
| 11:25 | 데몬 패치 `patch-daemon-site-knowledge.py`(한글 키워드 주입·심볼릭 링크 색인) + 909 핀 갱신 + 재기동 | daemon 364224 / Chrome 364270, 색인 24파일 | `belmont-browse/.state/logs/serve-fork-20260911T0225Z.log` |
| 11:45 | URL 직접 이동 조언 되돌림, 접근 제한 정지 규칙, 쿠팡 스킬 클릭 이동판 | 쿠팡 실행 중단(쿨다운) | 같은 문서 |
| 12:31~12:47 | 메모리 회로 실측(쿠팡 미접속): 검색이 사이트 페이지 반환, dreaming 강제 1회(설정 잠시 1→5 복구) | 회로 3단계 동작, Current 는 사실만·절차 없음 | `docs/aside-decision-count-2026-09-11.md` 마지막 절 |
| 13:05~13:09 | dreaming 절차 규칙 데몬 패치(v1 무시 → v2), 강제 dream 2회, 재기동 4회 | 사이트 페이지 4개에 절차 기록됨(쿠팡 6단계) | `docs/aside-decision-count-2026-09-11.md` 마지막 절 |
