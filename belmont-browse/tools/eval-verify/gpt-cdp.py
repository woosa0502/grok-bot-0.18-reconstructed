#!/usr/bin/env python3
# Minimal, careful CDP driver for the SINGLE existing ChatGPT tab (user's hard rule: ONE tab, continue the
# existing conversation, never re-send while a generation is in progress). No new tabs are ever opened.
#   state             -> print {generating, assistantCount, lastTailLen, lastTail}
#   read              -> print the full last assistant message
#   inject <file>     -> ONLY if not generating: type the file's text into #prompt-textarea and click send
import sys, json, time, websocket, urllib.request

CDP = "http://127.0.0.1:9401"
def tab():
    tabs = json.load(urllib.request.urlopen(f"{CDP}/json", timeout=6))
    pages = [t for t in tabs if t.get("type") == "page" and ("chatgpt" in t.get("url","") or "openai" in t.get("url",""))]
    if not pages: raise SystemExit("no ChatGPT tab")
    if len(pages) > 1: raise SystemExit(f"REFUSING: {len(pages)} ChatGPT tabs open (expected 1)")
    return pages[0]

def ev(ws, expr, mid):
    ws.send(json.dumps({"id": mid, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid:
            if "error" in m: raise SystemExit(f"CDP error: {m['error']}")
            res = m["result"].get("result", {})
            if res.get("subtype") == "error": raise SystemExit(f"JS error: {res.get('description','')[:200]}")
            return res.get("value")

STATE_JS = r"""(() => {
  const nodes = [...document.querySelectorAll('[data-message-author-role=assistant]')];
  const last = nodes[nodes.length-1];
  const txt = last ? last.innerText : '';
  const stop = document.querySelector('button[data-testid=stop-button]') || document.querySelector('button[aria-label*="Stop"]');
  return JSON.stringify({ generating: !!stop, assistantCount: nodes.length, lastTailLen: txt.length, lastTail: txt.slice(-1200) });
})()"""

READ_JS = r"""(() => {
  const nodes = [...document.querySelectorAll('[data-message-author-role=assistant]')];
  const last = nodes[nodes.length-1];
  return last ? last.innerText : '';
})()"""

def inject_js(text):
    j = json.dumps(text)
    return r"""(() => {
      const stop = document.querySelector('button[data-testid=stop-button]') || document.querySelector('button[aria-label*="Stop"]');
      if (stop) return 'REFUSED_GENERATING';
      const pm = document.querySelector('#prompt-textarea');
      if (!pm) return 'NO_INPUT';
      pm.focus();
      // clear then insert via execCommand so ProseMirror registers the input
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, %s);
      return 'TYPED:' + (pm.innerText||'').length;
    })()""" % j

def send_js():
    return r"""(() => {
      const btn = document.querySelector('button[data-testid=send-button]');
      if (!btn) return 'NO_SEND_BTN';
      if (btn.disabled) return 'SEND_DISABLED';
      btn.click();
      return 'SENT';
    })()"""

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "state"
    t = tab()
    ws = websocket.create_connection(t["webSocketDebuggerUrl"], max_size=None, timeout=15)
    mid = [0]
    def nx(): mid[0]+=1; return mid[0]
    try:
        ev(ws, "1", nx())  # warm up
        if cmd == "state":
            print(ev(ws, STATE_JS, nx()))
        elif cmd == "read":
            print(ev(ws, READ_JS, nx()))
        elif cmd == "inject":
            text = open(sys.argv[2], encoding="utf-8").read()
            st = json.loads(ev(ws, STATE_JS, nx()))
            if st["generating"]:
                print("REFUSED: generation in progress — not sending."); return
            r1 = ev(ws, inject_js(text), nx())
            print("inject:", r1)
            if not str(r1).startswith("TYPED:"):
                print("inject failed, not sending."); return
            time.sleep(0.6)
            r2 = ev(ws, send_js(), nx())
            print("send:", r2)
        else:
            print("unknown cmd", cmd)
    finally:
        ws.close()

main()
