// Pure grading logic for the L15 gateway/daemon auth driver, extracted so a self-test can exercise the EXACT
// decisions the live driver uses (the driver itself reads gateway.json and runs a case at import, so it can't
// be imported directly). Each grader FAILS CLOSED: an unreadable/ unreachable observation grades UNKNOWN, never
// PASS. These close the three false-PASSes GPT's whole-project review found.

// #2: roster count must be a REAL integer on BOTH sides (parsed), then equal. Two malformed rosters
// (count:null) can no longer read as "unchanged" (null===null). Unreadable roster -> UNKNOWN.
export function gradeOriginGuard({ allRejected, before, after }) {
  const rosterReadable = !!(before?.parsed && after?.parsed && Number.isInteger(before.count) && Number.isInteger(after.count));
  const countUnchanged = rosterReadable && before.count === after.count;
  const result = !rosterReadable ? "UNKNOWN" : (allRejected && countUnchanged ? "PASS" : "FAIL");
  return { result, rosterReadable, countUnchanged };
}

// #3: auth-ON proof needs BOTH bad->401 AND good->200. Without a correct token to prove the positive path, a
// wrong->401 alone cannot distinguish a real guard from a gateway that rejects everything -> UNKNOWN.
export function gradeBadBearer({ hasToken, wrongStatus, rightStatus }) {
  if (!hasToken) return { result: "UNKNOWN" };
  return { result: (wrongStatus === 401 && rightStatus === 200) ? "PASS" : "FAIL" };
}

// #1: both requests must actually reach the daemon (a real numeric HTTP status). A comm failure returns a
// string status; that must NOT count as "not 403". Either side unreached -> UNKNOWN.
export function gradeDaemonForChrome({ evil, noOrigin }) {
  const bothReached = Number.isInteger(evil?.status) && Number.isInteger(noOrigin?.status);
  const evilBlocked = evil?.status === 403 && /FORBIDDEN/.test(evil?.body || "");
  const noOriginNot403 = Number.isInteger(noOrigin?.status) && noOrigin.status !== 403;
  const result = !bothReached ? "UNKNOWN" : (evilBlocked && noOriginNot403 ? "PASS" : "FAIL");
  return { result, bothReached, evilBlocked, noOriginNot403 };
}
