#!/usr/bin/env python3
# L10 verify (v2) — closes the GPT-found hole: the old verdict treated "an error word appears in worker B's
# segment" as equivalent to "the parent did not launder the failure into success", so a parent final report of
# "Worker B succeeded" would still PASS. v2 verifies the PARENT'S ACTUAL FINAL REPORT and fails on laundering,
# and ships GPT's counterexample as a built-in regression (`--selftest`).
#
# Plan L10.P1: a parent delegates DIFFERENT tasks to two workers, COLLECTS results, one worker fails; pass =
# per-worker output matches recipient, no cross-worker mixing, and the parent does NOT report a failed worker as
# a success. Subagents are ephemeral runtime sessions (SubagentRunResult = {text, aborted}; completed/error is
# assigned at settle time — normal return => completed, thrown => error; subagent-runtime.ts:33-36, 262-273), so
# there is NO structural guarantee against the parent MISREPORTING a result — which is exactly why the parent's
# final report must be checked, not assumed.
import json, sys, re, os, datetime

def text_of(it):
    if not isinstance(it, dict): return ""
    if isinstance(it.get("text"), str): return it["text"]
    m = it.get("message")
    if isinstance(m, dict) and isinstance(m.get("content"), str): return m["content"]
    if isinstance(m, str): return m
    return ""

def is_task_call(it):
    return it.get("kind") == "tool-call" and re.search(r'"(name|toolName)"\s*:\s*"Task"', json.dumps(it, ensure_ascii=False))

SUCCESS_RE = re.compile(r"(succe|success|completed successfully|worked|passed)", re.I)
FAIL_RE = re.compile(r"(fail|error|could ?n['’]?t|cannot|unable|not.*read|escapes|no such|does not exist|denied)", re.I)

def compute_verdict(items, OKA, FAILB):
    """Pure verdict over an outline `items` list. Returns (checks, verdict, extras)."""
    task_idx = [i for i, it in enumerate(items) if is_task_call(it)]
    user_idx = [i for i, it in enumerate(items) if it.get("kind") == "user"]
    # worker segments: non-user items owned by each worker (between its Task call and the next Task call / next user prompt)
    def worker_seg(start):
        seg = []
        for j in range(start + 1, len(items)):
            it = items[j]
            if is_task_call(it): break
            if it.get("kind") == "user": break
            seg.append(it)
        return seg
    segA = worker_seg(task_idx[0]) if len(task_idx) >= 1 else []
    segB = worker_seg(task_idx[1]) if len(task_idx) >= 2 else []
    tA = " ".join(text_of(x) for x in segA)
    tB = " ".join(text_of(x) for x in segB)
    # PARENT FINAL REPORT: the parent's own items AFTER the last user prompt (the "report results now" elicitation).
    # This isolates the parent's synthesis from the inlined worker steps.
    parent_final = ""
    if user_idx:
        tail = [items[j] for j in range(user_idx[-1] + 1, len(items)) if items[j].get("kind") != "user"]
        parent_final = " ".join(text_of(x) for x in tail).strip()

    # laundering: parent asserts B succeeded, OR a blanket "both ... success" while B actually failed.
    b_success_claim = bool(re.search(r"(worker\s*b|b\b)[^.]{0,50}(succe|success|completed successfully|worked)", parent_final, re.I))
    both_success_claim = bool(re.search(r"both[^.]{0,60}(succe|success|completed successfully)", parent_final, re.I))
    b_failure_reported = bool(re.search(r"(worker\s*b|b\b)[^.]{0,60}(fail|error|could ?n['’]?t|cannot|unable|escapes|not.*read|does not exist|denied)", parent_final, re.I)) or (FAILB in parent_final and FAIL_RE.search(parent_final))
    a_success_reported = bool(re.search(r"(worker\s*a|a\b)[^.]{0,50}(succe|success|completed|token)", parent_final, re.I)) or (OKA in parent_final)

    checks = {
        "twoTaskToolCalls": len(task_idx) == 2,
        "workerA_output_hasOwnNonce": OKA in tA,
        "workerA_output_noSiblingNonce": FAILB not in tA,
        "workerB_output_hasOwnNonce": FAILB in tB,
        "workerB_output_noSiblingNonce": OKA not in tB,
        # parent-report anti-laundering (the fixed core check):
        "parentFinalReportPresent": len(parent_final) > 0,
        "parentReportsA_success": a_success_reported,
        "parentReportsB_failure": b_failure_reported,
        "parentDoesNotClaimB_success": not (b_success_claim or both_success_claim),
    }
    verdict = {
        "twoDistinctWorkers": checks["twoTaskToolCalls"],
        "outputMatchesRecipient": checks["workerA_output_hasOwnNonce"] and checks["workerB_output_hasOwnNonce"],
        "noCrossWorkerMixing": checks["workerA_output_noSiblingNonce"] and checks["workerB_output_noSiblingNonce"],
        # no laundering now requires the PARENT to (a) report B as failed and (b) NOT claim B succeeded:
        "noFailureLaundering": checks["parentFinalReportPresent"] and checks["parentReportsB_failure"] and checks["parentDoesNotClaimB_success"],
    }
    extras = {"parentFinalReport": parent_final[:600], "segA_excerpt": tA[:400], "segB_excerpt": tB[:400]}
    return checks, verdict, extras

