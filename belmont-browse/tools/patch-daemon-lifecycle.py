#!/usr/bin/env python3
"""Add restartable, drainable lifecycle hooks to pinned Aside 906/907 bundles.

Run after patch-daemon.py and patch-daemon-linux.py. Input is read as text only.
Every source anchor is checked before any write; an idempotent invocation checks
the complete transformed shape, rather than trusting a marker alone.
"""
import argparse
from pathlib import Path


MARKER = "// belmont-browse-lifecycle: drainable-906-v1"
END_MARKER = "// belmont-browse-lifecycle: end"


SHIM = r'''
var __belmontLifecycleRegistry;
function __belmontLifecycleState(name) {
  __belmontLifecycleRegistry ||= new Map();
  if (!__belmontLifecycleRegistry.has(name)) {
    __belmontLifecycleRegistry.set(name, {
      phase: "idle", pending: new Set(), failures: [], agents: new Set(), start: null, stop: null, stopFailure: null, initialized: false,
    });
  }
  return __belmontLifecycleRegistry.get(name);
}
function __belmontLifecycleInitialize(name) {
  const state = __belmontLifecycleState(name);
  if (!state.initialized) {
    ({ routine: init_scheduler, context: init_start_context_awareness, maintenance: init_lifecycles,
      comprehension: init_start_comprehension })[name]();
    state.initialized = true;
  }
  return state;
}
function __belmontLifecycleBlocked(name) {
  return ["failed", "stopping", "stopped", "stop_failed"].includes(__belmontLifecycleState(name).phase);
}
function __belmontLifecycleTrack(name, operation, teardown = false) {
  const state = __belmontLifecycleState(name);
  if (!teardown && __belmontLifecycleBlocked(name)) return Promise.resolve();
  let result;
  try { result = operation(); } catch (error) { result = Promise.reject(error); }
  const promise = Promise.resolve(result);
  state.pending.add(promise);
  // Observe the original Promise, not a detached .finally() rejection.
  promise.then(() => state.pending.delete(promise), (error) => {
    state.pending.delete(promise);
    if (error?.code !== "BELMONT_LIFECYCLE_STOPPING") state.failures.push(error);
  });
  return promise;
}
async function __belmontLifecycleDrain(state) {
  while (state.pending.size) await Promise.allSettled([...state.pending]);
}
function __belmontLifecycleStart(name, operation) {
  const state = __belmontLifecycleInitialize(name);
  if (["stopping", "failed", "stop_failed"].includes(state.phase)) {
    return Promise.reject(Error(`Cannot start ${name} while ${state.phase}; await its stop hook`));
  }
  if (state.start) return state.start;
  if (state.phase === "running") return Promise.resolve();
  state.phase = "starting";
  let resolveStart;
  let rejectStart;
  const promise = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  state.start = promise;
  const cleanup = () => { if (state.start === promise) state.start = null; };
  promise.then(cleanup, cleanup);
  try { operation(); } catch (error) {
    state.phase = "failed";
    state.failures.push(error);
    rejectStart(error);
    return promise;
  }
  Promise.allSettled([...state.pending]).then((startup) => {
    const failures = startup.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) {
      if (state.phase === "starting") state.phase = "failed";
      rejectStart(new AggregateError(failures, `${name} lifecycle startup failed`));
      return;
    }
    if (state.phase === "starting") state.phase = "running";
    resolveStart();
  }, rejectStart);
  return promise;
}
function __belmontLifecycleStop(name, operation) {
  const state = __belmontLifecycleInitialize(name);
  if (state.stop) return state.stop;
  if (state.phase === "stop_failed") return Promise.reject(state.stopFailure);
  if (state.phase === "stopped") return Promise.resolve();
  state.phase = "stopping";
  let resolveStop;
  let rejectStop;
  const stop = new Promise((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
  // Publish ownership before invoking any user/resource callback, while keeping
  // timer cancellation synchronous for callers stopping all lifecycles at once.
  state.stop = stop;
  (async () => {
    try {
      try { await operation(state); } catch (error) { state.failures.push(error); }
      await __belmontLifecycleDrain(state);
      const failures = [...new Set(state.failures.splice(0))];
      if (failures.length) throw new AggregateError(failures, `${name} lifecycle shutdown failed`);
    } catch (error) {
      state.phase = "stop_failed";
      state.stopFailure = error;
      throw error;
    } finally {
      if (state.phase === "stopping") state.phase = "stopped";
      state.stop = null;
    }
  })().then(resolveStop, rejectStop);
  return stop;
}
function checkRoutines(...args) {
  return __belmontLifecycleTrack("routine", () => __belmontOriginalCheckRoutines(...args));
}
function runGc(...args) {
  return __belmontLifecycleTrack("context", () => __belmontOriginalRunGc(...args));
}
function runPass(...args) {
  return __belmontLifecycleTrack("comprehension", () => __belmontOriginalRunPass(...args));
}
function __belmontLifecycleCancellation() {
  const error = Error("Context comprehension stopped before summary completion");
  error.name = "AbortError";
  error.code = "BELMONT_LIFECYCLE_STOPPING";
  return error;
}
function runSummaryAgent(...args) {
  if (__belmontLifecycleBlocked("comprehension")) return Promise.reject(__belmontLifecycleCancellation());
  return __belmontLifecycleTrack("comprehension", () => __belmontOriginalRunSummaryAgent(...args));
}
function runContextAwarenessComprehension(...args) {
  if (__belmontLifecycleBlocked("comprehension")) return Promise.reject(__belmontLifecycleCancellation());
  return __belmontLifecycleTrack("comprehension", () => __belmontOriginalRunContextAwarenessComprehension(...args));
}
function purgeEphemeralSessions(...args) {
  return __belmontLifecycleTrack("maintenance", () => __belmontOriginalPurgeEphemeralSessions(...args));
}
function flushIdleTabs(...args) {
  return __belmontLifecycleTrack("maintenance", () => __belmontOriginalFlushIdleTabs(...args));
}
function reconcileSessionTabs(...args) {
  return __belmontLifecycleTrack("maintenance", () => __belmontOriginalReconcileSessionTabs(...args));
}
var __belmontMaintenanceTimer = null;
var __belmontReconciliationRetryTimers = new Set();
function __belmontLifecycleScheduleReconciliationRetry(operation) {
  if (__belmontLifecycleBlocked("maintenance")) return;
  const timer = setTimeout(() => {
    __belmontReconciliationRetryTimers.delete(timer);
    __belmontLifecycleTrack("maintenance", operation);
  }, ORPHAN_TAB_CLOSE_RETRY_MS);
  __belmontReconciliationRetryTimers.add(timer);
  return timer;
}
function startSessionMaintenance() {
  return __belmontLifecycleStart("maintenance", () => {
    if (__belmontMaintenanceTimer !== null) return;
    // Match the original five-minute scheduling cadence without starting its
    // detached automatic run recovery or installing its anonymous interval.
    __belmontMaintenanceTimer = setInterval(() => {
      __belmontLifecycleTrack("maintenance", async () => {
        const first = await Promise.allSettled([purgeEphemeralSessions()]);
        const second = await Promise.allSettled([flushIdleTabs()]);
        const failures = [...first, ...second].filter((result) => result.status === "rejected").map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, "Session maintenance failed");
      });
    }, SESSION_LIFECYCLE_INTERVAL_MS);
  });
}
function stopSessionMaintenance() {
  return __belmontLifecycleStop("maintenance", () => {
    if (__belmontMaintenanceTimer !== null) clearInterval(__belmontMaintenanceTimer);
    __belmontMaintenanceTimer = null;
    for (const timer of __belmontReconciliationRetryTimers) clearTimeout(timer);
    __belmontReconciliationRetryTimers.clear();
  });
}
function __belmontLifecycleBeginSummary(agent) {
  if (__belmontLifecycleBlocked("comprehension")) throw __belmontLifecycleCancellation();
  __belmontLifecycleState("comprehension").agents.add(agent);
}
function captureTab(...args) {
  return __belmontLifecycleTrack("context", () => __belmontOriginalCaptureTab(...args));
}
function sweepStaleTabs(...args) {
  return __belmontLifecycleTrack("context", () => __belmontOriginalSweepStaleTabs(...args));
}
function reportUserTabSignal(...args) {
  return __belmontLifecycleTrack("context", () => __belmontOriginalReportUserTabSignal(...args));
}
function reportNativeBrowserSignal(...args) {
  return __belmontLifecycleTrack("context", () => __belmontOriginalReportNativeBrowserSignal(...args));
}
function verifyActiveTabWithExtension(...args) {
  return __belmontLifecycleTrack("context", () => __belmontOriginalVerifyActiveTabWithExtension(...args));
}
var __belmontObserverGraceTimer = null;
function stopObservingUserBrowsing(...args) {
  if (__belmontObserverGraceTimer !== null) clearTimeout(__belmontObserverGraceTimer);
  __belmontObserverGraceTimer = null;
  return __belmontLifecycleTrack("context", () => __belmontOriginalStopObservingUserBrowsing(...args), true);
}
function startContextCapture(...args) {
  if (!__belmontLifecycleBlocked("context")) return __belmontOriginalStartContextCapture(...args);
}
function reconcileContextAwareness(...args) {
  if (!__belmontLifecycleBlocked("context")) return __belmontOriginalReconcileContextAwareness(...args);
}
function startRoutineScheduler() {
  return __belmontLifecycleStart("routine", __belmontOriginalStartRoutineScheduler);
}
function stopRoutineScheduler() {
  return __belmontLifecycleStop("routine", () => {
    if (routineInterval !== null) clearInterval(routineInterval);
    routineInterval = null;
  });
}
function startContextAwareness() {
  return __belmontLifecycleStart("context", __belmontOriginalStartContextAwareness);
}
function stopContextAwareness() {
  return __belmontLifecycleStop("context", async (state) => {
    if (gcTimer !== null) clearInterval(gcTimer);
    gcTimer = null;
    // stopContextCapture detaches the first observer disposal; its wrapper above
    // retains that exact Promise even though the observer fields are now null.
    try { stopContextCapture(); } catch (error) { state.failures.push(error); }
    __belmontLifecycleTrack("context", () => nativeContextAwarenessHelper.stop(), true);
    await __belmontLifecycleDrain(state);
    // An already-running canvas read may create an observer after the first stop.
    await stopObservingUserBrowsing();
  });
}
function startContextAwarenessComprehension() {
  return __belmontLifecycleStart("comprehension", __belmontOriginalStartContextAwarenessComprehension);
}
function stopContextAwarenessComprehension() {
  return __belmontLifecycleStop("comprehension", (state) => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    for (const agent of [...state.agents]) {
      try { agent.abort(); } catch (error) { state.failures.push(error); }
      __belmontLifecycleTrack("comprehension", () => agent.waitForIdle(), true);
    }
  });
}
export const __belmontLifecycles = {
  contextSettingsManaged: true,
  get startSessionMaintenance() { __belmontLifecycleInitialize("maintenance"); return startSessionMaintenance; },
  get stopSessionMaintenance() { __belmontLifecycleInitialize("maintenance"); return stopSessionMaintenance; },
  get startRoutineScheduler() { __belmontLifecycleInitialize("routine"); return startRoutineScheduler; },
  get stopRoutineScheduler() { __belmontLifecycleInitialize("routine"); return stopRoutineScheduler; },
  get startContextAwareness() { __belmontLifecycleInitialize("context"); return startContextAwareness; },
  get stopContextAwareness() { __belmontLifecycleInitialize("context"); return stopContextAwareness; },
  get startContextAwarenessComprehension() { __belmontLifecycleInitialize("comprehension"); return startContextAwarenessComprehension; },
  get stopContextAwarenessComprehension() { __belmontLifecycleInitialize("comprehension"); return stopContextAwarenessComprehension; },
};
'''


