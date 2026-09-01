// §6 / Gate A5: assign every UNAVAIL and ENV case a scope disposition
// (EXACT_RESTORATION / WSL_EQUIVALENT / EXCLUDED_AND_HIDDEN) with an explicit
// rule basis, per the §1 classification and the §5 exclusion policy.
//
// The output is DERIVED (regenerate with `node scripts/assign-unavail-dispositions.mjs`);
// the append-only verdict ledger stays untouched. Unmatched cases are printed
// for manual judgment — the goal is zero unexplained UNAVAILs (§8-9).
import { readFileSync, writeFileSync } from "node:fs";

const LEDGER = "docs/testing/belmont-sweep-verdicts.jsonl";
const OUT = "docs/testing/belmont-unavail-dispositions.jsonl";

// disposition: how the ORIGINAL feature is treated in the WSL build (§1).
// verification:
//   HIDDEN_VERIFIED        — the exclusion/hiding itself was verified (tools not
//                            offered, prompt diet, gates pinned off, honest denial)
//   LOCAL_REPLACEMENT      — a working local equivalent exists and was verified
//   UNTRIGGERABLE_LOCALLY  — the code path exists, but the error/edge condition
//                            cannot be produced in a healthy local environment
//                            (or the CDP harness cannot synthesize the gesture)
//   GATE_A5                — needs the fresh-profile / full live pass
const RULES = [
  // ---- §5 exclusions (policy: EXCLUDED_AND_HIDDEN) ----
  { id: "cloud-agent", p: /cloud|클라우드/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "Cursor Cloud Agent 계열 — CloudAgent 도구 미제공 + 프롬프트 다이어트로 숨김 검증" },
  { id: "image-gen", p: /이미지 ?생성|GenerateImage|아바타|avatar|aspect_ratio/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "이미지 생성/AI 아바타 — 프롬프트 honest denial + 아바타 로컬 즉시-실패 가드" },
  { id: "updater", p: /업데이트|updater|auto-?update/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "자동 업데이트 — reconstructed-updater-guard + 게이트 오프" },
  { id: "marketplace", p: /마켓플레이스|marketplace|플러그인 백엔드/i, d: "WSL_EQUIVALENT", v: "LOCAL_REPLACEMENT", note: "Cursor 마켓플레이스 → 로컬 plugin-catalog.json/mcp.json (설치 라이브 실증)" },
  { id: "team-share", p: /팀|team|조직|org(?!aniz)|SSO|RBAC|공유|share|room/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "팀/공유/조직 기능 — 개인 로컬 제품에서 제외(§5)" },
  { id: "teach", p: /teach|demonstration/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "Teach-by-demonstration — 게이트 핀 오프" },
  { id: "remote-box", p: /원격|remote box|docker/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "원격 box/Docker 운영 기능 — 로컬 loopback box가 유일 실행 환경" },
  { id: "mobile", p: /iOS|모바일|아이폰|push 알림|iphone/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "모바일/푸시 — 게이트 오프" },
  { id: "billing", p: /billing|usage.*(page|한도)|사용량/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "Usage/Billing — sand_usage_page 오프" },
  { id: "webauthn", p: /webauthn|보안 ?키|security key/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "팀 WebAuthn 정책 — §5 제외 (설정 토글 잔존은 UI_ONLY 각주)" },
  { id: "connectors", p: /slack|github 이벤트|커넥터|connector|listener|외부 서비스 trigger/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "미연결 외부 trigger — isPlatformConnected 게이트로 연결된 것만 활성" },
  { id: "media-understanding", p: /비디오|video|오디오|audio/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "오디오/비디오 이해 — 사용자 제외 지시, 프롬프트/스키마 정직화" },
  { id: "cursor-account", p: /cursor 계정|cursor account|cursor 토큰|anysphere/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "Cursor 계정 전용 표면 — 로컬 모드 게이트" },
  { id: "cursor-ide", p: /cursor ide|ide 통합|git 통합|git diff.*첨부|PR.*(첨부|참조)/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "Cursor IDE 통합 컨텍스트 — standalone 앱에 IDE 없음" },
  { id: "multi-model", p: /다중 모델|모델 카탈로그|라우터|응답비교|모델 피커|Switch model|backend error/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "다중 provider/모델 피커 — Codex-only 결정(A12), 로컬 피커는 Pi 카탈로그로 대체" },
  { id: "killswitch", p: /킬스위치|denylist|박스차단/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "백엔드 킬스위치 — 백엔드 전용 운영 기능" },
  { id: "egress", p: /egress/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "egress 터널 — 클라우드 네트워크 인프라 전용" },
  { id: "local-absent", p: /absent in local mode|not exposed in local|로컬 (모드|빌드)에.*없|not wired in local/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "로컬 모드 미노출 표면 — 광고 없음(도구/스키마에서 제거)" },
  { id: "hook-step-unwired", p: /sessionStart|sessionEnd|afterAgentResponse.*미|HookStep enum.*(no|미)/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "미배선 훅 단계 — 어떤 표면도 광고하지 않으며 등록해도 무해" },
  { id: "shell-permissions", p: /required_permissions/i, d: "WSL_EQUIVALENT", v: "LOCAL_REPLACEMENT", note: "로컬 box는 sandbox 계층이 없어 권한 에스컬레이션 파라미터가 불필요 — 스키마 축소" },
  { id: "subagent-types", p: /subagent_type|computerUse.*(미|not)|browserUse.*(미|not)/i, d: "WSL_EQUIVALENT", v: "LOCAL_REPLACEMENT", note: "로컬 subagent 타입 집합 축소(executor+computerUse; browserUse는 옵트인)" },

  // ---- untriggerable states (feature EXISTS; the condition cannot be produced) ----
  { id: "error-states", p: /오류 상태|에러 (조건|상태)|렌더실패|손상.*(유발|불가)|실패.*재시도|ErrorBoundary|error tray|실패 상태 주입/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "정상 환경에서 오류 조건을 합성 유발할 수 없음 — 코드 경로는 존재" },
  { id: "ipc-states", p: /IPC|CDP로.*(불가|미구동)|합성 드래그|드래그드롭|플로팅.*드래그/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "렌더러↔host IPC/합성 제스처를 CDP 하네스가 만들 수 없음" },
  { id: "busy-states", p: /진행중 상태|작업중 전송|오프라인 작성|위젯 미응답|송신실패|큐\/|턴큐|중단복구/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "특정 in-flight/큐 상태 필요 — 안정 실행에서 유발 불가" },
  { id: "spend-guard", p: /spend-?guard|비용 초과/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "실제 비용 초과 상태 필요" },
  { id: "special-content", p: /reasoning 행|katex|retired-permission|reduced-motion|애니메이션 상태|시선추적|스레드.*(배지|상태)|branched/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "특정 콘텐츠/애니메이션 상태 필요" },
  { id: "big-history", p: /대용량 누적|하드리밋|이전기록 페이지/i, d: "EXACT_RESTORATION", v: "GATE_A5", note: "대용량 누적 대화 상태 — Gate A5 실사용 누적에서" },
  { id: "network-preview", p: /OpenGraph|외부 네트워크 프리뷰|링크 카드|external open|CSP/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "외부 네트워크 프리뷰/CSP 의존" },
  { id: "timeline-notices", p: /timeline 알림|아웃라인|비동기작업 패널|async task/i, d: "EXACT_RESTORATION", v: "GATE_A5", note: "특정 백그라운드 작업 상태의 UI 표출 — Gate A5" },
  { id: "backend-validation", p: /백엔드 검증 로직|API 레벨 동작/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "검증 로직은 API 레벨로 동작 확인 — UI 유발 경로만 부재" },
  { id: "secrets-ui", p: /비밀 관리|secret/i, d: "EXACT_RESTORATION", v: "GATE_A5", note: "secret 관리 UI — Gate A5 실사용에서" },
  { id: "toasts", p: /토스트|toast/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "특정 저장 성공/실패 이벤트 필요" },
  { id: "misc-widgets", p: /프라이버시모드|계획실행|피드백위젯|이메일카드|터미널패널|승인정리|직렬전송|강제요약/i, d: "EXACT_RESTORATION", v: "GATE_A5", note: "개별 위젯/모드 표면 — Gate A5 개별 실측 목록" },
  { id: "routine-timeline", p: /routine CRUD는 실측/i, d: "EXACT_RESTORATION", v: "GATE_A5", note: "routine CRUD 실측 済 — timeline 알림 카드 표출만 잔여" },
  { id: "mode-picker", p: /모드 선택|Plan\/Debug|Multitask.*피커/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "로컬 빌드 모드 피커 축소" },

  // ---- catch-alls (AFTER the specific rules) ----
  { id: "surface-not-exposed", p: /\bno\b.*\b(tool|param|flow|operation|action|field|schema)\b.*(exposed|available|present|wired|local)|not (available|exposed|present|wired|installable|surfaced)|unavailable in (local|this)|not exposed in this|미노출|unsurfaced|\bno [a-z-]+ tool\b/i, d: "EXCLUDED_AND_HIDDEN", v: "HIDDEN_VERIFIED", note: "로컬에서 미노출 표면 — 도구/스키마에 없어 광고되지 않음(§5 처리원칙 3 충족)" },
  { id: "behavior-delta", p: /behavioral difference|instead of|rather than|per-call|launch-time choice only|different surface|에만 존재|works\)? in this build|없어.*대신|no (force|pre-execution|send-stdin|operation to)/i, d: "WSL_EQUIVALENT", v: "LOCAL_REPLACEMENT", note: "행동 차이가 명시된 로컬 대체 계약 — 같은 목표를 다른 절차로 달성" },
  { id: "state-needed", p: /특정 .*(필요|경로)|상태 필요|timing|host단절|시스템 상태|hover/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "특정 상태/타이밍 조건 필요 — 정상 환경에서 합성 유발 불가" },
  { id: "untriggerable-misc", p: /유발 (불가|어려)|관측.*어려움|비현실적|도달 불가|미유발|연결 상태 전이|로딩\/실패 상태 미도달|roving-focus|필요 — 표준/i, d: "EXACT_RESTORATION", v: "UNTRIGGERABLE_LOCALLY", note: "유발/관측 불가 조건 — 코드 경로 존재, 조건 합성 불가" },
  { id: "config-level", p: /config-level|설정파일 편집|import 소스/i, d: "EXACT_RESTORATION", v: "GATE_A5", note: "설정 파일/외부 입력 기반 테스트 — Gate A5 개별 실측 목록" },
  { id: "surface-reduced", p: /미표출|미제공|관측 안 됨|위젯에 없음|토글 미제공|없음\(로컬|이 빌드/i, d: "WSL_EQUIVALENT", v: "GATE_A5", note: "로컬 렌더/위젯 표면 축소 — Gate A5에서 의도 여부 최종 확인" },
];

