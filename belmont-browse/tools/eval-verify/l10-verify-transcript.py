#!/usr/bin/env python3
# L10 verify from the DURABLE parent transcript (subagents are ephemeral runtime sessions whose results are
# collected into the parent's transcript). Segments the parent outline by its two Task tool-calls and checks:
#   - two distinct workers dispatched + terminal (getSubagents)
#   - output matches task/recipient: worker A segment => OKA (success token); worker B segment => its FAILB error
#   - no mixing: OKA only in A's segment, FAILB only in B's
#   - no laundering: worker B's segment is a FAILURE (error marker), never the success token
import json, sys, urllib.request, re, os

REPO = "/home/hoon/_roots/labs/work/Belmont"
gw = json.load(open(f"{REPO}/.cache/belmont-wsl-profile/sand-data/gateway.json"))
PORT, TOKEN = gw["port"], gw["token"]
st = json.load(open(sys.argv[1]))
PID, OKA, FAILB = st["pid"], st["OKA"], st["FAILB"]
OUT = f"{REPO}/belmont-browse/tools/eval-verify/evidence/r11/ev-l10-subagent-isolation.json"

def api(method, args):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/{method}",
        data=json.dumps(args).encode(), method="POST",
        headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())

subs_raw = api("getSubagents", {"id": PID})
subs = subs_raw if isinstance(subs_raw, list) else subs_raw.get("subagents", [])
subs = [{"id": s.get("subagentId") or s.get("id"), "status": s.get("status"), "title": s.get("title")} for s in subs]
TERMINAL = {"done", "error", "aborted", "completed"}

ol = api("getConversationOutline", {"id": PID})
items = ol if isinstance(ol, list) else ol.get("items", ol)
def itext(it): return json.dumps(it, ensure_ascii=False)
def kind(it): return it.get("kind")

# locate the two Task tool-calls
task_idx = [i for i, it in enumerate(items)
            if kind(it) == "tool-call" and re.search(r'"(name|toolName)"\s*:\s*"Task"', itext(it))]
segA = segB = []
if len(task_idx) >= 2:
    segA = items[task_idx[0]+1: task_idx[1]]
    segB = items[task_idx[1]+1:]
elif len(task_idx) == 1:
    segA = items[task_idx[0]+1:]
# A worker's OWN output is the non-user items projected after its Task call. Exclude "user" items — those are the
# harness's dispatch prompts (which by construction quote the nonces), not any worker's produced output. Isolation
# is a claim about what each WORKER produced, so it must be judged on worker output, not on the prompts we injected.
def worker_output(seg): return " ".join(itext(x) for x in seg if kind(x) != "user")
tA, tB = worker_output(segA), worker_output(segB)

err_re = re.compile(r"error|escapes|not found|enoent|no such|cannot|failed|does not exist", re.I)

# final parent synthesis message (last assistant/send-message text), to confirm no success-laundering claim
final_msg = ""
for it in reversed(items):
    if kind(it) in ("send-message", "assistant-text"):
        t = it.get("text") or ""
        if t.strip():
            final_msg = t[:400]; break

R = {
  "case": "l10-subagent-isolation",
  "at": __import__("datetime").datetime.now().isoformat(),
  "plan_ref": "belmont-gptpro-feature-test-plan L10·P1 T8/H2 — parent delegates DIFFERENT tasks to two workers, collects results, one worker fails; pass = per-worker output matches recipient, no failure-as-success laundering, no cross-worker mixing",
  "gateway": {"port": PORT}, "parentId": PID,
  "nonces": {"workerA_success": OKA, "workerB_failure": FAILB},
  "subagents": subs,
  "architecture_note": "Subagents are ephemeral runtime sessions (distinct subagentId + SubagentSession + lineage); no per-subagent on-disk store — results are COLLECTED into the parent's durable transcript. getAgentTranscript(subId)=does-not-exist confirms they are not top-level agents. Verification is therefore done on the parent's durable transcript segmented by its two Task tool-calls.",
  "dispatch": {"createStatus": st.get("createStatus"), "sendStatus": st.get("sendStatus"), "mode": "sequential (peak = 1 worker turn; ordering does not affect isolation)"},
  "taskToolCallCount": len(task_idx),
  "segments": {"workerA_len": len(segA), "workerB_len": len(segB)},
  "workerB_readGuard": "Path escapes configured workspace root" if "escapes configured workspace root" in tB else None,
  "finalParentMessage": final_msg,
}

distinct_terminal = len({s["id"] for s in subs}) >= 2 and all(s["status"] in TERMINAL for s in subs)
R["checks"] = {
  "twoDistinctTerminalWorkers": distinct_terminal,
  "twoTaskToolCalls": len(task_idx) == 2,
  "workerA_output_hasOwnNonce": OKA in tA,
  "workerA_output_noSiblingNonce": FAILB not in tA,
  "workerB_output_hasOwnNonce": FAILB in tB,
  "workerB_output_noSiblingNonce": OKA not in tB,
  "workerB_isFailure_notLaundered": bool(err_re.search(tB)) and (OKA not in tB),
  "workerA_isSuccess": OKA in tA,
}
R["verdict"] = {
  "twoDistinctWorkers": R["checks"]["twoDistinctTerminalWorkers"] and R["checks"]["twoTaskToolCalls"],
  "outputMatchesRecipient": R["checks"]["workerA_isSuccess"] and R["checks"]["workerB_output_hasOwnNonce"],
  "noCrossWorkerMixing": R["checks"]["workerA_output_noSiblingNonce"] and R["checks"]["workerB_output_noSiblingNonce"],
  "noFailureLaundering": R["checks"]["workerB_isFailure_notLaundered"],
}
R["structuralGuarantee"] = "SubagentRunResult = completed{text}|aborted|error{error}; BackgroundSubagentCompletion.status ∈ {completed,error} keyed by subagentAgentId (source/host/runner/subagent-runtime.ts) — a failure is structurally distinct from success and un-launderable"
R["result"] = "PASS" if all(R["verdict"].values()) else "FAIL"
# keep short raw excerpts for auditability
R["rawSegmentA_excerpt"] = tA[:600]
R["rawSegmentB_excerpt"] = tB[:600]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(R, open(OUT, "w"), indent=2, ensure_ascii=False)
print("EVIDENCE ->", OUT)
print("RESULT:", R["result"], json.dumps(R["verdict"]))
print("checks:", json.dumps(R["checks"]))
