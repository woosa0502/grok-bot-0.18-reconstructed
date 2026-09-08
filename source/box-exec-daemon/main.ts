import path from "node:path";

import { startBoxExecDaemon, type BoxExecDaemonHandle } from "./server.js";

export async function runBoxExecDaemonEntrypoint(): Promise<void> {
  let handle: BoxExecDaemonHandle | undefined;
  let shutdownRequested = typeof process.send === "function" && !process.connected;
  let stopping: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownRequested = true;
    if (handle === undefined) return Promise.resolve();
    return stopping ??= handle.stop().then(() => {
      process.exitCode = 0;
      if (process.connected) process.disconnect?.();
    });
  };
  const requestShutdown = () => {
    void shutdown().catch(error => {
      console.error("[box-exec-daemon] shutdown failed", error);
      process.exitCode = 1;
    });
  };
  // Register before startup awaits: the owning host can die while directories
  // are being created or before the listen callback announces readiness.
  process.once("disconnect", requestShutdown);
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  const workspaceRoot = path.resolve(process.env.SAND_BOX_WORKSPACE_ROOT ?? process.cwd());
  const portText = process.env.SAND_BOX_EXEC_DAEMON_PORT;
  handle = await startBoxExecDaemon({
    workspaceRoot,
    ...(portText == null ? {} : { port: Number.parseInt(portText, 10) }),
    ...(process.env.SAND_BOX_TERMINALS_DIRECTORY == null ? {} : { terminalsDirectory: process.env.SAND_BOX_TERMINALS_DIRECTORY }),
    ...(process.env.SAND_BOX_EXEC_DAEMON_AUTH_TOKEN == null ? {} : { authToken: process.env.SAND_BOX_EXEC_DAEMON_AUTH_TOKEN }),
  });
  if (shutdownRequested) {
    await shutdown();
    return;
  }
  process.stdout.write(`${JSON.stringify({ event: "box-exec-daemon-ready", url: handle.url, workspaceRoot: handle.workspaceRoot, terminalsDirectory: handle.terminalsDirectory })}\n`);
}
