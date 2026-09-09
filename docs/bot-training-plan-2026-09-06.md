# 봇 트레이닝 계획서 — 브라우저 봇 제외 (2026-09-06)

_이 문서 하나만 읽고 바로 시작할 수 있게 썼다. 전담 세션(Opus)용._
_읽는 순서: §1 결론 → §9 첫 지시문 → 나머지는 일하면서 참조._

---

## 1. 결론 먼저

브라우저 봇을 뺀 우리 봇 9개(+그룹 1, 임시 1)를 **원본 Grok Bot 사용자가 실제로 시킨 문장으로 재검사**해서, 못 하는 것을 봇의 지시문·기억·스킬·루틴·도구 권한으로 고친다. 순서는 이렇다. 먼저 사례를 모은다(원본 마켓플레이스 공개 봇 69개의 운영 규칙, 원장 1,500행 중 모델 경로 441개, 공식 문서 8쪽, SNS·유튜브 후기). 그다음 사례를 **그대로 복사한 지시문**으로 봇에 시키고, 호스트 게이트웨이를 통해 결과·시간·개입 횟수를 잰다. 실패하면 부검해서 원인이 봇 쪽(지시문·기억·스킬·루틴)인지 하네스 쪽(호스트 코드)인지 가르고, 봇 쪽이면 손잡이 하나만 바꿔 재검사하고, 하네스 쪽이면 목록에만 올린다. 재는 자는 브라우저 봇 때 쓴 `test/parity/drive.mjs`를 `agentId`만 바꿔 그대로 쓴다. 이 방식은 이미 브라우저 봇에서 통했다 — 계정 없이 되는 16개 중 15개 실행, 15개 전부 결과 정확·개입 0.

---

## 2. 트레이닝 대상 봇

봇 데이터는 전부 `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/agents/<id>/` 안에 있다. 아래 표의 "지시문 길이"는 `profile.json`의 `description` 글자 수다.

| 봇 (id 앞 8자) | 원본 Grok Bot에서의 역할 (근거) | 지금 상태 | 트레이닝 목표 |
|---|---|---|---|
| **Belmont** `40fb61e3` | 원본에는 없는 우리 확장. 원본 기준선 §1 "사용자는 Grok하고만 대화한다 / Grok이 워커를 생성·지시·검증한다"의 그 자리 (`grok-bot-user-test-standard` §1) | 지시문 2,695자, 모델 gpt-5.6-sol high, 기억 명시 143 + 합성 52 + profile.md 22줄 + 로그 183줄, 루틴 2개(job-sweeper 포함), 스킬 5개 켜짐 | 위임 왕복이 한 번에 끝나기. 원천 검증(폴더 개수 등)으로 확인. 같은 일 재요청 0회 |
| **Clerk** `97ab5a3d` | 원본의 "bounded 작업 워커" 대응 — 원본은 Task/Subagent 도구로 처리(`task.ts`, 원장 AGENT 15행) | 지시문 1,221자, gpt-5.6-luna max, 기억 0, 루틴 0, 스킬 0 (전부 끔) | 시킨 명령 그대로, 결과+근거만. 재설계·추가 조사 0 |
| **Scribe** `282110e5` | 원본의 요약·초안 (공식 문서 chat-and-collaboration) | 지시문 1,238자, gpt-5.6-luna max, 기억 0, 루틴 0, 스킬 summary 1개, **도구 금지 3종**(ExternalShell·ExternalRead·Computer) | 준 자료만으로 고정 양식 산출. 숫자·이름 보존 |
| **Research Bot** `1bb7efa9` | 원본의 WebSearch·WebFetch·서브에이전트 병렬 조사 (원장 AGENT: WebSearch 3행, WebFetch 5행, Task 15행) | 지시문 1,360자, gpt-5.6-sol medium, 기억 0, 루틴 0, 스킬 research 1개 | 결론→근거(링크)→미확인 3단. 시간 제한 지키기 |
| **Coding Bot** `8413b3eb` | 원본의 파일 편집·Shell·테스트 실행 (원장 AGENT: 파일 편집 4행, Shell 7행, 로컬 셸 8행) | 지시문 1,260자, gpt-5.6-sol high, 기억 0, 루틴 0, 스킬 code-change 1개 | 읽기→최소 변경→실제 실행→실제 출력 보고 |
| **QA Bot** `b2d1c233` | 원본의 auto-review·승인 게이트가 하던 "위험 사전 판정"의 사람 쪽 대응 (원장 AGENT: auto-review-controller 7행) | 지시문 1,352자, gpt-5.6-terra high, 기억 0, 루틴 0, 스킬 code-change 1개 | 심각도 순 지적 + 판정 한 줄(go / 조건부 / stop) |
| **Grok** `7cce3ad7` | 원본의 기본 대화 봇 그 자체 | 지시문 262자(가장 짧음), gpt-5.6-terra medium, 합성 기억 5개, 루틴 0, 스킬 research 1개 | 도구 없이 답할 것과 도구 쓸 것을 스스로 가르기 |
| **Tech Demos** `37f35796` | **원본 마켓플레이스 실제 봇**(Matt Palmer). 운영 규칙 8개·스킬 1개·루틴 1개를 그대로 가져옴 | 지시문 2,734자(가장 김), gpt-5.6-terra medium, 기억 0, 루틴 1개(`daily-x-tech-scout`, 꺼짐), 스킬 research 1개 | **원본 대조군.** 원본 규칙을 그대로 준 봇이 원본처럼 행동하는지가 다른 봇 지시문의 기준이 된다 |
| **딥시크** `0ba28117` | 없음(우리가 붙인 무료 엔드포인트 봇) | 지시문 107자, 모델 `nvidia/deepseek-ai/deepseek-v4-flash-0731`, **NVIDIA_API_KEY 없음**, 기억 0, 루틴 0, 스킬 summary 1개 | 키가 없으면 트레이닝 대상에서 빼고 그 사실만 기록. 키가 있으면 Scribe와 같은 검사표로 |
| **모바일 테스트 그룹** `e294c57a` | 원본의 그룹 채팅 2~6봇, `@everyone`, 보이는 handoff (`belmont-018-parity-inventory` §1) | 멤버 Scribe+Clerk, 지시문 11자 | 그룹 한 번 던지면 두 봇이 각자 답하고 겹치지 않기 |
| 모바일 테스트 봇 `4231da8a` | — | "PWA 검토용 임시 봇. 삭제해도 됨" | **대상 아님.** 검사 대조군으로만 |
| New Agent `subagent-dda62c6f` | — | 빈 봇, 대화 0 | **대상 아님.** 삭제 후보 (지우지 말 것 — 사용자 결정) |