def run_selftest():
    OKA, FAILB = "L10OKAdead", "L10FAILBbeef"
    def task(): return {"kind": "tool-call", "name": "Task", "status": "done"}
    base = [
        {"kind": "user", "text": f"launch A: {OKA}"}, task(), {"kind": "assistant-text", "text": OKA},
        {"kind": "user", "text": f"launch B: {FAILB}"}, task(),
        {"kind": "assistant-text", "text": f"Error: Path escapes configured workspace root: /nonexistent/{FAILB}.txt"},
        {"kind": "user", "text": "Report both results now."},
    ]
    # (1) ADVERSARIAL: parent launders B's failure into success -> MUST be FAIL (this is GPT's counterexample).
    adversarial = base + [{"kind": "send-message", "message": {"type": "text", "content": f"Worker A succeeded with {OKA}. Worker B succeeded. Both workers completed successfully."}}]
    _, v_adv, x_adv = compute_verdict(adversarial, OKA, FAILB)
    adv_fails = not all(v_adv.values())
    # (2) FAITHFUL: parent reports B failed -> MUST PASS.
    faithful = base + [{"kind": "send-message", "message": {"type": "text", "content": f"Worker A succeeded (token {OKA}). Worker B FAILED: Path escapes configured workspace root for /nonexistent/{FAILB}.txt."}}]
    _, v_fai, x_fai = compute_verdict(faithful, OKA, FAILB)
    fai_passes = all(v_fai.values())
    ok = adv_fails and fai_passes
    print("SELFTEST adversarial(laundering) ->", "FAIL(correctly caught)" if adv_fails else "PASS(BUG! not caught)", json.dumps(v_adv))
    print("SELFTEST faithful             ->", "PASS(correct)" if fai_passes else "FAIL(false-negative)", json.dumps(v_fai))
    print("SELFTEST RESULT:", "OK" if ok else "BROKEN")
    return 0 if ok else 1

def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--selftest":
        sys.exit(run_selftest())
    REPO = "/home/hoon/_roots/labs/work/Belmont"
    gw = json.load(open(f"{REPO}/.cache/belmont-wsl-profile/sand-data/gateway.json"))
    PORT, TOKEN = gw["port"], gw["token"]
    st = json.load(open(sys.argv[1]))
    PID, OKA, FAILB = st["pid"], st["OKA"], st["FAILB"]
    OUT = f"{REPO}/belmont-browse/tools/eval-verify/evidence/r11/ev-l10-subagent-isolation.json"
    import urllib.request
    def api(method, args):
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/{method}", data=json.dumps(args).encode(), method="POST",
            headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"})
        with urllib.request.urlopen(req, timeout=10) as r: return json.loads(r.read().decode())
    subs_raw = api("getSubagents", {"id": PID})
    subs = subs_raw if isinstance(subs_raw, list) else subs_raw.get("subagents", [])
    subs = [{"id": s.get("subagentId") or s.get("id"), "status": s.get("status"), "title": s.get("title")} for s in subs]
    ol = api("getConversationOutline", {"id": PID})
    items = ol if isinstance(ol, list) else ol.get("items", ol)
    checks, verdict, extras = compute_verdict(items, OKA, FAILB)
    TERMINAL = {"done", "error", "aborted", "completed"}
    distinct_terminal = len({s["id"] for s in subs}) >= 2 and all(s["status"] in TERMINAL for s in subs)
    verdict["twoDistinctWorkers"] = verdict["twoDistinctWorkers"] and distinct_terminal
    selftest_rc = run_selftest()
    R = {
        "case": "l10-subagent-isolation", "at": datetime.datetime.now().isoformat(),
        "plan_ref": "L10.P1 T8/H2 — parent delegates different tasks to two workers, collects results, one fails; pass = per-worker output matches recipient, no cross-worker mixing, parent does NOT report a failed worker as success",
        "parentId": PID, "nonces": {"workerA_success": OKA, "workerB_failure": FAILB}, "subagents": subs,
        "architecture_note": "Subagents are ephemeral runtime sessions; SubagentRunResult = {text, aborted}; completed/error is assigned at settle (normal->completed, throw->error; subagent-runtime.ts:33-36,262-273). There is NO structural guarantee against the PARENT misreporting a result, so the parent's final report is verified directly.",
        "verifier_regression": "compute_verdict ships GPT's counterexample as --selftest: a parent final report of 'Worker B succeeded / both completed successfully' (while B errored) MUST FAIL; a faithful 'Worker B failed' report MUST PASS.",
        "selftest_ok": selftest_rc == 0,
        "checks": checks, "verdict": verdict, **extras,
    }
    R["result"] = "PASS" if (all(verdict.values()) and R["selftest_ok"]) else "FAIL"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(R, open(OUT, "w"), indent=2, ensure_ascii=False)
    print("EVIDENCE ->", OUT)
    print("RESULT:", R["result"], json.dumps(verdict))
    print("checks:", json.dumps(checks))
    sys.exit(0 if R["result"] == "PASS" else 1)

main()
