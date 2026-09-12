# 스킬 globs 적용 계획 (environments/scoped_to 스킵) — 2026-09-11

대상: 0.47 `AgentSkill`의 3개 스코프 필드(globs / environments / scoped_to) 중 **우리에게 의미 있는 것만** 적용.

---

## 결론 (한 줄)

**globs만 적용. environments/scoped_to는 스킵.**
globs = "지금 다루는 파일이 패턴에 맞으면 그 스킬을 자동으로 켜기". 스킬이 많아질 때 토큰·혼란을 줄인다.
environments/scoped_to는 다환경·다봇 조직용이라 개인·단일환경엔 죽은 필드.

---

## 왜 이 판정인가

| 필드 | 뜻 | 개인용 | 판정 |
|---|---|---|---|
| **globs** | 파일 패턴(`*.py`, `쿠팡*.md`) 맞으면 스킬 자동 on | 스킬 많아지면 쓸모 | **적용(단계적)** |
| environments | 실행 환경(box)별 on/off | 단일 WSL 환경 → 구분 대상 없음 | ❌ 스킵 |
| scoped_to | 봇별 on/off | 봇 하나 → 무의미 | ❌ 스킵 |

우리 현재 동작(실측): 활성 스킬을 **전부** 시스템 프롬프트에 "이름+설명"으로 나열
(`promptSkillsFromWorkflows`). 스킬 2~3개면 문제없지만, 늘어나면 **전부 나열 = 낭비**.
globs는 이걸 "맥락 맞는 것만"으로 바꾸는 장치.

---

## 적용 지점 (실측한 코드 위치)

우리 스킬 엔진은 이미 있고, globs는 **3곳만** 손대면 된다.

### ① frontmatter에서 globs 읽기
`source/shared/workflow-model.ts:22` `parseWorkflowFile()` — SKILL.md frontmatter가 `data`로 들어옴.
```
SKILL.md frontmatter 예:
  ---
  name: 쿠팡 파싱 요령
  description: 쿠팡 상품/가격 추출 규칙
  globs: ["*coupang*", "쿠팡*"]
  ---
```
→ `parseWorkflowFile`이 `data.globs`(문자열 배열)를 파싱해 반환.

### ② WorkflowRecord에 globs 필드 추가
`source/shared/workflow-model.ts:7` `interface WorkflowRecord` 에 `globs?: readonly string[]` 추가.
`workflow-store.ts`의 `skillToWorkflow`/`managedSkillToWorkflow`/`pluginSkillToWorkflow`가 이 필드를 채움.

### ③ 스킬 선택에 glob 매칭
`source/shared/workflow-model.ts:40` `promptSkillsFromWorkflows()` — 현재 필터:
```
trigger==null && isEnabledForAgent && !disableModelInvocation && filePath.length>0
```
여기에 **glob 매칭 옵션** 추가:
- globs 없는 스킬 = 지금처럼 항상 나열 (하위호환)
- globs 있는 스킬 = **현재 컨텍스트(열린 파일/작업 경로/URL)가 매칭될 때만** 나열
- 컨텍스트는 프롬프트 조립부(`system-prompt-assembly.ts:242`)가 이미 가진 활성 파일/작업 정보 사용.

---

## 단계 계획 (개인용, 최소 침습)

### Phase 0 — 지금 (구현 안 함, 준비만)
- 스킬이 아직 적으니 **당장 필요 없음.** globs 없이 "전부 나열"로 충분.
- SKILL.md에 `globs:` 를 **써 둬도 무시되게** (하위호환) — 나중에 켜면 바로 동작.

### Phase 1 — globs 파싱 + 필드 (스킬 5개+ 될 때)
- ①② 구현: frontmatter의 globs를 읽어 WorkflowRecord에 담기.
- 이 시점엔 **매칭은 안 하고 데이터만 보유** (안전).

### Phase 2 — glob 매칭 필터 (실제 자동선택)
- ③ 구현: 컨텍스트 매칭 시에만 주입.
- 매칭 없으면 "이름만" 나열, 매칭되면 "본문까지" 주입하는 2단계도 가능(토큰 절약 극대화).

---

## 스킵하는 것 (명시)

- **environments**: 필드 자체를 추가하지 않음. 단일 환경이라 항상 true와 동일 → 코드에 넣으면 죽은 분기만 늘어남.
- **scoped_to**: 마찬가지. 봇/에이전트가 하나면 항상 매칭 → 무의미.
- (미래에 봇을 여러 개 굴리게 되면 그때 scoped_to만 재검토. environments는 WSL 단일이라 계속 불필요.)

---

## 리스크 / 주의

- **하위호환 필수**: globs 없는 기존 스킬은 동작 변화 0이어야 함. (필터를 "globs 있을 때만 조건 적용"으로.)
- **매칭 컨텍스트 정의**: "지금 다루는 파일"이 브라우징 작업엔 애매할 수 있음 → URL 호스트/작업 키워드도 매칭 대상에 포함할지 정해야 함(Phase 2에서 결정).
- **과잉주입 방지**: glob이 너무 느슨하면 오히려 다 켜짐 → 스킬 저자가 좁게 쓰도록.

---

## 다음 수

- **지금 당장 할 일: 없음** (스킬 적어서 globs 불필요).
- **트리거**: 스킬이 5개를 넘거나 "상황맞춤 자동선택"이 필요해지면 Phase 1부터.
- 하고 싶으면 Phase 1(파싱+필드, 무해)만 먼저 넣어 둬도 됨 — 데이터만 보유, 동작 변화 없음.

## 근거 파일
- 스킬 선택: `source/shared/workflow-model.ts:40` (promptSkillsFromWorkflows)
- frontmatter 파서: `source/shared/workflow-model.ts:22` (parseWorkflowFile)
- 프롬프트 주입: `source/host/runner/system-prompt-assembly.ts:242`
- 0.47 스키마 근거: `data/artifacts/grok-047-skills-canvas-extract/schemas/skill-messages.proto` (AgentSkill.globs/scoped_to/environments)
