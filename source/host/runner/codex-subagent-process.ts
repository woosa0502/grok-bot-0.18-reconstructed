import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodexCliPath } from "../../shared/node/inference-router-local.js";

export interface CodexSubagentResult {
  readonly text: string;
  readonly aborted: boolean;
}

export interface CodexSubagentInput {
  readonly prompt: string;
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly codexPath?: string | null;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Runs a subagent as a separate `codex exec` process instead of an in-process child
 * runner. This is the pi-subagents / OpenMausBot pattern: the spawned process is a full
 * agent with its own turn engine and toolset, so the parent does not need to reconstruct
 * an in-process subagent turn engine (which this build never wired). The child's final
 * assistant message is captured via `codex exec -o <file>` and returned to the parent.
 */
export async function runCodexSubagentProcess(input: CodexSubagentInput): Promise<CodexSubagentResult> {
  const codexPath = input.codexPath ?? resolveCodexCliPath();
  if (codexPath == null || codexPath.length === 0) {
    return { text: "The subagent could not run: the codex CLI was not found on this machine.", aborted: false };
  }
  const scratch = await mkdtemp(join(tmpdir(), "belmont-subagent-"));
  const resultFile = join(scratch, "final-message.txt");
  try {
    const child = spawn(
      codexPath,
      ["exec", "--skip-git-repo-check", "-C", input.cwd, "-o", resultFile, input.prompt],
      { stdio: ["ignore", "ignore", "ignore"] },
    );

    let aborted = false;
    const stop = () => {
      aborted = true;
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    };
    const onAbort = () => stop();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(stop, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();

    try {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.once("error", () => resolve());
      });
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }

    const captured = await readFile(resultFile, "utf8").then((value) => value.trim()).catch(() => "");
    if (aborted && captured.length === 0) {
      return { text: "The subagent was interrupted before it produced a result.", aborted: true };
    }
    return {
      text: captured.length > 0 ? captured : "The subagent finished without producing any output.",
      aborted,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
