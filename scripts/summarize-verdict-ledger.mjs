#!/usr/bin/env node
// §6: canonical summary of the durable verdict ledger. The ledger is
// append-only history (multiple rows per case as re-judgments land); the
// summary counts ONLY the latest row per caseId, so duplicate physical rows
// can never inflate a completion figure again. Writes/refreshes
// docs/testing/belmont-verdict-summary.json and prints the tally.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(repoRoot, "docs/testing/belmont-sweep-verdicts.jsonl");
const queuePath = path.join(repoRoot, "docs/testing/belmont-wsl-test-queue.jsonl");
const summaryPath = path.join(repoRoot, "docs/testing/belmont-verdict-summary.json");

export function summarizeLedger(ledgerText, queueText) {
  const rows = ledgerText.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
  const queueIds = new Set(
    queueText.split("\n").filter((line) => line.trim().length > 0).map((line) => { const row = JSON.parse(line); return row.testCaseId ?? row.caseId; }).filter(Boolean),
  );
  const latest = new Map();
  for (const row of rows) {
    if (typeof row.caseId === "string" && row.caseId.length > 0) latest.set(row.caseId, row);
  }
  const verdicts = {};
  for (const row of latest.values()) {
    const verdict = typeof row.verdict === "string" ? row.verdict : "UNKNOWN";
    verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
  }
  const judgedOutsideQueue = [...latest.keys()].filter((id) => !queueIds.has(id));
  const unjudged = [...queueIds].filter((id) => !latest.has(id));
  return {
    physicalRows: rows.length,
    uniqueCases: latest.size,
    duplicateRows: rows.length - latest.size,
    queueCases: queueIds.size,
    unjudgedQueueCases: unjudged.length,
    judgedOutsideQueue: judgedOutsideQueue.length,
    verdicts: Object.fromEntries(Object.entries(verdicts).sort((a, b) => b[1] - a[1])),
  };
}

const isMain = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const summary = {
    generatedAt: new Date().toISOString(),
    note: "Latest-verdict-per-case tally over the append-only ledger. Regenerate with scripts/summarize-verdict-ledger.mjs; never hand-edit.",
    ...summarizeLedger(readFileSync(ledgerPath, "utf8"), readFileSync(queuePath, "utf8")),
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