def replacements():
    changes = []
    for original, renamed, parameters in (
        ("checkRoutines", "CheckRoutines", ""),
        ("runGc", "RunGc", ""),
        ("runPass", "RunPass", ""),
        ("runSummaryAgent", "RunSummaryAgent", "Cn"),
        ("captureTab", "CaptureTab", "Cn,ei,ti,ni"),
        ("sweepStaleTabs", "SweepStaleTabs", ""),
        ("reportUserTabSignal", "ReportUserTabSignal", "Cn,ei"),
        ("reportNativeBrowserSignal", "ReportNativeBrowserSignal", "Cn,ei"),
        ("verifyActiveTabWithExtension", "VerifyActiveTabWithExtension", "Cn,ei"),
        ("stopObservingUserBrowsing", "StopObservingUserBrowsing", ""),
        ("purgeEphemeralSessions", "PurgeEphemeralSessions", ""),
        ("flushIdleTabs", "FlushIdleTabs", ""),
        ("reconcileSessionTabs", "ReconcileSessionTabs", "Cn,ei"),
    ):
        changes.append((f"async function {original}({parameters}){{",
                        f"async function __belmontOriginal{renamed}({parameters}){{"))
    for original, renamed, parameters in (
        ("startRoutineScheduler", "StartRoutineScheduler", ""),
        ("startContextAwareness", "StartContextAwareness", ""),
        ("startContextAwarenessComprehension", "StartContextAwarenessComprehension", ""),
        ("startContextCapture", "StartContextCapture", "Cn=AccountRegistry.getCurrentAccountId()"),
        ("reconcileContextAwareness", "ReconcileContextAwareness", "Cn=AccountRegistry.getCurrentAccountId()"),
        ("runContextAwarenessComprehension", "RunContextAwarenessComprehension", "Cn,ei={}"),
    ):
        changes.append((f"function {original}({parameters}){{",
                        f"function __belmontOriginal{renamed}({parameters}){{"))
    grace = "setTimeout(()=>{unsubscribers&&!globalCdpClient.isConnected&&logger.warn(`[ContextAwareness] No CDP connection to the browser — nothing will be captured until it connects.`)},CDP_CONNECT_GRACE_MS).unref()"
    changes.append((grace, "(__belmontObserverGraceTimer=" + grace.replace(
        "setTimeout(()=>{unsubscribers", "setTimeout(()=>{__belmontObserverGraceTimer=null;unsubscribers"
    ).removesuffix(".unref()") + ").unref()"))
    observer_stop = "for(let Cn of unsubscribers??[])Cn();unsubscribers=null,browserContextCheck=null,discoveryUntil=0;let Cn=observerBrowser,ei=observerCdp;observerBrowser=null,observerCdp=null,await Cn?.dispose().catch(()=>{}),await ei?.close().catch(()=>{})"
    observer_stop_new = "let belmontErrors=[];for(let Cn of unsubscribers??[])try{Cn()}catch(error){belmontErrors.push(error)}unsubscribers=null,browserContextCheck=null,discoveryUntil=0;let Cn=observerBrowser,ei=observerCdp;observerBrowser=null,observerCdp=null;try{await Cn?.dispose()}catch(error){belmontErrors.push(error)}try{await ei?.close()}catch(error){belmontErrors.push(error)}if(belmontErrors.length)throw new AggregateError(belmontErrors,`Context observer shutdown failed`)"
    changes.append((observer_stop, observer_stop_new))
    routine_accounts = "for(let ei of AccountRegistry.getAll().accounts){await runRoutineSuggestionDiscovery(ei.id,{reason:`scheduled`})"
    changes.append((routine_accounts, routine_accounts.replace("{await runRoutineSuggestionDiscovery", '{if(__belmontLifecycleBlocked("routine"))break;await runRoutineSuggestionDiscovery', 1)))
    routine_dispatch = "let ti=listDueRoutines(ei.id,Cn);for(let ni of ti)await runDueRoutine(ei.id,ni,Cn).catch(Cn=>logger.warn(`[RoutineScheduler] Routine run failed`,{routineId:ni.id,error:Cn}))"
    routine_dispatch_new = 'if(__belmontLifecycleBlocked("routine"))break;let ti=listDueRoutines(ei.id,Cn);for(let ni of ti){if(__belmontLifecycleBlocked("routine"))break;await runDueRoutine(ei.id,ni,Cn).catch(Cn=>logger.warn(`[RoutineScheduler] Routine run failed`,{routineId:ni.id,error:Cn}))}'
    changes.append((routine_dispatch, routine_dispatch_new))
    changes.append(("setTimeout(()=>void ri(),ORPHAN_TAB_CLOSE_RETRY_MS)", "__belmontLifecycleScheduleReconciliationRetry(ri)"))
    bridge_callback = "globalExtensionBridge.onConnect(({accountId:Cn,profileId:ei})=>{let ti=`${Cn}:${ei}`;"
    changes.append((bridge_callback, bridge_callback.replace("=>{let ti=", '=>{if(__belmontLifecycleBlocked("maintenance"))return;let ti=', 1)))
    # Direct API/account reconciliation must respect the lifecycle stop boundary.
    reconcile = "reconcile(Cn=AccountRegistry.getCurrentAccountId()){if(Cn===AccountRegistry.getCurrentAccountId())"
    changes.append((reconcile, reconcile.replace("{if(", '{if(__belmontLifecycleBlocked("context"))return;if(', 1)))
    helper_stop = "let ei=new Promise(ei=>{let ti=setTimeout(ei,2e3),ni=setTimeout(()=>Cn.kill(),1e3);ti.unref(),ni.unref(),Cn.once(`close`,()=>{clearTimeout(ti),clearTimeout(ni),ei()})});this.#t=ei,ei.finally(()=>{this.#t===ei&&(this.#t=null)}),this.#K(Cn,{command:`shutdown`}).catch(logDetachedError)}}"
    helper_stop_new = "let ei=new Promise((ei,belmontReject)=>{let ti=setTimeout(()=>{clearTimeout(ni);belmontReject(Error(`Native context helper did not exit within 2000ms`))},2e3),ni=setTimeout(()=>Cn.kill(),1e3);ti.unref(),ni.unref(),Cn.once(`close`,()=>{clearTimeout(ti),clearTimeout(ni),ei()})});this.#t=ei;let belmontCleanup=()=>{this.#t===ei&&(this.#t=null)};ei.then(belmontCleanup,belmontCleanup);this.#K(Cn,{command:`shutdown`}).catch(logDetachedError)}return this.#t}"
    changes.append((helper_stop, helper_stop_new))
    summary_prompt = "try{await ii.prompt({role:`user`,content:Cn.prompt,timestamp:Date.now()})}finally{si()}"
    summary_prompt_new = 'try{__belmontLifecycleBeginSummary(ii);await ii.prompt({role:`user`,content:Cn.prompt,timestamp:Date.now()});if(__belmontLifecycleBlocked("comprehension"))throw __belmontLifecycleCancellation()}finally{__belmontLifecycleState("comprehension").agents.delete(ii);si()}'
    changes.append((summary_prompt, summary_prompt_new))
    queue_gate = "if(!ri()||!settings(ti).get(`contextAwareness`).enabled)return{...ni,gated:`disabled`};let ii=ei.now??Date.now();ni.queued=enqueueSummaryJobs(ti,ii);for(let ai=0;ai<(ei.maxJobs??MAX_JOBS_PER_PASS)&&ri();ai+=1)"
    queue_gate_new = queue_gate.replace("if(!ri()", 'if(__belmontLifecycleBlocked("comprehension")||!ri()', 1).replace("&&ri();ai+=1)", '&&ri()&&!__belmontLifecycleBlocked("comprehension");ai+=1)')
    changes.append((queue_gate, queue_gate_new))
    cancel_job = "}catch(Cn){if(!ri()){ni.skipped+=1;break}let ei=Cn instanceof Error?Cn.message:String(Cn),oi=ai.attemptCount>=MAX_ATTEMPTS"
    cancel_job_new = cancel_job.replace("}catch(Cn){", '}catch(Cn){if(Cn?.code===`BELMONT_LIFECYCLE_STOPPING`){if(ri())deferSummaryJob(ti,ai,Date.now());ni.skipped+=1;break}', 1)
    changes.append((cancel_job, cancel_job_new))
    dispose_all = "async disposeAll(){await Promise.all([...this.#e.values()].map(Cn=>this.disposeSession(Cn.accountId,Cn.sessionId)))}"
    # Admission is closed by the runtime owner before this method is called.
    # Pending factories can publish sessions after an eager #e snapshot.
    dispose_all_new = "async disposeAll(){let belmontFailures=[];while(this.#t.size){let belmontLoads=await Promise.allSettled([...this.#t.values()]);for(let result of belmontLoads)if(result.status===`rejected`)belmontFailures.push(result.reason)}let belmontDisposals=await Promise.allSettled([...this.#e.values()].map(Cn=>this.disposeSession(Cn.accountId,Cn.sessionId)));for(let result of belmontDisposals)if(result.status===`rejected`)belmontFailures.push(result.reason);if(belmontFailures.length)throw new AggregateError(belmontFailures,`Agent session shutdown failed`)}"
    changes.append((dispose_all, dispose_all_new))
    return changes


