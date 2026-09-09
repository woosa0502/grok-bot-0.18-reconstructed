// Offline only. Never contact a browser, gateway, fixture server, or model.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digest, hashFile } from "./drive.mjs";
import { evaluateFixture, FIXTURE_SCENARIOS } from "./fixture-oracles.mjs";
import { verdictFor } from "./outcome.mjs";
import { validateRunRecord } from "./evidence-contract.mjs";

export function verifyResult(result, evidence, scenarioId, fixtureHash) {
  const contract = validateRunRecord(result);
  if (!contract.valid) {
    return { schemaVersion: 2, verdict: "UNVERIFIED", contract,
      verification: { status: "UNVERIFIED", checks: [], reason: "Incomplete or inconsistent run identity, lifecycle, timing or provenance; oracle was not run" } };
  }
  const verification = evaluateFixture(scenarioId, evidence, { ...result, finalText: typeof result.final === "string" ? result.final : undefined }, fixtureHash);
  return { ...result, contract, verification, verdict: verdictFor(result, verification),
    verdictScope: "Aggregate runtime verification; selected-file provenance does not verify executed runtime identity" };
}

export async function main(args) {
  const [resultFile, evidenceFile, scenarioId, outputFile] = args;
  if (args.length !== 4 || !FIXTURE_SCENARIOS[scenarioId]) throw new Error("Usage: verify.mjs RESULT OBSERVER_EVIDENCE SCENARIO NEW_OUTPUT");
  const rawResult = readFileSync(resultFile), rawEvidence = readFileSync(evidenceFile);
  const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), FIXTURE_SCENARIOS[scenarioId].fixtureFile);
  const verified = verifyResult(JSON.parse(rawResult), JSON.parse(rawEvidence), scenarioId, await hashFile(fixturePath));
  verified.inputs = { resultSha256: digest(rawResult), evidenceSha256: digest(rawEvidence), verifierSha256: await hashFile(fileURLToPath(import.meta.url)) };
  writeFileSync(outputFile, JSON.stringify(verified, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ verdict: verified.verdict, verification: verified.verification?.status ?? "UNVERIFIED" }));
  process.exitCode = verified.verdict === "PASS" ? 0 : verified.verdict === "UNVERIFIED" ? 2 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => { console.error("Offline verification failed; existing artifacts were preserved."); process.exitCode = 1; });
}
