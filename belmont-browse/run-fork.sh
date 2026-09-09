#!/bin/bash
# belmont-browse on the Aside fork with the real Aside extension (our code).
# The fork shows the Aside UI (vertical strip, chats, agent tabs) on BELMONT_BROWSE_DISPLAY; the daemon runs
# in-process (21420); Belmont's aside-browse bot talks to http://127.0.0.1:9340 (token in .state/serve.json).
set -euo pipefail
NODE_BIN="${BELMONT_BROWSE_NODE:-/home/hoon/.local/share/mise/installs/node/26.5.0/bin/node}"
export PATH="$(dirname "$NODE_BIN"):$PATH"
cd "$(dirname "$0")"
export BELMONT_BROWSE_CHROME="${BELMONT_BROWSE_CHROME:-/home/hoon/chromium/src/out/aside/chrome}"
# Chromium's Linux sandbox does not come up in this WSL2 environment (no SUID chrome_sandbox; a sandboxed headless
# launch hangs), so the default stays off. The value is parsed as a boolean: set 0/false to keep the sandbox on a
# host where it works; anything else than 1/true/yes/on or 0/false/no/off is rejected by src/chrome.mjs.
export BELMONT_BROWSE_NO_SANDBOX="${BELMONT_BROWSE_NO_SANDBOX:-1}"
export BELMONT_BROWSE_DISPLAY="${BELMONT_BROWSE_DISPLAY:-:99}"
export BELMONT_BROWSE_TRANSPORT="${BELMONT_BROWSE_TRANSPORT:-port}"
export BELMONT_BROWSE_ENGINE="${BELMONT_BROWSE_ENGINE:-907}"
export BELMONT_BROWSE_STATE_DIR="${BELMONT_BROWSE_STATE_DIR:-$PWD/.state}"
if [[ -z "${BELMONT_BROWSE_NATIVE_COMPONENTS+x}" ]]; then
  if [[ -n "${BELMONT_BROWSE_EXTENSION:-}" ]]; then
    export BELMONT_BROWSE_NATIVE_COMPONENTS=0
  else
    export BELMONT_BROWSE_NATIVE_COMPONENTS=1
  fi
fi
if [[ "$BELMONT_BROWSE_NATIVE_COMPONENTS" == 1 ]]; then
  "$NODE_BIN" tools/prepare-native-components.mjs \
    --source-root "${BELMONT_BROWSE_COMPONENT_SOURCE:-$PWD/vendor/aside-components-907}" \
    --profile-dir "$BELMONT_BROWSE_STATE_DIR/chrome-profile" \
    --version "${BELMONT_BROWSE_COMPONENT_VERSION:-1.26.907.1712}"
fi
# The binary must be the recorded build of the current source snapshot and the daemon bundle must be the pinned
# one; a source change after the last build refuses to launch the old binary (BELMONT_BROWSE_ALLOW_UNVERIFIED_NATIVE=1
# only downgrades that to a warning for deliberate experiments).
"$NODE_BIN" tools/native-build-identity.mjs verify --chrome "$BELMONT_BROWSE_CHROME" --engine "$BELMONT_BROWSE_ENGINE"
exec "$NODE_BIN" src/serve.mjs --port "${BELMONT_BROWSE_PORT:-9340}" --cdp-port "${BELMONT_BROWSE_CDP_PORT:-9333}" "$@"