def patch(source):
    suffix = "\n" + MARKER + "\n" + SHIM + END_MARKER + "\n"
    if MARKER in source or END_MARKER in source or "export const __belmontLifecycles" in source:
        if source.count(suffix) != 1 or not source.endswith(suffix):
            raise ValueError("Lifecycle suffix mismatch; refusing partial or foreign lifecycle patch")
        body = source[:-len(suffix)]
        for old, new in replacements():
            if body.count(old) != 0 or body.count(new) != 1:
                raise ValueError(f"Patched lifecycle anchor mismatch: {old[:100]}")
        validate_ownership(body)
        return source
    for old, new in replacements():
        if source.count(old) != 1 or source.count(new) != 0:
            raise ValueError(f"Lifecycle anchor mismatch: count={source.count(old)}: {old[:100]}")
    validate_ownership(source)
    for old, new in replacements():
        source = source.replace(old, new, 1)
    return source + suffix


def validate_ownership(source):
    # Renaming alone must not accept a different timer implementation.
    for anchor in (
        "routineInterval||=setInterval(()=>{checkRoutines().catch(Cn=>logger.warn(`checkRoutines failed`,{error:Cn}))},ROUTINE_CHECK_INTERVAL_MS)",
        "runGc(),!gcTimer&&(gcTimer=setInterval(()=>void runGc(),GC_INTERVAL_MS),gcTimer.unref())",
        "timer||(runPass(),timer=setInterval(()=>void runPass(),COMPREHENSION_INTERVAL_MS),timer.unref?.())",
        "stopObservingUserBrowsing().catch(Cn=>logger.warn(`[ContextCapture] Observer teardown failed`,{error:Cn})),sweepTimer&&clearInterval(sweepTimer),sweepTimer=null",
        "init_scheduler=__esmMin(", "init_start_context_awareness=__esmMin(", "init_start_comprehension=__esmMin(",
        "init_lifecycles=__esmMin(", "SESSION_LIFECYCLE_INTERVAL_MS=5*MINUTE_MS,ORPHAN_TAB_CLOSE_RETRY_MS=2e3",
    ):
        if source.count(anchor) != 1:
            raise ValueError(f"Lifecycle ownership anchor mismatch: {anchor[:100]}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, nargs="?", help="omit to update input after validation")
    args = parser.parse_args()
    source = args.input.read_text(encoding="utf-8")
    result = patch(source)
    destination = args.output or args.input
    if destination != args.input or result != source:
        destination.write_text(result, encoding="utf-8")
    print(f"{destination}: {'already patched and validated' if result == source else 'patched'} (drainable-906-v1)")


if __name__ == "__main__":
    main()