**브라우저 봇 `4cf461d4`는 이 계획서의 대상이 아니다.** 다른 세션이 그 봇으로 작업 중이다.

### 지금 상태에서 이미 보이는 것

- 9개 중 **8개가 기억 0개, 루틴 0개**다. 원본 사례의 자율성은 대부분 "기억으로 실수를 안 되풀이하고, 루틴으로 스스로 다시 깨어나는 것"인데 그 두 장치가 Belmont와 Grok 말고는 비어 있다.
- 스킬은 전역 서재 `sand-data/workflows/` 6개뿐이고, 봇마다 `enabled-workflows.json`으로 끄고 켠다. `plugin-skills`는 빈 배열, `managed-skills`는 빈 폴더다.
- 지시문 길이가 107자부터 2,734자까지 25배 차이 난다. 원본 마켓플레이스 봇 평균은 2,600자다(`scripts/lib/grok-bot-template.mjs` 머리말, 69개 전수 확인). **Grok(262자)·딥시크(107자)는 원본 기준으로 지시문이 거의 없는 셈이다.**

---

## 3. 사례 조사 방법

### 3.1 어디서 (좋은 순서대로)

| # | 출처 | 무엇이 나오나 | 접근 방법 | 상태 |
|---|---|---|---|---|
| S1 | **Grok Bot 마켓플레이스 공개 봇 69개** `https://x.ai/bot/marketplace/bots/<slug>` | 봇 이름·제작자·설명·**운영 규칙(memories, 평균 2,600자)**·스킬 이름과 한 줄 설명·루틴 이름과 요약·연동 이름 | `scripts/lib/grok-bot-template.mjs`의 `parseMarketplaceBot(html)`을 그대로 쓴다. 페이지는 Next.js RSC 덩어리라 이 파서가 필요하다 | **1순위.** 실제 사용자가 자기 봇에 뭘 시켰는지가 규칙 문장으로 그대로 나온다 |
| S2 | 검증 누락 원장 `AGENT_REACHABLE` 405행 / 441원자 | 모델이 하는 행동 단위 (기억 쓰기, 루틴 만들기, Await, TodoWrite, 승인 대기 등) | `docs/testing/legacy-grok-2026-08-25/grok-bot-verified-gap-ledger-2026-08-25.md` 2448행부터 | 하네스 후보의 원천 |
| S3 | 공식 문서 8쪽 `docs.x.ai/grok-bot/*` | 기능 이름과 공식 설명 (overview·bots·chat-and-collaboration·files-and-results·computer-and-apps·skills-routines-and-automations·settings-and-notifications·approvals-security-and-privacy) | 이미 `docs/testing/belmont-018-parity-inventory-2026-08-31.md` §1에 전수 대조표가 있다. 새로 안 받아도 된다 | 기능 이름 사전 |
| S4 | 앱 해부(안드로이드 1.5.0) | 화면 이름·문자열·기능 식별자 | `data/artifacts/grokbot_android_apk_decompile_20260902/{README.md,summary.json}`, 문자열은 `hermes/index.android.v98.hasm`(176MB, grep으로만) | 보조. **모바일 앱은 1.5.0이고 우리 기준선은 0.18이라 기능 차이가 있다** |
| S5 | 유튜브 후기 자막 | 사용자가 실제로 말한 지시 문장 | `yt-dlp --write-auto-sub --skip-download --sub-lang ko`. 브라우저 봇 때 10편 받아 `belmont-browse/aside-fork/usecases/sources/*.txt`에 있다 | 브라우저 사례가 섞여 있으니 걸러 쓴다 |
| S6 | 블로그·커뮤니티 | 긴 실사용 후기 | Jina 리더 `https://r.jina.ai/<원본 URL>`로 본문을 텍스트로 뽑는다 | 됨 |
| S7 | HN | 반응·불만 | `https://hn.algolia.com/api/v1/search?query=...` (공개 API, 차단 없음) | 됨 |
| S8 | X(트위터) | 출시 트윗·공식 계정 타임라인 | 개별 글은 tweet-result 엔드포인트로 받았다. **X 검색은 차단**이라 타임라인과 링크가 알려진 개별 글만 확보된다 | 반쪽 |
| S9 | Reddit | — | **차단.** 브라우저 봇 회차에서 뚫지 못했다 | 안 됨 |

