import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { prependPath } from "./local-browser-runtime.mjs";

export const BELMONT_WSL_DEBUG_PORT_ENV = "BELMONT_WSL_DEBUG_PORT";

export function assertSupportedNodeRuntime(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  if (major !== 26 || minor < 5) {
    throw new Error(`Belmont requires Node.js >=26.5.0 <27; received ${version}.`);
  }
}

export function assertWslPlatform({ platform = process.platform, env = process.env } = {}) {
  if (platform !== "linux" || (env.WSL_DISTRO_NAME == null && env.WSL_INTEROP == null)) {
    throw new Error("The Belmont WSL launcher requires Linux under WSL2.");
  }
}

export function assertWslGuiRuntime(options = {}) {
  assertWslPlatform(options);
  const env = options.env ?? process.env;
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
    throw new Error("WSLg is unavailable: DISPLAY and WAYLAND_DISPLAY are both missing.");
  }
}

/**
 * The box daemon's Grep tool spawns ripgrep directly (box-exec-daemon/server.ts) and
 * reports "ripgrep failed to start" when it is missing. Say so at launch instead of
 * letting the first search surface it; this warns and never throws.
 */
export function warnMissingBoxBinaries(binaries = ["rg"], log = console.error) {
  const missing = binaries.filter((name) => {
    try { execFileSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" }); return false; }
    catch { return true; }
  });
  if (missing.length > 0) {
    log(`[box] missing ${missing.join(", ")}: the Grep tool spawns ripgrep and will fail with "ripgrep failed to start" until it is installed (sudo apt install ripgrep).`);
  }
  return missing;
}

export function wslRuntimeEnvironment(env = process.env) {
  return {
    ...env,
    SAND_ATTACH_PROD_BOX: "0",
    SAND_DISABLE_UPDATES: "1",
    SAND_DISABLE_TELEMETRY: "1",
    SAND_DISABLE_SENTRY: "1",
    SAND_LOCAL_CODEX_MODE: "1",
    // Local Computer is a default capability (AUDIT-W17): the host still checks
    // that Xvfb/xdotool/ffmpeg exist and disables the tool (with a log line)
    // when they are missing. Set SAND_LOCAL_COMPUTER_USE=0 to opt out.
    SAND_LOCAL_COMPUTER_USE: env.SAND_LOCAL_COMPUTER_USE ?? "1",
  };
}

export function wslDataRoot(profileDir) {
  return path.join(path.resolve(profileDir), "sand-data");
}

/**
 * Append a `name=value` default to a SAND_FEATURE_GATE_OVERRIDES list unless the
 * list already mentions the gate — an explicit user value (on or off) always wins.
 */
export function mergeGateOverrides(raw, name, value) {
  const existing = typeof raw === "string" && raw.length > 0 ? raw : "";
  const mentioned = existing.split(",").some(pair => pair.split("=", 2)[0]?.trim() === name);
  if (mentioned) return existing;
  return existing.length === 0 ? `${name}=${value}` : `${existing},${name}=${value}`;
}

/**
 * Manager designation persisted per profile (Belmont B-1 bootstrap): written by
 * `npm run belmont:manager`, read at every start so the manager keeps working
 * without hand-set environment variables. SAND_DEFAULT_AGENT_ID still overrides.
 */
export function readManagerAgentId(profileDir) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(wslDataRoot(profileDir), "manager.json"), "utf8"));
    return typeof parsed.managerAgentId === "string" && parsed.managerAgentId.length > 0 ? parsed.managerAgentId : undefined;
  } catch {
    return undefined;
  }
}

