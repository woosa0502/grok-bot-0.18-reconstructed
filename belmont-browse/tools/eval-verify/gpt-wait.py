#!/usr/bin/env python3
# Read-only completion poller for the single ChatGPT tab. Detects a NEW answer via the generating flag + tail
# change/stability (assistantCount is unreliable: ChatGPT virtualizes off-screen messages). Never sends.
# argv[1] = baseline lastTailLen captured just before we sent (so we know when the tail has changed).
import subprocess, json, time, sys, os
HELP = os.path.join(os.path.dirname(__file__), "gpt-cdp.py")
BASE_LEN = int(sys.argv[1]) if len(sys.argv) > 1 else -1
def state():
    try:
        out = subprocess.run([sys.executable, HELP, "state"], capture_output=True, text=True, timeout=30).stdout.strip()
        return json.loads(out.splitlines()[-1])
    except Exception as e:
        return {"error": str(e)}
started = False
stable = 0
last_len = None
t0 = time.time()
while True:
    st = state()
    if "error" in st:
        print(f"[{int(time.time()-t0)}s] poll-error: {st['error'][:80]}", flush=True); time.sleep(30); continue
    gen, ln = st.get("generating"), st.get("lastTailLen", 0)
    # started once we see generating OR the tail length diverges from the pre-send baseline
    if not started and (gen or (BASE_LEN >= 0 and ln != BASE_LEN)):
        started = True
        print(f"[{int(time.time()-t0)}s] ANSWER STARTED (generating={gen}, len={ln})", flush=True)
    if started and ln != last_len:
        print(f"[{int(time.time()-t0)}s] progress: len={ln} generating={gen}", flush=True)
        last_len = ln; stable = 0
    if started and not gen:
        stable += 1
        if stable >= 3:   # ~90s of no growth and not generating
            print(f"[{int(time.time()-t0)}s] GPT-ANSWER-COMPLETE len={ln}", flush=True)
            sys.exit(0)
    else:
        stable = 0
    time.sleep(30)
