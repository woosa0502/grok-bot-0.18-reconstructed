#!/usr/bin/env python3
"""Own detached memory work and model transports in pinned Aside 907.

Run after patch-daemon-lifecycle.py. This tool reads bundle text only, validates
all anchors before writing, and refuses partial or foreign transformations.
"""
import argparse
from pathlib import Path


MARKER = "// belmont-browse-active-workloads: 907-v1"
END_MARKER = "// belmont-browse-active-workloads: end"

SHIM = r'''
var __belmontWorkloadRegistry;
function __belmontWorkloadState() {
  return __belmontWorkloadRegistry ||= {
    phase: "running", pending: new Set(), agents: new Set(), workers: new Map(),
    sockets: new Map(), failures: [], drain: null, close: null, resourcesClosing: false,
  };
}
function __belmontWorkloadCancellation() {
  const error = Error("Aside background work stopped during engine shutdown");
  error.name = "AbortError";
  error.code = "BELMONT_WORKLOAD_STOPPING";
  return error;
}
function __belmontWorkloadAssertOpen() {
  if (__belmontWorkloadState().phase !== "running") throw __belmontWorkloadCancellation();
}
function __belmontWorkloadTrack(operation, teardown = false) {
  const state = __belmontWorkloadState();
  if (!teardown && state.phase !== "running") return Promise.reject(__belmontWorkloadCancellation());
  const { promise, resolve, reject } = Promise.withResolvers();
  // Publish the obligation before calling a callback that may stop reentrantly.
  state.pending.add(promise);
  promise.then(() => state.pending.delete(promise), (error) => {
    state.pending.delete(promise);
    // AgentSession.dispose catches hook errors. Preserve teardown failures here
    // so its logging cannot turn a failed write into successful engine cleanup.
    if (teardown && error?.code !== "BELMONT_WORKLOAD_STOPPING") state.failures.push(error);
  });
  try { resolve(operation()); } catch (error) { reject(error); }
  return promise;
}
function __belmontWorkloadCompleted(operation) {
  if (__belmontWorkloadState().phase !== "running") return Promise.resolve();
  return __belmontWorkloadTrack(operation);
}
async function __belmontWorkloadPrompt(agent, ...args) {
  const state = __belmontWorkloadState();
  __belmontWorkloadAssertOpen();
  state.agents.add(agent);
  let result;
  try {
    // Agent.abort() before prompt creates its active run is ineffective. Keep
    // registration and prompt invocation in the same synchronous turn.
    result = await agent.prompt(...args);
    __belmontWorkloadAssertOpen();
  } finally {
    try { await agent.waitForIdle(); }
    catch (error) { state.failures.push(error); throw error; }
    finally { state.agents.delete(agent); }
  }
  // Shutdown may begin during waitForIdle after prompt has already resolved.
  __belmontWorkloadAssertOpen();
  return result;
}
function extractMemories(...args) {
  return __belmontWorkloadTrack(() => __belmontOriginalExtractMemories(...args));
}
function runDreaming(...args) {
  return __belmontWorkloadTrack(() => __belmontOriginalRunDreaming(...args));
}
function digestContextAwareness(...args) {
  return __belmontWorkloadTrack(() => __belmontOriginalDigestContextAwareness(...args));
}
function startSessionRunMemoryBackfill(...args) {
  if (__belmontWorkloadState().phase !== "running") return Promise.resolve();
  return __belmontWorkloadTrack(() => __belmontOriginalStartSessionRunMemoryBackfill(...args));
}
function __belmontWorkloadWorker(worker) {
  const state = __belmontWorkloadState();
  const { promise, resolve } = Promise.withResolvers();
  state.workers.set(worker, promise);
  worker.once("exit", () => { state.workers.delete(worker); resolve(); });
  // A filesystem/model await may finish after beginShutdown. Such a worker
  // remains owned and is immediately terminated rather than escaping the drain.
  if (state.phase !== "running") __belmontWorkloadTerminateWorker(worker);
  return worker;
}
function __belmontWorkloadTerminateWorker(worker) {
  const state = __belmontWorkloadState();
  __belmontWorkloadTrack(async () => {
    try { await worker.terminate(); }
    catch (error) { state.failures.push(error); }
  }, true);
}
function __belmontWorkloadBeginShutdown() {
  const state = __belmontWorkloadState();
  if (state.phase !== "running") return;
  state.phase = "stopping";
  for (const agent of state.agents) {
    try { agent.abort(); } catch (error) { state.failures.push(error); }
  }
  // Inspect only already-initialized backfills; shutdown must not bootstrap a DB.
  for (const accountId of activeBackfills?.keys() ?? []) {
    __belmontWorkloadTrack(async () => {
      try { await stopSessionRunMemoryBackfill(accountId); }
      catch (error) { state.failures.push(error); }
    }, true);
  }
  for (const worker of state.workers.keys()) __belmontWorkloadTerminateWorker(worker);
}
function __belmontWorkloadDrain() {
  const state = __belmontWorkloadState();
  __belmontWorkloadBeginShutdown();
  return state.drain ||= Promise.resolve().then(async () => {
    while (state.pending.size || state.workers.size) {
      await Promise.allSettled([...state.pending, ...state.workers.values()]);
    }
    state.phase = "drained";
    if (state.failures.length) throw new AggregateError([...state.failures], "Aside background workload cleanup failed");
  });
}
function __belmontWorkloadAssertResourcesOpen() {
  if (__belmontWorkloadState().resourcesClosing) throw __belmontWorkloadCancellation();
}
async function acquireWebSocket(...args) {
  __belmontWorkloadAssertResourcesOpen();
  const lease = await __belmontOriginalAcquireWebSocket(...args);
  if (__belmontWorkloadState().resourcesClosing) {
    lease.release({ keep: false });
    throw __belmontWorkloadCancellation();
  }
  const release = lease.release;
  lease.release = (options) => release(__belmontWorkloadState().resourcesClosing ? { keep: false } : options);
  return lease;
}
function __belmontWorkloadSocket(socket) {
  const state = __belmontWorkloadState();
  const onClose = () => {
    socket.removeEventListener("close", onClose);
    state.sockets.delete(socket);
  };
  state.sockets.set(socket, onClose);
  socket.addEventListener("close", onClose);
  if (socket.readyState === 3) onClose();
  return socket;
}
function __belmontWorkloadCloseSocket(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === 3) { resolve(); return; }
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };
    const onClose = () => { cleanup(); resolve(); };
    // Error alone does not prove the socket has closed.
    const onError = () => {};
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    timer = setTimeout(() => {
      cleanup();
      reject(Error(`Model WebSocket did not close within ${timeoutMs}ms`));
    }, timeoutMs);
    try { socket.close(1000, "engine_shutdown"); }
    catch (error) { cleanup(); reject(error); }
    if (socket.readyState === 3) onClose();
  });
}
function __belmontWorkloadCloseSessionResources({ timeoutMs = 5000 } = {}) {
  const state = __belmontWorkloadState();
  if (state.close) return state.close;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new TypeError("Socket close timeout must be positive"));
  state.resourcesClosing = true;
  return state.close = Promise.resolve().then(async () => {
    const failures = [];
    try { await __belmontWorkloadDrain(); } catch (error) { failures.push(error); }
    // Retain cached sockets even when imported before the constructor tracker.
    for (const entries of websocketSessionCache?.values() ?? []) {
      for (const entry of entries.values()) {
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        if (!state.sockets.has(entry.socket)) __belmontWorkloadSocket(entry.socket);
      }
    }
    // Attach close listeners before the registered cleanup invokes .close().
    const sockets = [...state.sockets.keys()].map((socket) => __belmontWorkloadCloseSocket(socket, timeoutMs));
    const cleanups = [...(sessionResourceCleanups ?? [])].map((cleanup) => Promise.resolve().then(() => cleanup()));
    const results = await Promise.allSettled([...sockets, ...cleanups]);
    for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    if (failures.length) {
      state.phase = "close_failed";
      throw new AggregateError(failures, "Aside model session resource cleanup failed");
    }
    state.phase = "closed";
  });
}
export const __belmontWorkloads = {
  start() {
    const state = __belmontWorkloadState();
    if (state.phase === "running") return;
    if (state.phase !== "closed" || state.pending.size || state.agents.size || state.workers.size || state.sockets.size) {
      throw Error(`Cannot restart Aside workloads while ${state.phase}`);
    }
    __belmontWorkloadRegistry = undefined;
    __belmontWorkloadState();
  },
  beginShutdown: __belmontWorkloadBeginShutdown,
  drain: __belmontWorkloadDrain,
  closeSessionResources: __belmontWorkloadCloseSessionResources,
  stats() {
    const state = __belmontWorkloadState();
    return { phase: state.phase, pending: state.pending.size, agents: state.agents.size,
      workers: state.workers.size, sockets: state.sockets.size, failures: state.failures.length };
  },
};
'''