막히면 이 환경의 `insane-search` 스킬을 쓴다(차단 우회 자동 시도: yt-dlp, Jina, 공개 API, curl_cffi).

### 3.2 무엇을 적나

사례 하나는 **한 사람이 봇에게 시킨 한 가지 일**이다. 기능 이름이 아니다. "메모리 기능이 있다"는 사례가 아니고, "미발행 글을 발행해 버린 사고 뒤에 봇이 스스로 재실수 방지 노트를 남겼다"가 사례다.

각 사례에 이 6개를 반드시 채운다.

1. **시킨 문장 원문** — 요약하지 말고 그대로. 없으면 후기 서술에서 최대한 문장 형태로 복원하고 "복원함"이라고 표시.
2. **결과** — 무엇이 만들어졌나. 표? 파일? 발행된 글? 등록된 루틴?
3. **걸린 시간** — 후기에 있으면 그대로 (예: "27분 24초", "2시간 48분").
4. **사람이 중간에 한 일** — 승인 카드 누른 횟수와 그 밖에 손댄 횟수를 나눠 적는다. 시작 지시는 개입이 아니다.
5. **우리 어느 봇 일인가** — Clerk / Scribe / Research Bot / Coding Bot / QA Bot / Grok / Belmont / Tech Demos / 그룹.
6. **출처** — URL 또는 파일 경로 + 봤을 때 날짜.

### 3.3 어떻게 저장하나

`docs/bot-training/cases/CASES-2026-09-06.md` 한 파일에 표로. 지시문이 길면 `docs/bot-training/cases/prompts/C-###.txt`에 원문 그대로 따로 둔다(브라우저 봇의 `test/parity/s11-prompt.txt`와 같은 방식).

표 양식:

```
번호 | 시킨 문장(원문) | 결과 | 원본 시간 | 개입 | 봇 | 출처
C-001 | "…" | 표 8행 + 캡처 8장 | 6분 50초 | 0 | Research Bot | YouTube apgwGvax6M4
```

**번호는 한 번 주면 안 바꾼다.** 사례를 쪼개면 새 번호를 주고 `쪼갠 원본: C-001`을 적는다. 원장 규칙(`grok-bot-user-test-standard` §4.1)과 같다.

---

## 4. 트레이닝 손잡이 — 봇을 바꾸는 8가지 방법

게이트웨이 주소는 `.cache/belmont-wsl-profile/sand-data/gateway.json`에 있다(`{port, token, host}`). **호스트를 다시 띄우면 포트와 토큰이 바뀌므로 매번 다시 읽는다.** 호출은 전부 이 모양이다.

```bash
G=/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/gateway.json
PORT=$(python3 -c "import json;print(json.load(open('$G'))['port'])")
TOKEN=$(python3 -c "import json;print(json.load(open('$G'))['token'])")
curl -s -X POST "http://127.0.0.1:$PORT/api/listAgents" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{}'
```

| # | 손잡이 | 무엇이 바뀌나 | 어떻게 | 되돌리는 법 |
|---|---|---|---|---|
| **K1** | **프로필 지시문** | 봇의 성격·규칙 전부. 가장 센 손잡이 | `updateAgent` `{id, description}` → `agents/<id>/profile.json`에 저장 | **바꾸기 전에 원문을 파일로 복사해 둔다.** 되돌리려면 같은 명령으로 옛 문장을 다시 넣는다 |
| **K2** | **기억 심기** | 봇이 매 턴 기억하는 사실 | `addAgentMemory` `{id, ...}`. 봇 스스로는 `update_state target=memory action=write`(tier: profile 항상 / log 날짜별 / note 금방 잊음) | `deleteAgentMemory`, 전체는 `clearAgentMemories`. 파일은 `agents/<id>/memory/` |
| **K3** | **지식 규칙** | 검색해서 꺼내 쓰는 문서 | `sand-data/knowledge/{rules,lessons,sites}/*.md`에 파일을 놓는다. 봇은 `memory_search`로 찾는다. 한국어는 두 글자 묶음으로 색인된다(`knowledge-store.ts`) | 파일 지우면 끝. 색인은 파일 수정 시각 기준 자동 갱신 |
| **K4** | **스킬(워크플로)** | `/`로 부르고 프롬프트에 이름·설명이 실리는 절차서 | 전역: `importAgentWorkflowText` `{id, markdown, name}` → `sand-data/workflows/<slug>/SKILL.md`. 봇별 켜고 끄기: `setAgentWorkflowEnabled`, 파일은 `agents/<id>/enabled-workflows.json`의 `disabled` 목록 | `deleteAgentWorkflow`. 끄기만 하려면 `disabled`에 이름 추가 |
| **K5** | **루틴(정기 실행)** | 시간이 되면 봇이 스스로 깨어남 | `createAgentAutomation` `{id, spec}` (spec: name, prompt, trigger.schedule = cron). 봇 스스로는 `update_state target=routine action=create` | `deleteAgentAutomation`. 잠시만 끄려면 `setAgentAutomationEnabled` false. 파일은 `agents/<id>/automations/<name>/automation.json` |
| **K6** | **도구 권한** | 봇이 못 쓰게 막을 도구 | `sand-data/settings.json`의 `agentToolPolicyByAgentId.<id>.denyTools` (지금은 Scribe만 `ExternalShell`·`ExternalRead`·`Computer` 금지) | 그 항목을 지운다. **이 파일은 호스트가 읽으므로 편집 후 봇 대화를 새로 시작해서 반영 확인** |
| **K7** | **자동 승인 지침** | 승인 카드를 띄울지 말지 | `settings.json`의 `autoReviewInstructions.allowInstructions` / `blockInstructions`. 지금 gmail-imap 관련 2줄이 있다 | 줄을 지운다 |
| **K8** | **모델·노력** | 답의 품질과 속도 | `setAgentModelSelection` `{id, modelId, parameters:[{id:"effort",value:"..."}]}`. 파일은 `settings.json`의 `agentModelsByAgentId` | 옛 값으로 다시 호출 |

