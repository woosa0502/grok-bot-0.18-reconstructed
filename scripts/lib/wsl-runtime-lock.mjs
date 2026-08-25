import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

function isErrno(error, code) {
  return typeof error === "object" && error != null && error.code === code;
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrno(error, "EPERM");
  }
}

async function readLock(lockPath) {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8"));
    return typeof parsed === "object" && parsed != null ? parsed : null;
  } catch {
    return null;
  }
}

export async function acquireBelmontRuntimeLock({
  profileDir,
  pid = process.pid,
  now = () => new Date(),
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  if (typeof profileDir !== "string" || profileDir.length === 0) {
    throw new TypeError("Belmont runtime lock requires a profile directory.");
  }
  await mkdir(profileDir, { recursive: true });
  const lockPath = path.join(path.resolve(profileDir), ".belmont-runtime.lock");
  const token = randomUUID();
  const record = { schemaVersion: 1, pid, token, startedAt: now().toISOString() };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      let released = false;
      return {
        lockPath,
        token,
        async release() {
          if (released) return;
          released = true;
          const current = await readLock(lockPath);
          if (current?.token === token) await unlink(lockPath).catch(error => {
            if (!isErrno(error, "ENOENT")) throw error;
          });
        },
      };
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      const current = await readLock(lockPath);
      if (current != null && isProcessAlive(current.pid)) {
        throw new Error(`Belmont is already running for this profile (pid ${current.pid}).`);
      }
      const recovered = `${lockPath}.stale-${Date.now()}-${randomUUID()}.json`;
      try {
        await rename(lockPath, recovered);
      } catch (renameError) {
        if (!isErrno(renameError, "ENOENT")) throw renameError;
      }
    }
  }
  throw new Error("Belmont could not acquire its profile runtime lock.");
}
