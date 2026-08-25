# Grok 0.18 테스트 자료 불변 snapshot

- 상태: `IMMUTABLE_LEGACY_INPUT / NOT_BELMONT_RESULTS`
- 이관일: 2026-08-25 KST
- 원본: `/home/hoon/orca/workspaces/MyLife/scup/external/grok-bot-0.18-reconstructed/docs`
- 원본 HEAD: `5ddf3d3d798612e4155c61c83304c5791404b3d4`
- 보존 파일: 테스트 Markdown 8개와 `audit/` 14개, 총 22개
- runnable 분모: 1,292
- excluded 분모: 208
- runnable SHA-256: `def55dc8b269e86db6820764e9ca996d6e35bdd245c8b9f562501c1cb377643e`
- queue SHA-256: `0d2b19a6096273386dd026df548f18719f3ce87bd2b60cdf79ef4bf4db144103`

이 디렉터리는 기존 Grok WSL 기능 원장, 분류 근거, 실행 문서와 과거 결과 계보를
Belmont 저장소 안에 보존한 원문 snapshot이다. 파일 내용은 이관하면서 수정하지
않았다.

## 사용 규칙

- 현재 정본은 [Belmont 실사용 검증 방법](../../belmont-user-test-method-2026-08-25.md)이다.
- 다른 모델에게는 [Belmont 단일 모델 프롬프트](../belmont-single-model-test-prompt-2026-08-25.md)를 전달한다.
- 이 디렉터리의 옛 launcher, profile, harness 명령은 현재 Belmont에서 실행하지 않는다.
- 과거 `PASS`, `FAIL`, `verdict-ledger.csv`는 Belmont 결과가 아니라 재검증 입력이다.
- 안정 feature ID, 기대 행동, source reference, batch, variant와 제외 근거만 재사용한다.
- 현재 Belmont에 맞춘 정정은 이 원문을 고치지 말고 새 queue/meta 또는 append-only
  mapping 파일에 남긴다.

## 핵심 파일

- `audit/grok-feature-registry-active.jsonl`: 1,500개 active 기능 원장
- `audit/grok-wsl-test-runnable.jsonl`: 실행 후보 1,292개
- `audit/grok-wsl-test-excluded.jsonl`: 구조적 제외 후보 208개와 근거
- `audit/grok-wsl-test-queue.meta.json`: 수량·batch·해시 정본
- `grok-bot-user-test-standard-2026-08-25.md`: 과거 결과·증거 계약
- `grok-bot-wsl-single-model-test-runbook-2026-08-25.md`: 과거 실행 규율

## 무결성 확인

이관 시 Markdown 8개는 각각 `cmp`, `audit/` 전체는 `diff -rq`로 원본과
byte-for-byte 일치를 확인했다. 이후 변경 여부는 Git diff로 확인한다.