**돌아가기(rollback) 규칙 — 반드시 지킨다.** 손잡이를 만지기 전에 그 봇의 `profile.json`, `settings.json`, `enabled-workflows.json`, `automations/`를 통째로 `docs/bot-training/backup/<회차>/<봇id>/`에 복사한다. `sand-data`는 git 밖이라 되돌릴 다른 방법이 없다.

한 회차에 **손잡이는 하나만** 만진다. 두 개를 같이 바꾸면 어느 쪽이 효과였는지 알 수 없다.

---

## 5. 하네스 다듬기 후보 — 목록만, 코드는 안 고침

봇을 아무리 잘 써도 호스트가 못 하게 막고 있으면 안 된다. 아래는 근거가 있는 후보다. **이 회차에서는 고치지 않는다.** 검사에서 실제로 걸리면 그때 사용자에게 보고한다.

| # | 후보 | 근거 | 왜 트레이닝에 걸리나 |
|---|---|---|---|
| H1 | **프롬프트 조립에 루틴·채널 절이 아직 null** | `docs/task-continuation-2026-09-05.md` 9번: "정기 실행(automationStore)과 채널(channelStore) 절은 여전히 null" | 봇이 자기 루틴 목록을 프롬프트에서 못 본다. "매일 아침 …" 사례가 통째로 막힌다 |
| H2 | **루틴 깨우기가 브라우저 봇 밖에서도 되는지 미확인** | `usecases/PARITY-RESULTS-2026-09-05.md` F8: 루틴 깨우기가 숨은 턴이라 실행기가 "찌르기"로 보고 무시 → `aside-bot-runner.ts`에서만 고침 | 나머지 9개 봇의 루틴 검사 전에 1건으로 먼저 확인해야 한다 |
| H3 | 정기 실행이 사용자 작업 턴 뒤에 줄 섬 | 같은 문서 "남은 것": 이어가기 루프 도는 동안 15분 루틴이 미뤄짐, 3시간 한도로 묶임 | 루틴 3일 연속 검사의 시각이 밀린다 |
| H4 | 사용자 메시지·루틴 프롬프트가 기록에 두 번 저장 | 같은 문서 "남은 것" | 드라이버가 답 개수를 셀 때 잡음이 된다 |
| H5 | 승인 카드 5개 동시 한도 / 10분 만료 / 새 메시지로 만료 | 원장 `auto-review-controller` 7행, `source/host/runner/sand-auto-review.ts` | 자동 응답 드라이버가 카드를 늦게 누르면 사례가 만료로 죽는다 |
| H6 | 목표 이어가기(goal continuation)의 anti_spin 3회 일시정지 | 원장 `목표(Goal)` 3행, `goal-continuation-action-handler.ts` | 긴 작업이 3번 헛돌면 스스로 멈춘다. 장시간 사례의 실패 원인 후보 |
| H7 | `Await` 도구(배경 셸 대기, 정규식 대기, 서브에이전트 대기 금지) | 원장 `대기 도구` 5행, `tools/core/await.ts` | Coding Bot의 "빌드 끝날 때까지 기다려" 사례 |
| H8 | `TodoWrite`의 `in_progress 필수` / 20개 초과 정리 알림 | 원장 `TodoWrite 도구` 5~6행 | 작업 이어가기가 이 목록을 보고 판단한다(`turn-open-work.ts`) |
| H9 | 봇 자기 수정(`update_state profile.set` / `avatar` / `settings`) | 원장 `자기 수정` 3~4행, `메모리` 5행, `update-state` 9행 | 원본 사례 A5(스스로 재실수 방지 노트) 계열이 이 경로다 |
| H10 | 공유 사용자 기억 주입의 `[via <assistant>]` 표시와 우선순위 | 원장 `메모리`: `source/host/runner/sand-memory.ts` | 봇 사이에 사실을 나눠 갖는 사례에 필요 |
| H11 | 규칙·스킬 범위(`metadata.scopedTo`, cloud-only/local-only 걸러내기) | 원장 `규칙·스킬 범위` 2행 | 봇별로 다른 규칙을 주려면 이게 있어야 한다 |
| H12 | 텔레그램 채널이 어느 봇에도 안 붙음 | `PARITY-RESULTS` ★16: 브라우저 봇 `getAgentChannels` connections 0 | 채널 사례(사진 보내서 시키기)가 전부 막힘 |
| H13 | `plugin-skills` 빈 배열 / `managed-skills` 빈 폴더 | `sand-data/plugin-skills/cache.json`의 `skills: []` | 스킬 서재가 우리가 쓴 6개뿐이다. 원본 봇의 스킬 본문은 공개되지 않는다(§3.1 S1) |
| H14 | 딥시크 봇에 `NVIDIA_API_KEY` 없음 | `docs/belmont-manager-persona-2026-09-05.md` §봇별 설정 점검 | 그 봇은 답 자체를 못 한다 |
| H15 | 검토기 시간 초과가 도구 호출 거부로 이어지던 경로 | 같은 문서 8번 (2026-09-05에 고쳐 luna 중앙값 2.9초). **고쳐진 것으로 기록됨 — 재발만 감시** | 재발하면 승인 카드가 폭증한다 |

