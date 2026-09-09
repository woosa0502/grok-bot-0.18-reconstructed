#!/usr/bin/env python3
"""Exercises the fork's secure remote debugging handshake the way the Aside
daemon does (AsideSecureCdpAuthorizer): GET /json/challenge -> sign the 32-byte
challenge with the installation P-256 key (raw r||s, like the native helper) ->
POST /json/auth/session -> Authorization: AsideSessionToken <token> on
/json/version and the browser WebSocket -> Browser.ensureProfile /
Browser.setAiTabsMetadata."""
import base64, json, os, sys, urllib.request, urllib.error
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
import websocket

HOST = os.environ.get("ASIDE_BROWSER_CDP_HOST", "localhost:45103")
KEY = os.environ["ASIDE_INSTALLATION_KEY"]
key = serialization.load_der_private_key(open(KEY, "rb").read(), password=None)

def http(path, method="GET", body=None, headers=None):
    req = urllib.request.Request(f"http://{HOST}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")

results = []
def check(name, ok, detail=""):
    results.append((name, ok)); print(("PASS" if ok else "FAIL"), name, detail)

st, body = http("/json/version")
check("unauthenticated /json/version rejected (401)", st == 401, f"status={st} body={body!r}")
st, ch = http("/json/challenge")
check("challenge issued", st == 200 and isinstance(ch, dict) and len(base64.b64decode(ch.get("challenge",""))) == 32, f"status={st} body={ch!r}")
challenge = base64.b64decode(ch["challenge"])
der = key.sign(challenge, ec.ECDSA(hashes.SHA256()))
r, s = decode_dss_signature(der)
raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
st, bad = http("/json/auth/session", "POST", {"challengeId": ch["challengeId"], "signedChallenge": base64.b64encode(b"\0"*64).decode()})
check("bad signature rejected", st == 403, f"status={st} body={bad!r}")
st, ch = http("/json/challenge")
challenge = base64.b64decode(ch["challenge"]); der = key.sign(challenge, ec.ECDSA(hashes.SHA256())); r, s = decode_dss_signature(der)
raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
st, sess = http("/json/auth/session", "POST", {"challengeId": ch["challengeId"], "signedChallenge": base64.b64encode(raw).decode()})
check("session token issued", st == 200 and isinstance(sess, dict) and sess.get("token_type") == "AsideSessionToken" and sess.get("expiresInSeconds") == 300, f"status={st} body={sess!r}")
auth = f"{sess['token_type']} {sess['access_token']}"
st, ver = http("/json/version", headers={"Authorization": auth})
check("authenticated /json/version", st == 200 and "webSocketDebuggerUrl" in ver, f"status={st} body={str(ver)[:120]}")
st, replay = http("/json/auth/session", "POST", {"challengeId": ch["challengeId"], "signedChallenge": base64.b64encode(raw).decode()})
check("challenge is single-use", st == 403, f"status={st}")

ws_url = ver["webSocketDebuggerUrl"]
try:
    websocket.create_connection(ws_url, timeout=5, suppress_origin=True).close(); check("ws without token rejected", False, "connected")
except Exception as e:
    check("ws without token rejected", True, type(e).__name__)
ws = websocket.create_connection(ws_url, timeout=15, suppress_origin=True, header=[f"Authorization: {auth}"])
def send(method, params=None, _id=[0]):
    _id[0] += 1; ws.send(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == _id[0]: return m
v = send("Browser.getVersion"); check("ws Browser.getVersion", "result" in v, str(v)[:100])
ep = send("Browser.ensureProfile", {"profileIndex": 0, "url": "https://example.com/ensure", "shouldFocus": True})
check("Browser.ensureProfile", "result" in ep and isinstance(ep["result"].get("windowId"), int), str(ep)[:160])
neg = send("Browser.ensureProfile", {"profileIndex": 7}); check("ensureProfile bad index -> 'Profile 7 does not exist'", "Profile 7 does not exist" in json.dumps(neg), str(neg)[:160])
neg2 = send("Browser.ensureProfile", {"profileIndex": -1}); check("ensureProfile negative -> non-negative error", "non-negative" in json.dumps(neg2), str(neg2)[:120])
targets = send("Target.getTargets")["result"]["targetInfos"]; page = next((t for t in targets if t["type"]=="page" and "example.com" in t["url"]), next(t for t in targets if t["type"]=="page"))
meta = send("Browser.setAiTabsMetadata", {"targetId": page["targetId"], "badgeLabel": "2", "initialOrigin": "https://example.com"})
check("setAiTabsMetadata on ungrouped tab -> 'Target is not in a tab group'", "Target is not in a tab group" in json.dumps(meta), str(meta)[:160])
ws.close()
print("SUMMARY", sum(1 for _,ok in results if ok), "/", len(results))
sys.exit(0 if all(ok for _,ok in results) else 1)
