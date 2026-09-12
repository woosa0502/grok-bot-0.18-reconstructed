#!/usr/bin/env python3
"""External pidfd supervisor for the eval serve's Chrome — the kernel-primitive closure for
DEF-L19-CHROME-ORPHAN-001 that pure-Node userspace could not reach (A-1/A-3 TOCTOU).

cgroup v2 and systemd-run need root / a user bus here, so neither is usable. `pidfd` is: a pidfd
binds to a specific process INSTANCE, so a signal sent through it can never reach a reused PID, and
it works without root. This supervisor:

  1. launches the eval serve as a child;
  2. learns the owned Chrome's (pid, start-ticks) from the owner file and opens a pidfd bound to that
     exact instance (verifying start-ticks so we never bind a reused pid);
  3. waits for serve to exit (ANY cause, including SIGKILL — the supervisor is serve's parent, so it
     always regains control);
  4. if the owned Chrome instance is still alive, reaps it through the pidfd (SIGTERM -> SIGKILL).

This backstops the in-process reaper for two windows it cannot close by itself: the SIGKILL-orphan
window (serve killed with no handler) and the PID-reuse mis-kill (A-3). It never signals by raw
pid/pgid, so it cannot mis-kill an unrelated process that inherited the number.

Usage: chrome-supervisor.py <profileDir> -- <serve argv...>
Env: BELMONT_SUPERVISOR_GRACE_MS (default 4000) reap grace before SIGKILL.
"""
import os, sys, json, time, signal

def owner_path(profile): return os.path.join(profile, ".belmont-chrome-owner.json")

def read_owner(profile):
    try:
        with open(owner_path(profile)) as f: return json.load(f)
    except Exception:
        return None

def start_ticks(pid):
    try:
        with open(f"/proc/{pid}/stat") as f: raw = f.read()
        after = raw[raw.rfind(")") + 2:].split()
        return int(after[19])  # field 22 (starttime), 0-indexed after state
    except Exception:
        return None

def pidfd_alive(fd):
    """True iff the bound instance is still alive. Uses signal 0 through the pidfd (instance-bound)."""
    try:
        signal.pidfd_send_signal(fd, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists but not signalable by us -> treat as alive
    except OSError:
        return False

def main():
    if "--" not in sys.argv:
        print("usage: chrome-supervisor.py <profileDir> -- <serve argv...>", file=sys.stderr); return 2
    sep = sys.argv.index("--")
    profile = sys.argv[1]
    serve_argv = sys.argv[sep + 1:]
    grace_ms = int(os.environ.get("BELMONT_SUPERVISOR_GRACE_MS", "4000"))

    child_pid = os.fork()
    if child_pid == 0:
        os.execvp(serve_argv[0], serve_argv)  # child: become serve
        os._exit(127)
    # child_pid is IMMUTABLE (the forked serve). Exit is tracked by a separate flag so it never collides with
    # the ownership comparison (round-9 fix).
    serve_exited = False

    def pin_owned_chrome():
        """Open a pidfd bound to the OWNED chrome instance, or None. Closes GPT round-8 holes:
        - ownership: the owner record must name OUR serve child (owner.servePid == child_pid (immutable)) and carry
          startTicks (no missing-identity binding), so we never pin another serve's chrome.
        - verify->open TOCTOU: after pidfd_open we RE-READ the pid's start-ticks and confirm they still match
          the expected value; a pid reused between the check and the open no longer matches, so we close the
          fd and refuse to bind the wrong instance."""
        o = read_owner(profile)
        if not o or not isinstance(o.get("chromePid"), int) or o["chromePid"] <= 1:
            return (None, None, None)
        # Ownership must match the immutable forked child pid, and servePid must be a VALID INTEGER (a missing
        # or null servePid must NEVER pass — round-9 fix: previously `serve_pid` was overwritten with None on
        # serve exit, so `None != None` let a null-servePid record through and mis-killed a foreign process,
        # while a valid owner was wrongly rejected by the final sweep).
        sp = o.get("servePid")
        if not isinstance(sp, int) or sp != child_pid:
            return (None, None, None)  # not our serve's chrome (or malformed ownership)
        cp = o["chromePid"]; ct = o.get("startTicks")
        if not isinstance(ct, int):
            return (None, None, None)  # require a start-ticks identity
        if start_ticks(cp) != ct:
            return (None, None, None)  # pid not (yet) the expected instance
        try:
            f = os.pidfd_open(cp)
        except (ProcessLookupError, OSError):
            return (None, None, None)
        if start_ticks(cp) != ct:   # re-verify AFTER open: reuse between check and open -> wrong bind
            os.close(f); return (None, None, None)
        return (f, cp, ct)

    # Parent: learn the owned Chrome instance and pin a pidfd to it.
    chrome_pid, chrome_ticks, fd = None, None, None
    deadline = time.time() + 60
    while time.time() < deadline:
        fd, chrome_pid, chrome_ticks = pin_owned_chrome()
        if fd is not None:
            print(f"[supervisor] pinned chrome pid={chrome_pid} startTicks={chrome_ticks} via pidfd", flush=True); break
        wpid, _ = os.waitpid(child_pid, os.WNOHANG)
        if wpid == child_pid:
            serve_exited = True; break  # serve exited; fall through to the final sweep (child_pid stays valid)
        time.sleep(0.5)

    # Wait for serve to exit (if it hasn't already).
    if not serve_exited:
        try: os.waitpid(child_pid, 0)
        except ChildProcessError: pass
    print("[supervisor] serve exited; checking owned chrome", flush=True)

    # Final sweep: even if we never pinned during the poll (chrome recorded then serve died before the next
    # poll, or created after the 60s window), try once more now that serve is gone (closes the early-death
    # "orphan alive but exit 0" counterexample).
    if fd is None:
        fd, chrome_pid, chrome_ticks = pin_owned_chrome()
    if fd is None:
        print("[supervisor] no owned chrome to reap", flush=True); return 0
    if not pidfd_alive(fd):
        print("[supervisor] owned chrome already gone (reaped by serve or exited)", flush=True); os.close(fd); return 0

    # The instance is still alive: reap through the pidfd (never by raw pid -> immune to reuse).
    print(f"[supervisor] reaping orphaned chrome instance pid={chrome_pid} via pidfd", flush=True)
    try: signal.pidfd_send_signal(fd, signal.SIGTERM)
    except (ProcessLookupError, OSError): os.close(fd); return 0
    end = time.time() + grace_ms / 1000.0
    while time.time() < end:
        if not pidfd_alive(fd): print("[supervisor] chrome exited on SIGTERM", flush=True); os.close(fd); return 0
        time.sleep(0.1)
    try: signal.pidfd_send_signal(fd, signal.SIGKILL)
    except (ProcessLookupError, OSError): os.close(fd); return 0
    end = time.time() + 2
    while time.time() < end:
        if not pidfd_alive(fd): print("[supervisor] chrome exited on SIGKILL", flush=True); os.close(fd); return 0
        time.sleep(0.1)
    os.close(fd)
    print("[supervisor] WARNING: chrome instance still present after SIGKILL", file=sys.stderr, flush=True)
    return 1

if __name__ == "__main__":
    sys.exit(main())
