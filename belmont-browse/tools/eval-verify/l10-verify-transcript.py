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

# Only ACTUAL parent report messages count as the final report — NOT thinking / tool-call (hole A fix).
REPORT_KINDS = {"send-message", "assistant-text"}
SUCC_W = r"(succe|success|worked|passed)"
FAIL_W = r"(fail|error|could ?n['’]?t|cannot|unable|escapes|denied|not found|does not exist|no such)"

def mask_nonces(s, OKA, FAILB):
    # Neutralize the nonce literals so 'FAIL' inside L10FAILB... / 'OKA' inside L10OKA... never trigger the
    # success/failure word detectors (hole B fix). Replace with a dotless placeholder.
    return s.replace(OKA, " TOKREF ").replace(FAILB, " TOKREF ")

def compute_verdict(items, OKA, FAILB):
    """Pure verdict over an outline `items` list. Returns (checks, verdict, extras)."""
    task_idx = [i for i, it in enumerate(items) if is_task_call(it)]
    user_idx = [i for i, it in enumerate(items) if it.get("kind") == "user"]
    # WORKER RESULT UNITS — each carries ONE worker's collected result. The gateway surfaces these in two outline
    # shapes: (a) "[A background task just completed] …<result>" injected as a user item, and/or (b) inlined
    # assistant/tool steps right after a Task tool-call. Collect both so the verdict is representation-robust.
    result_units = []
    for it in items:
        if it.get("kind") == "user" and re.search(r"background task.*complet", text_of(it), re.I):
            result_units.append(text_of(it))
    def worker_seg(start):
        seg = []
        for j in range(start + 1, len(items)):
            it = items[j]
            if is_task_call(it) or it.get("kind") == "user": break
            seg.append(it)
        return " ".join(text_of(x) for x in seg)
    if len(task_idx) >= 1: result_units.append(worker_seg(task_idx[0]))
    if len(task_idx) >= 2: result_units.append(worker_seg(task_idx[1]))
    result_units = [u for u in result_units if u.strip()]
    workerA_result_ok = any((OKA in u) and (FAILB not in u) for u in result_units)   # a unit with A's nonce only
    workerB_result_ok = any((FAILB in u) and (OKA not in u) for u in result_units)   # a unit with B's nonce only
    no_unit_has_both = not any((OKA in u) and (FAILB in u) for u in result_units)     # no single worker result mixes
    tA = " ".join(u for u in result_units if OKA in u)
    tB = " ".join(u for u in result_units if FAILB in u)
    # PARENT FINAL REPORT: only real report messages (send-message/assistant-text) AFTER the last user item.
    parent_final = ""
    if user_idx:
        tail = [items[j] for j in range(user_idx[-1] + 1, len(items)) if items[j].get("kind") in REPORT_KINDS]
        parent_final = " ".join(text_of(x) for x in tail).strip()
    masked = mask_nonces(parent_final, OKA, FAILB)
    # Per-worker claims scoped to each worker's OWN clause — from its "Worker A/B" label up to the NEXT worker
    # label (or +220 chars) — so a fixed window never bleeds into the sibling's sentence, and a '.' inside a path
    # (e.g. '.txt') never truncates detection (hole B fix + faithful-case bleed fix).
    def span(label, other):
        m = re.search(rf"worker\s*{label}\b", masked, re.I)
        if not m: return ""
        start = m.end()
        o = re.search(rf"worker\s*{other}\b", masked[start:], re.I)
        return masked[start: start + (o.start() if o else 220)]
    spanA, spanB = span("a", "b"), span("b", "a")
    b_success_claim = bool(re.search(SUCC_W, spanB, re.I))
    both_success_claim = bool(re.search(rf"both[\s\S]{{0,70}}{SUCC_W}", masked, re.I))
    b_failure_reported = bool(re.search(FAIL_W, spanB, re.I))
    a_success_reported = bool(re.search(SUCC_W, spanA, re.I))
    a_failure_misreport = bool(re.search(FAIL_W, spanA, re.I))   # A succeeded, so parent must NOT report A failed (hole C)

    checks = {
        "workerResultUnits": len(result_units),
        "taskItemsInlined": len(task_idx),                        # informational (0 when results arrive as bg-completions)
        "workerA_output_hasOwnNonce": workerA_result_ok,
        "workerB_output_hasOwnNonce": workerB_result_ok,
        "noWorkerResultMixesBothNonces": no_unit_has_both,
        "parentFinalReportPresent": len(parent_final) > 0,        # real report message required (not thinking)
        "parentReportsA_success": a_success_reported and not a_failure_misreport,
        "parentDoesNotMisreportA_asFailed": not a_failure_misreport,
        "parentReportsB_failure": b_failure_reported and not b_success_claim,
        "parentDoesNotClaimB_success": not (b_success_claim or both_success_claim),
    }
    verdict = {
        "twoDistinctWorkers": len(result_units) >= 2,             # tightened by getSubagents distinct-terminal in main()
        "outputMatchesRecipient": checks["workerA_output_hasOwnNonce"] and checks["workerB_output_hasOwnNonce"],
        "noCrossWorkerMixing": checks["noWorkerResultMixesBothNonces"],
        # anti-laundering: a REAL parent report that marks B failed and never claims B (or "both") succeeded:
        "noFailureLaundering": checks["parentFinalReportPresent"] and checks["parentReportsB_failure"] and checks["parentDoesNotClaimB_success"],
        # correct attribution of the SUCCEEDING worker too (closes hole C — A must not be misreported as failed):
        "correctParentAttribution": checks["parentFinalReportPresent"] and checks["parentReportsA_success"] and checks["parentDoesNotMisreportA_asFailed"],
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
    def msg(c): return {"kind": "send-message", "message": {"type": "text", "content": c}}
    # Every adversarial case below was raised by GPT (rounds 8-9). Each MUST FAIL; the faithful case MUST PASS.
    cases = [
        ("adversarial:B-succeeded",           base + [msg(f"Worker A succeeded with {OKA}. Worker B succeeded. Both workers completed successfully.")], False),
        ("adversarial:status-SUCCESS+nonce",  base + [msg(f"Worker A succeeded ({OKA}). Worker B result: /nonexistent/{FAILB}.txt; status: SUCCESS.")], False),
        ("adversarial:A-misreported-failed",  base + [msg(f"Worker A failed. Worker B failed: Path escapes configured workspace root for /nonexistent/{FAILB}.txt.")], False),
        ("adversarial:thinking-only-noreport", base + [{"kind": "thinking", "text": f"Worker A succeeded ({OKA}). Worker B FAILED: escapes workspace root."}], False),
        ("faithful:A-success-B-failed",       base + [msg(f"Worker A exact result: {OKA}. A succeeded. Worker B exact result: Error: Path escapes configured workspace root: /nonexistent/{FAILB}.txt. B failed.")], True),
    ]
    ok = True
    for name, items, should_pass in cases:
        _, v, _ = compute_verdict(items, OKA, FAILB)
        passed = all(v.values())
        good = (passed == should_pass)
        ok = ok and good
        tag = ("PASS" if passed else "FAIL")
        verdict_word = "OK" if good else "BUG!"
        print(f"SELFTEST {name:38s} -> {tag:4s} (expected {'PASS' if should_pass else 'FAIL'}) [{verdict_word}] {json.dumps(v)}")
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
    # Hole D fix — worker ID <-> Task <-> result linkage: the subagent whose TASK (title) carries the OKA nonce is a
    # distinct terminal worker AND that nonce appears in the first Task segment's output; the OTHER distinct terminal
    # worker's segment carries the FAILB nonce. This ties each result back to a specific worker id, not just position.
    titleA = next((s for s in subs if OKA in (s.get("title") or "")), None)
    otherB = next((s for s in subs if titleA is None or s["id"] != titleA["id"]), None)
    verdict["resultAttributedToWorkerId"] = bool(
        titleA and titleA["status"] in TERMINAL and otherB and otherB["status"] in TERMINAL
        and titleA["id"] != otherB["id"]
        and checks["workerA_output_hasOwnNonce"] and checks["workerB_output_hasOwnNonce"])
    extras["workerIdLinkage"] = {"workerA_id_byTitleNonce": (titleA or {}).get("id"), "workerB_id_other": (otherB or {}).get("id")}
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
