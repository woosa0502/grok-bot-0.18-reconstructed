// One-shot CLI through the shared browse service or one owned core engine.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { modelOverrides } from "./model-options.mjs";
import { cliError, connectSharedService, createOwnedSessionClient, readServiceState } from "./cli-client.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
export const CLI_USAGE = 'usage: node src/run.mjs --task "..." [--model ID] [--provider ID] [--thinking LEVEL] [--fast-mode|--no-fast-mode] [--mode full-access|guard|read-only] [--auto-approve] [--keep-chrome|--no-keep-chrome] [--verbose]';

export function parseCliArgs(args, env = process.env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, allowNegative: true, options: {
    task: { type: "string" },
    model: { type: "string", default: env.BELMONT_BROWSE_MODEL },
    provider: { type: "string", default: env.BELMONT_BROWSE_PROVIDER },
    thinking: { type: "string", default: env.BELMONT_BROWSE_THINKING },
    "fast-mode": { type: "boolean", default: env.BELMONT_BROWSE_FAST_MODE === undefined ? undefined : env.BELMONT_BROWSE_FAST_MODE === "1" },
    mode: { type: "string", default: env.BELMONT_BROWSE_MODE || "full-access" },
    "auto-approve": { type: "boolean", default: false },
    "cdp-port": { type: "string", default: "9333" },
    display: { type: "string", default: env.BELMONT_BROWSE_DISPLAY || env.BELMONT_MOBILE_DISPLAY || ":99" },
    "keep-chrome": { type: "boolean", default: true },
    verbose: { type: "boolean", default: false },
    engine: { type: "string", default: env.BELMONT_BROWSE_ENGINE },
    help: { type: "boolean", default: false },
  } });
  const task = (values.task ?? positionals.join(" ")).trim();
  if (!values.help && !task) throw cliError("CLI_USAGE", CLI_USAGE, 2);
  if (!["full-access", "guard", "read-only"].includes(values.mode)) throw cliError("CLI_USAGE", "--mode must be full-access, guard, or read-only", 2);
  const cdpPort = Number(values["cdp-port"]);
  if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65535) throw cliError("CLI_USAGE", "--cdp-port must be an integer from 1 to 65535", 2);
  const model = modelOverrides({ model: values.model, provider: values.provider, thinking: values.thinking, fastMode: values["fast-mode"] });
  for (const [name, value] of Object.entries(model ?? {})) if (name !== "fastMode" && (typeof value !== "string" || !value.trim())) throw cliError("CLI_USAGE", `${name} must be a nonempty string`, 2);
  return { task, model, mode: values.mode, autoApprove: values["auto-approve"], keepChrome: values["keep-chrome"], verbose: values.verbose, engine: values.engine, cdpPort, display: values.display, help: values.help };
}

export async function suspensionResponse(suspension, { autoApprove, question, log = () => {}, signal } = {}) {
  log(`[suspension] ${suspension.description ?? suspension.kind}`);
  if (suspension.kind === "ask-user-question") {
    const answers = [];
    for (const item of suspension.request?.questions ?? []) {
      const choices = item.options?.map((option) => typeof option === "string" ? option : option.label).join(" | ");
      const prompt = `${item.question ?? item.header ?? "answer"}${choices ? ` (${choices})` : ""}> `;
      const answer = autoApprove ? (item.options?.[0]?.label ?? item.options?.[0] ?? "yes") : await question(prompt, { signal });
      answers.push({ header: item.header ?? "", answer });
    }
    return { answers };
  }
  if (suspension.kind === "approval" || suspension.kind === "action-confirmation") {
    const allowed = autoApprove || (await question("allow? [y/N] ", { signal })).trim().toLowerCase().startsWith("y");
    return suspension.kind === "approval" ? { verdict: allowed ? "allow" : "deny", always: false } : { verdict: allowed ? "confirm" : "cancel" };
  }
  throw cliError("UNSUPPORTED_SUSPENSION", `Unsupported suspension kind: ${suspension.kind}`);
}

