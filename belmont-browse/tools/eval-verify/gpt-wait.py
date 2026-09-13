#!/usr/bin/env python3
# Read-only completion poller for the single ChatGPT tab. Emits ONLY on meaningful transitions and exits when the
# new assistant answer is complete. Never sends anything. Used under Monitor.
import subprocess, json, time, sys, os
HELP = os.path.join(os.path.dirname(__file__), "gpt-cdp.py")
BASELINE = int(sys.argv[1]) if len(sys.argv) > 1 else 2   # assistant count before we sent
def state():
    try:
        out = subprocess.run([sys.executable, HELP, "state"], capture_output=True, text=True, timeout=30).stdout.strip()
        return json.loads(out.splitlines()[-1])
    except Exception as e:
        return {"error": str(e)}
seen_new = False           # a new assistant message (count > baseline) has appeared
stable_done = 0
last_len = -1
started = time.time()
while True:
    st = state()
    if "error" in st:
        print(f"[{int(time.time()-started)}s] poll-error: {st['error'][:80]}", flush=True)
        time.sleep(30); continue
    gen, cnt, ln = st.get("generating"), st.get("assistantCount", 0), st.get("lastTailLen", 0)
    if cnt > BASELINE and not seen_new:
        seen_new = True
        print(f"[{int(time.time()-started)}s] NEW ANSWER STARTED (count={cnt})", flush=True)
    if seen_new and ln != last_len:
        print(f"[{int(time.time()-started)}s] progress: {ln} chars, generating={gen}", flush=True)
        last_len = ln
    # completion: a new answer exists, not generating, and length stable across two polls
    if seen_new and not gen:
        stable_done += 1
        if stable_done >= 2:
            print(f"[{int(time.time()-started)}s] GPT-ANSWER-COMPLETE len={ln}", flush=True)
            sys.exit(0)
    else:
        stable_done = 0
    time.sleep(30)
