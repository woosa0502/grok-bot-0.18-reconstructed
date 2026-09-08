import { spawn } from "node:child_process";
import readline from "node:readline";

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function projectWindow(limit, scope) {
  const window = limit?.[scope];
  const usedPercent = finiteNumber(window?.usedPercent);
  const windowDurationMins = finiteNumber(window?.windowDurationMins);
  const resetsAt = finiteNumber(window?.resetsAt);
  if (usedPercent == null || windowDurationMins == null || resetsAt == null) return null;
  const limitId = optionalString(limit.limitId) ?? "codex";
  return {
    id: `${limitId}:${scope}`,
    limitId,
    limitName: optionalString(limit.limitName) ?? (limitId === "codex" ? "Codex" : limitId),
    scope,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    windowDurationMins,
    resetsAt,
  };
}

/** Reduce Codex's account payload to the fields the mobile usage screen renders. */
export function projectCodexUsage(rateLimitResult, activityResult, fetchedAt = Date.now()) {
  const byId = isRecord(rateLimitResult?.rateLimitsByLimitId)
    ? Object.values(rateLimitResult.rateLimitsByLimitId).filter(isRecord)
    : [];
  const limits = byId.length > 0
    ? byId
    : (isRecord(rateLimitResult?.rateLimits) ? [rateLimitResult.rateLimits] : []);
  const windows = [];
  for (const limit of limits) {
    for (const scope of ["primary", "secondary"]) {
      const projected = projectWindow(limit, scope);
      if (projected != null) windows.push(projected);
    }
  }

  const defaultLimit = isRecord(rateLimitResult?.rateLimits) ? rateLimitResult.rateLimits : limits[0];
  const summary = isRecord(activityResult?.summary) ? activityResult.summary : {};
  const daily = Array.isArray(activityResult?.dailyUsageBuckets)
    ? activityResult.dailyUsageBuckets.filter((entry) => isRecord(entry) && typeof entry.startDate === "string" && finiteNumber(entry.tokens) != null)
    : [];
  const recentDaily = daily.slice(-30).map((entry) => ({ startDate: entry.startDate, tokens: entry.tokens }));

  return {
    planType: optionalString(defaultLimit?.planType),
    windows,
    resetCredits: Number.isInteger(rateLimitResult?.rateLimitResetCredits?.availableCount)
      ? rateLimitResult.rateLimitResetCredits.availableCount
      : null,
    activity: {
      lifetimeTokens: finiteNumber(summary.lifetimeTokens),
      peakDailyTokens: finiteNumber(summary.peakDailyTokens),
      currentStreakDays: finiteNumber(summary.currentStreakDays),
      recentDaily,
    },
    fetchedAt,
  };
}

/** Read the authenticated local Codex account without exposing its credentials to the browser. */
export function readCodexUsage({
  codexBin = process.env.CODEX_BIN || "codex",
  spawnProcess = spawn,
  timeoutMs = 15_000,
  now = Date.now,
} = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, NO_COLOR: "1" };
    delete childEnv.FORCE_COLOR;
    const child = spawnProcess(codexBin, ["app-server"], {
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = readline.createInterface({ input: child.stdout });
    const responses = new Map();
    let stderr = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      lines.close();
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode == null && child.signalCode == null) child.kill();
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      const error = new Error(message);
      error.status = 502;
      error.publicMessage = "Codex 사용량을 불러오지 못했습니다. 로컬 Codex 로그인 상태를 확인해 주세요.";
      reject(error);
    };
    const finish = () => {
      if (settled || !responses.has(1) || !responses.has(2)) return;
      const rateLimits = responses.get(1);
      const activity = responses.get(2);
      if (rateLimits?.error != null && activity?.error != null) {
        fail("Codex account endpoints rejected the request");
        return;
      }
      settled = true;
      cleanup();
      resolve(projectCodexUsage(rateLimits?.result, activity?.result, now()));
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timer = setTimeout(() => fail("Codex app-server usage request timed out"), timeoutMs);

    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4_096) stderr += chunk.toString("utf8").slice(0, 4_096 - stderr.length);
    });
    child.on("error", (error) => fail(`Codex app-server failed to start: ${error.message}`));
    child.on("exit", (code, signal) => {
      if (!settled) fail(`Codex app-server exited before usage arrived (${code ?? signal ?? "unknown"}): ${stderr.trim()}`);
    });
    lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); }
      catch { return; }
      if (message.id === 0) {
        if (message.error != null) {
          fail(`Codex app-server initialization failed: ${message.error.message ?? "unknown error"}`);
          return;
        }
        send({ method: "initialized", params: {} });
        send({ method: "account/rateLimits/read", id: 1 });
        send({ method: "account/usage/read", id: 2 });
        return;
      }
      if (message.id === 1 || message.id === 2) {
        responses.set(message.id, message);
        finish();
      }
    });

    send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "belmont_mobile_pwa",
          title: "Belmont Mobile PWA",
          version: "0.1.0",
        },
      },
    });
  });
}
