#!/usr/bin/env python3
import base64, json, os, sys, urllib.request
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
import websocket
HOST=os.environ.get("ASIDE_BROWSER_CDP_HOST","localhost:45103")
key=serialization.load_der_private_key(open(os.environ["ASIDE_INSTALLATION_KEY"],"rb").read(),password=None)
def http(path,method="GET",body=None,headers=None):
    req=urllib.request.Request(f"http://{HOST}{path}",method=method,data=json.dumps(body).encode() if body is not None else None,headers={"content-type":"application/json",**(headers or {})})
    with urllib.request.urlopen(req,timeout=10) as r: return json.loads(r.read())
ch=http("/json/challenge"); c=base64.b64decode(ch["challenge"]); r,s=decode_dss_signature(key.sign(c,ec.ECDSA(hashes.SHA256())))
sess=http("/json/auth/session","POST",{"challengeId":ch["challengeId"],"signedChallenge":base64.b64encode(r.to_bytes(32,"big")+s.to_bytes(32,"big")).decode()})
auth=f"{sess['token_type']} {sess['access_token']}"; ver=http("/json/version",headers={"Authorization":auth})
ws=websocket.create_connection(ver["webSocketDebuggerUrl"],timeout=20,suppress_origin=True,header=[f"Authorization: {auth}"])
ws.send(json.dumps({"id":1,"method":"Target.createTarget","params":{"url":sys.argv[1]}}))
while True:
    m=json.loads(ws.recv())
    if m.get("id")==1: print(json.dumps(m)[:200]); break
ws.close()
