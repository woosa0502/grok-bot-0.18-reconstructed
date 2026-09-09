#!/usr/bin/env python3
"""G5 verification replay server.

Stands in for BOTH Aside network peers so the fork can be exercised end to end
without touching Aside's servers or the live daemon:

  * the Aside Omaha endpoint  (component update check + real signed CRX3)
  * the local Aside daemon    (/health, /shutdown, /auth/daemon/*, /auth/*)

Every request is appended to requests.log with its full body.
"""
import base64, json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("G5_PORT", "18790"))
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = "/home/hoon/work/Belmont/data/artifacts/aside_latest_engine_20260906/raw"
AGENT_CRX = os.path.join(RAW, "AsideAgentManager-1.26.905.904.crx")
DAEMON_CRX = os.path.join(RAW, "AsideDaemon-mac-x64-1.26.905.904.crx")
AGENT_SHA = "168bba4498b0a797409ad7d4f80a7f4bfd8790a3486653c5c59fa4a4b81c53c8"
DAEMON_SHA = "e6579c81381ee8b240cbb1774a8107c8053e6e93fce9243ed4b8b099f0718f39"
AGENT_ID = "fjdhphbdlfjogobdofoaagnlnkoibdge"
DAEMON_ID = "kbbaihbiiohdfpocgkpkmngpjcpddbhh"
VERSION = "1.26.905.904"
LOG = os.path.join(HERE, "requests.log")

# Which app ids we are willing to offer an update for this run.
OFFER = set(os.environ.get("G5_OFFER", AGENT_ID).split(","))
# Make /auth/access-token answer 401 (revoked session) when set.
REVOKED = os.environ.get("G5_REVOKED", "") == "1"

def log(*a):
    line = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a):
        pass

    def _send(self, code, body: bytes, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode())

    def do_GET(self):
        p = urlparse(self.path)
        q = parse_qs(p.query)
        auth = self.headers.get("Authorization")
        log("GET", self.path, "auth=" + (auth or "<none>"))
        if p.path == "/health":
            return self._json({"status": "ok", "version": VERSION})
        if p.path == "/auth/daemon/challenge":
            # RE: GET %s/auth/daemon/challenge?clientKind=chromium
            log("  clientKind=", q.get("clientKind"))
            return self._json({"challengeId": "g5-challenge-1",
                               "challenge": base64.b64encode(b"G5-REPLAY-CHALLENGE").decode()})
        if p.path == "/auth/access-token":
            # RE: %s/auth/access-token?accountId=%d[&forceRefresh=1]
            if REVOKED:
                return self._json({"error": "session revoked", "code": "TOKEN_REVOKED"}, 401)
            if not auth or not auth.startswith("AsideDaemonSessionToken "):
                return self._json({"error": "unauthorized"}, 401)
            acct = int(q.get("accountId", ["-1"])[0])
            return self._json({"accountId": acct,
                               "accessToken": "g5-sync-access-token",
                               "expiresAt": time.strftime(
                                   "%Y-%m-%dT%H:%M:%SZ",
                                   time.gmtime(time.time() + 3600))})
        if p.path == "/auth/sync-passphrase":
            if not auth or not auth.startswith("AsideDaemonSessionToken "):
                return self._json({"error": "unauthorized"}, 401)
            acct = int(q.get("accountId", ["-1"])[0])
            return self._json({"accountId": acct, "passphrase": "g5-replay-passphrase"})
        if p.path.endswith(".crx"):
            path = DAEMON_CRX if "AsideDaemon" in p.path else AGENT_CRX
            with open(path, "rb") as f:
                data = f.read()
            log("  serving", os.path.basename(path), len(data), "bytes")
            return self._send(200, data, "application/octet-stream")
        return self._send(404, b"{}")

    def do_POST(self):
        p = urlparse(self.path)
        n = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(n).decode("utf8", "replace") if n else ""
        auth = self.headers.get("Authorization")
        log("POST", self.path, "auth=" + (auth or "<none>"))
        log("  body:", raw[:4000])
        if p.path == "/auth/daemon/session":
            return self._json({"access_token": "g5-daemon-session-token",
                               "token_type": "AsideDaemonSessionToken",
                               "expiresInSeconds": 600})
        if p.path == "/shutdown":
            return self._json({"ok": True})
        if p.path.startswith("/omaha"):
            try:
                req = json.loads(raw)["request"]
                apps = req.get("apps") or req.get("app") or []
            except Exception:
                apps = []
            out = []
            for app in apps:
                appid = app.get("appid")
                if appid in OFFER:
                    crx = ("AsideDaemon-%s.crx" % VERSION) if appid == DAEMON_ID \
                          else ("AsideAgentManager-%s.crx" % VERSION)
                    sha = DAEMON_SHA if appid == DAEMON_ID else AGENT_SHA
                    size = os.path.getsize(DAEMON_CRX if appid == DAEMON_ID else AGENT_CRX)
                    out.append({"appid": appid, "status": "ok", "updatecheck": {
                        "status": "ok", "nextversion": VERSION,
                        "pipelines": [{"pipeline_id": "full-" + VERSION, "operations": [
                            {"type": "download",
                             "urls": [{"url": "http://127.0.0.1:%d/%s" % (PORT, crx)}],
                             "out": {"sha256": sha}, "size": size},
                            {"type": "crx3", "path": ".", "arguments": "",
                             "in": {"sha256": sha}}]}]}})
                else:
                    out.append({"appid": appid, "status": "ok",
                                "updatecheck": {"status": "noupdate"}})
            body = b")]}'\n" + json.dumps({"response": {
                "protocol": "4.0", "server": "aside-edge-replay",
                "daystart": {"elapsed_days": 7187}, "apps": out}}).encode()
            return self._send(200, body)
        return self._send(404, b"{}")

if __name__ == "__main__":
    open(LOG, "w").close()
    log("replay listening on 127.0.0.1:%d  offer=%s revoked=%s" % (PORT, sorted(OFFER), REVOKED))
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
