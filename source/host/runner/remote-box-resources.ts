import {
  backgroundShellExecutorResource,
} from "../../packages/agent-exec/background-shell.js";
import { computerUseExecutorResource } from "../../packages/agent-exec/computer-use.js";
import { deleteExecutorResource } from "../../packages/agent-exec/delete.js";
import { grepExecutorResource } from "../../packages/agent-exec/grep.js";
import { hookExecutorResource } from "../../packages/agent-exec/hook-executor.js";
import { lsExecutorResource } from "../../packages/agent-exec/ls.js";
import { readExecutorResource } from "../../packages/agent-exec/read.js";
import { writeExecutorResource } from "../../packages/agent-exec/write.js";
import {
  RegistryResourceAccessor,
  type ResourceAccessor,
} from "../../packages/agent-exec/resource-provider.js";
import { shellExecutorResource } from "../../packages/agent-exec/shell.js";
import { shellStreamExecutorResource } from "../../packages/agent-exec/shell-stream.js";
import { smartModeClassifierExecutorResource } from "../../packages/agent-exec/smart-mode-classifier.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getSandRootDir } from "../host-paths.js";
import type {
  Executor,
  RemoteExecManager,
  StreamExecutor,
} from "../../packages/agent-exec/remote.js";
import type { Context } from "../../packages/context/core.js";
import type {
  BackgroundShellSpawnArgs,
  BackgroundShellSpawnResult,
} from "../../packages/proto/generated/agent/v1/background_shell_exec_pb.js";
import type {
  ComputerUseArgs,
  ComputerUseResult,
} from "../../packages/proto/generated/agent/v1/computer_use_tool_pb.js";
import type { DeleteArgs, DeleteResult } from "../../packages/proto/generated/agent/v1/delete_exec_pb.js";
import type { ExecuteHookArgs, ExecuteHookResult } from "../../packages/proto/generated/agent/v1/exec_pb.js";
import type { GrepArgs, GrepResult } from "../../packages/proto/generated/agent/v1/grep_exec_pb.js";
import type { LsArgs, LsResult } from "../../packages/proto/generated/agent/v1/ls_exec_pb.js";
import type { ReadArgs, ReadResult } from "../../packages/proto/generated/agent/v1/read_exec_pb.js";
import type { WriteArgs, WriteResult } from "../../packages/proto/generated/agent/v1/write_exec_pb.js";
import type { ShellArgs, ShellResult, ShellStream } from "../../packages/proto/generated/agent/v1/shell_exec_pb.js";
import type {
  SmartModeClassifierArgs,
  SmartModeClassifierResult,
} from "../../packages/proto/generated/agent/v1/smart_mode_classifier_exec_pb.js";
import {
  boxAgentWindowIndex,
  boxIsPreparing,
  type CapableBox,
} from "../box/box-capabilities.js";
import { touchSandMonitorBusyLease, type ShellAccessor } from "../box/box-windows.js";
import {
  boxNotReadyMessageForError,
  isNoMonitorComputerUseExecutor,
  SandBoxNoMonitorAvailableError,
  SAND_BOX_NOT_READY_MESSAGE,
} from "../ports/box.js";
import { requestIdKey } from "../../packages/chat-inference-proto/client.js";

export class SandBoxNotReadyError extends Error {
  override readonly name = "SandBoxNotReadyError";
}

export interface RemoteConnection {
  readonly terminalsFolder: string;
  readonly remoteAccessor: ResourceAccessor<RemoteExecManager>;
}

interface NavigationProbe {
  captureBaseline(
    context: Context,
    remoteAccessor: ResourceAccessor<RemoteExecManager>,
    windowIndex: number,
  ): Promise<void> | undefined;
}

