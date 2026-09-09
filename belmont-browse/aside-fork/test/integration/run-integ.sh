#!/usr/bin/env bash
export PATH="/home/hoon/.nvm/versions/node/v26.8.1/bin:$PATH"
BB=/home/hoon/_roots/labs/work/Belmont/belmont-browse
SP=/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/2534ba16-801e-4ada-9486-ce4d1be6622c/scratchpad
cd "$BB"
# 잔여 정리 (pid 기반 + 패턴은 이 스크립트 파일 안에만 있어 자기매칭 안 됨)
[ -f .state/serve.json ] && kill $(grep -oE '"pid": *[0-9]+' .state/serve.json 2>/dev/null | grep -oE '[0-9]+') 2>/dev/null
pkill -f "out/aside/chrome" 2>/dev/null
sleep 2
pgrep -f "Xvfb :99" >/dev/null || { Xvfb :99 -screen 0 1400x900x24 >/dev/null 2>&1 & sleep 2; }
mv .state/serve.log "$SP/serve.prev2.log" 2>/dev/null
BELMONT_BROWSE_CHROME=/home/hoon/chromium/src/out/aside/chrome \
BELMONT_BROWSE_EXTENSION="$BB/vendor/aside-ext/AsideAgentManager" \
BELMONT_BROWSE_NO_SANDBOX=1 \
ASIDE_INSTALLATION_KEY="$SP/AsideInstallationKey" \
BELMONT_BROWSE_DISPLAY=:99 BELMONT_BROWSE_ENGINE=902 BELMONT_BROWSE_MODE=guard \
setsid nohup node src/serve.mjs > .state/serve.log 2>&1 &
echo "serve pid=$!"
