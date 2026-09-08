import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExecOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal | undefined;
  cwd?: string;
  maxBuffer?: number;
}

export interface LocalProcessResult { exitCode: number; stdout: string; stderr: string }

export function executionSignal(context: unknown): AbortSignal | undefined {
  if (typeof context !== "object" || context === null || !("signal" in context)) return undefined;
  return context.signal instanceof AbortSignal ? context.signal : undefined;
}

export function throwIfExecutionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Local execution canceled", "AbortError");
}

export function execResult(command: string, args: readonly (string | number)[], options?: ExecOptions): Promise<LocalProcessResult> {
  const signal = options?.signal;
  return new Promise((resolve, reject) => {
    throwIfExecutionAborted(signal);
    const child = spawn(command, args.map(String), {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const maxBuffer = options?.maxBuffer ?? 1024 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    const stop = () => {
      // A separate group contains only this invocation and its child processes.
      // Killing just an intermediate shell can leave an input process running.
      if (child.pid !== undefined && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else {
        child.kill("SIGKILL");
      }
    };
    const abort = () => {
      failure = new DOMException("Local execution canceled", "AbortError");
      stop();
    };
    const timeout = setTimeout(() => {
      failure = new Error(`${command} timed out`);
      stop();
    }, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const append = (chunks: Buffer[], chunk: Buffer, previousBytes: number) => {
      if (previousBytes + chunk.length > maxBuffer) {
        chunks.push(chunk.subarray(0, Math.max(0, maxBuffer - previousBytes)));
        failure ??= new Error(`${command} output exceeded ${maxBuffer} bytes`);
        stop();
      } else {
        chunks.push(chunk);
      }
      return previousBytes + chunk.length;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdoutBytes = append(stdout, chunk, stdoutBytes); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes = append(stderr, chunk, stderrBytes); });
    child.on("error", (error) => { failure = error; });
    child.on("close", (code, killedBy) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(new DOMException("Local execution canceled", "AbortError"));
      else if (failure !== undefined) reject(failure);
      else resolve({
        exitCode: code ?? 127,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8") || (killedBy ? `${command} terminated by ${killedBy}` : ""),
      });
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function exec(command: string, args: readonly (string | number)[], options?: ExecOptions): Promise<string> {
  const result = await execResult(command, args, options);
  if (result.exitCode !== 0) throw new Error(result.stderr || `${command} exited with code ${result.exitCode}`);
  return result.stdout;
}
