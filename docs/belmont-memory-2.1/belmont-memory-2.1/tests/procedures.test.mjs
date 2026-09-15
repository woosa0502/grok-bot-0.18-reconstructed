import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProcedure, wilson } from "../dist/index.js";
const trials = (n, ratio = 1) => Array.from({ length: n }, (_, i) => ({ scenarioId: String(i), environment: "browser-v1", success: true, criticalFailure: false, latencyMs: 1000 * ratio, tokens: 200 * ratio }));
test("procedure: 200 paired successes with material savings pass offline gate", () => {
  assert.equal(evaluateProcedure(trials(200), trials(200, 0.8), "browser-v1").accept, true);
});
test("procedure: speed improvement never overrides critical failure", () => {
  const c = trials(200, 0.5); c[0].criticalFailure = true;
  assert.equal(evaluateProcedure(trials(200), c, "browser-v1").reason, "CRITICAL_FAILURE");
});
test("procedure: 20 runs are only a smoke test, not statistical promotion", () => {
  assert.equal(evaluateProcedure(trials(20), trials(20, 0.5), "browser-v1").reason, "NEEDS_MORE_TRIALS");
});
test("procedure: changed environment requires re-evaluation", () => {
  assert.equal(evaluateProcedure(trials(200), trials(200), "browser-v2").reason, "ENVIRONMENT_CHANGED");
});
test("procedure: Wilson lower bound exposes uncertainty in small success samples", () => {
  assert.ok(wilson(31, 33).low < 0.85);
});
