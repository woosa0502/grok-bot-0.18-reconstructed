// Example ONLY for an operator-controlled local fixture. This is not a booking/site verifier.
// A trusted fixture driver writes an observation file for each session, independently of model text.
import fs from "node:fs/promises";
import path from "node:path";
export const id = "operator-local-fixture-v1";
export const isolation = "read-only";
export async function verify({ sessionId, signal }) {
  signal.throwIfAborted();
  const root = process.env.BELMONT_EVALUATION_OBSERVATIONS;
  if (!root || !path.isAbsolute(root) || !/^[a-zA-Z0-9_-]+$/.test(sessionId))
    return { verdict: "unknown", criticalFailure: false, evidence: [] };
  const file = path.join(root, sessionId + ".json");
  try {
    const observed = JSON.parse(await fs.readFile(file, { encoding: "utf8", signal }));
    if (observed.sessionId !== sessionId || typeof observed.predicateSatisfied !== "boolean")
      return { verdict: "unknown", criticalFailure: false, evidence: [] };
    return { verdict: observed.predicateSatisfied ? "succeeded" : "failed", criticalFailure: observed.criticalFailure === true, evidence: [file] };
  } catch (error) {
    if (signal.aborted) throw error;
    return { verdict: "unknown", criticalFailure: false, evidence: [] };
  }
}