export interface RemoteBoxResourceHost {
  readonly remoteBox: CapableBox & {
    ensureReady(context: Context, agentId: string): Promise<RemoteConnection>;
  };
  readonly remoteBoxHasDesktop: boolean;
  readonly preparedRemoteBoxConnection?: Promise<RemoteConnection | undefined>;
  resolveBoxId(): string;
  getConversationId(): string;
  // True when this accessor serves a Task/subagent turn (turnConversationId !== session.id).
  // The manager read-guard bypass must NOT extend to subagents the manager spawns, even
  // though they run under the manager's session id. Defaults to parent (false) when absent.
  isSubagentTurn?(): boolean;
  setRemoteBoxTerminalsFolder(folder: string): void;
  readonly autoReviewGate: {
    assertNoPendingApproval(): void;
    currentModes(): Readonly<Record<string, string>>;
  };
  auditShellCommand(
    agentId: string,
    kind: "foreground" | "background",
    command: string,
    target: "box",
    attribution: { readonly turnId?: string; readonly boxId?: string },
  ): void;
  readonly computerUse: {
    getOrCreateNavigationProbe(): NavigationProbe | undefined;
    recordAuditIntent(actionCase: string | undefined): void;
  };
  probeNavigationAfterComputerUse(
    context: Context,
    connection: RemoteConnection,
  ): void;
  readonly autoReviewClassifierExecutor?: Executor<
    SmartModeClassifierArgs,
    SmartModeClassifierResult
  >;
}

// Belmont full-access: the manager agent (single orchestrator) bypasses the box Read
// guard so it can inspect worker transcripts/logs/host-only stores. Read once from
// manager.json; a manager change takes effect on the next host restart.
let cachedManagerAgentId: string | null | undefined;
function managerAgentId(): string | null {
  if (cachedManagerAgentId === undefined) {
    try { cachedManagerAgentId = JSON.parse(readFileSync(join(getSandRootDir(), "manager.json"), "utf8")).managerAgentId ?? null; }
    catch { cachedManagerAgentId = null; }
  }
  return cachedManagerAgentId ?? null;
}

