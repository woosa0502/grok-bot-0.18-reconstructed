import { randomInt } from "node:crypto";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { createBelmontCompanionAdapter, resolveBelmontDataRoot } from "./belmont-adapter.mjs";
import { createMobileServer, warnIfPlaintextExposed } from "./server.mjs";

export async function startBelmontMobileServer(env = process.env) {
  const dataRoot = resolveBelmontDataRoot(env);
  const pairCode = env.BELMONT_MOBILE_PAIR_CODE?.trim() || String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Paired sessions survive restarts via this state dir (secrets, 0600 files).
  const stateDir = env.BELMONT_MOBILE_STATE_DIR?.trim() || join(homedir(), ".belmont-mobile-pwa");
  const adapter = createBelmontCompanionAdapter({ dataRoot, pairCode, persistPath: join(stateDir, "adapter-sessions.json") });
  await listen(adapter, 0, "127.0.0.1");
  const adapterAddress = adapter.address();
  if (adapterAddress == null || typeof adapterAddress === "string") throw new Error("Belmont adapter did not bind a TCP port.");

  const mobile = createMobileServer({
    upstream: `http://127.0.0.1:${adapterAddress.port}`,
    trustProxy: env.BELMONT_MOBILE_TRUST_PROXY === "1",
    persistPath: join(stateDir, "gateway-sessions.json"),
  });
  const port = integerPort(env.BELMONT_MOBILE_PORT, 4173);
  const host = env.BELMONT_MOBILE_HOST?.trim() || "127.0.0.1";
  try {
    await listen(mobile, port, host);
  } catch (error) {
    await close(adapter);
    throw error;
  }

  const shutdown = async () => {
    await Promise.allSettled([close(mobile), close(adapter)]);
  };
  return { mobile, adapter, host, port, pairCode, dataRoot, shutdown };
}

function listen(server, port, host) {
  return new Promise((resolveListen, reject) => {
    const onError = (error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolveListen(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function integerPort(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) throw new Error("BELMONT_MOBILE_PORT must be a valid TCP port.");
  return value;
}

async function main() {
  const running = await startBelmontMobileServer();
  console.log(`Belmont Mobile PWA: http://${running.host}:${running.port}`);
  console.log(`Belmont data root: ${running.dataRoot}`);
  console.log(`Mobile pairing code: ${running.pairCode}`);
  warnIfPlaintextExposed(running.host, process.env.BELMONT_MOBILE_TRUST_PROXY === "1");
  const stop = () => { void running.shutdown().finally(() => process.exit(0)); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
