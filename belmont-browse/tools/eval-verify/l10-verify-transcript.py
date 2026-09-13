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

def norm_title(t):
    return re.sub(r'[…\.\s]+$', '', (t or '')).strip().lower()

def titles_consistent(reg_title, unit_title):
    # A registered subagent title (often truncated with "…") must be consistent with the completion's task-title.
    # Empty unit_title => inlined shape with no title to cross-check => not treated as a mismatch (order-attributed).
    r, u = norm_title(reg_title), norm_title(unit_title)
    if not u: return True
    if not r: return False
    return u.startswith(r) or r.startswith(u) or (len(r) >= 15 and r[:15] in u) or (len(u) >= 15 and u[:15] in r)

def compute_verdict(items, OKA, FAILB, subs=None):
    """Pure verdict over an outline `items` list (+ optional getSubagents `subs` for id/task attribution).
    Returns (checks, verdict, extras)."""
    task_idx = [i for i, it in enumerate(items) if is_task_call(it)]
    user_idx = [i for i, it in enumerate(items) if it.get("kind") == "user"]
    # WORKER RESULT UNITS — each carries ONE worker's collected result, kept in document order (= dispatch order
    # A,B). Two outline shapes: (a) "[A background task just completed] Background task \"<TITLE>\" … finished:
    # <BODY>" as a user item, and/or (b) inlined assistant steps right after a Task tool-call. For (a) the TITLE
    # echoes the dispatched task text (so it contains the input nonce) — attribution/nonce checks must use the
    # BODY, never the title (GPT hole-D fix). For (b) there is no title; attribution is by Task ORDER.
    def parse_unit(u):
        m = re.search(r'background task\s+"(?P<title>.*?)"(?P<mid>.*?)finished:\s*(?P<body>.*)$', u, re.S | re.I)
        if m: return m.group("title"), m.group("body")
        return "", u  # inlined segment: no title, whole text is the produced body
    units = []
    for it in items:
        if it.get("kind") == "user" and re.search(r"background task.*complet", text_of(it), re.I):
            units.append(parse_unit(text_of(it)))
    def worker_seg(start):
        seg = []
        for j in range(start + 1, len(items)):
            it = items[j]
            if is_task_call(it) or it.get("kind") == "user": break
            seg.append(it)
        return " ".join(text_of(x) for x in seg)
    if len(task_idx) >= 1: units.append(("", worker_seg(task_idx[0])))
    if len(task_idx) >= 2: units.append(("", worker_seg(task_idx[1])))
    units = [(t, b) for (t, b) in units if (t.strip() or b.strip())]
    # Attribute A's unit and B's unit BY INDEX. Prefer TITLE-identity (background shape); fall back to ORDER
    # (inlined shape has empty titles). Index-based so a result SWAP between workers is caught.
    aIdx = next((i for i, (t, b) in enumerate(units) if OKA in t), None)
    if aIdx is None and units: aIdx = 0
    bIdx = next((i for i, (t, b) in enumerate(units)
                 if i != aIdx and t and OKA not in t and re.search(r"attempt to read|/nonexistent/|" + re.escape(FAILB[:8]), t, re.I)), None)
    if bIdx is None:
        bIdx = next((i for i in range(len(units)) if i != aIdx), None)
    bodyA = units[aIdx][1] if aIdx is not None else ""
    bodyB = units[bIdx][1] if bIdx is not None else ""
    titleA_unit = units[aIdx][0] if aIdx is not None else ""
    titleB_unit = units[bIdx][0] if bIdx is not None else ""
    # nonce checks apply to the produced BODY only (title-echo does not count), to each worker's OWN unit:
    workerA_result_ok = (OKA in bodyA) and (FAILB not in bodyA)
    workerB_result_ok = (FAILB in bodyB) and (OKA not in bodyB)
    no_unit_has_both = (aIdx is not None and bIdx is not None and aIdx != bIdx
                        and not (OKA in bodyA and FAILB in bodyA) and not (OKA in bodyB and FAILB in bodyB))
    result_units = [b for (_, b) in units]
    tA, tB = bodyA, bodyB
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
        "twoDistinctWorkers": len(result_units) >= 2,             # tightened by getSubagents distinct-terminal below
        "outputMatchesRecipient": checks["workerA_output_hasOwnNonce"] and checks["workerB_output_hasOwnNonce"],
        "noCrossWorkerMixing": checks["noWorkerResultMixesBothNonces"],
        # anti-laundering: a REAL parent report that marks B failed and never claims B (or "both") succeeded:
        "noFailureLaundering": checks["parentFinalReportPresent"] and checks["parentReportsB_failure"] and checks["parentDoesNotClaimB_success"],
        # correct attribution of the SUCCEEDING worker too (closes hole C — A must not be misreported as failed):
        "correctParentAttribution": checks["parentFinalReportPresent"] and checks["parentReportsA_success"] and checks["parentDoesNotMisreportA_asFailed"],
    }
    # Hole-D (round-10/11): tie each RESULT to the REGISTERED worker that was ASSIGNED that task. When `subs`
    # (getSubagents) is provided: two distinct terminal workers; regA is the one whose title carries OKA; regB is
    # the other; and — crucially — regB's REGISTERED task title must be CONSISTENT with the B result unit's
    # task-title. A B worker registered with a DIFFERENT task than the one that produced the result (GPT's third
    # counterexample) is a mismatch and FAILS, even though the result body still carries FAILB.
    TERM = {"done", "error", "aborted", "completed"}
    if subs is not None:
        regA = next((s for s in subs if OKA in (s.get("title") or "")), None)
        regB = next((s for s in subs if regA is None or s.get("id") != regA.get("id")), None)
        two_reg_terminal = bool(regA and regB and regA.get("id") != regB.get("id")
                                and regA.get("status") in TERM and regB.get("status") in TERM)
        a_task_consistent = titles_consistent(regA.get("title") if regA else "", titleA_unit)
        b_task_consistent = titles_consistent(regB.get("title") if regB else "", titleB_unit)
        checks["registeredB_taskMatchesResult"] = b_task_consistent
        verdict["twoDistinctWorkers"] = verdict["twoDistinctWorkers"] and two_reg_terminal
        verdict["resultAttributedToWorkerId"] = bool(
            two_reg_terminal and checks["workerA_output_hasOwnNonce"] and checks["workerB_output_hasOwnNonce"]
            and a_task_consistent and b_task_consistent)
    extras = {"parentFinalReport": parent_final[:600], "segA_excerpt": tA[:400], "segB_excerpt": tB[:400],
              "titleA_unit": titleA_unit[:120], "titleB_unit": titleB_unit[:120]}
    return checks, verdict, extras

