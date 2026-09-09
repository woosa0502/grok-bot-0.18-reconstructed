#!/usr/bin/env python3
"""Authenticates like the daemon, attaches a DevTools session to the first
"Agent Tabs" tab (example.org), activates it, then waits so a screenshot can be
taken; on SIGTERM/timeout it detaches. Usage: agent-attach.py <seconds>"""
import base64, json, os, sys, time, urllib.request
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
auth=f"{sess['token_type']} {sess['access_token']}"
ver=http("/json/version",headers={"Authorization":auth})
ws=websocket.create_connection(ver["webSocketDebuggerUrl"],timeout=20,suppress_origin=True,header=[f"Authorization: {auth}"])
_id=[0]
def send(method,params=None,sessionId=None):
    _id[0]+=1; m={"id":_id[0],"method":method,"params":params or {}}
    if sessionId: m["sessionId"]=sessionId
    ws.send(json.dumps(m))
    while True:
        msg=json.loads(ws.recv())
        if msg.get("id")==_id[0]: return msg
targets=send("Target.getTargets")["result"]["targetInfos"]
agent=[t for t in targets if t["type"]=="page" and "example.org" in t["url"]]
print("agent targets:",[t["url"] for t in agent]); sys.stdout.flush()
if not agent: sys.exit(2)
tid=agent[0]["targetId"]
att=send("Target.attachToTarget",{"targetId":tid,"flatten":True}); sid=att["result"]["sessionId"]
send("Target.activateTarget",{"targetId":tid})
meta=send("Browser.setAiTabsMetadata",{"targetId":tid,"badgeLabel":"2","initialOrigin":"https://example.org"})
print("setAiTabsMetadata:",json.dumps(meta)[:200]); sys.stdout.flush()
print("ATTACHED"); sys.stdout.flush()
deadline=time.time()+float(sys.argv[1] if len(sys.argv)>1 else 30)
ws.settimeout(1)
while time.time()<deadline:
    try:
        msg=json.loads(ws.recv())
        if msg.get("method")=="Target.detachedFromTarget": print("DETACHED by browser:",msg); sys.stdout.flush(); break
    except websocket.WebSocketTimeoutException: pass
ws.close()
