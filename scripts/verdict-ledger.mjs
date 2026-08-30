#!/usr/bin/env node
// Durable verdict ledger (append-only history, one row per judgement).
//   node scripts/verdict-ledger.mjs summary           latest-per-case counts
//   node scripts/verdict-ledger.mjs list <VERDICT>    case ids currently at that verdict
//   node scripts/verdict-ledger.mjs show <CASE_ID>    full history of one case
// The summary counts ONLY the newest row per case, so re-verdicts supersede old rows
// without rewriting history.
import { readFileSync } from "node:fs";
import path from "node:path";

export const LEDGER_PATH = path.resolve(import.meta.dirname, "..", "docs", "testing", "belmont-sweep-verdicts.jsonl");

export function readLedger(file = LEDGER_PATH) {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${file}:${index + 1}: ${String(error)}`); }
  });
}

export function latestPerCase(rows) {
  const latest = new Map();
  for (const row of rows) if (typeof row.caseId === "string") latest.set(row.caseId, row);
  return latest;
}

export function summarize(rows) {
  const latest = latestPerCase(rows);
  const counts = {};
  for (const row of latest.values()) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
  return { rows: rows.length, cases: latest.size, superseded: rows.length - latest.size, counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [command, arg] = process.argv.slice(2);
  const rows = readLedger();
  if (command === "list") {
    const latest = latestPerCase(rows);
    const ids = [...latest.values()].filter(row => row.verdict === arg).map(row => row.caseId).sort();
    console.log(ids.join("\n"));
  } else if (command === "show") {
    for (const row of rows) if (row.caseId === arg) console.log(JSON.stringify(row));
  } else {
    console.log(JSON.stringify(summarize(rows), null, 2));
  }
}
