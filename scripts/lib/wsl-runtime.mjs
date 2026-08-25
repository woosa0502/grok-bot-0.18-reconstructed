import path from "node:path";

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

export function wslRuntimeEnvironment(env = process.env) {
  return {
    ...env,
    SAND_ATTACH_PROD_BOX: "0",
    SAND_DISABLE_UPDATES: "1",
    SAND_DISABLE_TELEMETRY: "1",
    SAND_DISABLE_SENTRY: "1",
    SAND_LOCAL_CODEX_MODE: "1",
  };
}

export function wslDataRoot(profileDir) {
  return path.join(path.resolve(profileDir), "sand-data");
}

export function wslHostEnvironment({ profileDir, env = process.env }) {
  return {
    ...wslRuntimeEnvironment(env),
    SAND_DATA_ROOT: wslDataRoot(profileDir),
    SAND_GATEWAY_BIND_HOST: "127.0.0.1",
    SAND_HOST_PORT: "0",
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

export function initialLocalSettingsUpdate(raw) {
  const settings = typeof raw === "object" && raw != null && !Array.isArray(raw) ? raw : {};
  return {
    ...(typeof settings.inferenceProvider === "string" ? {} : { inferenceProvider: "codex" }),
    ...(typeof settings.hasSeenOnboarding === "boolean" ? {} : { hasSeenOnboarding: true }),
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