---

## 6. 검사표 양식과 재는 법

### 6.1 검사표 (`docs/bot-training/CHECKLIST-<회차>.md`)

브라우저 봇의 `PARITY-CHECKLIST.md`와 같은 모양이다.

```
번호 | 봇 | 지시문 (그대로 복사) | 원본 보고치 | 근거 사례 | 통과 기준 | 우리 결과(시간·개입·정확도) | 판정
T-01 | Clerk | "…" | — | C-014 | 개입 0, 파일 12개 전부 이동, 다른 파일 무손상 | | 
```

**판정 기준** (브라우저 봇 때와 같다):
- 중간 개입 0 (승인 카드는 따로 셈)
- 결과가 맞음
- 시간이 원본 보고치의 2배 안. 원본 보고치가 없으면 시간은 기록만 하고 판정에는 안 넣는다.

**실패해도 실패로 안 세는 것**: 캡차, 2단계 인증, 로그인 만료, 계정 없음. 원본도 사람 몫이다.

**한 단어로 원인 표시**: `봇`(지시문·기억·스킬·루틴) / `하네스`(호스트 코드) / `모델`(모델 능력) / `환경`(키 없음·계정 없음).

### 6.2 드라이버 — `drive.mjs`를 그대로 쓴다

파일: `/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/test/parity/drive.mjs`
이 드라이버는 브라우저와 무관하다. 게이트웨이의 `sendPrompt`로 지시를 보내고 `getAgentTranscriptTail`을 2초마다 읽어 답·승인 카드·시간을 센다. **`agentId`만 바꾸면 다른 봇에 그대로 쓸 수 있다.**

```bash
cd /home/hoon/_roots/labs/work/Belmont
node belmont-browse/aside-fork/test/parity/drive.mjs \
  97ab5a3d-a434-4e88-b35f-72954b466141 \
  "$(cat docs/bot-training/cases/prompts/C-014.txt)" \
  --gateway-file=.cache/belmont-wsl-profile/sand-data/gateway.json \
  --out=/home/hoon/work/Belmont/bot-training/runs/T-01-clerk-r1.json \
  --answer=allow --poll=1 --quiet=45 --max=1800 \
  --include-content=true --model-label=gpt-5.6-luna/max
```

알아야 할 것 4가지:

1. **`--out` 파일은 덮어쓰지 않는다** (`openSync(..., "wx")`). 재검사할 때마다 새 이름을 준다 (`-r1`, `-r2`).
2. **`--answer=allow`는 카드의 `option.value`로 답한다.** 라벨("허용")을 보내면 실제로는 거부로 처리된다 — 브라우저 봇 때 F7로 걸렸던 함정이다.
3. **판정은 `UNVERIFIED`로 나온다.** 브라우저 봇은 Aside 서비스가 작업 상태(`done`)를 따로 알려줘서 `PASS`가 나왔다. 우리 봇에는 그 관찰자가 없으므로 `execution`이 `QUIET`("답이 멎고 호스트가 한가함")로 끝나고 종합 판정은 `UNVERIFIED`가 된다. **이건 고장이 아니다.** 드라이버는 시간·개입 횟수·답 원문을 주는 계측기로 쓰고, 맞았는지는 사람이 검사표에서 판정한다. 브라우저 봇 결과표도 그렇게 적었다("내용 통과, 시간 초과").
4. 결과 JSON에서 볼 값: `timing.lastAnswerMs`(시간), `interventions.automaticResponses`(카드 누른 횟수), `interventions.observedExternalResponses`(우리 말고 누가 눌렀나 — 0이어야 한다), `assistantTexts`, `final`(답 원문, `--include-content=true`일 때).

### 6.3 게이트웨이 손잡이 (드라이버 없이 직접 쓸 때)

