# 스킬 스코프 3필드 적용 계획 — globs / environments / scoped_to (2026-09-11)

0.47 `AgentSkill`의 스코프 필드 3개를 우리 Belmont에 어떻게 적용할지. **각각 판정+코드지점+단계**.

전제(실측): 우리는 스킬 엔진(`FileWorkflowStore`)을 이미 갖고 있고, 그 중 **scoped_to에 해당하는
기존 기능(`AgentWorkflowEnablement`)이 이미 있다.** 그래서 3개가 다 "0부터"가 아니다.

---

## 요약 표

| 필드 | 뜻 | 개인용 필요 | 우리 기존 대응 | 적용 판정 |
|---|---|---|---|---|
| **globs** | 파일/작업 패턴 맞으면 스킬 자동 on | 스킬 많아지면 쓸모 | 없음 | **신규 구현 (단계적)** |
| **environments** | 실행 환경(box)별 on/off | 단일 WSL이라 약함 | box 개념은 있음(`source/host/box/`) | **최소 구현 or 스킵** |
| **scoped_to** | 봇/에이전트별 on/off | 봇 하나면 약함 | **이미 있음**(`AgentWorkflowEnablement.isEnabled`) | **기존 것 유지, 확장만** |

---

## 1. globs — 신규 구현 (핵심)

### 무엇
SKILL.md에 파일/작업 패턴을 달아, **현재 컨텍스트가 맞을 때만** 그 스킬을 프롬프트에 주입.
```
---
name: 쿠팡 파싱 요령
globs: ["*coupang*", "쿠팡*"]
---
```

### 코드 지점 (3곳)
1. `source/shared/workflow-model.ts:22` `parseWorkflowFile()` — frontmatter `data.globs` 파싱.
2. `source/shared/workflow-model.ts:7` `WorkflowRecord` — `globs?: readonly string[]` 추가.
   (+ `skillToWorkflow`/`managedSkillToWorkflow`/`pluginSkillToWorkflow`가 채우기)
3. `source/shared/workflow-model.ts:40` `promptSkillsFromWorkflows()` — glob 매칭 필터.
   - globs 없음 = 지금처럼 항상 나열(하위호환)
   - globs 있음 = 컨텍스트(열린 파일/작업경로/URL 호스트) 매칭 시에만 나열

### 단계
- **Phase 1**: 파싱+필드만 (매칭 안 함, 데이터만 보유 — 무해).
- **Phase 2**: 매칭 필터 실동작. 매칭 컨텍스트에 "브라우징 URL 호스트"도 포함(직구 보조 특성).

---

## 2. environments — 최소 구현 or 스킵

### 무엇
스킬이 특정 실행 환경(box)에서만 활성. 0.47: `environments` / `disabled_environments`.

### 우리 현실
- 우리는 **box 개념은 있으나**(`loopback-sand-box`, `production`) 실사용은 **단일 WSL 환경**.
- 환경이 하나면 "environments 매칭"은 **항상 true** → 분기 자체가 무의미.

### 판정: **필드만 수용, 강제 안 함 (관대한 무시)**
- `parseWorkflowFile`이 `data.environments`를 **읽어서 보관은 하되**, 매칭 로직은 **미구현**.
- 이유: 나중에 진짜 다환경(원격 box 등)을 쓰게 되면 그때 필터만 추가. 지금 분기 넣으면 죽은 코드.
- SKILL.md에 `environments:` 써도 **에러 없이 무시** (하위호환·전방호환).

### 스킵 근거
- 개인·단일 WSL에선 켜봐야 효과 0. **구현 우선순위 최하.**

---

## 3. scoped_to — 기존 것 유지 + 확장

### 무엇
스킬이 특정 봇/에이전트에게만 보임. 0.47: `scoped_to` (에이전트 id 목록).

### 우리 기존 대응 (이미 있음!)
- `AgentWorkflowEnablement.isEnabled(id)` = **에이전트 디렉터리별 스킬 on/off**.
- `skillToWorkflow`가 `isEnabledForAgent: this.enablement.isEnabled(record.id)`로 이미 봇별 활성 판정.
- 즉 **"봇별 스코프"는 우리가 이미 하고 있다** — 방식만 다름(0.47은 스킬에 목록, 우리는 에이전트에 활성목록).

### 판정: **기존 방식 유지. 필드는 수용만.**
- 우리 방식(에이전트별 enablement)이 더 단순하고 이미 작동 → 굳이 0.47식 `scoped_to` 목록으로 안 바꿈.
- `parseWorkflowFile`이 `data.scoped_to`를 **읽어서 보관**은 하되, 활성 판정은 **기존 enablement 유지**.
- 봇 하나면 어차피 전부 활성 = 지금 동작과 동일.

### 확장 여지 (미래)
- 봇을 여러 개 굴리게 되면: 현재 `AgentWorkflowEnablement`가 이미 봇별이라 **그대로 확장 가능**.
  스킬쪽 `scoped_to`를 쓸지, 에이전트쪽 enablement를 쓸지는 그때 택1.

---

## 통합 단계 계획

| Phase | 내용 | 3필드 |
|---|---|---|
| **Phase 1 (무해, 지금 넣어도 됨)** | `parseWorkflowFile`이 globs/environments/scoped_to **3개 다 읽어서 WorkflowRecord에 보관** | 파싱만, 동작변화 0 |
| **Phase 2 (스킬 5개+ 될 때)** | globs **매칭 필터** 실동작 (컨텍스트=파일+URL) | globs만 활성화 |
| **Phase 3 (다환경/다봇 될 때만)** | environments 필터 / scoped_to 판정 추가 | 필요해지면 |

### 핵심 설계 원칙
- **3개 다 "필드는 수용, 강제는 단계적"** → SKILL.md에 셋 다 써도 에러 없음(전방호환).
- **하위호환 절대**: 필드 없는 기존 스킬 = 동작 변화 0.
- **globs만 실질 신규**, environments는 죽은 필드(보관만), scoped_to는 우리 기존 것이 대신함.

---

## 결론

- **globs**: 실제로 만들 것 (Phase 1 파싱 → Phase 2 매칭). 스킬 많아질 때 값.
- **environments**: 필드만 읽어두고 매칭 미구현. 단일 환경이라 사실상 스킵.
- **scoped_to**: **우리가 이미 `AgentWorkflowEnablement`로 하고 있음.** 필드만 수용, 기존 유지.

→ 지금 당장 실질 작업은 **Phase 1(3필드 파싱+보관, 무해)** 하나면 3개 다 "수용" 상태가 되고,
globs만 나중에 Phase 2로 켜면 된다.

## 근거 파일
- 스킬 활성 판정(scoped_to 대응): `source/host/workflows/workflow-store.ts:31` (isEnabledForAgent)
- 봇별 enablement: `source/host/agents/agent-workflow-enablement.js`
- 스킬 선택(globs 지점): `source/shared/workflow-model.ts:40`
- frontmatter 파서(3필드 지점): `source/shared/workflow-model.ts:22`
- box(environments 대응): `source/host/box/`
- 0.47 스키마: `data/artifacts/grok-047-skills-canvas-extract/schemas/skill-messages.proto`
