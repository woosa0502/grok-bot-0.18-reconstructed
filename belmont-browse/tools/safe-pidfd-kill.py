#!/usr/bin/env python3
"""Instance-bound kill for test cleanup/injection: signal a pid ONLY through a pidfd bound to a verified
instance, never a raw pid. Refuses (no signal) when identity is absent or does not match — no raw-PID fallback.
Same kernel primitive the product supervisor uses (os.pidfd_open + signal.pidfd_send_signal).

Returns DISTINCT results so a caller can tell an actually-delivered signal from a no-op (whole-project review
round-4: `exit 0` alone conflated SIGNALLED with already-gone/refused/error):
  0  SIGNALLED     signal was delivered to the verified instance
  10 ALREADY_GONE  the instance is already dead (no signal needed/possible)
  3  REFUSED       identity absent or mismatched (a reused pid) — deliberately NOT signalled
  4  ERROR         an unexpected OS error while signalling
  2  USAGE
The result word is printed to stdout. Crash/stop INJECTIONS must require SIGNALLED; general cleanup may accept
SIGNALLED or ALREADY_GONE.

Usage: safe-pidfd-kill.py <pid> <expectedStartTicks> [SIGKILL|SIGTERM]
An expectedStartTicks that is not a positive integer is REFUSED (identity is required, never skipped).
"""
import os, sys, signal

SIGNALLED, ALREADY_GONE, REFUSED, ERROR, USAGE = 0, 10, 3, 4, 2

def start_ticks(pid):
    try:
        with open(f"/proc/{pid}/stat") as f: raw = f.read()
        return int(raw[raw.rfind(")") + 2:].split()[19])
    except Exception:
        return None

def out(word, code):
    print(f"[safe-kill] {word}", file=sys.stderr); return code

def main():
    if len(sys.argv) < 3:
        print("usage: safe-pidfd-kill.py <pid> <expectedStartTicks> [SIGKILL|SIGTERM]", file=sys.stderr); return USAGE
    try:
        pid = int(sys.argv[1]); expected = int(sys.argv[2])
    except ValueError:
        return out("REFUSED: pid/expectedStartTicks must be integers", REFUSED)
    if pid <= 1 or expected <= 0:
        return out("REFUSED: identity required (pid>1 and expectedStartTicks>0)", REFUSED)
    sig = getattr(signal, sys.argv[3], signal.SIGKILL) if len(sys.argv) > 3 else signal.SIGKILL
    cur = start_ticks(pid)
    if cur is None:
        return out("ALREADY_GONE: pid not present", ALREADY_GONE)
    if cur != expected:
        return out("REFUSED: startTicks mismatch (reused pid)", REFUSED)   # never signal a reused pid
    try:
        fd = os.pidfd_open(pid)
    except ProcessLookupError:
        return out("ALREADY_GONE: pidfd_open ProcessLookupError", ALREADY_GONE)
    except OSError as e:
        return out(f"ERROR: pidfd_open {e}", ERROR)
    try:
        if start_ticks(pid) != expected:      # re-verify AFTER open: reuse between check and open -> refuse
            return out("REFUSED: pid reused between check and pidfd_open", REFUSED)
        signal.pidfd_send_signal(fd, sig)     # bound to the instance; can never reach a reused pid
        return out(f"SIGNALLED {sig}", SIGNALLED)
    except ProcessLookupError:
        return out("ALREADY_GONE: gone before signal", ALREADY_GONE)
    except OSError as e:
        return out(f"ERROR: send {e}", ERROR)
    finally:
        try: os.close(fd)
        except OSError: pass

if __name__ == "__main__":
    sys.exit(main())
