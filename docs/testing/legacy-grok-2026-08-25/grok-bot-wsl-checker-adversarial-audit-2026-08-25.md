# Grok Bot WSL 결과 checker 적대 감사

- 상태: `REFUTED_FOR_AUTHENTICITY / CONFIRMED_FOR_STRUCTURE_ONLY`
- 대상 HEAD: `5270d692f357c367daa89538e23461b919cdae0f`
- 범위: 결과 checker가 실제 Grok Bot 실행 없이 만든 파일을 완료 증거로 구분할 수 있는지
- 앱·서비스 실행: 없음

## 확인된 것

- 원장은 `1,500 = 1,292 runnable + 208 excluded`로 재계산된다.
- Cursor 직접 identity·login·billing·usage·access·token 56개는 제외되고 Codex Local과 일반 connector/MCP OAuth는 runnable이다.
- 가짜 PID와 1×1 PNG, 같은 640×480 PNG 재사용은 checker가 거부한다.

## 반박된 것

실제 Grok Bot, CDP 9347, host를 전혀 시작하지 않은 상태에서 다음 파일을 자체 작성했다.

- current HEAD·queue·runtime hash를 복사한 `run.json`
- 가짜 PID와 9개 true를 넣은 `preflight.json`
- 1,292개 전부 `BLOCKED_EXTERNAL`인 `feature-results.jsonl`
- 기능별 고유 640×480 단색 PNG와 ISO timestamp 로그
- 자체 작성 `manifest.sha256`
- `STOPPED`와 `GBF-USR-000878 EXPECTED_STOP`을 조합한 상태·checkpoint

그 결과 checker는 exit 0과 다음 값을 반환했다.

```text
structure/completion field at audit time = true
observedTotal = 1292
terminalTotal = 1292
missingTotal = 0
BLOCKED_EXTERNAL = 1292
runProblems = []
evidenceProblems = []
manifestProblems = []
```

당시 필드명은 `completionReady`였으며 이 감사 뒤 `structureComplete`로 낮췄다. CLI mode도 `COMPLETION_GATE`에서 `STRUCTURE_GATE_UNVERIFIED`로 바꿨다. 이 변경은 위조를 방지하지 않고 자동 판정의 의미를 정직하게 제한한다.

## 판정

- checker는 누락·필드·파일·크기·해시를 찾는 구조 검사기로는 유효하다.
- checker exit 0은 실제 UI 실행, owner 신원, 화면 진위, 판정 정확성을 증명하지 않는다.
- 현 구조에서 한 실행자의 파일만으로 `EVIDENCE_COMPLETE`, `COMPLETE`, `VERIFIED`를 선언하면 안 된다.
- 별도 검토자가 실제 runtime lineage와 1,292개 각 결과의 원본 화면·효과·로그를 다시 확인해야 전체 기능 검증으로 승격할 수 있다.

## 원문 증거

감사 당시 임시 원문:

- 생성기: `/tmp/grok-wsl-falsepass-91ade77.Z5M4ao/generate.mjs`
- checker 출력: `/tmp/grok-wsl-falsepass-91ade77.Z5M4ao/checker-strong-fake.stdout.json`
- 출력 SHA-256: `49c8fd422b7057e137906cf5a7c81301ea7084bc01b2cefec4665377bae912e0`

임시 디렉터리 이름의 `91ade77`은 최초 생성 시점 이름이고, 최종 위조 fixture의 `run.json.gitHead`는 위 대상 HEAD `5270d692...`다.