// Case-level overrides where the terse ledger reason needs a bespoke judgment.
const OVERRIDES = new Map([
  ["GBF-AGT-000015-N01", { disposition: "WSL_EQUIVALENT", verification: "GATE_A5", basis: "manual", note: "SetMcpInstructions가 로컬 stdio 서버 id(이름 해시 숫자열)와 Cursor 숫자 ID 검증이 어긋나 거부 — 로컬 id 체계로 동작하도록 손볼 후보(Gate A5 확인)" }],
  ["GBF-AGT-000435-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "8단계 상한은 OpenRouter 실행기 전용 — 로컬 Codex 경로는 Belmont 루프가 단계를 소유(SAND_AGENT_MAX_STEPS)" }],
  ["GBF-AGT-000312-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "누락 작업 디렉터리는 fallback-to-root 대신 명시적 오류 — fail-closed가 더 안전한 로컬 계약" }],
  ["GBF-AGT-000115-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "30초 초과 foreground는 abort 대신 background 승격 — 명시적 로컬 계약(ShellTimeout 별도 존재)" }],
  ["GBF-AGT-000392-N01", { disposition: "EXCLUDED_AND_HIDDEN", verification: "HIDDEN_VERIFIED", basis: "manual", note: "meta-agent 노트 디렉터리 안내는 플래그 오프로 미노출" }],
  ["GBF-AGT-000263-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "로컬 DDG WebSearch는 스니펫 반환 — 대형 본문 외부화 경로가 필요 없는 형태" }],
  ["GBF-USR-000801-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "로컬 WebFetch는 직접 fetch 서비스 — Cursor 박스의 권한 프롬프트 경로 자체가 대체됨" }],
  ["GBF-USR-000802-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "로컬 WebSearch는 직접 검색 서비스 — 권한 프롬프트 경로 대체(801과 동일)" }],
  ["GBF-USR-000573-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "web-search 승인 카드는 로컬 직접-fetch 경로에 존재하지 않는 설계(801 참조)" }],
  ["GBF-USR-000574-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "web-search 거부 카드 — 573과 동일" }],
  ["GBF-AGT-000122-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "notify_on_output 대신 AwaitShell.pattern 인턴 대기 — 로컬 대체 계약" }],
  ["GBF-USR-000621-N01", { disposition: "EXACT_RESTORATION", verification: "GATE_A5", basis: "manual", note: "후속 프롬프트 제안 미표출 — 표출 조건(플래그/상태) 확인 후보" }],
  ["GBF-USR-000622-N01", { disposition: "EXACT_RESTORATION", verification: "GATE_A5", basis: "manual", note: "621과 동일" }],
  ["GBF-USR-000578-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "질문 위젯은 선택지형 — 자유텍스트는 일반 채팅 입력으로 대체" }],
  ["GBF-USR-000006-N01", { disposition: "WSL_EQUIVALENT", verification: "LOCAL_REPLACEMENT", basis: "manual", note: "도구 결과 카드는 정적 확장 렌더 — 접기 토글 없는 로컬 렌더 계약" }],
  ["GBF-USR-000079-N01", { disposition: "EXCLUDED_AND_HIDDEN", verification: "HIDDEN_VERIFIED", basis: "manual", note: "생성 스피너는 Cursor 의존 이미지 생성 전용 — 생성 자체가 제외라 도달 불가" }],
  ["GBF-USR-000181-N01", { disposition: "EXACT_RESTORATION", verification: "UNTRIGGERABLE_LOCALLY", basis: "manual", note: "클립보드/특정 입력 상태 필요 — 자동완성 핵심 경로는 실측 済" }],
  ["GBF-USR-000824-N01", { disposition: "EXACT_RESTORATION", verification: "UNTRIGGERABLE_LOCALLY", basis: "manual", note: "181과 동일" }],
  ["GBF-USR-000845-N01", { disposition: "EXACT_RESTORATION", verification: "UNTRIGGERABLE_LOCALLY", basis: "manual", note: "clientNonce dedup은 백엔드 계층 — 게이트웨이 createAgent nonce 원장 코드로 존재, UI 유발 불가" }],
  ["GBF-USR-000762-N01", { disposition: "EXCLUDED_AND_HIDDEN", verification: "HIDDEN_VERIFIED", basis: "manual", note: "외부 서비스 트리거 구성 필요 — 미연결 트리거는 §5 게이트로 숨김" }],
]);

const latest = new Map();
for (const line of readFileSync(LEDGER, "utf8").trim().split("\n")) {
  const row = JSON.parse(line);
  latest.set(row.caseId, row);
}
const targets = [...latest.values()].filter((row) => row.verdict === "UNAVAIL" || row.verdict === "ENV");

const out = [];
const unmatched = [];
const counts = {};
for (const row of targets) {
  const reason = row.reason ?? "";
  const override = OVERRIDES.get(row.caseId);
  if (override !== undefined) {
    out.push({ caseId: row.caseId, verdict: row.verdict, ...override });
    counts.manual = (counts.manual ?? 0) + 1;
    continue;
  }
  const rule = RULES.find((candidate) => candidate.p.test(reason));
  if (rule === undefined) {
    if (row.verdict === "ENV") {
      // ENV rows carry their own environmental explanation; they stay
      // EXACT_RESTORATION with the environment noted, pending Gate A5.
      out.push({ caseId: row.caseId, verdict: row.verdict, disposition: "EXACT_RESTORATION", verification: "GATE_A5", basis: "env-explained", note: reason.slice(0, 200) });
      counts["env-explained"] = (counts["env-explained"] ?? 0) + 1;
      continue;
    }
    unmatched.push(row);
    continue;
  }
  out.push({ caseId: row.caseId, verdict: row.verdict, disposition: rule.d, verification: rule.v, basis: rule.id, note: rule.note });
  counts[rule.id] = (counts[rule.id] ?? 0) + 1;
}

writeFileSync(OUT, out.map((row) => JSON.stringify(row)).join("\n") + "\n");
console.log(`targets=${targets.length} assigned=${out.length} unmatched=${unmatched.length}`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
for (const row of unmatched) console.log("UNMATCHED", row.caseId, "|", (row.reason ?? "").slice(0, 140));
