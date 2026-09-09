#!/usr/bin/env python3
"""AI-delivery notification test against the fork launched by belmont-browse (CDP port 9333):
1. ask the real Aside extension (its service worker) to call chrome.asideNotification.requestPermission(tab)
   for an example.com tab -> content setting ALLOW + ai_delivery_mode_by_origin[origin]=1
2. fire `new Notification()` in that tab -> the fork must NOT show it; it stores <profile>/Default/AsideInbox/*.json
   and hands the payload to the extension (aside.inboxNotification)."""
import json, sys, time, urllib.request, glob, os
import websocket
CDP=os.environ.get("CDP","http://127.0.0.1:9333")
PROFILE=os.environ.get("PROFILE_DIR","/home/hoon/_roots/labs/work/Belmont/belmont-browse/.state/chrome-profile")
def targets(): return json.load(urllib.request.urlopen(f"{CDP}/json/list", timeout=10))
def connect(ws_url): return websocket.create_connection(ws_url, timeout=30, suppress_origin=True)
def call(ws, method, params=None, _id=[0]):
    _id[0]+=1; ws.send(json.dumps({"id":_id[0],"method":method,"params":params or {}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==_id[0]: return m
# open an example.com tab
b=connect(json.load(urllib.request.urlopen(f"{CDP}/json/version"))["webSocketDebuggerUrl"])
tid=call(b,"Target.createTarget",{"url":"https://example.com/?inbox=1"})["result"]["targetId"]; time.sleep(4)
sw=next((t for t in targets() if t["type"]=="service_worker" and "fjdhphbdlfjogobdofoaagnlnkoibdge" in t["url"]),None)
if not sw: print("NO extension service worker target"); sys.exit(2)
s=connect(sw["webSocketDebuggerUrl"])
r=call(s,"Runtime.evaluate",{"expression":"(async()=>{const ts=await chrome.tabs.query({url:'https://example.com/*'}); const t=ts[ts.length-1]; const ok=await chrome.asideNotification.requestPermission(t.id); return JSON.stringify({tab:t.id,ok});})()","awaitPromise":True,"returnByValue":True})
print("requestPermission via extension:", json.dumps(r.get("result",{}).get("result",{}).get("value") or r)[:200])
page=next(t for t in targets() if t.get("id")==tid or t.get("url","").startswith("https://example.com/?inbox"))
p=connect(page["webSocketDebuggerUrl"])
before=set(glob.glob(f"{PROFILE}/Default/AsideInbox/*.json"))
r=call(p,"Runtime.evaluate",{"expression":"(async()=>{const perm=Notification.permission; const n=new Notification('Inbox test title',{body:'inbox test body '+Date.now(),tag:'t1'}); await new Promise(r=>setTimeout(r,1500)); return JSON.stringify({perm, shown:!!n});})()","awaitPromise":True,"returnByValue":True})
print("page Notification():", json.dumps(r.get("result",{}).get("result",{}).get("value") or r)[:200])
time.sleep(3)
after=set(glob.glob(f"{PROFILE}/Default/AsideInbox/*.json"))-before
print("new inbox entries:", len(after))
for f in sorted(after): print(open(f).read()[:400])
