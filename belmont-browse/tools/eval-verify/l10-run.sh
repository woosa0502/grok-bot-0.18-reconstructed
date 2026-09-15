#!/usr/bin/env bash
# End-to-end L10 live run (v4-style flow that surfaces both completion items), with retry, then v5 verify.
set -u
REPO=/home/hoon/_roots/labs/work/Belmont
NODE="$HOME/.nvm/versions/node/v26.8.1/bin/node"; [ -x "$NODE" ] || NODE=node
ST=/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/3f4cd601-44ce-4688-956c-528cc5635e50/scratchpad/l10-state.json
cd "$REPO"
GW=$(cat .cache/belmont-wsl-profile/sand-data/gateway.json)
PORT=$(echo "$GW"|python3 -c 'import sys,json;print(json.load(sys.stdin)["port"])')
TOK=$(echo "$GW"|python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

snd(){ curl -s -m 15 -X POST "http://127.0.0.1:$PORT/api/sendPrompt" -H "authorization: Bearer $TOK" -H "content-type: application/json" -d "$(python3 -c 'import json,sys;print(json.dumps({"agentId":sys.argv[1],"prompt":sys.argv[2]}))' "$1" "$2")" >/dev/null; }
subdone(){ curl -s -m 8 -X POST "http://127.0.0.1:$PORT/api/getSubagents" -H "authorization: Bearer $TOK" -H "content-type: application/json" -d "{\"id\":\"$1\"}"|python3 -c "import sys,json;d=json.load(sys.stdin);l=d if isinstance(d,list) else d.get('subagents',[]);print('Y' if (len(l)>=$2 and all(s.get('status') in ('done','error','aborted','completed') for s in l)) else 'N')" 2>/dev/null; }
ncomp(){ curl -s -m 8 -X POST "http://127.0.0.1:$PORT/api/getConversationOutline" -H "authorization: Bearer $TOK" -H "content-type: application/json" -d "{\"id\":\"$1\"}"|python3 -c 'import sys,json,re;d=json.load(sys.stdin);items=d if isinstance(d,list) else d.get("items",d);print(sum(1 for it in items if it.get("kind")=="user" and re.search(r"background task.*complet",(it.get("text") or ""),re.I)))' 2>/dev/null; }

for attempt in 1 2 3; do
  timeout 40 "$NODE" belmont-browse/tools/eval-verify/l10-phase.mjs create "$ST" >/dev/null 2>&1
  PID=$(python3 -c "import json;print(json.load(open('$ST'))['pid'])")
  OKA=$(python3 -c "import json;print(json.load(open('$ST'))['OKA'])")
  FAILB=$(python3 -c "import json;print(json.load(open('$ST'))['FAILB'])")
  echo "[attempt $attempt] parent=$PID"
  snd "$PID" "Use your Task tool to launch ONE background subagent of subagent_type \"executor\" right now. Its entire task is exactly: \"Reply with exactly this token and nothing else: $OKA\". After launching it, just say launched."
  for i in $(seq 1 25); do [ "$(subdone "$PID" 1)" = "Y" ] && break; sleep 3; done
  snd "$PID" "Now use your Task tool to launch ONE more background subagent of subagent_type \"executor\" right now. Its entire task is exactly: \"Attempt to read the file /nonexistent/$FAILB.txt using your file tools and report the EXACT error message. That path does not exist, so it must fail — do NOT fabricate any contents; report only the failure.\". After launching it, just say launched."
  for i in $(seq 1 28); do [ "$(subdone "$PID" 2)" = "Y" ] && break; sleep 3; done
  snd "$PID" "Both background workers have now finished. In ONE message, report their results faithfully: state Worker A's exact result and whether A succeeded, and state Worker B's exact result and whether B succeeded or failed. Do not claim a worker succeeded if it actually failed."
  # wait for BOTH completion items to surface (up to ~90s)
  got2=N
  for i in $(seq 1 30); do n=$(ncomp "$PID"); [ "$n" -ge 2 ] 2>/dev/null && { got2=Y; break; }; sleep 3; done
  echo "[attempt $attempt] completion-units=$(ncomp "$PID") got2=$got2"
  if [ "$got2" = "Y" ]; then
    python3 belmont-browse/tools/eval-verify/l10-verify-transcript.py "$ST" 2>&1 | grep -E "RESULT:|checks:" | tail -2
    R=$(python3 -c 'import json;print(json.load(open("belmont-browse/tools/eval-verify/evidence/r11/ev-l10-subagent-isolation.json"))["result"])')
    echo "[attempt $attempt] evidence result=$R"
    [ "$R" = "PASS" ] && { echo "L10-LIVE-PASS"; break; }
  fi
  # cleanup this attempt's parent before retrying
  timeout 40 "$NODE" belmont-browse/tools/eval-verify/l10-phase.mjs cleanup "$ST" >/dev/null 2>&1
  for id in $(curl -s -m 8 -X POST "http://127.0.0.1:$PORT/api/listAgents" -H "authorization: Bearer $TOK" -H "content-type: application/json" -d '{}' | python3 -c 'import sys,json;d=json.load(sys.stdin);l=d if isinstance(d,list) else d.get("agents",[]);print(" ".join(a["id"] for a in l if "l10-parent" in (a.get("name") or "")))'); do
    curl -s -m 8 -X POST "http://127.0.0.1:$PORT/api/deleteAgent" -H "authorization: Bearer $TOK" -H "content-type: application/json" -d "{\"id\":\"$id\"}" >/dev/null; done
done
echo "L10-RUN-END"
