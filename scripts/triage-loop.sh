#!/bin/bash
export PATH="/home/hoon/.local/share/mise/installs/node/26.5.0/bin:$PATH"
cd /home/hoon/_roots/labs/work/Belmont
while pgrep -f gw-evidence.mjs >/dev/null; do
  RECORD=1 node scripts/triage.mjs > /tmp/triage-last.txt 2>&1
  sleep 240
done
# final pass after runner exits
RECORD=1 node scripts/triage.mjs > /tmp/triage-last.txt 2>&1
echo "triage-loop DONE $(date)" >> /tmp/triage-last.txt
