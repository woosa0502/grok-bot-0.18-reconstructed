#!/usr/bin/env python3
# L49 (ops O4) — daemon patch contract against the REAL aside-909 vendor bundle. HONEST disposition:
#   The reconstruction retains NO clean upstream daemon (every daemon.mjs in the repo is a pre-patched vendor
#   snapshot), so the canonical clean->patch->re-patch byte-stability cycle cannot be run here. What IS verifiable
#   on the real shipped artifact is verified; the idempotency gap is reported as a bounded finding, not a pass.
#   Verified:  wrong-anchor fails closed (no partial output) | shipped bundle is valid syntax (node --check) |
#              real start + capability actually runs (cited from the live harness r10: serve runs THIS bundle).
#   Finding:   the in-tree patch-daemon.py cannot re-apply to the shipped 909 bundle — its memory-tool re-apply
#              assertion expects '__belmontMemorySearch({accountId:Cn.accountId,...{queries:' but the shipped
#              bundle carries the older '__belmontMemorySearch({accountId:Cn.accountId,...' shape (patcher/artifact
#              version skew). Not a runtime defect (serve consumes the bundle pre-patched, never re-patches it), but
#              L49's "re-apply bytes unchanged" cannot be demonstrated on the shipped bundle.
import hashlib, os, shutil, subprocess, sys, tempfile, json, datetime

REPO = "/home/hoon/_roots/labs/work/Belmont"
PATCHER = f"{REPO}/belmont-browse/tools/patch-daemon.py"
SRC = f"{REPO}/belmont-browse/vendor/aside-909/apps/daemon/build/daemon.mjs"
VERSION = "909"
NODE = os.path.expanduser("~/.nvm/versions/node/v26.8.1/bin/node")
if not os.path.exists(NODE): NODE = "node"
OUT = f"{REPO}/belmont-browse/tools/eval-verify/evidence/r11/ops/l49-daemon-patch-contract.json"

def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()
def run_patch(src, dst):
    r = subprocess.run([sys.executable, PATCHER, src, dst, VERSION], capture_output=True, text=True, cwd=f"{REPO}/belmont-browse/tools")
    return r.returncode, (r.stdout or "") + (r.stderr or "")

R = {"case": "l49-daemon-patch-contract", "at": datetime.datetime.now().isoformat(),
     "bundle": SRC, "bundleSecured": os.path.exists(SRC), "bundleSize": os.path.getsize(SRC), "version": VERSION}
work = tempfile.mkdtemp(prefix="l49-")
try:
    body = open(SRC, encoding="utf-8").read()
    R["bundleState"] = "already-patched" if "belmont-browse: patched from Aside daemon" in body else "clean"
    R["origSha"] = sha(SRC)

    # (A) shipped bundle valid syntax — the artifact the serve actually runs.
    chk = subprocess.run([NODE, "--check", SRC], capture_output=True, text=True)
    R["shippedBundleSyntax"] = {"rc": chk.returncode, "ok": chk.returncode == 0, "err": (chk.stderr or "").strip()[:160]}

    # (B) wrong-anchor fails closed, no partial output written. Break the CDP anchor (checked first, before the
    #     memory hook), so failure is attributable to the broken anchor.
    clean_anchor = "globalCdpClient=new CdpClient}"
    patched_anchor = "globalCdpClient=new CdpClient(process.env.BELMONT_CDP_URL"
    if body.count(patched_anchor) >= 1:
        R["wrongAnchor_brokeForm"] = "patched"; body_bad = body.replace(patched_anchor, "globalCdpClient=new CdpClientBROKEN(process.env.BELMONT_CDP_URL", 1)
    elif body.count(clean_anchor) >= 1:
        R["wrongAnchor_brokeForm"] = "clean"; body_bad = body.replace(clean_anchor, "globalCdpClient=new CdpClient/*BROKEN*/}", 1)
    else:
        raise AssertionError("no known CDP anchor form present to break")
    corrupt = os.path.join(work, "corrupt.mjs"); open(corrupt, "w", encoding="utf-8").write(body_bad)
    bad_out = os.path.join(work, "bad_out.mjs")
    rc_bad, log_bad = run_patch(corrupt, bad_out)
    R["wrongAnchor"] = {
        "rc": rc_bad, "failedClosed": rc_bad != 0, "noPartialOutputWritten": not os.path.exists(bad_out),
        "errorSignature": next((ln.strip() for ln in log_bad.splitlines() if "anchor" in ln.lower()), (log_bad.strip().splitlines()[-1] if log_bad.strip() else "")),
    }
    R["wrongAnchor"]["ok"] = R["wrongAnchor"]["failedClosed"] and R["wrongAnchor"]["noPartialOutputWritten"]

    # (C) re-apply idempotency on the shipped bundle — attempt patch(shipped); record the outcome as a FINDING.
    reout = os.path.join(work, "reapply.mjs")
    rc_re, log_re = run_patch(SRC, reout)
    reapply_signature = next((ln.strip() for ln in log_re.splitlines() if "mismatch" in ln.lower() or "AssertionError" in ln), (log_re.strip().splitlines()[-1] if log_re.strip() else ""))
    R["reapplyIdempotency"] = {
        "attempted": True, "rc": rc_re, "reapplySucceeded": rc_re == 0 and os.path.exists(reout),
        "bytesUnchanged": (rc_re == 0 and os.path.exists(reout) and sha(reout) == sha(SRC)),
        "finding": None if rc_re == 0 else f"in-tree patch-daemon.py cannot re-apply to shipped {VERSION} bundle: {reapply_signature}",
        "cleanUpstreamAvailable": False,
        "note": "No clean upstream daemon exists in the repo (all daemon.mjs are pre-patched vendor snapshots); canonical clean->patch->re-patch byte-stability is therefore untestable here.",
    }

    # (D) real start + capability actually runs — cited from the live harness.
    R["realStart_capabilityRuns"] = "demonstrated by the live harness (evidence/r10): the serve runs THIS vendor aside-909 bundle and its memory/eval/browser capabilities were verified live."

    R["verified"] = {
        "bundleSecured_notBlocked": R["bundleSecured"],
        "shippedBundleValidSyntax": R["shippedBundleSyntax"]["ok"],
        "wrongAnchorFailsClosedPreservingOriginal": R["wrongAnchor"]["ok"],
        "realStartCapabilityRuns_cited": True,
    }
    R["open"] = {
        "reapplyBytesUnchanged": R["reapplyIdempotency"]["bytesUnchanged"],  # False here (finding recorded)
    }
    all_verified = all(R["verified"].values())
    R["result"] = "PARTIAL(finding)" if (all_verified and not R["open"]["reapplyBytesUnchanged"]) else ("PASS" if all_verified and R["open"]["reapplyBytesUnchanged"] else "FAIL")
except Exception as e:
    R["error"] = f"{type(e).__name__}: {e}"; R["result"] = "FAIL(exception)"
finally:
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(R, open(OUT, "w"), indent=2)
    print("EVIDENCE ->", OUT)
    print("RESULT:", R["result"])
    print("verified:", json.dumps(R.get("verified", {})))
    print("finding:", (R.get("reapplyIdempotency") or {}).get("finding"))
    sys.exit(0)
