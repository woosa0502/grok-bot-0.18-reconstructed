import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const PORT = process.argv[2], SECS = Number(process.argv[3] || 15), FILTER = process.argv[4] || "";
const res = await fetch(`http://127.0.0.1:${PORT}/json`);
const targets = await res.json();
const sw = targets.find(t => t.type === "service_worker" && (!FILTER || (t.url||"").includes(FILTER)));
if (!sw) { console.log("NO_SW_TARGET"); process.exit(0); }
console.log("SW:", sw.url);
const ws = new WebSocket(sw.webSocketDebuggerUrl);
let id = 1;
const send = (method, params) => ws.send(JSON.stringify({ id: id++, method, params }));
ws.on("open", () => { send("Runtime.enable"); send("Log.enable"); send("Runtime.setAsyncCallStackDepth", { maxDepth: 4 }); });
ws.on("message", (data) => {
  const m = JSON.parse(data);
  if (m.method === "Runtime.consoleAPICalled") {
    const args = (m.params.args || []).map(a => a.value ?? a.description ?? a.unserializableValue ?? JSON.stringify(a.preview?.properties?.map(p=>p.name+':'+p.value)||"")).join(" ");
    console.log(`[console.${m.params.type}] ${args}`.slice(0, 300));
  } else if (m.method === "Log.entryAdded") {
    console.log(`[log.${m.params.entry.level}] ${m.params.entry.text}`.slice(0, 300));
  } else if (m.method === "Runtime.exceptionThrown") {
    const e = m.params.exceptionDetails;
    console.log(`[EXCEPTION] ${e.exception?.description || e.text}`.slice(0, 300));
  }
});
ws.on("error", e => console.log("WS_ERR", String(e)));
setTimeout(() => { console.log("--- capture end ---"); process.exit(0); }, SECS * 1000);
