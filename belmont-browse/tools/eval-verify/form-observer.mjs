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

// Rotate the token + clear submissions so this trial starts from a known-empty form.
export async function beforeTrial({ round, arm, signal }) {
  signal?.throwIfAborted?.();
  await ctl("POST", "/control/reset", { round, arm }, signal);
}

// Grade strictly on the form server's received submission for the current token.
export async function verify({ signal }) {
  signal?.throwIfAborted?.();
  const obs = await ctl("GET", "/control/observation", undefined, signal);
  const c = obs.current;
  const submitted = !!c && c.token === obs.token && Array.isArray(c.submits) && c.submits.length > 0;
  const goalMet = submitted && c.destination === "NYC" && c.seat === "aisle";
  return {
    verdict: goalMet ? "succeeded" : "failed",
    criticalFailure: false, // a goal-miss is a normal reject, not a crash
    evidence: [`form-observation token=${obs.token} label=${JSON.stringify(obs.label)} current=${JSON.stringify(c)}`],
  };
}