| 하고 싶은 일 | 명령 |
|---|---|
| 봇 목록 | `listAgents` |
| 지시 보내기 | `sendPrompt {agentId, prompt, clientNonce}` |
| 답 읽기 | `getAgentTranscriptTail {id, limit}` |
| 카드에 답하기 | `respondToWidget {entryId, value, agentId}` |
| 지시문 바꾸기 | `updateAgent {id, description}` |
| 기억 보기/심기/지우기 | `getAgentMemories` / `addAgentMemory` / `deleteAgentMemory` |
| 루틴 만들기/지금 돌리기 | `createAgentAutomation {id, spec}` / `runAgentAutomationNow` |
| 스킬 넣기/켜기 | `importAgentWorkflowText {id, markdown, name}` / `setAgentWorkflowEnabled` |
| 스킬 서재 보기 | `skillsCatalog` |
| 모델 바꾸기 | `setAgentModelSelection` |
| 채널 확인 | `getAgentChannels {id}` |
| 그룹 만들기 | `createGroup` / `setGroupMembers` |
| 살아있나 | `GET /health` (`ok`, `isBusy`, `activeAgentId`) |

전체 목록은 `source/host/gateway-protocol.ts` (123개).

---

## 7. 실행 순서 — 회차 단위

한 회차 = **사례 10개 수집 → 검사 → 실패 부검 → 손잡이 하나 조정 → 재검사**. 날짜로 끊지 않는다.

| 회차 | 대상 | 사례 출처 초점 | 이 회차에서 답할 질문 |
|---|---|---|---|
| **0** | 준비 | — | 게이트웨이가 살아 있나. 드라이버가 Clerk에게 한 문장을 보내 답을 받나. 봇별 원본 백업을 떴나 |
| **1** | Clerk, Scribe | 마켓플레이스 봇 중 "정해진 일 반복"·"글쓰기" 계열 | 시킨 그대로 하나. 재설계하지 않나 |
| **2** | Research Bot, Grok | 마켓플레이스 조사 봇 + 원장 WebSearch/WebFetch 행 | 결론→근거→미확인 3단이 나오나. 시간 제한을 지키나 |
| **3** | Belmont | 원장 §1 최종 성공 상태 6줄 + 관리자 페르소나 사건 기록 | 위임 왕복이 한 번에 끝나나. 원천으로 검증하나 |
| **4** | Coding Bot, QA Bot | 마켓플레이스 코드 봇 + 원장 파일 편집·Shell·auto-review 행 | 진짜 실행하고 진짜 출력을 보고하나. 판정 한 줄이 나오나 |
| **5** | Tech Demos, 딥시크, 그룹 | Tech Demos는 원본 규칙 그대로 → **대조군** | 원본 규칙을 그대로 받은 봇이 원본처럼 구나. 그렇다면 다른 봇 지시문을 그 모양으로 다시 쓴다 |
| **6** | 장치 검사 (전 봇) | 원장 AGENT 경로의 memory·update-state·routine·TodoWrite·Await | 기억이 다음 대화에서 되살아나나. 루틴이 스스로 깨어나나. 스킬이 프롬프트에 실리나 |

### 진행 규칙 (`CLAUDE.research.md` 적용)

1. **실패는 끝이 아니라 갈림길.** 모든 실패 보고에 세 가지를 붙인다 — 부검(왜 실패했나, 기제 수준으로), 사망 반경(정확히 무엇이 죽었나), 다음 한 수. **다음 한 수는 제안이 아니라 이미 실행한 상태로 보고한다.**
2. **사망 선언 반경 ≤ 증거 반경.** 사례 하나가 실패하면 그 사례만 죽는다. "Clerk는 못 쓴다" 같은 선언은 봇 전체를 덮는 천장 증거가 있을 때만.
3. **원인에서 나온 재설계만.** 지시문을 고칠 때 "이 검사를 통과시키려고" 고치면 안 된다. "실패의 원인이 이것이라서" 고쳐야 한다. 검사 문장을 지시문에 심는 것은 금지.
4. **같은 문제를 계속 판다.** 주제를 바꾸는 것은 사용자가 정한다. 다른 아이디어는 스택 하단에 제안으로만 남긴다.
5. **"돌릴까요?" 금지.** 사례 수집·검사·부검·재설계는 기본 계속. 멈추는 것은 호스트 재시작, 봇 삭제, 커밋, 외부 발행뿐.

---

## 8. 하면 안 되는 것과 함정

### 절대 금지

- **git commit 금지.** 사용자가 시킬 때만.
- **사용자 파일·계정·메일 건드리기 금지.** 검사 사례에 Gmail이 나와도 읽기만.
- **브라우저 봇 `4cf461d4` 건드리기 금지.** 그 봇의 지시문·루틴·대화·`browse-runtime.json` 모두. 다른 세션이 쓰고 있다.
- **봇 삭제 금지.** "New Agent"와 "모바일 테스트 봇"이 지워도 된다고 적혀 있어도 사용자가 시킬 때만.
- **호스트 재시작 금지 — 브라우저 포크 작업이 끝날 때까지.** 아래 참조.

### 호스트 재시작 (정말 필요할 때만)

지금 호스트는 tmux 세션 `belmont-bot`에서 `SAND_ASIDE_BROWSE=1 npm run wsl:start`로 떠 있다. 재시작하면:

