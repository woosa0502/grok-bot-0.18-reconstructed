#!/usr/bin/env python3
"""Instance-bound kill for test cleanup: signal a pid ONLY through a pidfd bound to a verified instance, never a
raw pid. Refuses (no signal) when identity is absent or does not match — no raw-PID fallback. This is the same
kernel primitive the product supervisor uses (os.pidfd_open + signal.pidfd_send_signal), so cleanup cannot
mis-signal a reused PID (closes the check->signal race the Node process.kill path could not).

Usage: safe-pidfd-kill.py <pid> <expectedStartTicks> [SIGKILL|SIGTERM]
Exit: 0 signalled (or already gone); 3 identity mismatch/absent (refused); 2 usage.
An expectedStartTicks that is not a positive integer is REFUSED (identity is required, never skipped).
"""
import os, sys, signal

def start_ticks(pid):
    try:
        with open(f"/proc/{pid}/stat") as f: raw = f.read()
        return int(raw[raw.rfind(")") + 2:].split()[19])
    except Exception:
        return None

def main():
    if len(sys.argv) < 3:
        print("usage: safe-pidfd-kill.py <pid> <expectedStartTicks> [SIGKILL|SIGTERM]", file=sys.stderr); return 2
    try:
        pid = int(sys.argv[1]); expected = int(sys.argv[2])
    except ValueError:
        print("[safe-kill] REFUSED: pid/expectedStartTicks must be integers", file=sys.stderr); return 3
    if pid <= 1 or expected <= 0:
        print("[safe-kill] REFUSED: identity required (pid>1 and expectedStartTicks>0)", file=sys.stderr); return 3
    sig = getattr(signal, sys.argv[3], signal.SIGKILL) if len(sys.argv) > 3 else signal.SIGKILL
    # verify identity BEFORE opening the pidfd
    if start_ticks(pid) != expected:
        return 0  # not our instance (dead or reused) -> nothing to do, and never signal a raw/reused pid
    try:
        fd = os.pidfd_open(pid)
    except (ProcessLookupError, OSError):
        return 0  # gone between check and open
    try:
        # re-verify AFTER open: a reuse between check and open no longer matches -> refuse
        if start_ticks(pid) != expected:
            print("[safe-kill] REFUSED: pid reused between check and pidfd_open", file=sys.stderr); return 3
        signal.pidfd_send_signal(fd, sig)   # bound to the instance; can never reach a reused pid
        return 0
    except (ProcessLookupError, OSError):
        return 0
    finally:
        try: os.close(fd)
        except OSError: pass

if __name__ == "__main__":
    sys.exit(main())
