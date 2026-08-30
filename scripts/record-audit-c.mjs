import { readFileSync, appendFileSync, writeFileSync } from "node:fs";

const add = [
  { id: "AUDIT-9", pri: "P0", verdict: "CONFIRMED", title: "이미지생성/아바타는 Cursor 토큰 필요(광고만)", evidence: "system-prompt.ts:140 GenerateImage 광고; generate-image-service.ts:5 getAccessToken 요구; cursor-generate-image.ts:8 Cursor backend RPC. Codex-OAuth 로컬모드엔 토큰없어 실패." },
  { id: "AUDIT-W1", pri: "P1", verdict: "CONFIRMED", title: "영구 봇별 모델설정 없음(글로벌 하나)", evidence: "turn-run-shell.ts:196-202 top-level는 getAgentDefaultModel() 하나; 봇id별 map 없음, 서브에이전트 타입별만." },
  { id: "AUDIT-W2", pri: "P1", verdict: "CONFIRMED", title: "Shell 작업디렉터리 미유지", evidence: "server.ts:1254 매번 새 /bin/sh -lc; cd/export 비유지." },
  { id: "AUDIT-W3", pri: "P0", verdict: "CONFIRMED", title: "Auto-review가 Codex에서 강제 OFF", evidence: "auto-review/extension.ts:52-55 localCodexMode면 isEnabled:false 강제; sand-auto-review.ts:66 off. 사용자가 켜도 무효." },
  { id: "AUDIT-W4", pri: "P1", verdict: "PARTIAL", title: "훅 커버리지 부분적", evidence: "host측 WebSearch+Task만; 박스측 preToolUse는 Shell/Read/파일 게이트(server.ts:798). WebFetch/MCP 미포함. 감사의 Shell-미포함 주장은 오류." },
  { id: "AUDIT-W5", pri: "P2", verdict: "CONFIRMED", title: "첨부 staging 즉시삭제 안함", evidence: "attachments.ts:5,11,91 전송후 삭제안하고 시작시 1시간초과만 쓸어냄." },
  { id: "AUDIT-W6", pri: "P2", verdict: "PARTIAL", title: "서브에이전트 audit이 부모id 사용", evidence: "subagent-runtime.ts:348 computerUseSession audit이 부모 conversationId. MCP는 아님 — 감사 프레이밍 부정확." },
  { id: "AUDIT-F1", pri: "P1", verdict: "CONFIRMED", title: "stream-retry 모듈 production 미연결(false-green)", evidence: "recovered-production-stream-retry.ts importer 없음(테스트만); 실제 retry는 stream-attempt.ts." },
  { id: "AUDIT-F2", pri: "P1", verdict: "CONFIRMED", title: "video 분석 실제 없음(config/test만)", evidence: "recovered-video-subagent-configs.ts:5 not-wired; prod subagent는 executor뿐." },
  { id: "AUDIT-F3", pri: "P1", verdict: "CONFIRMED", title: "per-agent-model 테스트가 resolver 재구현(false-green)", evidence: "per-agent-model-selection.test.mjs가 로컬 resolve 복사, production turn-run-shell 미호출." },
  { id: "AUDIT-F4", pri: "P1", verdict: "CONFIRMED", title: "local Codex 테스트가 가짜 로그인 객체 검사", evidence: "local-codex-mode.ts:7 frozen LOCAL_CODEX_STATUS; 상수만 assert." },
  { id: "AUDIT-F5", pri: "P2", verdict: "PARTIAL", title: "대화 메모리 테스트 자체가 없음", evidence: "tests/에 memory 테스트 전무; 감사가 credential-store 테스트를 오인. 메모리 플로우 미검증은 사실." },
];
for (const x of add) appendFileSync("/tmp/audit-findings.jsonl", JSON.stringify(x) + "\n");

const V = readFileSync("/tmp/sweep-verdicts.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const arCases = ["GBF-AGT-000101-N01", "GBF-AGT-000102-N01", "GBF-AGT-000105-N01", "GBF-AGT-000149-N01", "GBF-AGT-000151-N01", "GBF-AGT-000154-N01", "GBF-AGT-000155-N01"];
let n = 0;
for (const x of V) if (arCases.includes(x.caseId)) { x.verdict = "ISSUE"; x.reason = "FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AUDIT-W3."; x.by = "audit-reclassified"; n++; }
writeFileSync("/tmp/sweep-verdicts.jsonl", V.map((x) => JSON.stringify(x)).join("\n") + "\n");

const findings = readFileSync("/tmp/audit-findings.jsonl", "utf8").split("\n").filter(Boolean).length;
const by = {}; for (const x of V) by[x.verdict] = (by[x.verdict] || 0) + 1;
console.log("audit findings 총:", findings, "| auto-review 정정:", n);
console.log("PASS:", by.PASS, "ISSUE:", by.ISSUE);