def replacements():
    changes = []
    for name, renamed, parameters in (
        ("extractMemories", "ExtractMemories", "Cn"),
        ("runDreaming", "RunDreaming", "Cn"),
        ("digestContextAwareness", "DigestContextAwareness", "Cn,ei={}"),
    ):
        changes.append((f"async function {name}({parameters}){{", f"async function __belmontOriginal{renamed}({parameters}){{"))
    changes.append(("function startSessionRunMemoryBackfill(Cn){", "function __belmontOriginalStartSessionRunMemoryBackfill(Cn){"))
    changes.append(("async function acquireWebSocket(Cn,ei,ti,ni,ri,ii,ai){", "async function __belmontOriginalAcquireWebSocket(Cn,ei,ti,ni,ri,ii,ai){"))
    completed = "this.hooks.trigger(`agent.run.completed`,{finalAssistantMessage:ei,sessionRun:ti},void 0).catch(Cn=>console.error(`[Hook] agent.run.completed failed:`,Cn))"
    changes.append((completed, "__belmontWorkloadCompleted(()=>" + completed.split(".catch", 1)[0] + ").catch(Cn=>console.error(`[Hook] agent.run.completed failed:`,Cn))"))
    disposed = '"session.dispose":()=>{incrementSessionCount(Cn.accountRoot).catch(Cn=>{logger.error(`[MemoryHook] incrementSessionCount failed: ${Cn}`)})}'
    changes.append((disposed, '"session.dispose":()=>__belmontWorkloadTrack(()=>incrementSessionCount(Cn.accountRoot),true)'))
    for name, content in (("pi", "buildExtractionPrompt({sessionId:Cn.sessionId,memoryRoot:ai,recentMessageCount:ri,targetEpisodicPath:si.path,recentEpisodicContent:si.recentContent})"),):
        old = f"try{{await {name}.prompt({{role:`user`,content:[{{type:`text`,text:{content}}}],timestamp:Date.now()}})"
        changes.append((old, old.replace(f"{name}.prompt(", f"__belmontWorkloadPrompt({name},", 1)))
    dream = "try{await Ti.prompt({role:`user`,content:buildDreamingUserPrompt({memoryRoot:ui,memoryIndex:vi,recentEpisodic:bi,existingL1User:Ci,existingL1Memory:wi}),timestamp:Date.now()})"
    changes.append((dream, dream.replace("Ti.prompt(", "__belmontWorkloadPrompt(Ti,", 1)))
    worker = "ri=new Worker(MEMORY_HISTORY_BACKFILL_WORKER_SOURCE,{eval:!0,workerData:ni});await new Promise"
    changes.append((worker, worker.replace("ri=new Worker(", "ri=__belmontWorkloadWorker(new Worker(").replace("workerData:ni});", "workerData:ni}));")))
    constructor = "let ii=await getWebSocketConstructor(ri);if(!ii)throw Error(`WebSocket transport is not available in this runtime`);"
    changes.append((constructor, constructor + "__belmontWorkloadAssertResourcesOpen();"))
    changes.append(("ci=new ii(Cn,{headers:ai})", "ci=__belmontWorkloadSocket(new ii(Cn,{headers:ai}))"))
    return changes