export function wslHostEnvironment({ profileDir, env = process.env, localBinDir }) {
  const managerAgentId = env.SAND_DEFAULT_AGENT_ID?.trim() || readManagerAgentId(profileDir);
  return {
    ...wslRuntimeEnvironment(env),
    // The browser driver spawns bare command names ("box-chrome") that only a
    // container box ships. Provisioned shims live here, ahead of the system PATH.
    ...(localBinDir == null ? {} : { PATH: prependPath(env.PATH, localBinDir) }),
    ...(managerAgentId == null ? {} : { SAND_DEFAULT_AGENT_ID: managerAgentId }),
    SAND_DATA_ROOT: wslDataRoot(profileDir),
    SAND_GATEWAY_BIND_HOST: "127.0.0.1",
    SAND_HOST_PORT: "0",
    // Enable multitask locally. The Task/Subagent toolset and the built-in "executor"
    // subagent type are fully implemented, but the host only offers them when
    // isMultitaskEnabled() is true — which normally comes from the Cursor-backed
    // "sand_multitask" Statsig gate. There is no such backend here, so the gate reads
    // false and Task fails with "No subagent types are available". resolveMultitaskEnabled
    // honours SAND_MULTITASK ahead of the gate, so set it on for the local build.
    SAND_MULTITASK: env.SAND_MULTITASK ?? "1",
    // Enable the replacement memory pipeline (background synthesis, "dreaming") locally.
    // The gate normally pins on the first AUTHENTICATED Statsig bootstrap, which never
    // happens without a Cursor account; the experiments extension pins local Codex mode
    // from the local evaluation instead, and this default turns the gate on there.
    // Opt out with SAND_FEATURE_GATE_OVERRIDES=sand_memory_dreaming=0 (an explicit
    // value in the variable always wins over this default).
    SAND_FEATURE_GATE_OVERRIDES: mergeGateOverrides(env.SAND_FEATURE_GATE_OVERRIDES, "sand_memory_dreaming", "1"),
    // Require gateway auth. The gateway only serves the local-exec channel
    // (/local-exec/requests|responses — how the desktop's local-exec daemon attaches
    // as the "local machine") when it has an auth token; on a loopback bind it mints
    // one only when this is set. Without it the daemon's attach is refused with 401,
    // the host never sees a live computer, and every ExternalShell/ExternalRead call
    // fails with "Your local machine isn't connected right now". The launcher already
    // forwards gateway.json's token to Electron (SAND_HOST_GATEWAY_TOKEN) and uses it
    // for its own settings POST.
    SAND_GATEWAY_REQUIRE_AUTH: env.SAND_GATEWAY_REQUIRE_AUTH ?? "1",
  };
}

export function gatewayUrlFromDiscovery(discovery, expectedPid) {
  if (discovery == null || typeof discovery !== "object" || discovery.pid !== expectedPid) return null;
  if (!Number.isInteger(discovery.port) || discovery.port < 1 || discovery.port > 65535) return null;
  const host = typeof discovery.host === "string" && discovery.host.length > 0 ? discovery.host : "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") return null;
  const scheme = discovery.scheme === "https" ? "https" : "http";
  return `${scheme}://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${discovery.port}`;
}

export const LOCAL_AUTO_REVIEW_SEED_MARKER = ".local-auto-review-seeded";

export function initialLocalSettingsUpdate(raw, { seedAutoReviewOff = false } = {}) {
  const settings = typeof raw === "object" && raw != null && !Array.isArray(raw) ? raw : {};
  const hasAutoReview = typeof settings.autoReviewInstructions === "object" && settings.autoReviewInstructions != null;
  return {
    // inferenceProvider / onboarding: seed when missing (idempotent — a persisted value wins).
    ...(typeof settings.inferenceProvider === "string" ? {} : { inferenceProvider: "codex" }),
    ...(typeof settings.hasSeenOnboarding === "boolean" ? {} : { hasSeenOnboarding: true }),
    // Ship the local/codex build pre-configured with Smart-Mode auto-review off: the
    // Cursor-backed risk classifier has no backend here, so an enabled review fail-closes
    // and blocks every shell/browser/computer action. Seeding the setting (instead of
    // hard-coding the mode in the host) leaves host-machine actions gated by "Execution on
    // Local Computer".
    //
    // Seed it exactly once per profile, tracked by an on-disk marker (LOCAL_AUTO_REVIEW_SEED
    // _MARKER), NOT by field-absence. The store records an enabled review with no custom
    // instructions as "the default" by dropping the field, so a user who turns review back
    // on leaves no field behind — re-seeding on absence would silently disable their choice
    // on the next restart. inferenceProvider is also unusable as the first-run signal here:
    // an older launcher already wrote it, so profiles predating this setting would never be
    // seeded and would fall back to the enabled default. The caller passes seedAutoReviewOff
    // = "marker absent", and we still respect an auto-review setting the user already chose.
    ...(seedAutoReviewOff && !hasAutoReview ? { autoReviewInstructions: { isEnabled: false, allowInstructions: [], blockInstructions: [] } } : {}),
  };
}

export function parseDebugPort(raw) {
  if (raw == null || raw.trim() === "") return null;
  if (!/^\d+$/u.test(raw)) throw new Error(`${BELMONT_WSL_DEBUG_PORT_ENV} must be an integer port.`);
  const value = Number(raw);
  if (value < 1024 || value > 65535) {
    throw new Error(`${BELMONT_WSL_DEBUG_PORT_ENV} must be between 1024 and 65535.`);
  }
  return value;
}

export function wslElectronArgs({ appRoot, profileDir, debugPort = null }) {
  const args = [
    path.resolve(appRoot),
    "--no-sandbox",
    `--user-data-dir=${path.resolve(profileDir)}`,
  ];
  if (debugPort != null) {
    args.push("--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`);
  }
  return args;
}
