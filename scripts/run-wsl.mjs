import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./lib/config.mjs";
import { acquireBelmontRuntimeLock } from "./lib/wsl-runtime-lock.mjs";
import { assertWslBuildSourceIdentity, captureWslBuildSourceIdentity } from "./lib/wsl-build-lineage.mjs";
import { collectWslRuntimeLineage, writeWslRuntimeLineage } from "./lib/wsl-runtime-lineage.mjs";
import {
  assertSupportedNodeRuntime,
  assertWslGuiRuntime,
  BELMONT_WSL_DEBUG_PORT_ENV,
  gatewayUrlFromDiscovery,
  initialLocalSettingsUpdate,
  parseDebugPort,
  wslDataRoot,
  wslElectronArgs,
  wslHostEnvironment,
  wslRuntimeEnvironment,
} from "./lib/wsl-runtime.mjs";

assertSupportedNodeRuntime();
assertWslGuiRuntime();

const electronBinary = path.join(repoRoot, "node_modules", "electron", "dist", "electron");
const appRoot = path.join(repoRoot, ".build", "belmont-wsl-runtime");
const profileDir = process.env.BELMONT_WSL_PROFILE?.trim() || path.join(repoRoot, ".cache", "belmont-wsl-profile");
const dataRoot = wslDataRoot(profileDir);
const hostEntry = path.join(appRoot, "dist", "host", "host-main.cjs");
const buildLineagePath = path.join(appRoot, "dist", "wsl-build-lineage.json");
const settingsPath = path.join(dataRoot, "settings.json");
const runtimeLock = await acquireBelmontRuntimeLock({ profileDir });
const runnerStartedAt = new Date().toISOString();

try {
  for (const required of [
    electronBinary,
    path.join(appRoot, "package.json"),
    path.join(appRoot, "dist", "renderer", "index.html"),
    buildLineagePath,
    hostEntry,
  ]) {
    await access(required).catch(() => {
      throw new Error(`Missing Belmont WSL runtime file: ${required}. Run npm run wsl:setup first.`);
    });
  }
  const buildLineage = JSON.parse(await readFile(buildLineagePath, "utf8"));
  const sourceIdentity = await captureWslBuildSourceIdentity({ repoRoot });
  assertWslBuildSourceIdentity(buildLineage, sourceIdentity);
  await mkdir(dataRoot, { recursive: true });
  const storedSettings = await readFile(settingsPath, "utf8").then(JSON.parse).catch(() => null);
  const initialSettings = initialLocalSettingsUpdate(storedSettings);

  const hostStartedAt = new Date().toISOString();
  const host = spawn(process.execPath, [hostEntry], {
    cwd: repoRoot,
    env: wslHostEnvironment({ profileDir }),
    stdio: "inherit",
  });
  const hostExit = new Promise((resolve, reject) => {
    host.once("error", reject);
    host.once("exit", (code, signal) => resolve({ code, signal }));
  });

  const waitForGateway = async () => {
    const discoveryPath = path.join(dataRoot, "gateway.json");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const discovery = await readFile(discoveryPath, "utf8").then(JSON.parse).catch(() => null);
      const url = gatewayUrlFromDiscovery(discovery, host.pid);
      if (url != null) {
        const healthy = await fetch(`${url}/health`).then(response => response.ok).catch(() => false);
        if (healthy) return { url, token: typeof discovery.token === "string" ? discovery.token : "" };
      }
      const exited = await Promise.race([
        hostExit.then(result => ({ result })),
        new Promise(resolve => setTimeout(() => resolve(null), 100)),
      ]);
      if (exited != null) throw new Error(`Belmont host exited before becoming ready (${exited.result.code ?? `signal ${exited.result.signal}`}).`);
    }
    throw new Error("Belmont host did not become ready within 20 seconds.");
  };

  const stopHost = () => {
    if (host.exitCode == null && host.signalCode == null) host.kill("SIGTERM");
  };

  let gateway;
  try {
    gateway = await waitForGateway();
    if (Object.keys(initialSettings).length > 0) {
      const response = await fetch(`${gateway.url}/api/setHostSettings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(gateway.token.length === 0 ? {} : { authorization: `Bearer ${gateway.token}` }),
        },
        body: JSON.stringify(initialSettings),
      });
      if (!response.ok) throw new Error(`Could not initialize Belmont local settings (${response.status}).`);
    }
  } catch (error) {
    stopHost();
    await hostExit.catch(() => {});
    throw error;
  }

  const debugPort = parseDebugPort(process.env[BELMONT_WSL_DEBUG_PORT_ENV]);
  const electronStartedAt = new Date().toISOString();
  const electron = spawn(electronBinary, wslElectronArgs({ appRoot, profileDir, debugPort }), {
    cwd: repoRoot,
    env: {
      ...wslRuntimeEnvironment(),
      SAND_DATA_ROOT: dataRoot,
      SAND_HOST_GATEWAY_URL: gateway.url,
      ...(gateway.token.length === 0 ? {} : { SAND_HOST_GATEWAY_TOKEN: gateway.token }),
    },
    stdio: "inherit",
  });
  const electronExit = new Promise((resolve, reject) => {
    electron.once("error", reject);
    electron.once("exit", (code, signal) => resolve({ code, signal }));
  });

  try {
    const lineage = await collectWslRuntimeLineage({
      repoRoot,
      appRoot,
      profileDir,
      debugPort,
      processes: {
        runner: { pid: process.pid, startedAt: runnerStartedAt },
        host: { pid: host.pid, startedAt: hostStartedAt },
        electron: { pid: electron.pid, startedAt: electronStartedAt },
      },
      buildLineage,
      sourceIdentity,
    });
    await writeWslRuntimeLineage(path.join(dataRoot, "runtime-lineage.json"), lineage);
  } catch (error) {
    if (electron.exitCode == null && electron.signalCode == null) electron.kill("SIGTERM");
    stopHost();
    await Promise.allSettled([electronExit, hostExit]);
    throw error;
  }

  let stopping = false;
  const stopOwnedProcesses = () => {
    if (stopping) return;
    stopping = true;
    if (electron.exitCode == null && electron.signalCode == null) electron.kill("SIGTERM");
    stopHost();
  };
  process.once("SIGINT", stopOwnedProcesses);
  process.once("SIGTERM", stopOwnedProcesses);

  let result;
  try {
    result = await Promise.race([
      electronExit.then(exit => ({ owner: "electron", exit })),
      hostExit.then(exit => ({ owner: "host", exit })),
    ]);
  } catch (error) {
    stopOwnedProcesses();
    await Promise.allSettled([electronExit, hostExit]);
    throw error;
  }
  const requested = stopping;
  stopOwnedProcesses();
  await Promise.allSettled([electronExit, hostExit]);
  if (!requested && (result.exit.signal != null || result.exit.code !== 0)) {
    throw new Error(`Belmont ${result.owner} exited with ${result.exit.code ?? `signal ${result.exit.signal}`}`);
  }
} finally {
  await runtimeLock.release();
}
