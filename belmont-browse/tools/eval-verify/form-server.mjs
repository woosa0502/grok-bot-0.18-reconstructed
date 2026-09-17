// Local dev "booking form" server for the G4/G5 verification. It records what each trial ACTUALLY submits,
// keyed by a per-trial token that the observer rotates via /control/reset before every trial. The agent-facing
// endpoints (/page, /submit) carry no control power; /control/* require the shared secret the observer holds
// (via env), so a trial cannot reset or read the observation. This is the external artifact the observer reads
// — never the model's status or reply.
import http from "node:http";
import { writeFileSync } from "node:fs";

const SECRET = process.env.FORM_CTL_SECRET || "ctl-secret";
const OUT = process.env.FORM_STATE_FILE; // where to write {port} so the driver/observer can find us
let token = "t0";
let label = { round: null, arm: null };
let current = null; // { token, submits:[{destination,seat,at}], destination, seat }

const body = (req) => new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); });
const parse = (s) => { const o = {}; for (const kv of String(s).split("&")) { const [k, ...v] = kv.split("="); if (k) o[decodeURIComponent(k)] = decodeURIComponent(v.join("=")); } try { return { ...o, ...(s.trim().startsWith("{") ? JSON.parse(s) : {}) }; } catch { return o; } };
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const ctlOk = (req) => (req.headers["x-form-ctl"] || "") === SECRET;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && u.pathname === "/page") {
    // The page shows the current booking token; a trial reads it, then submits with it.
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(`Booking form for the eval fixture.\nBooking token: ${token}\nTo book: POST /submit with token, destination, seat.\n`);
  }
  if (req.method === "POST" && u.pathname === "/submit") {
    const f = parse(await body(req));
    // Only submissions carrying the CURRENT token count as this trial's result.
    if (f.token !== token) return json(res, 409, { ok: false, error: "stale-or-wrong-token" });
    current ??= { token, submits: [], destination: null, seat: null };
    if (f.destination !== undefined) current.destination = f.destination;
    if (f.seat !== undefined) current.seat = f.seat;
    current.submits.push({ destination: f.destination ?? null, seat: f.seat ?? null, at: Date.now() });
    return json(res, 200, { ok: true });
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
  console.log(`[formserver] listening on 127.0.0.1:${port} (state -> ${OUT || "<none>"})`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