def run_selftest():
    OKA, FAILB = "L10OKAdead", "L10FAILBbeef"
    def task(): return {"kind": "tool-call", "name": "Task", "status": "done"}
    def user(t): return {"kind": "user", "text": t}
    def msg(c): return {"kind": "send-message", "message": {"type": "text", "content": c}}
    def bgc(title, body): return user(f'[A background task just completed] Background task "{title}" (executor) finished:\n{body}')
    ERR = f"Error: Path escapes configured workspace root: /nonexistent/{FAILB}.txt"
    faithful = msg(f"Worker A exact result: {OKA}. A succeeded. Worker B exact result: {ERR}. B failed.")
    # Inlined-shape base (worker steps inlined after each Task) — used for the parent-report (laundering) cases.
    base = [user(f"launch A: {OKA}"), task(), {"kind": "assistant-text", "text": OKA},
            user(f"launch B: {FAILB}"), task(), {"kind": "assistant-text", "text": ERR},
            user("Report both results now.")]
    # Background-completion shape (this run's shape): task TITLE echoes the nonce, BODY is the produced result.
    bg_ok = [user(f"launch A: {OKA}"), bgc(f"Reply with exactly this token: {OKA}", OKA),
             user(f"launch B: {FAILB}"), bgc(f"Attempt to read /nonexistent/{FAILB}.txt", ERR),
             user("Report both results now.")]
    # getSubagents `subs`: A's registered title carries OKA; B's registered title is its assigned task.
    def subs2(bt): return [{"id": "sa", "status": "done", "title": f"Reply with exactly this token and nothing else: {OKA}"},
                           {"id": "sb", "status": "done", "title": bt}]
    subs_ok = subs2(f"Attempt to read the file /nonexistent/{FAILB}.txt using your file tools …")
    subs_mismatch = subs2("Compute 2 + 2 and return 4.")   # registered B did a DIFFERENT task than the result
    cases = [
        # rounds 8-9 (parent-report laundering) — holes A/B/C:
        ("adv:B-succeeded",            base + [msg(f"Worker A succeeded with {OKA}. Worker B succeeded. Both workers completed successfully.")], subs_ok, False),
        ("adv:status-SUCCESS+nonce",   base + [msg(f"Worker A succeeded ({OKA}). Worker B result: /nonexistent/{FAILB}.txt; status: SUCCESS.")], subs_ok, False),
        ("adv:A-misreported-failed",   base + [msg(f"Worker A failed. Worker B failed: escapes workspace root /nonexistent/{FAILB}.txt.")], subs_ok, False),
        ("adv:thinking-only-noreport", base + [{"kind": "thinking", "text": f"Worker A succeeded ({OKA}). Worker B FAILED."}], subs_ok, False),
        ("faithful:inlined",           base + [faithful], subs_ok, True),
        # round-10/11 (result attribution) — hole D, exercised through the FULL path (with subs):
        ("advD:inlined-result-swap",   [user(f"launch A: {OKA}"), task(), {"kind": "assistant-text", "text": ERR},
                                        user(f"launch B: {FAILB}"), task(), {"kind": "assistant-text", "text": OKA},
                                        user("Report both results now."), faithful], subs_ok, False),
        ("advD:bg-title-only-noresult", [user(f"launch A: {OKA}"), bgc(f"Reply with exactly this token: {OKA}", "(the task finished without producing any text output)"),
                                        user(f"launch B: {FAILB}"), bgc(f"Attempt to read /nonexistent/{FAILB}.txt", "(the task finished without producing any text output)"),
                                        user("Report both results now."), faithful], subs_ok, False),
        ("advD:different-B-body",      [user(f"launch A: {OKA}"), bgc(f"Reply token: {OKA}", OKA),
                                        user("launch B: compute"), bgc("Compute 2+2 and reply", "4"),
                                        user("Report both results now."), faithful], subs_ok, False),
        # GPT round-11's EXACT counterexample: completion messages intact (B result body has FAILB), but the
        # REGISTERED B (getSubagents) was assigned a DIFFERENT task -> attribution mismatch MUST FAIL:
        ("advD:registered-B-taskmismatch", bg_ok + [faithful], subs_mismatch, False),
        ("faithful:background",        bg_ok + [faithful], subs_ok, True),
    ]
    ok = True
    for name, items, subs, should_pass in cases:
        _, v, _ = compute_verdict(items, OKA, FAILB, subs=subs)
        passed = all(v.values())
        good = (passed == should_pass)
        ok = ok and good
        print(f"SELFTEST {name:32s} -> {('PASS' if passed else 'FAIL'):4s} (expect {'PASS' if should_pass else 'FAIL'}) [{'OK' if good else 'BUG!'}] {json.dumps(v)}")
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
    # Full verdict path: pass the getSubagents `subs` so result<->registered-worker task attribution is checked.
    checks, verdict, extras = compute_verdict(items, OKA, FAILB, subs=subs)
    selftest_rc = run_selftest()
    R = {
        "case": "l10-subagent-isolation", "at": datetime.datetime.now().isoformat(),
        "plan_ref": "L10.P1 T8/H2 — parent delegates different tasks to two workers, collects results, one fails; pass = per-worker output matches recipient, no cross-worker mixing, parent does NOT report a failed worker as success",
        "parentId": PID, "nonces": {"workerA_success": OKA, "workerB_failure": FAILB}, "subagents": subs,
        "architecture_note": "Subagents are ephemeral runtime sessions; SubagentRunResult = {text, aborted}; completed/error is assigned at settle (normal->completed, throw->error; subagent-runtime.ts:33-36,262-273). There is NO structural guarantee against the PARENT misreporting a result, so the parent's final report is verified directly.",
        "verifier_regression": "compute_verdict ships all of GPT's counterexamples (rounds 8-11) as --selftest regressions run through the FULL subs path (10 cases): laundering holes A/B/C (thinking-only report, 'status: SUCCESS'+nonce-'FAIL', A-misreported-as-failed, B-succeeded) and attribution hole D (inlined result SWAP, background title-only/empty body, different-B-body, and GPT round-11's registered-B-task-mismatch where the completion is intact but getSubagents shows B assigned a DIFFERENT task) all MUST FAIL; faithful inlined + faithful background MUST PASS. Nonce checks read the produced BODY (not the task-title echo); each result is attributed by title-identity or Task order AND the B result's task-title must be consistent with the REGISTERED worker's task.",
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
