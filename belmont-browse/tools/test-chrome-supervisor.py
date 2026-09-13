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

def test_pidfd_reuse_safety():
    p = subprocess.Popen(["sleep", "0.2"]); fd = os.pidfd_open(p.pid); p.wait(); time.sleep(0.2)
    try:
        signal.pidfd_send_signal(fd, signal.SIGKILL); raise AssertionError("signaled a dead instance")
    except ProcessLookupError:
        print("PASS pidfd-reuse-safety: dead-instance pidfd raises ProcessLookupError (reused pid never signaled)")
    finally:
        os.close(fd)

if __name__ == "__main__":
    test_reap(); test_ownership_no_miskill(); test_null_servepid_no_miskill(); test_repin_reaps_current_chrome(); test_pidfd_reuse_safety(); print("ALL SUPERVISOR TESTS PASS")
