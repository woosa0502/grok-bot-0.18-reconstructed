import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { MemoryKernel, actionQueries, reciprocalRankFusion } from "../dist/index.js";
const at = Date.parse("2026-09-11T00:00:00Z"), scope = "user:benchmark";
const kernel = new MemoryKernel({ path: ":memory:", tombstoneKey: new Uint8Array(32).fill(61), now: () => at });
const user = kernel.session({ id: "benchmark-fixture", actor: "user", scopes: [scope], capabilities: ["read", "capture", "propose", "explicit"] });
let counter = 0;
function add(content, type = "episodic") {
  const key = String(++counter);
  const e = user.capture({ scope, source: "user-message", sourceRef: key, content, occurredAt: at, expectedEpoch: 0 });
  const r = user.propose({ scope, type, content, evidenceIds: [e.id], basedOn: user.snapshot(scope), idempotencyKey: key });
  if (r.status !== "committed") throw new Error(JSON.stringify(r)); return r.id;
}
const cases = [];
for (const [word, fact] of [
  ["통로석", "통로석을 선호합니다"], ["카페인", "카페인을 오후에는 피합니다"],
  ["반려견", "반려견과 함께 숙박합니다"], ["주차장", "주차장이 필요합니다"],
  ["채식", "채식을 선택합니다"], ["자전거", "자전거로 출퇴근합니다"],
  ["도서관", "도서관에서 공부합니다"], ["회의실", "회의실은 조용한 곳을 원합니다"],
  ["오사카", "오사카에 다녀왔습니다"], ["제주도", "제주도를 방문했습니다"],
  ["예약번호", "예약번호는 ABC703입니다"], ["배포시간", "배포시간은 오전입니다"],
]) cases.push({ id: `ko-${word}`, kind: "korean_suffix", query: word, expected: [add(fact)] });
for (const word of ["SQLite", "TypeScript", "Electron", "Belmont", "React", "Docker", "PRAGMAs", "FTS5"]) cases.push({ id: `exact-${word}`, kind: "exact", query: word, expected: [add(`${word} project-specific implementation note`)] });
// Deliberately hard: no lexical cue in the query. One is rescued by action expansion;
// the other remains a known sparse-only failure. Never label this a dense benchmark.
const seat = add("항공 좌석은 통로석 선택을 기억해", "preference");
cases.push({ id: "implicit-flight", kind: "implicit", query: "뉴욕행 준비", tool: "flight_search", expected: [seat] });
const latent = add("긴 이동 중에는 일어나기 쉬운 자리를 골라 줘", "preference");
cases.push({ id: "implicit-paraphrase", kind: "implicit", query: "대서양 횡단 출발 준비", tool: "flight_search", expected: [latent] });
for (let i = 0; i < 500; i++) add(`일반 기록 ${i} 문서 검토 상태 완료 참고 자료`);
for (const query of ["UNSEENXYZ", "지하잠수정", "QZXVV071", "행성간순간이동"]) cases.push({ id: `absent-${query}`, kind: "unanswerable", query, expected: [] });
const modes = [
  { name: "unicode61_only", cjk: false, expand: false },
  { name: "cjk_bigram", cjk: true, expand: false },
  { name: "cjk_plus_action_queries", cjk: true, expand: true },
];
function retrieve(mode, item) {
  const queries = mode.expand ? actionQueries(item.query, item.tool ?? "") : [item.query];
  return reciprocalRankFusion(queries.map((q, i) => ({ name: `query-${i}`, weight: 1, candidates: user.search(scope, q, { cjk: mode.cjk, at, limit: 20 }).map((h) => ({ id: h.item.id, version: h.item.version })) }))).slice(0, 5).map((r) => r.id);
}
const details = [], results = [];
for (const mode of modes) {
  for (let i = 0; i < 5; i++) for (const c of cases) retrieve(mode, c); // warmup
  const latencies = [];
  for (let i = 0; i < 30; i++) for (const c of cases) { const t = performance.now(); retrieve(mode, c); latencies.push(performance.now() - t); }
  latencies.sort((a, b) => a - b);
  const rows = cases.map((c) => {
    const ids = retrieve(mode, c); const rank = c.expected.length ? ids.indexOf(c.expected[0]) : -1;
    return { caseId: c.id, kind: c.kind, retrieved: ids, expected: c.expected, recall5: c.expected.length ? Number(rank >= 0) : null, ndcg5: c.expected.length ? (rank >= 0 ? 1 / Math.log2(rank + 2) : 0) : null, correctEmpty: c.expected.length ? null : ids.length === 0 };
  });
  const answerable = rows.filter((r) => r.recall5 !== null), empty = rows.filter((r) => r.correctEmpty !== null);
  results.push({ mode: mode.name, recallAt5: answerable.reduce((s, r) => s + r.recall5, 0) / answerable.length, ndcgAt5: answerable.reduce((s, r) => s + r.ndcg5, 0) / answerable.length, emptyReturnRateOnAbsent: empty.filter((r) => r.correctEmpty).length / empty.length, p50Ms: latencies[Math.floor(latencies.length * 0.5)], p95Ms: latencies[Math.floor(latencies.length * 0.95)], measuredQueries: latencies.length });
  details.push({ mode: mode.name, cases: rows });
}
const report = { schema: 1, fixture: "synthetic-26-cases-v1", records: counter, answerableCases: 22, absentCases: 4, runtime: process.version, sqlite: "node:sqlite", generatedAt: new Date().toISOString(), limitation: "In-memory, warm synthetic microbenchmark. Not current Belmont baseline, not LoCoMo/LongMemEval, not pretrained dense retrieval, not production latency or LLM abstention.", results, details };
writeFileSync(new URL("../results/retrieval-benchmark.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, details: undefined }, null, 2)); kernel.close();