- **브라우저 봇 작업이 끊긴다.** 다른 세션이 그 위에서 검사 중이다.
- `SAND_ASIDE_BROWSE=1`을 빼먹으면 브라우저 봇이 Aside를 안 쓰고 혼자 답한다(PARITY-RESULTS F1).
- **저장소 파일을 하나라도 고쳤으면 `npm run wsl:setup` 재빌드가 먼저 필요하다.** 오래됨(stale) 검사가 작업 트리 전체를 내용 해시로 본다. 문서 파일 하나만 고쳐도 걸린다 — 실제로 그렇게 걸린 적이 있다. **그래서 이 계획서를 포함해 검사 결과 파일은 되도록 저장소 밖(`/home/hoon/work/Belmont/bot-training/`)에 쓴다.**
- 재시작하면 `gateway.json`의 포트와 토큰이 바뀐다. 드라이버 명령을 다시 만들어야 한다.

### 프로세스 죽일 때의 함정

```bash
# 하지 말 것 — 자기 감시 셸까지 죽인다
pkill -f run-wsl.mjs

# 이렇게 정확히 조준한다
ps -eo pid,args | awk '$2 ~ /node$/ && $3=="scripts/run-wsl.mjs" {print $1}'
```

### 기타

- 테스트는 node 24 이상으로 돌린다. 셸 기본이 v22면 `using` 구문이 가짜로 실패한다.
- 다른 체크아웃(`belmont-018-restore-*` 같은)의 호스트가 같이 떠 있으면 새 호스트가 기동 직후 죽는다. `ss -ltnp`로 확인.
- 마켓플레이스는 스킬 **이름과 한 줄 설명**만 공개한다. 스킬 본문과 루틴 프롬프트는 앱 전용 딥링크(계정 필요)에만 있다. 그러니 원본 스킬을 그대로 베낄 수는 없고, 이름·설명에서 우리가 다시 써야 한다.

---

## 9. 전담 세션에 줄 첫 지시문 (그대로 복사)

> 벨몬트(Belmont, `/home/hoon/_roots/labs/work/Belmont`)의 봇들을 트레이닝한다. 계획서는 `docs/bot-training-plan-2026-09-06.md` 하나이고, 먼저 그것을 전문 읽고 그대로 따른다. 대상은 브라우저 봇(`4cf461d4`)을 뺀 9개 봇과 그룹 1개다. 트레이닝이란 원본 Grok Bot 사용자가 실제로 시킨 문장을 모아, 같은 문장을 우리 봇에게 그대로 시키고, 결과·시간·중간 개입 횟수를 재서, 못 하는 것을 봇의 지시문·기억·지식·스킬·루틴·도구 권한으로 고치는 일이다. 0회차부터 시작한다: (1) `.cache/belmont-wsl-profile/sand-data/gateway.json`의 포트·토큰으로 `listAgents`를 불러 봇 11개를 확인하고, (2) 각 봇의 `profile.json`·`settings.json`·`enabled-workflows.json`·`automations/`를 `docs/bot-training/backup/r0/<봇id>/`에 통째로 복사하고, (3) `belmont-browse/aside-fork/test/parity/drive.mjs`로 Clerk(`97ab5a3d-a434-4e88-b35f-72954b466141`)에게 한 문장을 보내 답이 오는지 확인한다. 그다음 1회차로 넘어가 마켓플레이스 봇 69개(`scripts/lib/grok-bot-template.mjs`의 `parseMarketplaceBot`으로 읽는다)에서 Clerk·Scribe 계열 사례 10개를 모아 검사표를 만들고 실행한다. 규칙: 손잡이는 한 회차에 하나만 만진다. 실패 보고에는 반드시 부검·사망 반경·이미 실행한 다음 한 수를 붙인다. 검사 통과를 노리고 지시문에 검사 문장을 심지 않는다. 커밋하지 않는다. 호스트를 재시작하지 않는다(브라우저 포크 작업이 그 위에서 돌고 있다). 브라우저 봇과 사용자 파일·계정은 건드리지 않는다. 검사 결과 파일은 저장소 밖 `/home/hoon/work/Belmont/bot-training/`에 쓴다. "돌릴까요?"라고 묻지 말고 계속 진행한다.

---

## 10. 근거 파일 (전부 절대 경로)

### 원본 기능·검사 원장

- `/home/hoon/_roots/labs/work/Belmont/docs/testing/README.md`
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/legacy-grok-2026-08-25/README.md`
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/legacy-grok-2026-08-25/grok-bot-atomic-feature-ledger-2026-08-25.md` — 원자 기능 344개, 게이트웨이 명령 123개 매핑
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/legacy-grok-2026-08-25/grok-bot-verified-gap-ledger-2026-08-25.md` — 1,325행 / 1,500원자. **`AGENT_REACHABLE` 절은 2448행부터** (405행 / 441원자)
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/legacy-grok-2026-08-25/grok-bot-user-test-standard-2026-08-25.md` — 판정 규칙, §1 최종 성공 상태 6줄, §4 ID 규칙
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/legacy-grok-2026-08-25/grok-bot-full-feature-user-test-plan-2026-08-25.md`
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/legacy-grok-2026-08-25/grok-bot-wsl-single-model-test-runbook-2026-08-25.md`
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/legacy-grok-2026-08-25/audit/` — `grok-feature-registry-active.jsonl`(1,500), `grok-wsl-test-runnable.jsonl`(1,292), `grok-wsl-test-excluded.jsonl`(208), `grok-wsl-test-queue.meta.json`

### 우리 쪽 상태 문서

- `/home/hoon/_roots/labs/work/Belmont/docs/testing/belmont-grokbot-parity-first-scope-2026-08-30.md` — EXACT / WSL_EQUIVALENT / EXCLUDED_HIDDEN 분류 원칙
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/belmont-018-parity-inventory-2026-08-31.md` — 공식 문서 8쪽 전수 대조표
- `/home/hoon/_roots/labs/work/Belmont/docs/testing/belmont-next-session-handoff.md` — 회차 이력, 재빌드·프로세스 함정
- `/home/hoon/_roots/labs/work/Belmont/docs/task-continuation-2026-09-05.md` — 작업 이어가기, 검토기 시간 초과, 스킬 목록 프롬프트 연결, 남은 것
- `/home/hoon/_roots/labs/work/Belmont/docs/belmont-manager-persona-2026-09-05.md` — 봇별 모델·노력·페르소나 전문, 스킬 배치표

