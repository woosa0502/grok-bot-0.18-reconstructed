// Evaluate in isolated overlays; publish only completed, independently observed successes.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { KNOWLEDGE_DIR } from "./session.mjs";
import { createEvaluationApi, evaluateProcedure } from "./procedure-evaluation.mjs";

const { values } = parseArgs({ options: {
  domain: { type: "string" }, task: { type: "string" }, goal: { type: "string" },
  model: { type: "string", default: "gpt-5.6-luna" }, thinking: { type: "string", default: "max" },
  runs: { type: "string", default: "3" }, verify: { type: "string" }, publish: { type: "boolean", default: false },
  "state-dir": { type: "string", default: process.env.BELMONT_BROWSE_STATE_DIR || path.resolve(import.meta.dirname, "../.state") },
  "timeout-ms": { type: "string", default: "480000" }, "poll-ms": { type: "string", default: "1000" },
} });
const lifetime = new AbortController();
const stop = () => lifetime.abort(new Error("Evaluation interrupted"));
process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  const stateDir = path.resolve(values["state-dir"]);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, "serve.json"), "utf8"));
  const verifier = values.verify ? await import(pathToFileURL(path.resolve(values.verify)).href) : undefined;
  const result = await evaluateProcedure({ ...values, runs: Number(values.runs), timeoutMs: Number(values["timeout-ms"]), pollMs: Number(values["poll-ms"]),
    knowledgeDir: KNOWLEDGE_DIR, stateDir, api: createEvaluationApi(state), verifier, signal: lifetime.signal,
    log: (line) => console.log(line) });
  if (result.auditWarning) { console.error("Published/measurement state requires audit inspection; see retained run.json."); process.exitCode = 1; }
} catch (error) {
  console.error(`[learn-measure] ${error.code ?? "ABORTED"}: ${error.message}`);
  process.exitCode = error.code === "EVALUATION_LOCKED" ? 3 : error.code === "OVERLAY_NOT_PROVEN" ? 4 : 1;
} finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
