# 스킬 적용 계획 — 0.47 대비 우리 Belmont 상태 (2026-09-11)

목표: 0.47 스킬을 우리(0.18 재구성)에 적용. 그 전에 **우리가 이미 뭘 가졌나** 실측했더니
결론이 바뀌었다.

---

## 결론 (한 줄)

**우리는 스킬 시스템을 이미 갖고 있다.** "workflows"라는 이름으로 SKILL.md 스캔·로드·프롬프트 주입까지
동작한다. 그러니 "새로 만들기"가 아니라 **0.47 대비 몇 가지 격차만 메우면** 된다.

---

## 우리 현재 상태 (실측, `source/host/workflows/`)

**`FileWorkflowStore`** = 사실상 우리 스킬 엔진:
- ✅ **SKILL.md 파일 스캔** (`readPluginSkillFileFacts`, `readdirSync`, helperScripts 수집)
- ✅ **3개 소스 통합**: `managed`(팀/관리형) · `plugin`(플러그인) · `workflow`(로컬)
- ✅ **디렉터리 감시** (`WatchedDirectory`, 변경 실시간 반영)
- ✅ **프롬프트 주입 배선** (`system-prompt-assembly.ts:242` — `promptSkillsFromWorkflows` → `renderWorkflowsSystemPrompt`)
- ✅ **세션 연결** (`workflowStoreForDbPath`가 세션마다 스토어 생성)
- ✅ **수동 첨부 스킬** 렌더 (`renderManuallyAttachedSkillsSection`, gray-matter 파싱)

### 우리 `WorkflowRecord` ↔ 0.47 `AgentSkill` 필드 대응

| 0.47 AgentSkill | 우리 WorkflowRecord | 상태 |
|---|---|---|
| content | body | ✅ |
| description | description | ✅ |
| full_path | filePath | ✅ |
| disable_model_invocation | disableModelInvocation | ✅ |
| (helper scripts) | helperScripts | ✅ |
| environments / disabled_environments | — | ❌ 없음 |
| globs | — | ❌ 없음 |
| scoped_to | — | ❌ 없음 |
| plugin / marketplace / plugin_id | pluginId | △ 부분 |
| package_type (CLAUDE_SKILL/PLUGIN/CURSOR_*) | source (managed/plugin/workflow) | △ 다른 분류 |

---

## 0.47 대비 실제 격차 (메울 것)

| 격차 | 0.47엔 있고 우리엔 없음 | 개인용 필요도 | 난이도 |
|---|---|---|---|
| **1. Claude Skill 포맷 호환** | `PACKAGE_TYPE_CLAUDE_SKILL/CLAUDE_PLUGIN` — Claude 스킬/플러그인을 그대로 로드 | **높음** (생태계 호환) | 중 |
| **2. environments 스코프** | 스킬이 특정 환경(box)에서만 활성 | 낮 (개인 단일환경) | 낮 |
| **3. globs 자동적용** | 파일 패턴 맞으면 스킬 자동 활성 | 중 | 중 |
| **4. scoped_to** | 특정 에이전트/봇에만 적용 | 낮 (개인) | 낮 |
| **5. 스킬 생성 UI/도구** | "Ask your Bot to create one" — 에이전트가 스킬을 만듦 | 중 | 중 |
| 게시/공유(Cursor team) | ShareCanvas류 클라우드 | ❌ 불필요 | — |

---

## 적용 계획 (개인용 우선순위)

### Phase 1 — Claude Skill 포맷 호환 (핵심, 권장 먼저)
0.47의 골격은 **`PACKAGE_TYPE_CLAUDE_SKILL` = Claude의 SKILL.md 포맷을 그대로 받는 것.**
우리 `FileWorkflowStore`는 이미 SKILL.md를 읽으니, **Claude 스킬 디렉터리 규약**(SKILL.md +
frontmatter: name/description + 본문 + 헬퍼 파일)에 맞춰 로더를 정렬하면 된다.
- 할 일: `readPluginSkillFileFacts`의 frontmatter 파싱을 Claude 규약(name/description/allowed-tools 등)과 맞춤.
- 이득: **Claude용으로 만든 스킬을 그대로 우리 봇에 붙임** (생태계 호환).

### Phase 2 — globs 자동적용 (선택)
`AgentSkill.globs` 필드 추가 → 현재 파일/작업이 glob에 맞으면 그 스킬을 자동으로 프롬프트에 주입.
- 우리 `WorkflowRecord`에 `globs?: string[]` 추가 + `promptSkillsFromWorkflows`에서 매칭 로직.

### Phase 3 — 스킬 생성 도구 (선택)
에이전트가 대화 중 스킬을 만들 수 있게 (`create skill` 도구 → SKILL.md 파일 작성).
- 0.47 UI 텍스트: "No private skills yet. Ask your Bot to create one for you."

### 안 할 것
- 게시/공유/팀 (Cursor 클라우드 의존, 개인용 불필요)
- environments/scoped_to (단일 환경·단일 사용자라 무의미)

---

## 다음 수

**Phase 1(Claude Skill 포맷 호환)이 가성비 최고.** 우리 스킬 엔진이 이미 있으니
로더를 Claude 규약에 맞추면 "Claude 스킬 그대로 쓰기"가 열린다.
→ 이걸 실제 구현으로 진행할지 결정 필요. (우리 `readPluginSkillFileFacts` + frontmatter 파서 수정)

## 근거 파일
- 우리 스킬 엔진: `source/host/workflows/workflow-store.ts` (FileWorkflowStore)
- 프롬프트 주입: `source/host/runner/system-prompt-assembly.ts:242`
- 수동 스킬 렌더: `source/packages/agent/context-processing-manual-skills.ts`
- 0.47 스키마: `data/artifacts/grok-047-skills-canvas-extract/schemas/skill-messages.proto`
