#!/bin/bash
# Restarts the group-G4 browser once per installation metadata document and
# checks that the handshake only accepts the scheme/key storage this platform
# can honour. pq_v1 is the macOS 26 ML-DSA scheme and must be refused here.
set -u
UD=/tmp/aside-ui-G4
KEY=$UD/AsideInstallationKey
CHROME=/home/hoon/chromium/src/out/aside/chrome
# The secure server binds whichever loopback family is available, so the
# readiness probe and every request have to accept either.
BASE=""
probe() {
  for b in http://127.0.0.1:45103 "http://[::1]:45103"; do
    if curl -sS --max-time 2 "$b/json/challenge" >/dev/null 2>&1; then BASE="$b"; return 0; fi
  done
  return 1
}
start() {
  setsid nohup env DISPLAY=:114 "$CHROME" --no-sandbox --no-first-run \
    --user-data-dir=$UD --window-size=1280,800 about:blank \
    > /tmp/aside-chrome-G4-secure.log 2>&1 < /dev/null &
  for i in $(seq 1 40); do
    probe && return 0
    sleep 2
  done
  return 1
}
stop() {
  for p in $(pgrep -f "^$CHROME --no-sandbox --no-first-run --user-data-dir=$UD"); do kill "$p" 2>/dev/null; done
  for i in $(seq 1 30); do
    pgrep -f "^$CHROME --no-sandbox --no-first-run --user-data-dir=$UD" >/dev/null || break
    sleep 1
  done
  for p in $(pgrep -f "^$CHROME --no-sandbox --no-first-run --user-data-dir=$UD"); do kill -9 "$p" 2>/dev/null; done
  sleep 2
}
attempt() {  # prints the HTTP status of a correctly signed session request
  python3 - "$KEY" "$BASE" <<'PY'
import base64, json, subprocess, sys, tempfile, os, urllib.request, urllib.error
key, base = sys.argv[1], sys.argv[2]
with urllib.request.urlopen(base + "/json/challenge", timeout=10) as f:
    ch = json.loads(f.read())
with tempfile.NamedTemporaryFile(delete=False) as f:
    f.write(base64.b64decode(ch["challenge"])); m = f.name
sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key, "-keyform", "DER", m],
                     capture_output=True).stdout
os.unlink(m)
body = json.dumps({"challengeId": ch["challengeId"],
                   "signedChallenge": base64.b64encode(sig).decode()}).encode()
r = urllib.request.Request(base + "/json/auth/session", data=body,
                           headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(r, timeout=10) as f:
        print(f.status)
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode().strip())
PY
}
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (want '$2', got '$3')"; fail=$((fail+1)); fi
}
stop
for case in "absent::200" \
            '{"version":1,"scheme":"p256_v1","key_storage":"file"}::200' \
            '{"version":1,"scheme":"pq_v1","key_storage":"keychain"}::403 Invalid or expired challenge.' \
            '{"version":1,"scheme":"ed25519_v9","key_storage":"file"}::403 Invalid or expired challenge.' \
            '{"version":1,"scheme":"p256_v1","key_storage":"keychain"}::403 Invalid or expired challenge.' \
            '{"version":1,"key_storage":"file"}::403 Invalid or expired challenge.' \
            'not json::403 Invalid or expired challenge.'; do
  meta="${case%%::*}"; want="${case##*::}"
  if [ "$meta" = "absent" ]; then rm -f "$KEY.meta"; else printf '%s' "$meta" > "$KEY.meta"; fi
  start || { echo "FAIL could not start browser for $meta"; fail=$((fail+1)); continue; }
  got="$(attempt)"
  check "metadata $meta" "$want" "$got"
  stop
done
rm -f "$KEY.meta"
echo "metadata cases: $fail failure(s)"
exit $((fail ? 1 : 0))
