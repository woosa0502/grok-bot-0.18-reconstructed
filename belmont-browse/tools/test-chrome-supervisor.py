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
chrome = subprocess.Popen(["sleep", "600"], start_new_session=True)
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

def test_pidfd_reuse_safety():
    p = subprocess.Popen(["sleep", "0.2"]); fd = os.pidfd_open(p.pid); p.wait(); time.sleep(0.2)
    try:
        signal.pidfd_send_signal(fd, signal.SIGKILL); raise AssertionError("signaled a dead instance")
    except ProcessLookupError:
        print("PASS pidfd-reuse-safety: dead-instance pidfd raises ProcessLookupError (reused pid never signaled)")
    finally:
        os.close(fd)

if __name__ == "__main__":
    test_reap(); test_pidfd_reuse_safety(); print("ALL SUPERVISOR TESTS PASS")
