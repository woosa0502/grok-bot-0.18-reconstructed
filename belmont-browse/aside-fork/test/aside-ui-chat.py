#!/usr/bin/env python3
"""Creates a chat the way the Aside UI does (daemon tRPC sessions.createAndPrompt), authenticating as clientKind=cli
with the installation key, so the bot mirror can be tested with an Aside-originated session."""
import base64, json, os, sys, urllib.request, urllib.error
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
DAEMON=os.environ.get("ASIDE_DAEMON","http://127.0.0.1:21420")
key=serialization.load_der_private_key(open(os.environ["ASIDE_INSTALLATION_KEY"],"rb").read(),password=None)
def http(path,method="GET",body=None,headers=None):
    req=urllib.request.Request(f"{DAEMON}{path}",method=method,data=json.dumps(body).encode() if body is not None else None,headers={"content-type":"application/json",**(headers or {})})
    try:
        with urllib.request.urlopen(req,timeout=20) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
st,ch=http("/auth/daemon/challenge?clientKind=cli"); assert st==200, (st,ch)
sig=key.sign(b"Aside Daemon Auth v1\0"+base64.b64decode(ch["challenge"]), ec.ECDSA(hashes.SHA256()))
st,sess=http("/auth/daemon/session","POST",{"challengeId":ch["challengeId"],"signedChallenge":base64.b64encode(sig).decode()}); assert st==200, (st,sess)
auth={"Authorization":f"{sess['token_type']} {sess['access_token']}"}
text=sys.argv[1] if len(sys.argv)>1 else "Hello from the Aside UI"
msg={"role":"user","content":[{"type":"text","text":text}],"timestamp":int(__import__('time').time()*1000)}
for body in ({"json":{"accountId":0,"title":text[:40],"message":msg}},{"accountId":0,"title":text[:40],"message":msg}):
    st,res=http("/trpc/sessions.createAndPrompt","POST",body,auth)
    print("createAndPrompt",st,str(res)[:300])
    if st==200: break
