import { createCursorAuthWiring, type AuthServicePort } from "../account/cursor-auth-wiring.js";
import type { ElectronProductionAdapterBindings } from "../production-adapters.js";
import type { ProductionAccountService, ProductionAccountStatus, ProductionServiceContext } from "../main-production-services.js";
import { getLocalInferenceCliStatus } from "../../shared/node/inference-router-local.js";
import { LOCAL_CODEX_STATUS } from "./local-codex-mode.js";
import { requireFunction, requireObject } from "./provider-guards.js";

type CursorAuthWiringDeps = Parameters<typeof createCursorAuthWiring>[0];

type LocalCodexStatus = ProductionAccountStatus;

const LOGGED_OUT: LocalCodexStatus = { kind: "logged-out" };
const LOCAL_CODEX_LOGIN_TIMEOUT_MS = 10 * 60_000;
const LOCAL_CODEX_LOGIN_POLL_MS = 2_000;
const LOCAL_CODEX_STATUS_REFRESH_MS = 15_000;

type ProviderLoginState =
  | { readonly state: "idle" }
  | { readonly state: "pending"; readonly verificationUri?: string; readonly userCode?: string; readonly authUrl?: string }
  | { readonly state: "completed" }
  | { readonly state: "failed"; readonly error: string };

type ProviderAuthLegs = {
  getProviderAuthStatus?: () => Promise<{ configured: boolean } | undefined>;
  startProviderLogin?: () => Promise<ProviderLoginState | undefined>;
  getProviderLoginStatus?: () => Promise<ProviderLoginState | undefined>;
  cancelProviderLogin?: () => Promise<unknown>;
  providerLogout?: () => Promise<unknown>;
};

/**
 * Local Codex mode account service. The renderer's sign-in screen is driven by
 * the REAL Pi Codex OAuth credential instead of a frozen "logged in" status:
 * - status: host `getProviderAuthStatus` when the coordinator is live, otherwise
 *   the credential file on disk (`getLocalInferenceCliStatus().codex`);
 * - sign in: host runs the device-code flow; the desktop opens the verification
 *   URL in the browser (the code is also shown in-app as a tray) and polls until
 *   the host reports completion, failure, or the timeout elapses;
 * - sign out: host removes the Pi credential.
 * Cursor access tokens remain unavailable.
 */
