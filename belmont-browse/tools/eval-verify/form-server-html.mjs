// HTML-form variant of the eval form server for L13.BROWSER (the real browser fill/submit boundary).
// GET / serves a fillable HTML form whose hidden token = the current (observer-minted) token; POST /submit
// records what was actually submitted, keyed by that token. Control endpoints require the shared secret.
import http from "node:http";
import { writeFileSync } from "node:fs";

const SECRET = process.env.FORM_CTL_SECRET || "ctl-secret";
const OUT = process.env.FORM_STATE_FILE;
let token = "t0";
let label = { round: null, arm: null };
let current = null;

const body = (req) => new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); });
const parse = (s) => { const o = {}; for (const kv of String(s).split("&")) { const [k, ...v] = kv.split("="); if (k) o[decodeURIComponent(k)] = decodeURIComponent(v.join("=").replace(/\+/g, " ")); } return o; };
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const ctlOk = (req) => (req.headers["x-form-ctl"] || "") === SECRET;

const page = () => `<!doctype html><html><head><meta charset=utf-8><title>Booking</title></head><body>
<h1>Flight booking</h1>
<form id="booking" action="/submit" method="POST">
  <input type="hidden" name="token" value="${token}">
  <label>Destination <input id="destination" name="destination" type="text" value=""></label><br>
  <label>Seat <input id="seat" name="seat" type="text" value=""></label><br>
  <button id="submit" type="submit">Submit booking</button>
</form>
<p id="status">not submitted</p>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/page")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page());
  }
  if (req.method === "POST" && u.pathname === "/submit") {
    const f = parse(await body(req));
    if (f.token !== token) { res.writeHead(409, { "content-type": "text/html" }); return res.end("<p id=status>stale-or-wrong-token</p>"); }
    current ??= { token, submits: [], destination: null, seat: null };
    if (f.destination !== undefined) current.destination = f.destination;
    if (f.seat !== undefined) current.seat = f.seat;
    current.submits.push({ destination: f.destination ?? null, seat: f.seat ?? null, at: Date.now() });
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<p id=status>submitted destination=${f.destination ?? ""} seat=${f.seat ?? ""}</p>`);
  }
  if (req.method === "POST" && u.pathname === "/control/reset") {
    if (!ctlOk(req)) return json(res, 403, { ok: false });
    const f = parse(await body(req));
    token = "tok-" + Math.random().toString(16).slice(2, 12);
    label = { round: f.round ?? null, arm: f.arm ?? null };
    current = null;
    return json(res, 200, { ok: true, token, label });
  }
  if (req.method === "GET" && u.pathname === "/control/observation") {
    if (!ctlOk(req)) return json(res, 403, { ok: false });
    return json(res, 200, { token, label, current });
  }
  json(res, 404, { ok: false });
});
server.listen(Number(process.env.FORM_PORT || 0), "127.0.0.1", () => {
  const port = server.address().port;
  if (OUT) writeFileSync(OUT, JSON.stringify({ port, pid: process.pid }));
  console.log(`[formserver-html] listening on 127.0.0.1:${port} (state -> ${OUT || "<none>"})`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
