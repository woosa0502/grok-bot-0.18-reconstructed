// Self-test for the CORRECTED L15 gateway/daemon auth grading. Imports the REAL graders from
// gateway-origin-auth-lib.mjs (the same ones the live driver calls) and proves each of the three false-PASSes
// GPT's whole-project review found is now closed: an unreadable/unreachable/unproven observation grades
// UNKNOWN — never PASS.
import assert from "node:assert/strict";
import { gradeOriginGuard, gradeBadBearer, gradeDaemonForChrome } from "./gateway-origin-auth-lib.mjs";

// #2 origin-guard: malformed roster on BOTH sides must NOT read as "unchanged".
const okBefore = { parsed: true, count: 14 }, okAfter = { parsed: true, count: 14 };
assert.equal(gradeOriginGuard({ allRejected: true, before: okBefore, after: okAfter }).result, "PASS", "all rejected + roster 14==14 -> PASS");
assert.equal(gradeOriginGuard({ allRejected: false, before: okBefore, after: okAfter }).result, "FAIL", "a browser origin got through -> FAIL");
const bad = { parsed: false, count: null };
assert.equal(gradeOriginGuard({ allRejected: true, before: bad, after: bad }).result, "UNKNOWN", "two malformed rosters (null===null) -> UNKNOWN, not PASS");
assert.equal(gradeOriginGuard({ allRejected: true, before: okBefore, after: bad }).result, "UNKNOWN", "roster unreadable after -> UNKNOWN");
assert.equal(gradeOriginGuard({ allRejected: true, before: { parsed: true, count: 14 }, after: { parsed: true, count: 15 } }).result, "FAIL", "roster changed 14->15 -> FAIL");

// #3 bad-bearer: auth-ON needs BOTH bad->401 AND good->200; no token to prove the positive path -> UNKNOWN.
assert.equal(gradeBadBearer({ hasToken: true, wrongStatus: 401, rightStatus: 200 }).result, "PASS", "bad->401 AND good->200 -> PASS");
assert.equal(gradeBadBearer({ hasToken: true, wrongStatus: 401, rightStatus: 401 }).result, "FAIL", "good token ALSO rejected -> FAIL (guard rejects everything)");
assert.equal(gradeBadBearer({ hasToken: false, wrongStatus: 401, rightStatus: null }).result, "UNKNOWN", "no token to prove positive path -> UNKNOWN, not PASS");
assert.equal(gradeBadBearer({ hasToken: true, wrongStatus: 200, rightStatus: 200 }).result, "FAIL", "wrong token accepted -> FAIL");

// #1 daemon-for-chrome: a no-Origin communication FAILURE must not count as "not 403".
const reached404 = { status: 404, body: "not found" };
const forbidden = { status: 403, body: '{"error":"FORBIDDEN"}' };
const commFail = { status: "fetch-failed:ECONNREFUSED", body: "" };
assert.equal(gradeDaemonForChrome({ evil: forbidden, noOrigin: reached404 }).result, "PASS", "evil->403 FORBIDDEN AND no-origin reached (404) -> PASS");
assert.equal(gradeDaemonForChrome({ evil: forbidden, noOrigin: commFail }).result, "UNKNOWN", "no-origin comm-failure -> UNKNOWN, not PASS");
assert.equal(gradeDaemonForChrome({ evil: commFail, noOrigin: reached404 }).result, "UNKNOWN", "evil comm-failure -> UNKNOWN, not PASS");
assert.equal(gradeDaemonForChrome({ evil: reached404, noOrigin: reached404 }).result, "FAIL", "evil NOT blocked (404, guard missing) -> FAIL");
assert.equal(gradeDaemonForChrome({ evil: forbidden, noOrigin: forbidden }).result, "FAIL", "no-origin ALSO 403 (guard over-blocks) -> FAIL");

console.log("PASS: L15 graders — malformed roster, comm-failure, and unproven-auth all grade UNKNOWN (never PASS); real defects grade FAIL; only genuinely-proven guards PASS");
