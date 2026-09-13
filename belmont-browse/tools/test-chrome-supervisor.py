#!/usr/bin/env python3
"""Self-contained test for chrome-supervisor.py (DEF-L19-CHROME-ORPHAN-001 kernel closure).
Simulates a hard serve crash (SIGKILL, no handler) that orphans a detached "chrome"; asserts the
supervisor reaps that exact instance via a pidfd. Also asserts pidfd instance-binding safety: a
dead instance's pidfd raises ProcessLookupError, so a reused PID can never be signaled."""
import os, sys, json, time, subprocess, signal, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SUP = os.path.join(ROOT, "belmont-browse/tools/chrome-supervisor.py")

FAKE_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]
chrome = subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
json.dump({"servePid": os.getpid(), "chromePid": chrome.pid, "pgid": chrome.pid, "startTicks": ticks(chrome.pid), "generation": "t"},
          open(os.path.join(profile, ".belmont-chrome-owner.json"), "w"))
open(os.path.join(profile, "serve-ready"), "w").write(str(chrome.pid))
time.sleep(1.5)
os.kill(os.getpid(), signal.SIGKILL)
'''

def alive(pid):
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False
    except PermissionError: return True

def test_reap():
    profile = tempfile.mkdtemp(prefix="sup-")
    fs = os.path.join(profile, "fake-serve.py"); open(fs, "w").write(FAKE_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = os.path.join(profile, "serve-ready"); chrome_pid = None
    for _ in range(100):
        if os.path.exists(ready): chrome_pid = int(open(ready).read().strip()); break
        time.sleep(0.05)
    assert chrome_pid and alive(chrome_pid), "fake chrome should be alive before the crash"
    out, _ = sup.communicate(timeout=30); time.sleep(0.5)
    assert not alive(chrome_pid), "supervisor did not reap the orphaned chrome\n" + out
    assert sup.returncode == 0, f"supervisor exit {sup.returncode}\n{out}"
    print("PASS reap:", out.strip().splitlines()[-1] if out.strip() else "")

FOREIGN_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]
# a CONTROL chrome owned by a DIFFERENT (foreign) serve: the owner record names servePid != our pid.
control = subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
json.dump({"servePid": 999999999, "chromePid": control.pid, "pgid": control.pid, "startTicks": ticks(control.pid), "generation": "foreign"},
          open(os.path.join(profile, ".belmont-chrome-owner.json"), "w"))
open(os.path.join(profile, "serve-ready"), "w").write(str(control.pid))
time.sleep(1.0)
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_ownership_no_miskill():
    """GPT round-8 counterexample: the owner record names a DIFFERENT serve (servePid != ours). The
    supervisor must NOT pin/kill that chrome (it belongs to another serve)."""
    profile = tempfile.mkdtemp(prefix="sup-foreign-")
    fs = os.path.join(profile, "foreign-serve.py"); open(fs, "w").write(FOREIGN_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = os.path.join(profile, "serve-ready"); control_pid = None
    for _ in range(100):
        if os.path.exists(ready): control_pid = int(open(ready).read().strip()); break
        time.sleep(0.05)
    assert control_pid and alive(control_pid)
    out, _ = sup.communicate(timeout=30); time.sleep(0.5)
    assert alive(control_pid), "MIS-KILL: supervisor killed a chrome owned by a different serve\n" + out
    try: os.kill(control_pid, signal.SIGKILL)  # cleanup
    except ProcessLookupError: pass
    print("PASS ownership: a foreign serve's chrome is not pinned or killed")


NULL_SERVEPID_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]
control = subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
# owner record with servePid OMITTED (null) but a valid foreign chromePid+startTicks
json.dump({"chromePid": control.pid, "pgid": control.pid, "startTicks": ticks(control.pid), "generation": "nullsp"},
          open(os.path.join(profile, ".belmont-chrome-owner.json"), "w"))
open(os.path.join(profile, "serve-ready"), "w").write(str(control.pid))
time.sleep(1.0)
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_null_servepid_no_miskill():
    """GPT round-9 counterexample: owner record with a NULL/missing servePid must NOT pass the ownership
    check (it previously did, because serve_pid was overwritten with None -> None != None was false)."""
    profile = tempfile.mkdtemp(prefix="sup-nullsp-")
    fs = os.path.join(profile, "nullsp-serve.py"); open(fs, "w").write(NULL_SERVEPID_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = os.path.join(profile, "serve-ready"); control_pid = None
    for _ in range(100):
        if os.path.exists(ready): control_pid = int(open(ready).read().strip()); break
        time.sleep(0.05)
    assert control_pid and alive(control_pid)
    out, _ = sup.communicate(timeout=30); time.sleep(0.5)
    assert alive(control_pid), "MIS-KILL: supervisor killed a chrome whose owner had a null servePid\n" + out
    try: os.kill(control_pid, signal.SIGKILL)
    except ProcessLookupError: pass
    print("PASS null-servePid: an owner record with no servePid is never pinned/killed")


REPIN_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]; owner = os.path.join(profile, ".belmont-chrome-owner.json")
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
def rec(pid):
    tmp = owner + ".tmp"
    json.dump({"servePid": os.getpid(), "chromePid": pid, "pgid": pid, "startTicks": ticks(pid), "generation": "r"}, open(tmp, "w"))
    os.replace(tmp, owner)  # atomic
def spawn(): return subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
A = spawn(); rec(A.pid); open(os.path.join(profile, "serve-ready"), "w").write(str(A.pid))
time.sleep(2.5)                     # let the supervisor pin A
A.kill(); A.wait()                  # same serve kills A ...
B = spawn(); rec(B.pid)             # ... and restarts as B, updating the owner atomically
open(os.path.join(profile, "serve-ready-b"), "w").write(str(B.pid))
time.sleep(1.0)
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_repin_reaps_current_chrome():
    """GPT round-10 counterexample: the supervisor pins A, then the same serve kills A and restarts as B
    (owner updated to B). On serve exit the supervisor must reap the CURRENT owner (B), not just the stale A."""
    profile = tempfile.mkdtemp(prefix="sup-repin-")
    fs = os.path.join(profile, "repin-serve.py"); open(fs, "w").write(REPIN_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    rb = os.path.join(profile, "serve-ready-b"); b_pid = None
    for _ in range(200):
        if os.path.exists(rb): b_pid = int(open(rb).read().strip()); break
        time.sleep(0.05)
    assert b_pid, "serve never restarted chrome B"
    out, _ = sup.communicate(timeout=40); time.sleep(0.5)
    assert not alive(b_pid), "supervisor left the CURRENT chrome (B) alive after a same-serve restart\n" + out
    print("PASS re-pin: reaps the current owner (B) after a same-serve A->B chrome restart")


DELETE_OWNER_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]; owner = os.path.join(profile, ".belmont-chrome-owner.json")
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
A = subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
json.dump({"servePid": os.getpid(), "chromePid": A.pid, "pgid": A.pid, "startTicks": ticks(A.pid), "generation": "d"}, open(owner, "w"))
open(os.path.join(profile, "serve-ready"), "w").write(str(A.pid))
time.sleep(2.5)                    # let the supervisor pin A
os.remove(owner)                   # owner file deleted between pin and serve exit
time.sleep(0.3)
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_polled_chrome_reaped_after_owner_deleted():
    """GPT round-11 counterexample: the supervisor pins A, then the owner file is DELETED before serve exit.
    The poll-fd must NOT be discarded — A must still be reaped (owner deletion must not orphan a pinned owned chrome)."""
    profile = tempfile.mkdtemp(prefix="sup-delown-")
    fs = os.path.join(profile, "delown-serve.py"); open(fs, "w").write(DELETE_OWNER_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = os.path.join(profile, "serve-ready"); a_pid = None
    for _ in range(200):
        if os.path.exists(ready): a_pid = int(open(ready).read().strip()); break
        time.sleep(0.05)
    assert a_pid, "serve never started chrome A"
    out, _ = sup.communicate(timeout=40); time.sleep(0.5)
    assert not alive(a_pid), "supervisor orphaned the pinned chrome A after the owner file was deleted\n" + out
    print("PASS owner-deleted: a polled+pinned chrome is still reaped when its owner file is deleted")


REPIN_DELETE_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]; owner = os.path.join(profile, ".belmont-chrome-owner.json")
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
def rec(pid):
    tmp = owner + ".tmp"
    json.dump({"servePid": os.getpid(), "chromePid": pid, "pgid": pid, "startTicks": ticks(pid), "generation": "rd"}, open(tmp, "w"))
    os.replace(tmp, owner)
def spawn(): return subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
A = spawn(); rec(A.pid); open(os.path.join(profile, "serve-ready"), "w").write(str(A.pid))
time.sleep(2.5)                    # supervisor tracks A
A.kill(); A.wait()                 # restart A -> B
B = spawn(); rec(B.pid)
open(os.path.join(profile, "serve-ready-b"), "w").write(str(B.pid))
time.sleep(1.0)                    # supervisor tracks B
os.remove(owner)                   # then owner deleted (GPT round-12 exact sequence)
time.sleep(0.3)
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_repin_then_owner_deleted_reaps_current(): 
    """GPT round-12 counterexample: A pinned -> same serve restarts A->B (owner updated) -> owner DELETED ->
    serve SIGKILL. Continuous tracking must have pinned B, so B is reaped despite the deleted owner."""
    profile = tempfile.mkdtemp(prefix="sup-repindel-")
    fs = os.path.join(profile, "repindel-serve.py"); open(fs, "w").write(REPIN_DELETE_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    rb = os.path.join(profile, "serve-ready-b"); b_pid = None
    for _ in range(240):
        if os.path.exists(rb): b_pid = int(open(rb).read().strip()); break
        time.sleep(0.05)
    assert b_pid, "serve never restarted to B"
    out, _ = sup.communicate(timeout=45); time.sleep(0.5)
    assert not alive(b_pid), "supervisor leaked B after an A->B restart followed by owner deletion\n" + out
    print("PASS repin+owner-deleted: B (post-restart) is reaped even though the owner file was deleted")


POLL_GAP_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]; owner = os.path.join(profile, ".belmont-chrome-owner.json"); reg = os.environ.get("BELMONT_CHROME_REG")
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
def register(pid):
    if reg:
        with open(reg, "a") as f: f.write(json.dumps({"pid": pid, "pgid": pid, "startTicks": ticks(pid), "servePid": os.getpid(), "ts": time.time()}) + "\n")
def own(pid):
    tmp = owner + ".tmp"; json.dump({"servePid": os.getpid(), "chromePid": pid, "pgid": pid, "startTicks": ticks(pid), "generation": "pg"}, open(tmp, "w")); os.replace(tmp, owner)
def spawn(): return subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
A = spawn(); register(A.pid); own(A.pid); open(os.path.join(profile, "serve-ready"), "w").write(str(A.pid))
time.sleep(2.5)                    # supervisor pins A
A.kill(); A.wait()
# THE POLL GAP: register+own B, then DELETE the owner immediately, all within one 0.5s poll window, then die.
B = spawn(); register(B.pid); own(B.pid)
os.remove(owner)                   # owner gone before the next poll -> pin_owned_chrome can't find B
open(os.path.join(profile, "serve-ready-b"), "w").write(str(B.pid))
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_poll_gap_registered_chrome_reaped():
    """GPT whole-project counterexample: B is spawned+registered+owner-published then the owner is DELETED
    within one poll window before SIGKILL. Owner-polling alone misses B; the registration tail must catch+reap it."""
    profile = tempfile.mkdtemp(prefix="sup-pollgap-")
    fs = os.path.join(profile, "pollgap-serve.py"); open(fs, "w").write(POLL_GAP_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    rb = os.path.join(profile, "serve-ready-b"); b_pid = None
    for _ in range(240):
        if os.path.exists(rb): b_pid = int(open(rb).read().strip()); break
        time.sleep(0.05)
    assert b_pid, "serve never registered B"
    out, _ = sup.communicate(timeout=45); time.sleep(0.5)
    assert not alive(b_pid), "supervisor missed B (owner deleted in the poll gap); registration tail failed\n" + out
    print("PASS poll-gap: a chrome registered at spawn is reaped even when its owner is deleted within the poll window")

def test_pidfd_reuse_safety():
    p = subprocess.Popen(["sleep", "0.2"]); fd = os.pidfd_open(p.pid); p.wait(); time.sleep(0.2)
    try:
        signal.pidfd_send_signal(fd, signal.SIGKILL); raise AssertionError("signaled a dead instance")
    except ProcessLookupError:
        print("PASS pidfd-reuse-safety: dead-instance pidfd raises ProcessLookupError (reused pid never signaled)")
    finally:
        os.close(fd)


REG_ONLY_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]; reg = os.environ.get("BELMONT_CHROME_REG")
assert reg, "supervisor must set BELMONT_CHROME_REG before exec"
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
# NO owner file is ever written: reaping must rely ENTIRELY on the registration channel (proves the channel is
# live even though the profile dir did not exist until the supervisor created it — C-1).
A = subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
with open(reg, "a") as f:
    f.write(json.dumps({"pid": A.pid, "pgid": A.pid, "startTicks": ticks(A.pid), "servePid": os.getpid(), "ts": time.time()}) + "\n")
open(os.path.join(profile, "serve-ready"), "w").write(str(A.pid))
time.sleep(1.5)
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_profile_missing_created_and_registers():
    """C-1: the profile dir does NOT exist when the supervisor starts. It must create the dir AND stand up the
    registration channel (not silently disable it), so a chrome registered via that channel — with no owner file
    at all — is still reaped."""
    base = tempfile.mkdtemp(prefix="sup-nomkdir-")
    profile = os.path.join(base, "profile-does-not-exist-yet")   # missing on purpose
    fs = os.path.join(base, "reg-only-serve.py"); open(fs, "w").write(REG_ONLY_SERVE)
    assert not os.path.isdir(profile)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = os.path.join(profile, "serve-ready"); a_pid = None
    for _ in range(200):
        if os.path.exists(ready): a_pid = int(open(ready).read().strip()); break
        time.sleep(0.05)
    assert a_pid, "serve never registered A (profile dir was not created / reg channel disabled)"
    out, _ = sup.communicate(timeout=40); time.sleep(0.5)
    assert not alive(a_pid), "registration-only chrome leaked (C-1: reg channel was silently disabled)\n" + out
    print("PASS profile-missing: supervisor creates the profile dir and the registration channel reaps a chrome with no owner file")


SENTINEL_SERVE = r'''
import os, sys, time
open(sys.argv[1], "w").write("serve ran")   # if this appears, serve was exec'd despite fail-closed
time.sleep(2)
'''

def test_reg_channel_unavailable_fails_closed():
    """C-1: if the registration channel cannot be established (here: the profile PATH is an existing regular
    file, so makedirs raises), the supervised start must FAIL-CLOSED (non-zero exit) and NEVER exec serve —
    it must not silently fall back to owner-file polling."""
    base = tempfile.mkdtemp(prefix="sup-failclosed-")
    profile = os.path.join(base, "not-a-dir")
    open(profile, "w").write("i am a regular file, not a directory")  # makedirs(profile) -> FileExistsError
    sentinel = os.path.join(base, "serve-ran")
    fs = os.path.join(base, "sentinel-serve.py"); open(fs, "w").write(SENTINEL_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, sentinel],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out, _ = sup.communicate(timeout=20)
    assert sup.returncode == 3, f"expected fail-closed exit 3, got {sup.returncode}\n{out}"
    assert not os.path.exists(sentinel), "serve was exec'd despite the registration channel being unavailable\n" + out
    print("PASS fail-closed: an unavailable registration channel aborts the start (exit 3) without running serve")


ADOPT_REG_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]; reg = os.environ.get("BELMONT_CHROME_REG"); owner = os.path.join(profile, ".belmont-chrome-owner.json")
assert reg, "supervisor must set BELMONT_CHROME_REG before exec"
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
# An orphan chrome from a "previous" serve already exists. THIS serve ADOPTS it: it registers the adopted
# instance under ITS OWN servePid (exactly what chrome.mjs's adopt branch now does via registerChromeInstance),
# then the owner file is deleted before crash. Only the adopt-path registration can reap it (C-2).
A = subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
json.dump({"servePid": 111111111, "chromePid": A.pid, "pgid": A.pid, "startTicks": ticks(A.pid), "generation": "prev"}, open(owner, "w"))
time.sleep(0.2)
# adopt: re-own + register under our pid (the C-2 code path), then delete the owner so ONLY registration remains.
with open(reg, "a") as f:
    f.write(json.dumps({"pid": A.pid, "pgid": A.pid, "startTicks": ticks(A.pid), "servePid": os.getpid(), "ts": time.time()}) + "\n")
os.remove(owner)
open(os.path.join(profile, "serve-ready"), "w").write(str(A.pid))
time.sleep(1.0)
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_adopt_path_registration_reaped():
    """C-2: a chrome that came under this serve's ownership via ADOPTION (not spawn) is registered under this
    serve's pid; with the owner file deleted, the registration tail must still pin+reap it on crash."""
    profile = tempfile.mkdtemp(prefix="sup-adoptreg-")
    fs = os.path.join(profile, "adopt-reg-serve.py"); open(fs, "w").write(ADOPT_REG_SERVE)
    sup = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = os.path.join(profile, "serve-ready"); a_pid = None
    for _ in range(200):
        if os.path.exists(ready): a_pid = int(open(ready).read().strip()); break
        time.sleep(0.05)
    assert a_pid, "serve never adopted+registered A"
    out, _ = sup.communicate(timeout=40); time.sleep(0.5)
    assert not alive(a_pid), "adopted+registered chrome leaked after owner deletion (C-2 registration missing)\n" + out
    print("PASS adopt-registration: an adopted chrome registered under this serve is reaped with no owner file")

LOCK_HOLD_SERVE = r'''
import os, sys, time
open(os.path.join(sys.argv[1], "serve-ready"), "w").write("held")
time.sleep(8)   # hold the profile (and thus the supervisor's flock) long enough for a 2nd run to be rejected
'''

def test_profile_lock_rejects_second_run():
    """A-1: two supervised serves on the SAME profile must not both run — the second must be rejected by the
    exclusive flock (exit 4) and must NOT exec its serve."""
    profile = tempfile.mkdtemp(prefix="sup-lock-")
    fs = os.path.join(profile, "hold-serve.py"); open(fs, "w").write(LOCK_HOLD_SERVE)
    first = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = os.path.join(profile, "serve-ready")
    for _ in range(200):
        if os.path.exists(ready): break
        time.sleep(0.05)
    assert os.path.exists(ready), "first supervised serve never started"
    # second run on the same profile, while the first still holds the lock
    second_sentinel = os.path.join(profile, "second-serve-ran")
    fs2 = os.path.join(profile, "sentinel2.py"); open(fs2, "w").write(SENTINEL_SERVE)
    second = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs2, second_sentinel],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out2, _ = second.communicate(timeout=20)
    assert second.returncode == 4, f"second run should be rejected with exit 4, got {second.returncode}\n{out2}"
    assert not os.path.exists(second_sentinel), "second run exec'd serve despite the profile lock being held\n" + out2
    first.communicate(timeout=20)
    print("PASS profile-lock: a second supervised serve on the same profile is rejected (exit 4) and never runs serve")

REG_HOLD_SERVE = r'''
import os, sys, json, time, subprocess, signal
profile = sys.argv[1]; reg = os.environ.get("BELMONT_CHROME_REG")
assert reg, "supervisor must set BELMONT_CHROME_REG before exec"
def ticks(pid):
    with open(f"/proc/{pid}/stat") as f: raw = f.read()
    return int(raw[raw.rfind(")") + 2:].split()[19])
