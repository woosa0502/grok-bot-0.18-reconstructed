#!/bin/bash
# Start Xvfb :97 (if missing) and the belmont-browse service on the fork (HANDOFF §1).
set -u
export PATH="/home/hoon/.nvm/versions/node/v26.8.1/bin:$PATH"
pgrep -x Xvfb -a | grep -q ':97' || (Xvfb :97 -screen 0 1400x900x24 >/dev/null 2>&1 &)
sleep 1
cd /home/hoon/_roots/labs/work/Belmont/belmont-browse
(BELMONT_BROWSE_DISPLAY=:97 setsid nohup ./run-fork.sh > .state/serve.log 2>&1 < /dev/null &)
for i in $(seq 1 60); do curl -s -m 1 http://127.0.0.1:9333/json/version >/dev/null 2>&1 && { echo "CDP up after ${i}s"; exit 0; }; sleep 1; done
echo "CDP 9333 not up after 60s"; tail -5 .state/serve.log; exit 1
