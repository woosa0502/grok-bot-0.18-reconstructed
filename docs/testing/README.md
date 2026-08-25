# Belmont WSL 테스트 문서

- 현재 정본: [전체 기능 실사용 검증 방법](../belmont-user-test-method-2026-08-25.md)
- 다른 모델 전달: [단일 모델 테스트 프롬프트](belmont-single-model-test-prompt-2026-08-25.md)
- 실행 plan 예제: [examples](examples/)
- pilot 필수조치 결과: [2026-08-26 remediation](belmont-pilot-remediation-2026-08-26.md)
- 이관된 과거 자료: [legacy Grok snapshot](legacy-grok-2026-08-25/README.md)

현재 상태는 `PILOT_REMEDIATED_PROVISIONAL / 1292_QUEUE_READY`다. queue 재기준화는
1,292행으로 완료됐지만 pilot은 독립 승인 전이며, full host toolset이 로컬 Codex
대화에 연결되지 않는 `GB-CORE-001` 때문에 tool-dependent batch는 계속 막힌다.
legacy 결과는 Belmont 통과 결과가 아니다.