### 브라우저 봇에서 쓴 방식 (그대로 본뜬다)

- `/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/usecases/USE-CASES-2026-09-05.md`
- `/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/usecases/PARITY-CHECKLIST.md`
- `/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/usecases/PARITY-RESULTS-2026-09-05.md`
- `/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/usecases/sources/` — 유튜브 자막 10편, X 타임라인
- `/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/test/parity/drive.mjs` — 드라이버 본체
- `/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/test/parity/outcome.mjs` — 판정 계산
- `/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/test/parity/s11-prompt.txt` — 긴 지시문 파일 예

### 봇 가져오기 도구 (마켓플레이스 사례의 열쇠)

- `/home/hoon/_roots/labs/work/Belmont/scripts/import-grok-bot.mjs`
- `/home/hoon/_roots/labs/work/Belmont/scripts/lib/grok-bot-template.mjs` — `parseMarketplaceBot`, `parseSharePage`, `buildBotDescription`
- `/home/hoon/_roots/labs/work/Belmont/tests/import-grok-bot.test.mjs`

### 원본 앱 해부

- `/home/hoon/_roots/labs/work/Belmont/data/artifacts/grokbot_android_apk_decompile_20260902/README.md`
- `/home/hoon/_roots/labs/work/Belmont/data/artifacts/grokbot_android_apk_decompile_20260902/summary.json`
- 같은 폴더 `hermes/index.android.v98.hasm` (176MB, grep 전용)

### 봇 실제 상태 (읽기만)

- `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/gateway.json`
- `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/settings.json` — 모델·도구 정책·자동 승인
- `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/manager.json`
- `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/agents/<id>/{profile.json,settings.json,enabled-workflows.json,automations/,memory/}`
- `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/knowledge/{rules,lessons,sites,drafts}/`
- `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/workflows/{briefing,calendar,code-change,gmail,research,summary}/SKILL.md`
- `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/plugin-skills/cache.json` (빈 배열)

### 하네스(호스트가 봇에게 주는 능력)

- `/home/hoon/_roots/labs/work/Belmont/source/host/gateway-protocol.ts` — 게이트웨이 명령 123개
- `/home/hoon/_roots/labs/work/Belmont/source/host/runner/tools/sand-state-tool.ts` — `update_state`: memory / routine / workflow / profile / settings / channel / project / avatar
- `/home/hoon/_roots/labs/work/Belmont/source/host/automations/automation.ts` — 루틴 지시문 전문, 깨우기 문구
- `/home/hoon/_roots/labs/work/Belmont/source/host/runner/knowledge-store.ts` — 지식 색인(한국어 두 글자 묶음)
- `/home/hoon/_roots/labs/work/Belmont/source/host/runner/turn-open-work.ts`, `turn-settle.ts`, `turn-shape.ts` — 턴이 언제 끝나나
- `/home/hoon/_roots/labs/work/Belmont/source/host/runner/sand-memory.ts`, `turn-memory.ts` — 기억 저장·회수
- `/home/hoon/_roots/labs/work/Belmont/source/host/runner/sand-auto-review.ts`, `auto-review-gate.ts` — 승인 카드
- `/home/hoon/_roots/labs/work/Belmont/source/host/runner/system-prompt-assembly.ts` — 프롬프트 조립(스킬 절은 연결됨, 루틴·채널 절은 아직 null)

호스트 확장(폴더 이름 한 줄 설명):

| 폴더 | 하는 일 |
|---|---|
| `memory` | 봇·사용자·프로젝트 기억 저장과 합성 |
| `mcp` | 외부 도구 서버 연결, 플러그인 스킬 캐시 |
| `auto-review` | 위험한 행동 사전 판정, 승인 카드 |
| `transcript` | 대화 기록, 루틴 실행 경로, 봇 사이 메시지 |
| `automations` | 루틴 저장·로컬 cron 발화·이벤트 트리거 |
| `local-exec` | 이 리눅스 상자에서 명령 실행 |
| `browse-runtime` | 브라우저 봇 전용 (Aside 엔진) — **손대지 않는다** |
| `session` | 대화 DB, 채널 저장소, 회복 |
| `state-backstop` | 상태 쓰기 안전망 |
| `turn-execution` | 턴 실행 서비스 |
| `notifications`, `trays`, `settings`, `secrets`, `attachments`, `auth` | 알림·트레이·설정·비밀·첨부·인증 |
