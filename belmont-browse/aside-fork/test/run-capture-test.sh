#!/usr/bin/env bash
SP=/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/2534ba16-801e-4ada-9486-ce4d1be6622c/scratchpad
BIN=/home/hoon/chromium/src/out/aside/chrome
TD="$SP/capture-test-ext"
PROF="$SP/fork-profile-test"; rm -rf "$PROF"
PORT="$1"; ALLOWLIST="$2"   # ALLOWLIST=id 이면 --allowlisted-extension-id 추가
LOG="$SP/chrome-test-$PORT.log"
DISP=":$((70 + RANDOM % 20))"

Xvfb "$DISP" -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB_PID=$!; sleep 2

EXTRA=""; [ -n "$ALLOWLIST" ] && EXTRA="--allowlisted-extension-id=$ALLOWLIST"
DISPLAY="$DISP" "$BIN" \
  --user-data-dir="$PROF" --load-extension="$TD" \
  --remote-debugging-port="$PORT" \
  --no-first-run --no-default-browser-check --no-sandbox --disable-gpu \
  --enable-logging=stderr $EXTRA about:blank >"$LOG" 2>&1 &
CH_PID=$!

RESULT=""
for i in $(seq 1 30); do
  sleep 1
  R=$(curl -s "http://127.0.0.1:$PORT/json" 2>/dev/null | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except: sys.exit()
for t in d:
  ti=t.get('title','')
  if ti.startswith('CAPRESULT '):
    print(ti); break" 2>/dev/null)
  [ -n "$R" ] && { RESULT="$R"; echo "[${i}s] got result"; break; }
done

echo "=== RESULT ==="
[ -n "$RESULT" ] && echo "$RESULT" || echo "TIMEOUT (no CAPRESULT)"
echo "=== EXT/PERM LOG ==="
grep -aiE "capture-tab|at\.studio|Permission .* is unknown|Unrecognized|Invalid value for" "$LOG" 2>/dev/null | head -10
echo "=== TARGETS ==="
curl -s "http://127.0.0.1:$PORT/json" 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);[print(' -',t.get('type'),'|',t.get('title','')[:70]) for t in d]" 2>/dev/null | head -8

kill "$CH_PID" 2>/dev/null; wait "$CH_PID" 2>/dev/null
kill "$XVFB_PID" 2>/dev/null; wait "$XVFB_PID" 2>/dev/null
exit 0
