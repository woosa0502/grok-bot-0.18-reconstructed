#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./lib/config.mjs";

import {
  BELMONT_CDP_DEFAULT_ENDPOINT,
  BelmontCdpClient,
  BelmontCdpError,
  observeBelmontPlan,
  snapshotBelmont,
  validateBelmontRuntimeLineage,
} from "./lib/belmont-cdp-observer.mjs";

const HELP = `Belmont CDP observer

Usage:
  npm run wsl:cdp -- status [--endpoint http://127.0.0.1:9347]
  npm run wsl:cdp -- snapshot [--output FILE] [--max-text 4000]
  npm run wsl:cdp -- run --plan PLAN.json --run-dir DIRECTORY [--lineage FILE]

The observer attaches to one existing loopback Belmont Electron target. It never
starts, stops, restarts, or reconfigures the product and never assigns a final
product PASS without external review.
`;

function defaultRuntimeLineagePath() {
  return path.join(repoRoot, ".cache", "belmont-wsl-profile", "sand-data", "runtime-lineage.json");
}

async function readRuntimeLineage(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new BelmontCdpError("RUN_LINEAGE_NOT_FOUND", `No active Belmont runtime lineage was found at ${filePath}. Start one new CDP-enabled Belmont runtime.`);
    }
    if (error instanceof SyntaxError) throw new BelmontCdpError("RUN_LINEAGE_INVALID", `Belmont runtime lineage is not valid JSON: ${filePath}`);
    throw error;
  }
}

function parseArguments(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new BelmontCdpError("INVALID_ARGUMENT", `Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (value == null || value.startsWith("--")) throw new BelmontCdpError("INVALID_ARGUMENT", `Missing value for --${key}.`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) throw new BelmontCdpError("INVALID_ARGUMENT", `--${name} is required.`);
  return value;
}

async function emit(value, output) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (output) await writeFile(path.resolve(output), rendered);
  else process.stdout.write(rendered);
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (!new Set(["status", "snapshot", "run"]).has(command)) throw new BelmontCdpError("INVALID_ARGUMENT", `Unknown command: ${command}`);
  const client = new BelmontCdpClient({ endpoint: options.endpoint ?? BELMONT_CDP_DEFAULT_ENDPOINT });
  try {
    const target = await client.connect();
    if (command === "status") {
      const page = await snapshotBelmont(client, 0);
      const lineagePath = path.resolve(options.lineage ?? defaultRuntimeLineagePath());
      const runtimeLineage = validateBelmontRuntimeLineage(await readRuntimeLineage(lineagePath), client);
      await emit({ connected: true, endpoint: client.endpoint, target: { id: target.id, title: target.title, url: target.url }, runtimeLineage, page: { title: page.title, url: page.url, readyState: page.readyState, dimensions: page.dimensions } }, options.output);
      return;
    }
    if (command === "snapshot") {
      const maxText = Math.max(0, Math.min(Number(options["max-text"]) || 4000, 20000));
      await emit(await snapshotBelmont(client, maxText), options.output);
      return;
    }
    const planPath = path.resolve(requireOption(options, "plan"));
    const runDir = path.resolve(requireOption(options, "run-dir"));
    const lineagePath = path.resolve(options.lineage ?? defaultRuntimeLineagePath());
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    const runtimeLineage = await readRuntimeLineage(lineagePath);
    const record = await observeBelmontPlan({ client, plan, runDir, runtimeLineage });
    await emit(record, options.output);
    if (record.executionStatus !== "ACTION_COMPLETE") process.exitCode = 2;
  } finally {
    client.close();
  }
}

main().catch(error => {
  const payload = {
    executionStatus: "HARNESS_ERROR",
    code: error.code ?? "UNEXPECTED",
    message: error.message,
    details: error.details,
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
