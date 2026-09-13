// LIVE test — L02 browser tool matrix (navigate / read / fill / click) end-to-end against a REAL page.
// A local HTTP server serves a form page whose heading carries a unique nonce; its /submit endpoint CAPTURES the
// submitted field value. A guard-mode browse session (autoApprove:true) is told to navigate to the page, READ
// the heading, FILL the text box with a distinct nonce, and CLICK Submit. Proof:
//   - navigate+read : the HEADING nonce appears in the session (the agent read the page).
//   - navigate+fill+click : the local server RECEIVES the FILL nonce (only reachable by actually submitting the
//     form in the real browser) — an external observable, not the agent's self-report.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const REPO = process.env.BELMONT_REPO || "/home/hoon/_roots/labs/work/Belmont";
const serve = JSON.parse(fs.readFileSync(path.join(REPO, "belmont-browse/.state/serve.json"), "utf8"));
const PORT = serve.port, TOKEN = serve.token;
const OUT = process.argv[2] || path.join(REPO, "belmont-browse/tools/eval-verify/evidence/r11/ev-l02-browser-matrix.json");
const n = Math.random().toString(16).slice(2, 8);
const HEAD = `L02HEAD${n}`, FILL = `L02FILL${n}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, p, body) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: body ? JSON.stringify(body) : undefined });
    let b = null, t = ""; try { t = await res.text(); b = JSON.parse(t); } catch {} return { status: res.status, body: b, text: t, ok: res.ok };
  } catch (e) { return { status: `fetch-failed:${e.message}`, body: null, text: "", ok: false }; }
}
// local form server: GET / -> form (heading has HEAD nonce); GET /submit?field=... -> captures the value
let captured = null;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/submit") {
    captured = url.searchParams.get("field");
    res.setHeader("content-type", "text/html"); res.end(`<html><body><h1>SUBMITTED</h1><p id=result>RESULT ${captured}</p></body></html>`);
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(`<html><body><h1>${HEAD}</h1><form action="/submit" method="get"><input type="text" name="field" id="field"/><button type="submit" id="go">Submit</button></form></body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pagePort = server.address().port;
const pageUrl = `http://127.0.0.1:${pagePort}/`;

const R = { case: "l02-browser-matrix", at: new Date().toISOString(), pageUrl, headNonce: HEAD, fillNonce: FILL };
try {
  const task = `Use your browser tools. 1) Navigate to ${pageUrl} . 2) Read the page's main heading (an <h1>). 3) Type "${FILL}" into the text input (name "field"). 4) Click the Submit button. 5) In ONE message, report the exact heading text you read and confirm you clicked Submit.`;
  const post = await api("POST", "/sessions", { task, model: "gpt-5.5", thinking: "high", mode: "guard", autoApprove: true });
  const id = post.body?.id;
  R.sessionId = id;
  const TERMINAL = new Set(["done", "error", "stopped", "interrupted"]);
  let finalStatus = null, headingSeen = false;
  // Accumulate: the heading nonce may appear in a read tool-result OR the agent's final report. Do NOT stop as
  // soon as the server sees the submit — keep polling until the agent terminates or BOTH proofs are in hand.
  for (let i = 0; i < 70; i++) {
    const v = await api("GET", `/sessions/${id}`);
    if (v.status === 200 && v.text && v.text.includes(HEAD)) headingSeen = true;
    finalStatus = v.body?.status ?? finalStatus;
    if (captured !== null && headingSeen) break;
    if (TERMINAL.has(finalStatus)) break;
    await sleep(3000);
  }
  await sleep(1500);
  const v2 = await api("GET", `/sessions/${id}`); if (v2.status === 200 && v2.text && v2.text.includes(HEAD)) headingSeen = true;
  finalStatus = v2.body?.status ?? finalStatus;
  const sessionText = headingSeen ? HEAD : "";   // marker only; full text not retained
  R.finalStatus = finalStatus;
  R.serverCapturedField = captured;                                   // external observable
  R.fillClickNavigate_ok = captured === FILL;                        // server received the exact fill nonce
  R.headingReadInSession = sessionText.includes(HEAD);               // agent read the heading (in tool result / message)
  R.navigateRead_ok = R.headingReadInSession;
  R.verdict = { navigateRead: R.navigateRead_ok, fillClickNavigate: R.fillClickNavigate_ok };
  R.result = (R.navigateRead_ok && R.fillClickNavigate_ok) ? "PASS" : (finalStatus === "error" ? "FAIL(session-error)" : "FAIL");
  try { await api("POST", `/sessions/${id}/stop`, {}); } catch {}
} catch (e) { R.error = e.message; R.result = "FAIL(exception)"; }
finally {
  await new Promise((r) => server.close(r));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(R, null, 2));
  console.log("EVIDENCE ->", OUT);
  console.log("RESULT:", R.result, JSON.stringify({ serverCaptured: R.serverCapturedField, headingRead: R.headingReadInSession, finalStatus: R.finalStatus }));
  process.exit(R.result === "PASS" ? 0 : 1);
}
