#!/usr/bin/env bash
# Belmont Mobile PWA를 폰(Tailscale)용으로 시작한다.
#
# 전제 (한 번만 해두면 유지됨):
#   - Belmont 앱이 WSL에서 실행 중
#   - Windows에서 등록된 Tailscale serve: tailscale serve --bg --https=8444 4173
#     (재부팅해도 유지된다. 끄려면: tailscale serve --https=8444 off)
#
# 폰에서: https://desktop-ofkcvog.tail23bc25.ts.net:8444 접속
#   → Other ways to connect → Enter address and code
#   → 주소는 비워두고, 아래에 출력되는 페어링 코드 입력
#
# 코드를 고정하고 싶으면: BELMONT_MOBILE_PAIR_CODE=123456 ./start-mobile.sh
set -euo pipefail
export PATH="$HOME/.local/share/mise/installs/node/26.5.0/bin:$PATH"
cd "$(dirname "$0")"

BELMONT_MOBILE_TRUST_PROXY=1 \
BELMONT_MOBILE_PORT=4173 \
BELMONT_WSL_PROFILE=/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile \
node belmont-server.mjs
