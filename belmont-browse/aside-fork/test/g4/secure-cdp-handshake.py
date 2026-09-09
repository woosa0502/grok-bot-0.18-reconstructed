#!/usr/bin/env python3
"""Drives the Aside secure remote debugging handshake against a browser that
started the always-on loopback DevTools server (features::kSecureRemoteDebugging,
port 45103).  Checks, in order:

  1. an unauthenticated /json/version is refused with the original's wording
  2. the discovery page is refused as well
  3. GET  /json/challenge hands out a scheme + challenge
  4. a signature made with the wrong key is rejected
  5. POST /json/auth/session with the installation key returns a session token
  6. the same token authorises /json/version and /json/list
  7. a replayed challenge id is refused (single use)

Usage: secure-cdp-handshake.py <pkcs8-key.der> <port>
(the key is the PKCS#8 DER file the browser reads as the installation key:
 openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 |
 openssl pkcs8 -topk8 -nocrypt -outform DER -out AsideInstallationKey)
"""
import base64, json, subprocess, sys, tempfile, urllib.request, urllib.error, os

KEY, PORT = sys.argv[1], int(sys.argv[2])


def pick_base(port):
    # The secure server binds whichever loopback family is free.
    for base in (f"http://127.0.0.1:{port}", f"http://[::1]:{port}"):
        try:
            urllib.request.urlopen(base + "/json/challenge", timeout=3).read()
            return base
        except urllib.error.HTTPError:
            return base
        except OSError:
            continue
    return f"http://127.0.0.1:{port}"


BASE = pick_base(PORT)
results = []


def req(path, data=None, headers=None, method=None):
    r = urllib.request.Request(BASE + path, data=data, headers=headers or {},
                               method=method)
    try:
        with urllib.request.urlopen(r, timeout=10) as f:
            return f.status, f.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def sign(key_path, blob):
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(blob)
        msg = f.name
    out = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_path,
                          "-keyform", "DER", msg],
                         capture_output=True, check=True).stdout
    os.unlink(msg)
    return out


def check(name, ok, detail=""):
    results.append({"check": name, "pass": bool(ok), "detail": str(detail)[:300]})


status, body = req("/json/version")
check("unauthenticated /json/version is 401", status == 401, f"{status} {body.strip()}")
check("401 body is the original's wording",
      body.strip() == "Missing or invalid Authorization header.", body.strip())

status, body = req("/")
check("discovery page is 401 too", status == 401, f"{status} {body.strip()}")

status, body = req("/json/challenge")
check("/json/challenge is 200", status == 200, f"{status} {body[:120]}")
ch = json.loads(body)
check("challenge scheme is AsideSecureToken", ch.get("scheme") == "AsideSecureToken", ch.get("scheme"))
check("challenge names the Authorization header", ch.get("headerName") == "Authorization", ch.get("headerName"))
check("challenge is 32 random bytes", len(base64.b64decode(ch["challenge"])) == 32,
      len(base64.b64decode(ch["challenge"])))
check("challenge expires in 30 s", ch.get("expiresInSeconds") == 30, ch.get("expiresInSeconds"))

# 4. wrong key
with tempfile.NamedTemporaryFile(suffix=".der", delete=False) as f:
    other = f.name
subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt",
                "ec_paramgen_curve:P-256", "-outform", "DER", "-out", other],
               check=True, capture_output=True)
bad = base64.b64encode(sign(other, base64.b64decode(ch["challenge"]))).decode()
status, body = req("/json/auth/session",
                   data=json.dumps({"challengeId": ch["challengeId"],
                                    "signedChallenge": bad}).encode(),
                   headers={"Content-Type": "application/json"}, method="POST")
check("a foreign key is refused with 403", status == 403, f"{status} {body.strip()}")
os.unlink(other)

# the refused attempt consumed the challenge; take a fresh one
ch = json.loads(req("/json/challenge")[1])
sig = base64.b64encode(sign(KEY, base64.b64decode(ch["challenge"]))).decode()
status, body = req("/json/auth/session",
                   data=json.dumps({"challengeId": ch["challengeId"],
                                    "signedChallenge": sig}).encode(),
                   headers={"Content-Type": "application/json"}, method="POST")
check("the installation key gets a session", status == 200, f"{status} {body[:200]}")
tok = json.loads(body)
check("token type is AsideSessionToken", tok.get("token_type") == "AsideSessionToken", tok.get("token_type"))
check("session lasts 300 s", tok.get("expiresInSeconds") == 300, tok.get("expiresInSeconds"))

auth = {"Authorization": "AsideSessionToken " + tok["access_token"]}
status, body = req("/json/version", headers=auth)
check("the token authorises /json/version", status == 200 and "Browser" in body, f"{status} {body[:160]}")
version = json.loads(body) if status == 200 else {}
status, body = req("/json/list", headers=auth)
check("the token authorises /json/list", status == 200, f"{status} {body[:120]}")

status, body = req("/json/version", headers={"Authorization": "AsideSessionToken bogus"})
check("a bogus token is still 401", status == 401, f"{status} {body.strip()}")

# 7. replay
status, body = req("/json/auth/session",
                   data=json.dumps({"challengeId": ch["challengeId"],
                                    "signedChallenge": sig}).encode(),
                   headers={"Content-Type": "application/json"}, method="POST")
check("a replayed challenge id is refused", status == 403, f"{status} {body.strip()}")

status, body = req("/json/auth/session", headers=auth)
check("GET on /json/auth/session is refused", status == 405, f"{status} {body.strip()[:120]}")

print(json.dumps({"browser": version.get("Browser"), "results": results}, indent=1))
ok = sum(1 for r in results if r["pass"])
print(f"{ok}/{len(results)} passed", file=sys.stderr)
for r in results:
    if not r["pass"]:
        print("FAIL " + r["check"] + " -- " + r["detail"], file=sys.stderr)
sys.exit(0 if ok == len(results) else 1)
