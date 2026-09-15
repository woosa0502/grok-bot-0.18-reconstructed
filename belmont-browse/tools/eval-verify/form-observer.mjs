// External-artifact completion observer for G4/G5. It does NOT read the worker's status, final answer, or any
// success string. Before each trial it rotates the form's booking token (resettable isolation); after the trial
// it reads what the form server actually received under THAT token and grades the goal (destination==NYC,
// seat==aisle, actually submitted). The token match ties the observation to this exact trial, so a prior run's
// result can never be reused as success.
import { readFileSync } from "node:fs";

const SECRET = process.env.FORM_CTL_SECRET || "ctl-secret";
function formPort() {
  return Number(process.env.FORM_PORT || JSON.parse(readFileSync(process.env.FORM_STATE_FILE, "utf8")).port);
}
const ctl = async (method, path, bodyObj, signal) => {
  const res = await fetch(`http://127.0.0.1:${formPort()}${path}`, {
    method, headers: { "x-form-ctl": SECRET, "content-type": "application/json" },
    ...(bodyObj ? { body: JSON.stringify(bodyObj) } : {}), signal,
  });
  if (!res.ok) throw new Error(`form ctl ${path} -> HTTP ${res.status}`);
  return res.json();
};

export const id = "external-form-submission-observer-v1";
export const isolation = "resettable";

// The token minted by THIS trial's reset, held client-side. verify() compares the receipt to this, not to the
// server's current token — otherwise a later trial's rotation could let a leftover receipt pass (a gap found by
// GPT-6 Pro's round-2 adversarial replay of this observer).
let expectedToken = null;

// Rotate the token + clear submissions so this trial starts from a known-empty form; remember the reset token.
export async function beforeTrial({ round, arm, signal }) {
  signal?.throwIfAborted?.();
  const r = await ctl("POST", "/control/reset", { round, arm }, signal);
  expectedToken = r.token;
}

// Grade strictly on the form server's received submission for THIS trial's reset token.
// Default contract (final-state, e.g. learn-measure where a champion may legitimately submit twice): >=1 submit
// and the merged destination/seat correct. Strict-one contract (FORM_OBSERVER_STRICT_ONE=1, e.g. L01 "exactly
// once"): require exactly one submit carrying both values.
export async function verify({ signal }) {
  signal?.throwIfAborted?.();
  const obs = await ctl("GET", "/control/observation", undefined, signal);
  const c = obs.current;
  const strictOne = process.env.FORM_OBSERVER_STRICT_ONE === "1";
  const tokenOk = !!c && expectedToken !== null && c.token === expectedToken;
  const countOk = Array.isArray(c?.submits) && (strictOne ? c.submits.length === 1 : c.submits.length > 0);
  const goalMet = tokenOk && countOk && c.destination === "NYC" && c.seat === "aisle";
  expectedToken = null; // consume; a verify without a preceding beforeTrial cannot pass on a stale token
  return {
    verdict: goalMet ? "succeeded" : "failed",
    criticalFailure: false, // a goal-miss is a normal reject, not a crash
    evidence: [`form-observation expectedToken=${obs.token === undefined ? "?" : (c?.token ?? null)} strictOne=${strictOne} current=${JSON.stringify(c)}`],
  };
}