export async function runCli(args = process.argv.slice(2), {
  env = process.env, stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, signal,
  stateFile = path.join(process.env.BELMONT_BROWSE_STATE_DIR || path.join(ROOT, ".state"), "serve.json"), loadServiceState = readServiceState,
  isProcessAlive, fetchImpl, requestTimeoutMs = 10000, pollIntervalMs = 250,
  createEngine = async (options) => (await import("./core.mjs")).createBrowseEngine(options), question: suppliedQuestion,
} = {}) {
  const log = (value) => stderr.write(String(value) + "\n");
  let engine;
  let client;
  let session;
  let sessionId;
  const snapshot = (value) => {
    if (!value || typeof value.id !== "string" || !value.id || (sessionId && value.id !== sessionId) || typeof value.status !== "string") {
      throw cliError("INVALID_SERVICE_RESPONSE", "Browse service returned an invalid or mismatched session");
    }
    sessionId ??= value.id;
    return value;
  };
  let terminal = false;
  let readline;
  let exitCode = 0;
  const question = suppliedQuestion ?? ((prompt, options) => {
    if (!stdin.isTTY) throw cliError("CLI_INPUT_REQUIRED", "This session needs input; use an interactive terminal or explicitly choose --auto-approve");
    readline ??= createInterface({ input: stdin, output: stderr });
    return readline.question(prompt, options);
  });
  try {
    let options;
    try { options = parseCliArgs(args, env); }
    catch (error) { throw cliError("CLI_USAGE", error.message, 2); }
    if (options.help) { stdout.write(CLI_USAGE + "\n"); return 0; }
    signal?.throwIfAborted();
    const shared = await connectSharedService(await loadServiceState(stateFile), { isProcessAlive, fetchImpl, requestTimeoutMs, requestedEngine: options.engine, signal });
    if (shared) {
      client = shared.client;
      log(`[cli] using shared browse service pid=${shared.health.pid} engine=${shared.health.engine}`);
    } else {
      engine = await createEngine({
        ...(options.engine === undefined ? {} : { engine: options.engine }),
        transport: "port", cdpPort: options.cdpPort, display: options.display,
        keepChromeOnStop: options.keepChrome, log,
      });
      client = createOwnedSessionClient(engine);
      log(`[cli] using owned browse engine ${engine.version ?? options.engine ?? "default"}`);
    }
    signal?.throwIfAborted();
    // Keep the bounded creation response alive through Ctrl-C: once the server has
    // accepted the task, its returned ID is required to cancel only our own session.
    session = snapshot(await client.start({ task: options.task, mode: options.mode, autoApprove: options.autoApprove, ...(options.model === undefined ? {} : { model: options.model }) }));
    log(`[session] ${session.id}`);
    const seenActivity = new Set();
    while (true) {
      signal?.throwIfAborted();
      if (options.verbose) {
        for (const activity of session.activity ?? []) if (!seenActivity.has(activity)) { seenActivity.add(activity); log(`[activity] ${activity}`); }
        while (seenActivity.size > 400) seenActivity.delete(seenActivity.values().next().value);
      }
      if (["done", "error", "stopped", "interrupted"].includes(session.status)) {
        terminal = true;
        if (session.result) stdout.write(String(session.result) + "\n");
        if (session.status !== "done") { exitCode = 1; log(`[session] ${session.status}: ${session.error ?? session.errorCode ?? "execution did not complete"}`); }
        log(`[summary] status=${session.status} modelCalls=${session.modelCalls ?? 0} toolCalls=${session.toolCalls ?? 0}`);
        break;
      }
      if (session.status === "suspended" && options.autoApprove) {
        // The shared owner already handles automatic responses. A duplicate answer
        // from the CLI could race it and accidentally stop an otherwise valid run.
        if (session.error) throw cliError("AUTO_APPROVAL_FAILED", session.error);
        await delay(pollIntervalMs, undefined, { signal });
        session = snapshot(await client.get(sessionId, { signal }));
      } else if (session.status === "suspended" && session.suspension) {
        const pending = session.suspension;
        if (typeof pending.toolCallId !== "string" || !pending.toolCallId) throw cliError("INVALID_SERVICE_RESPONSE", "Suspension has no tool call ID");
        const response = await suspensionResponse(pending, { autoApprove: options.autoApprove, question, log, signal });
        signal?.throwIfAborted();
        try { session = snapshot(await client.answer(sessionId, response, pending.toolCallId, { signal })); }
        catch (error) {
          if (!["STALE_SUSPENSION", "NO_PENDING_SUSPENSION"].includes(error.code)) throw error;
          session = snapshot(await client.get(sessionId, { signal }));
        }
      } else {
        if (!["queued", "running", "suspended"].includes(session.status)) throw cliError("INVALID_SERVICE_RESPONSE", `Unknown session status: ${session.status}`);
        await delay(pollIntervalMs, undefined, { signal });
        session = snapshot(await client.get(sessionId, { signal }));
      }
    }
  } catch (error) {
    exitCode = signal?.aborted ? (signal.reason?.exitCode ?? 130) : (error.exitCode ?? 1);
    log(`[cli] ${error.message ?? error}`);
    if (client && sessionId && !terminal) {
      try { await client.stop(sessionId); }
      catch (stopError) { log(`[cli] owned session stop failed: ${stopError.message}`); }
    }
  } finally {
    readline?.close();
    if (engine) {
      try { await engine.stop(); }
      catch (error) { exitCode = 1; log(`[cli] engine cleanup failed: ${error.message}`); }
    }
  }
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const interrupt = () => abort.abort(cliError("CLI_INTERRUPTED", "Interrupted by SIGINT", 130));
  const terminate = () => abort.abort(cliError("CLI_INTERRUPTED", "Interrupted by SIGTERM", 143));
  // Keep signal ownership until runCli has awaited engine cleanup; signal-exit
  // otherwise re-raises the signal while our asynchronous stop is still running.
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  try { process.exitCode = await runCli(undefined, { signal: abort.signal }); }
  finally { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); }
}
