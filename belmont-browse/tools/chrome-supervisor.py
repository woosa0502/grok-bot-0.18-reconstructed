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
import os, sys, json, time, signal, fcntl

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

    # Append-only registration log the serve writes at each chrome spawn; we TAIL it so discovery does not
    # depend on polling a deletable owner file (closes the round-12/13 poll-gap: a chrome registered at spawn
    # is seen even if the owner file is replaced/deleted before the next poll).
    #
    # The ORDER of the next three steps matters (whole-project review R1). A rejected second supervised serve
    # must not damage the winner's state, so we must acquire the exclusive lock BEFORE touching the shared
    # registration log — otherwise the loser truncates the winner's log before it is turned away:
    #   1. create the profile dir (needed before the lock file or the reg log can exist),
    #   2. acquire the per-profile flock (A-1) — a loser returns here, having touched nothing shared,
    #   3. ONLY the lock winner creates/truncates + fsyncs the reg log (C-1 fail-closed).
    reg_path = os.path.join(profile, ".belmont-chrome-reg.jsonl")

    # 1. profile dir
    try:
        os.makedirs(profile, exist_ok=True)
    except OSError as e:
        print(f"[supervisor] FATAL: cannot create profile dir {profile}: {e}", file=sys.stderr, flush=True)
        return 3

    # 2. A-1: exclusive PER-PROFILE lock. Two supervised serves on the SAME profile would race to own/adopt the
    # same Chrome (the A-1 TOCTOU). fcntl.flock is unprivileged and the kernel releases it automatically when
    # this process dies — so it closes A-1 without cgroup/root. LOCK_NB: reject (don't block) the second run.
    # Acquired BEFORE the reg log is touched so a rejected run leaves the winner's log intact (R1). The fd is
    # kept open for the supervisor's whole life (held in this local, closed at exit; CLOEXEC so serve doesn't
    # inherit it, making the lock's lifetime exactly the supervisor's).
    lock_path = os.path.join(profile, ".belmont-chrome-supervisor.lock")
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_CLOEXEC, 0o644)
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as e:
        print(f"[supervisor] FATAL: another supervised serve holds the profile lock {lock_path}: {e}", file=sys.stderr, flush=True)
        return 4

    # 3. C-1 FAIL-CLOSED. Push-registration is the PRIMARY discovery channel; owner-file polling is only a compat
    # fallback with a known poll-gap. So the registration channel must exist BEFORE we exec serve, and if it
    # cannot be established the supervised start FAILS with a non-zero exit — we do NOT silently fall back to
    # polling-only. Only the lock winner reaches here, so this truncation cannot clobber another run's log.
    try:
        with open(reg_path, "w") as f:
            f.write("")  # truncate/create
            f.flush(); os.fsync(f.fileno())
    except OSError as e:
        print(f"[supervisor] FATAL: cannot establish chrome registration log at {reg_path}: {e}", file=sys.stderr, flush=True)
        return 3
    os.environ["BELMONT_CHROME_REG"] = reg_path

    child_pid = os.fork()
    if child_pid == 0:
        os.execvp(serve_argv[0], serve_argv)  # child: become serve
        os._exit(127)
    # child_pid is IMMUTABLE (the forked serve). Exit is tracked by a separate flag so it never collides with
    # the ownership comparison (round-9 fix).
    serve_exited = False
    reg_offset = 0

    def drain_registrations(tracked):
        """Tail the append-only registration log; pin a pidfd for each newly-registered owned chrome we do not
        already track (verifying servePid==our child and start-ticks, then re-verifying after pidfd_open)."""
        nonlocal reg_offset
        if not reg_path: return
        try:
            with open(reg_path) as f:
                f.seek(reg_offset)
                data = f.read(); reg_offset = f.tell()
        except OSError: return
        for line in data.splitlines():
            line = line.strip()
            if not line: continue
            try: e = json.loads(line)
            except Exception: continue
            cp, ct, sp = e.get("pid"), e.get("startTicks"), e.get("servePid")
            if not (isinstance(cp, int) and cp > 1 and isinstance(ct, int) and sp == child_pid): continue
            if cp in tracked: continue
            if start_ticks(cp) != ct: continue         # already a different/dead instance
            try: f2 = os.pidfd_open(cp)
            except (ProcessLookupError, OSError): continue
            if start_ticks(cp) != ct: os.close(f2); continue   # reuse between check and open
            tracked[cp] = (f2, ct)
            print(f"[supervisor] pinned chrome pid={cp} startTicks={ct} via pidfd (registration)", flush=True)

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

    # Parent: continuously TRACK every owned Chrome instance for the serve's whole life (round-12 fix: a
    # pin-once loop could not follow a chrome A->B restart whose owner was then deleted). Each poll we pin the
    # current owner (adding a pidfd for any new instance) and prune tracked instances that have died, so at
    # serve-exit we hold a pidfd for every still-live owned instance regardless of restarts or owner deletion.
    tracked = {}   # chromePid -> (fd, startTicks)
    while True:
        drain_registrations(tracked)   # primary discovery: push-registered at spawn (no owner-file poll-gap)
        f, cp, ct = pin_owned_chrome() # secondary: current owner (compat / cross-serve adopt)
        if f is not None:
            if cp in tracked: os.close(f)                       # already tracked
            else: tracked[cp] = (f, ct); print(f"[supervisor] pinned chrome pid={cp} startTicks={ct} via pidfd", flush=True)
        for pid in [p for p, (tf, _) in tracked.items() if not pidfd_alive(tf)]:  # prune dead instances
            try: os.close(tracked[pid][0])
            except OSError: pass
            del tracked[pid]
        wpid, _ = os.waitpid(child_pid, os.WNOHANG)
        if wpid == child_pid:
            serve_exited = True; break
        time.sleep(0.5)
    drain_registrations(tracked)   # final drain: catch a chrome registered right at serve-exit
    print("[supervisor] serve exited; reaping tracked owned chrome instances", flush=True)

    def reap_via_fd(fd, chrome_pid):
        if not pidfd_alive(fd): print("[supervisor] owned chrome already gone", flush=True); return True
        print(f"[supervisor] reaping owned chrome instance pid={chrome_pid} via pidfd", flush=True)
        try: signal.pidfd_send_signal(fd, signal.SIGTERM)
        except (ProcessLookupError, OSError): return True
        end = time.time() + grace_ms / 1000.0
        while time.time() < end:
            if not pidfd_alive(fd): print("[supervisor] chrome exited on SIGTERM", flush=True); return True
            time.sleep(0.1)
        try: signal.pidfd_send_signal(fd, signal.SIGKILL)
        except (ProcessLookupError, OSError): return True
        end = time.time() + 2
        while time.time() < end:
            if not pidfd_alive(fd): print("[supervisor] chrome exited on SIGKILL", flush=True); return True
            time.sleep(0.1)
        return False

    # One last pin in case a chrome was recorded right at serve-exit, then reap EVERY tracked live instance.
    f, cp, ct = pin_owned_chrome()
    if f is not None and cp not in tracked: tracked[cp] = (f, ct)
    elif f is not None: os.close(f)
    reaped, ok = 0, True
    for cp, (tf, _) in list(tracked.items()):
        ok = reap_via_fd(tf, cp) and ok
        try: os.close(tf)
        except OSError: pass
        reaped += 1
    if reaped == 0:
        print("[supervisor] no owned chrome to reap", flush=True); return 0
    if not ok:
        print("[supervisor] WARNING: an owned chrome instance survived SIGKILL", file=sys.stderr, flush=True); return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
