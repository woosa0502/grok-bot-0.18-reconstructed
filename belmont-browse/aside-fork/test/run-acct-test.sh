#!/usr/bin/env bash
SP=/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/2534ba16-801e-4ada-9486-ce4d1be6622c/scratchpad
BIN=/home/hoon/chromium/src/out/aside/chrome
TD="$SP/aside-account-test"
PROF="$SP/fork-prof-acct"; rm -rf "$PROF"
PORT=22010; DISP=":91"
Xvfb "$DISP" -screen 0 1280x800x24 >/dev/null 2>&1 & XP=$!; sleep 2
DISPLAY="$DISP" "$BIN" --user-data-dir="$PROF" --load-extension="$TD" \
  --remote-debugging-port=$PORT --no-first-run --no-sandbox --disable-gpu \
  --enable-logging=stderr about:blank >"$SP/acct.log" 2>&1 & CP=$!
R=""
for i in $(seq 1 25); do sleep 1
  R=$(curl -s "http://127.0.0.1:$PORT/json" 2>/dev/null | python3 -c "import sys,json,urllib.parse
try: d=json.load(sys.stdin)
except: sys.exit()
for t in d:
  ti=t.get('title','')
  if ti.startswith('ACCTRESULT '):
    print(urllib.parse.unquote(ti[len('ACCTRESULT '):])); break" 2>/dev/null)
  [ -n "$R" ] && break
done
echo "=== asideAccount API 결과 ==="
[ -n "$R" ] && echo "$R" | python3 -m json.tool 2>/dev/null || echo "$R"
[ -z "$R" ] && echo "TIMEOUT — 확장/네임스페이스 로그:" && grep -aiE "asideAccount|at.studio|unknown|error" "$SP/acct.log" | head -5
kill $CP 2>/dev/null; wait $CP 2>/dev/null; kill $XP 2>/dev/null; wait $XP 2>/dev/null; exit 0