A = subprocess.Popen(["sleep", "600"], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
with open(reg, "a") as f:   # NO owner file: reaping depends entirely on the reg log surviving the rival
    f.write(json.dumps({"pid": A.pid, "pgid": A.pid, "startTicks": ticks(A.pid), "servePid": os.getpid(), "ts": time.time()}) + "\n")
open(os.path.join(profile, "serve-ready"), "w").write(str(A.pid))
time.sleep(6)               # hold the profile lock long enough for a rival run to be rejected
os.kill(os.getpid(), signal.SIGKILL)
'''

def test_rejected_second_run_preserves_registration():
    """R1 (whole-project review): a rejected second supervised serve must NOT truncate the winner's shared
    registration log. Before the fix the loser did `open(reg,"w")` BEFORE the flock check, wiping the winner's
    registrations. Assert: the rival exits 4, does NOT run serve, the winner's reg line is preserved across the
    rival, and the winner still reaps its target."""
    profile = tempfile.mkdtemp(prefix="sup-r1-")
    fs = os.path.join(profile, "reg-hold-serve.py"); open(fs, "w").write(REG_HOLD_SERVE)
    winner = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs, profile],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = os.path.join(profile, "serve-ready"); a_pid = None
    for _ in range(200):
        if os.path.exists(ready): a_pid = int(open(ready).read().strip()); break
        time.sleep(0.05)
    assert a_pid, "winner serve never registered its chrome"
    reg_path = os.path.join(profile, ".belmont-chrome-reg.jsonl")
    # confirm the winner's registration is present before the rival runs
    before = [l for l in open(reg_path).read().splitlines() if l.strip()]
    assert len(before) == 1, f"expected 1 winner registration before the rival, got {before}"
    # rival run on the same profile while the winner holds the lock
    rival_sentinel = os.path.join(profile, "rival-serve-ran")
    fs2 = os.path.join(profile, "rival-sentinel.py"); open(fs2, "w").write(SENTINEL_SERVE)
    rival = subprocess.Popen(["python3", SUP, profile, "--", "python3", fs2, rival_sentinel],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out2, _ = rival.communicate(timeout=20)
    assert rival.returncode == 4, f"rival should be rejected with exit 4, got {rival.returncode}\n{out2}"
    assert not os.path.exists(rival_sentinel), "rival exec'd serve despite the profile lock\n" + out2
    # THE R1 ASSERTION: the winner's registration log is intact after the rejected rival
    after = [l for l in open(reg_path).read().splitlines() if l.strip()]
    assert after == before, f"rival TRUNCATED the winner's registration log (R1): before={before} after={after}"
    # and the winner still reaps its target
    winner.communicate(timeout=20); time.sleep(0.5)
    assert not alive(a_pid), "winner failed to reap its target after the rejected rival\n"
    print("PASS r1-preserve-registration: a rejected rival (exit 4) leaves the winner's reg log intact and the target is still reaped")

if __name__ == "__main__":
    test_reap(); test_ownership_no_miskill(); test_null_servepid_no_miskill(); test_repin_reaps_current_chrome(); test_polled_chrome_reaped_after_owner_deleted(); test_repin_then_owner_deleted_reaps_current(); test_poll_gap_registered_chrome_reaped(); test_pidfd_reuse_safety(); test_profile_missing_created_and_registers(); test_reg_channel_unavailable_fails_closed(); test_adopt_path_registration_reaped(); test_profile_lock_rejects_second_run(); test_rejected_second_run_preserves_registration(); print("ALL SUPERVISOR TESTS PASS")
