import type { Context } from "../../../context/core.js";
import { FileOperationLockManager, type ExclusiveFileOperationLock } from "./file-operation-lock-manager.js";

// A file edit is one read/modify/write transaction. The accessor identifies the
// executor connection shared by the turn's edit, write and delete tools. Lock
// mutations together because the remote executor, rather than the host, owns
// path resolution (relative paths and absolute aliases may name the same file).
// Independent executor connections and external processes are outside this lock.
const mutationLocks = new WeakMap<object, FileOperationLockManager>();

export function waitForFileMutationLock(
  ctx: Context,
  resourceAccessor: object,
): Promise<ExclusiveFileOperationLock> {
  let manager = mutationLocks.get(resourceAccessor);
  if (manager === undefined) {
    manager = new FileOperationLockManager();
    mutationLocks.set(resourceAccessor, manager);
  }
  return manager.waitForExclusiveLock(ctx);
}