export function createRemoteBoxResourceAccessor(host: RemoteBoxResourceHost) {
  const box = host.remoteBox;
  const boxId = host.resolveBoxId();
  const agentId = host.getConversationId();
  // Bypass the box Read guard ONLY for the manager's own direct turn. A subagent runs under
  // the manager's session id, so agentId === managerId is true for it too — gate on the
  // per-turn subagent flag so the manager's Task children stay guarded.
  const isManagerAgent = managerAgentId() != null
    && agentId === managerAgentId()
    && host.isSubagentTurn?.() !== true;
  let connectionPromise: Promise<RemoteConnection | undefined> | undefined;
  const preparedConnection = host.preparedRemoteBoxConnection;

  const connect = async (context: Context): Promise<RemoteConnection> => {
    if (boxIsPreparing(box, boxId)) {
      throw new SandBoxNotReadyError(SAND_BOX_NOT_READY_MESSAGE);
    }
    try {
      const connection = await (
        connectionPromise ??= (async () =>
          await preparedConnection ?? box.ensureReady(context, boxId))()
      );
      if (connection == null) throw new Error(SAND_BOX_NOT_READY_MESSAGE);
      host.setRemoteBoxTerminalsFolder(connection.terminalsFolder);
      return connection;
    } catch (error) {
      connectionPromise = undefined;
      throw new SandBoxNotReadyError(boxNotReadyMessageForError(error), { cause: error });
    }
  };

  const audit = (
    context: Context,
    kind: "foreground" | "background",
    command: string,
  ): void => {
    const turnId = context.get(requestIdKey);
    host.auditShellCommand(agentId, kind, command, "box", {
      ...(turnId === undefined ? {} : { turnId }),
      boxId,
    });
  };
  const guardAutoReviewBarrier = (): void => host.autoReviewGate.assertNoPendingApproval();

  const ownsMonitorForShellNavigationAudit = (connection: RemoteConnection): boolean => {
    if (!host.remoteBoxHasDesktop) return false;
    try {
      return !isNoMonitorComputerUseExecutor(
        connection.remoteAccessor.get(computerUseExecutorResource),
      );
    } catch {
      return false;
    }
  };

  const awaitShellNavigationBaseline = async (
    context: Context,
    connection: RemoteConnection,
  ): Promise<void> => {
    if (!ownsMonitorForShellNavigationAudit(connection)) return;
    await host.computerUse.getOrCreateNavigationProbe()?.captureBaseline(
      context.withDetached(),
      connection.remoteAccessor,
      boxAgentWindowIndex(box, boxId) ?? 1,
    );
  };

  const probeNavigationAfterShell = (
    context: Context,
    connection: RemoteConnection,
  ): void => {
    if (ownsMonitorForShellNavigationAudit(connection)) {
      host.probeNavigationAfterComputerUse(context, connection);
    }
  };

  const accessor = new RegistryResourceAccessor();
  accessor.register(shellStreamExecutorResource, {
    execute: (context: Context, args: ShellArgs, options) => (async function* () {
      guardAutoReviewBarrier();
      audit(context, "foreground", args.command);
      const connection = await connect(context);
      guardAutoReviewBarrier();
      await awaitShellNavigationBaseline(context, connection);
      guardAutoReviewBarrier();
      try {
        yield* connection.remoteAccessor.get(shellStreamExecutorResource).execute(
          context,
          args,
          options,
        );
      } finally {
        probeNavigationAfterShell(context, connection);
      }
    })(),
  } satisfies StreamExecutor<ShellArgs, ShellStream>);
  accessor.register(backgroundShellExecutorResource, {
    execute: async (
      context: Context,
      args: BackgroundShellSpawnArgs,
      options,
    ): Promise<BackgroundShellSpawnResult> => {
      guardAutoReviewBarrier();
      audit(context, "background", args.command);
      const connection = await connect(context);
      guardAutoReviewBarrier();
      await awaitShellNavigationBaseline(context, connection);
      guardAutoReviewBarrier();
      try {
        return await connection.remoteAccessor.get(backgroundShellExecutorResource).execute(
          context,
          args,
          options,
        );
      } finally {
        probeNavigationAfterShell(context, connection);
      }
    },
  } satisfies Executor<BackgroundShellSpawnArgs, BackgroundShellSpawnResult>);
  accessor.register(readExecutorResource, {
    execute: async (
      context: Context,
      args: ReadArgs,
      options,
    ): Promise<ReadResult> => {
      const connection = await connect(context);
      return await connection.remoteAccessor.get(readExecutorResource).execute(
        context,
        args,
        // Non-manager reads are always guarded: force bypassReadGuard:false so a value that
        // arrived in options from elsewhere can never grant an unguarded read. Only the
        // manager's own turn (isManagerAgent) sets it true, decided here host-side per call.
        isManagerAgent
          ? { ...(options ?? {}), bypassReadGuard: true }
          : { ...(options ?? {}), bypassReadGuard: false },
      );
    },
  } satisfies Executor<ReadArgs, ReadResult>);
  accessor.register(lsExecutorResource, {
    execute: async (
      context: Context,
      args: LsArgs,
      options,
    ): Promise<LsResult> => {
      const connection = await connect(context);
      return await connection.remoteAccessor.get(lsExecutorResource).execute(
        context,
        args,
        options,
      );
    },
  } satisfies Executor<LsArgs, LsResult>);
  accessor.register(deleteExecutorResource, {
    execute: async (
      context: Context,
      args: DeleteArgs,
      options,
    ): Promise<DeleteResult> => {
      const connection = await connect(context);
      return await connection.remoteAccessor.get(deleteExecutorResource).execute(
        context,
        args,
        options,
      );
    },
  } satisfies Executor<DeleteArgs, DeleteResult>);
  accessor.register(grepExecutorResource, {
    execute: async (
      context: Context,
      args: GrepArgs,
      options,
    ): Promise<GrepResult> => {
      const connection = await connect(context);
      return await connection.remoteAccessor.get(grepExecutorResource).execute(
        context,
        args,
        options,
      );
    },
  } satisfies Executor<GrepArgs, GrepResult>);
  accessor.register(writeExecutorResource, {
    execute: async (
      context: Context,
      args: WriteArgs,
      options,
    ): Promise<WriteResult> => {
      const connection = await connect(context);
      return await connection.remoteAccessor.get(writeExecutorResource).execute(
        context,
        args,
        options,
      );
    },
  } satisfies Executor<WriteArgs, WriteResult>);
  accessor.register(shellExecutorResource, {
    execute: async (
      context: Context,
      args: ShellArgs,
      options,
    ): Promise<ShellResult> => {
      guardAutoReviewBarrier();
      const connection = await connect(context);
      guardAutoReviewBarrier();
      return await connection.remoteAccessor.get(shellExecutorResource).execute(
        context,
        args,
        options,
      );
    },
  } satisfies Executor<ShellArgs, ShellResult>);
  accessor.register(computerUseExecutorResource, {
    execute: async (
      context: Context,
      args: ComputerUseArgs,
      options,
    ): Promise<ComputerUseResult> => {
      const connection = await connect(context);
      const localComputerUse = process.env.SAND_LOCAL_COMPUTER_USE === "1";
      let ownsMonitorForNavigationAudit = false;
      try {
        const inner = connection.remoteAccessor.get(computerUseExecutorResource);
        if (isNoMonitorComputerUseExecutor(inner)) {
          throw new SandBoxNoMonitorAvailableError();
        }
        ownsMonitorForNavigationAudit = true;
        // Local computer-use drives a bare Xvfb with no monitor-lease / navigation-probe
        // infrastructure; skip those box-desktop-only steps and call the executor directly.
        if (localComputerUse) {
          guardAutoReviewBarrier();
          const result = await inner.execute(context, args, options);
          host.computerUse.recordAuditIntent(args.actions[0]?.action.case);
          return result;
        }
        const windowIndex = boxAgentWindowIndex(box, boxId) ?? 1;
        void host.computerUse.getOrCreateNavigationProbe()?.captureBaseline(
          context.withDetached(),
          connection.remoteAccessor,
          windowIndex,
        );
        await touchSandMonitorBusyLease(
          context,
          connection.remoteAccessor as ShellAccessor,
          windowIndex,
        );
        guardAutoReviewBarrier();
        const result = await inner.execute(context, args, options);
        host.computerUse.recordAuditIntent(args.actions[0]?.action.case);
        return result;
      } catch (error) {
        if (error instanceof SandBoxNoMonitorAvailableError) {
          connectionPromise = undefined;
          throw new SandBoxNotReadyError(boxNotReadyMessageForError(error), { cause: error });
        }
        throw error;
      } finally {
        if (localComputerUse) {
          // No navigation probe in local mode.
        } else
        if (ownsMonitorForNavigationAudit) {
          host.probeNavigationAfterComputerUse(context, connection);
        }
      }
    },
  } satisfies Executor<ComputerUseArgs, ComputerUseResult>);
  accessor.register(hookExecutorResource, {
    execute: async (
      context: Context,
      args: ExecuteHookArgs,
      options,
    ): Promise<ExecuteHookResult> => {
      const connection = await connect(context);
      return await connection.remoteAccessor.get(hookExecutorResource).execute(
        context,
        args,
        options,
      );
    },
  } satisfies Executor<ExecuteHookArgs, ExecuteHookResult>);

  if (
    host.autoReviewClassifierExecutor !== undefined
    && Object.values(host.autoReviewGate.currentModes()).some(mode => mode !== "off")
  ) {
    accessor.register(
      smartModeClassifierExecutorResource,
      host.autoReviewClassifierExecutor,
    );
  }
  return accessor;
}