def repair_routine_memory_await(source):
    # 907 made ensureRoutineMemory async, but left this fallback un-awaited.
    # Repair both fresh inputs and previously patched bundles without relaxing
    # any lifecycle/workload anchor or suffix validation.
    old = "ii=ti===void 0?await getLastRun(Cn,ei):ti,ai=ni.routineMemoryPath??ensureRoutineMemory(Cn,ei),oi="
    new = "ii=ti===void 0?await getLastRun(Cn,ei):ti,ai=ni.routineMemoryPath??await ensureRoutineMemory(Cn,ei),oi="
    if source.count("async function buildRoutineTriggerMessage(Cn,ei,ti,ni={}){") != 1:
        raise ValueError("Routine trigger message declaration mismatch")
    if source.count(old) == 1 and source.count(new) == 0:
        return source.replace(old, new, 1)
    if source.count(old) == 0 and source.count(new) == 1:
        return source
    raise ValueError("Routine memory await anchor mismatch")


def patch(source):
    source = repair_routine_memory_await(source)
    suffix = "\n" + MARKER + "\n" + SHIM + END_MARKER + "\n"
    if MARKER in source or END_MARKER in source or "export const __belmontWorkloads" in source:
        if source.count(suffix) != 1 or not source.endswith(suffix):
            raise ValueError("Active workload suffix mismatch; refusing partial or foreign patch")
        body = source[:-len(suffix)]
        for old, new in replacements():
            if body.count(new) != 1 or body.count(old) != new.count(old):
                raise ValueError(f"Patched active workload anchor mismatch: {old[:100]}")
        return source
    for old, new in replacements():
        if source.count(old) != 1 or source.count(new) != 0:
            raise ValueError(f"Active workload anchor mismatch: count={source.count(old)}: {old[:100]}")
    for old, new in replacements():
        source = source.replace(old, new, 1)
    return source + suffix


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, nargs="?")
    args = parser.parse_args()
    source = args.input.read_text(encoding="utf-8")
    result = patch(source)
    destination = args.output or args.input
    if destination != args.input or result != source:
        destination.write_text(result, encoding="utf-8")
    print(f"{destination}: {'already patched and validated' if result == source else 'patched'} (active-workloads-907-v1)")


if __name__ == "__main__":
    main()