export function createLocalCodexAccountService(
  context: Pick<ProductionServiceContext, "coordinatorLegs" | "native" | "requireMainEdge">,
  options: { readonly readCredentialStatus?: () => boolean; readonly refreshIntervalMs?: number; readonly sleep?: (ms: number) => Promise<void> } = {},
): ProductionAccountService {
  const readCredentialStatus = options.readCredentialStatus ?? (() => getLocalInferenceCliStatus().codex.authenticated);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const listeners = new Set<() => void>();
  let current: LocalCodexStatus = readCredentialStatus() ? LOCAL_CODEX_STATUS : LOGGED_OUT;
  let loginTask: Promise<LocalCodexStatus> | null = null;
  let disposed = false;
  const assertActive = () => {
    if (disposed) throw new Error("Belmont local Codex account adapter is disposed.");
  };
  const legs = (): ProviderAuthLegs => context.coordinatorLegs.legs as unknown as ProviderAuthLegs;
  const emit = (status: LocalCodexStatus) => {
    current = status;
    try { context.requireMainEdge().emit("cursor-auth-changed", status); } catch { /* main edge not up yet */ }
    for (const listener of [...listeners]) listener();
  };
  const refresh = async (): Promise<LocalCodexStatus> => {
    if (loginTask != null) return current;
    let configured: boolean;
    try {
      const hostStatus = await legs().getProviderAuthStatus?.();
      configured = hostStatus === undefined ? readCredentialStatus() : hostStatus.configured;
    } catch {
      configured = readCredentialStatus();
    }
    const next = configured ? LOCAL_CODEX_STATUS : LOGGED_OUT;
    if (next.kind !== current.kind) emit(next);
    return current;
  };
  const timer = setInterval(() => { void refresh(); }, options.refreshIntervalMs ?? LOCAL_CODEX_STATUS_REFRESH_MS);
  timer.unref?.();

  const runLogin = async (): Promise<LocalCodexStatus> => {
    emit({ kind: "logging-in" });
    try {
      const started = await legs().startProviderLogin?.();
      if (started === undefined) throw new Error("Belmont host is not connected; try again in a moment.");
      if (started.state === "failed") throw new Error(started.error);
      const url = started.state === "pending" ? (started.verificationUri ?? started.authUrl) : undefined;
      if (typeof url === "string") await context.native.shell.openExternal(url).catch(() => undefined);
      const deadline = Date.now() + LOCAL_CODEX_LOGIN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const status = await legs().getProviderLoginStatus?.();
        if (status?.state === "completed") { emit(LOCAL_CODEX_STATUS); return current; }
        if (status?.state === "failed") { emit({ kind: "logged-out", errorMessage: status.error }); return current; }
        if (status?.state === "idle") break;
        await sleep(LOCAL_CODEX_LOGIN_POLL_MS);
      }
      await legs().cancelProviderLogin?.().catch(() => undefined);
      emit({ kind: "logged-out", errorMessage: "Codex sign-in timed out; try again." });
    } catch (error) {
      emit({ kind: "logged-out", errorMessage: error instanceof Error ? error.message : String(error) });
    }
    return current;
  };

  const service: AuthServicePort = {
    subscribe: (listener) => {
      const wrapped = () => listener(current);
      listeners.add(wrapped);
      return () => { listeners.delete(wrapped); };
    },
    getStatus: () => refresh(),
    getValidAccessToken: async () => { throw new Error("Cursor access tokens are unavailable in Belmont local Codex mode."); },
    revokeForAccountRefusal: async () => ({ kind: "completed", status: current }),
    login: () => {
      if (loginTask == null) loginTask = runLogin().finally(() => { loginTask = null; });
      return loginTask;
    },
    cancelLogin: async () => {
      await legs().cancelProviderLogin?.().catch(() => undefined);
      emit(readCredentialStatus() ? LOCAL_CODEX_STATUS : LOGGED_OUT);
      return current;
    },
    logout: async () => {
      await legs().providerLogout?.();
      emit(LOGGED_OUT);
      return current;
    },
    updateDisplayName: async () => current,
  };

  return {
    async getStatus() { assertActive(); return refresh(); },
    currentAuthStatusFreshness: () => 0,
    deliverCursorAuthStatus() { assertActive(); },
    async getAuthService() { assertActive(); return service; },
    async revokeForAccountRefusal() { assertActive(); return { kind: "completed", status: current }; },
    subscribe(listener) {
      assertActive();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async dispose() { disposed = true; clearInterval(timer); listeners.clear(); },
  };
}

export interface ProductionAccountOAuthPorts {
  readonly resolveWiringDeps?: (context: ProductionServiceContext) => CursorAuthWiringDeps;
}

function accountRuntimeOf(context: ProductionServiceContext): ReturnType<CursorAuthWiringDeps["getAccountRuntime"]> {
  try {
    const runtime = context.requireCoordinator().getAccountRuntime?.();
    if (runtime != null && typeof (runtime as { observe?: unknown }).observe === "function" && typeof (runtime as { whenIdle?: unknown }).whenIdle === "function") {
      return runtime as ReturnType<CursorAuthWiringDeps["getAccountRuntime"]>;
    }
  } catch {
    // Account construction precedes coordinator construction. The auth wiring
    // must deliver directly until the coordinator exposes its settled runtime.
  }
  return null;
}

