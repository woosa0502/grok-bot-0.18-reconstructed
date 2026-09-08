#!/usr/bin/env bash
# Linear Grok Mobile PWA를 폰(Tailscale)용으로 시작한다. 기존 belmont-mobile-pwa와 같은 포트(4173)를 쓰므로
# 폰 주소는 그대로다: https://desktop-ofkcvog.tail23bc25.ts.net:8444 (Windows: tailscale serve --bg --https=8444 4173)
# 코드를 고정하려면: BELMONT_MOBILE_PAIR_CODE=123456 ./start-mobile.sh (없으면 시작 시 한 번 출력되는 코드 사용)
set -euo pipefail
export PATH="$HOME/.local/share/mise/installs/node/26.5.0/bin:$HOME/.nvm/versions/node/v26.8.1/bin:$PATH"
cd "$(dirname "$0")"
if [ -n "${BELMONT_MOBILE_PAIR_CODE:-}" ]; then export GROK_MOBILE_PAIRING_CODE="$BELMONT_MOBILE_PAIR_CODE"; fi
export GROK_MOBILE_TRUST_PROXY=1
export GROK_MOBILE_PORT="${GROK_MOBILE_PORT:-4173}"
export GROK_MOBILE_HOST="${GROK_MOBILE_HOST:-127.0.0.1}"
export BELMONT_PROFILE_DIR=/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data
# absolute path so the process is identifiable (restart scripts match on it)
exec node "$PWD/server.mjs"