function defaultWiringDeps(context: ProductionServiceContext): CursorAuthWiringDeps {
  requireFunction(context.native?.shell?.openExternal, "electron.shell.openExternal");
  requireFunction(context.settings?.settingsStore?.getLocalToolPermission, "account settings.getLocalToolPermission");
  requireFunction(context.settings?.settingsStore?.setLocalToolPermissionCeiling, "account settings.setLocalToolPermissionCeiling");
  requireFunction(context.requireMainEdge, "account main-edge");
  requireFunction(context.coordinatorLegs?.legs?.setHostSettings, "account coordinator.setHostSettings");
  return {
    openExternal: async (url) => { await context.native.shell.openExternal(url); },
    getAccountRuntime: () => accountRuntimeOf(context),
    emitAuthStatus: (status) => context.requireMainEdge().emit("cursor-auth-changed", status),
    sentryEnabled: context.env.SAND_DISABLE_SENTRY !== "1",
    settingsStore: context.settings.settingsStore,
    syncHostSettingsToBox: async (settings) => {
      const setHostSettings = context.coordinatorLegs.legs.setHostSettings;
      if (typeof setHostSettings !== "function") throw new Error("Electron production account requires coordinator host-settings synchronization.");
      await setHostSettings(settings);
    },
  };
}

function validateAuthService(service: AuthServicePort): AuthServicePort {
  requireObject(service, "accountOAuth.service");
  for (const method of ["subscribe", "getStatus", "getValidAccessToken", "revokeForAccountRefusal", "login", "cancelLogin", "logout", "updateDisplayName"] as const) {
    requireFunction(service[method], `accountOAuth.service.${method}`);
  }
  return service;
}

/** Artifact anchor: main.cjs:505993, `var cursorAuthWiring = createCursorAuthWiring({`. */
export function createProductionAccountOAuthAdapter(
  ports: ProductionAccountOAuthPorts,
): ElectronProductionAdapterBindings["accountOAuth"] {
  return {
    async create(context): Promise<ProductionAccountService> {
      if (context.env.SAND_LOCAL_CODEX_MODE === "1") return createLocalCodexAccountService(context);
      const wiring = createCursorAuthWiring((ports?.resolveWiringDeps ?? defaultWiringDeps)(context));
      const service = validateAuthService(await wiring.ensureCursorAuthService());
      const subscriptions = new Set<() => void>();
      let disposed = false;
      return {
        getStatus: () => service.getStatus(),
        currentAuthStatusFreshness: wiring.currentAuthStatusFreshness,
        deliverCursorAuthStatus(status) {
          if (disposed) throw new Error("Electron production account adapter is disposed.");
          wiring.deliverCursorAuthStatus(service, status);
        },
        async getAuthService() {
          if (disposed) throw new Error("Electron production account adapter is disposed.");
          return service;
        },
        async revokeForAccountRefusal() {
          if (disposed) throw new Error("Electron production account adapter is disposed.");
          return await service.revokeForAccountRefusal();
        },
        subscribe(listener) {
          if (disposed) throw new Error("Electron production account adapter is disposed.");
          const unsubscribe = service.subscribe(() => listener());
          subscriptions.add(unsubscribe);
          return () => { if (subscriptions.delete(unsubscribe)) unsubscribe(); };
        },
        async dispose() {
          if (disposed) return;
          disposed = true;
          const failures: unknown[] = [];
          for (const unsubscribe of [...subscriptions].reverse()) {
            subscriptions.delete(unsubscribe);
            try { unsubscribe(); } catch (error) { failures.push(error); }
          }
          try { wiring.dispose(); } catch (error) { failures.push(error); }
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1) throw new AggregateError(failures, "Electron production account cleanup failed.");
        },
      };
    },
  };
}

/**
 * Exact desktop account composition: native browser callback, secure-store
 * defaults, generated profile clients, main-edge status, coordinator account
 * runtime, and host-settings synchronization remain real owner seams.
 */
export function createElectronProductionAccountOAuthBinding(): ElectronProductionAdapterBindings["accountOAuth"] {
  return createProductionAccountOAuthAdapter({});
}
