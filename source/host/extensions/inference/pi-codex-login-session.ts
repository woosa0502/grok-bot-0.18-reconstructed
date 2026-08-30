import type { AuthInteraction } from "@earendil-works/pi-ai";

// In-app Pi Codex OAuth login session.
//
// The renderer's account screen only knows "sign in / sign out"; the Pi login is a
// device-code (or browser) OAuth flow driven through an AuthInteraction. This
// session runs that flow in the background on the host, records the code / URL
// the user must visit, and exposes a small status the desktop polls. Only one
// login runs at a time; cancel aborts it. Prompts other than the method select
// cannot be answered from the app and fail the login with a pointer to the CLI.

export type PiCodexLoginMethod = "device_code" | "browser";

export type PiCodexLoginState =
  | { readonly state: "idle" }
  | {
      readonly state: "pending";
      readonly startedAt: number;
      readonly verificationUri?: string;
      readonly userCode?: string;
      readonly authUrl?: string;
      readonly message?: string;
    }
  | { readonly state: "completed"; readonly completedAt: number }
  | { readonly state: "failed"; readonly error: string; readonly failedAt: number };

export interface PiCodexLoginSessionDeps {
  readonly login: (interaction: AuthInteraction) => Promise<unknown>;
  readonly method?: PiCodexLoginMethod;
  readonly now?: () => number;
  readonly onChange?: (state: PiCodexLoginState) => void;
  /** How long start() waits for a code/URL before returning the pending state anyway. */
  readonly codeWaitMs?: number;
}

export interface PiCodexLoginSession {
  /** Starts a login (idempotent while one is pending) and resolves once a code/URL is known. */
  start(): Promise<PiCodexLoginState>;
  status(): PiCodexLoginState;
  cancel(): PiCodexLoginState;
}

export const PI_CODEX_LOGIN_CLI_HINT = 'run "node scripts/pi-codex-auth.mjs login" from the Belmont checkout instead';

export function createPiCodexLoginSession(deps: PiCodexLoginSessionDeps): PiCodexLoginSession {
  const now = deps.now ?? Date.now;
  const method: PiCodexLoginMethod = deps.method ?? "device_code";
  let state: PiCodexLoginState = { state: "idle" };
  let controller: AbortController | undefined;
  let waiters: Array<() => void> = [];
  const set = (next: PiCodexLoginState) => {
    state = next;
    deps.onChange?.(next);
    const pending = waiters;
    waiters = [];
    for (const wake of pending) wake();
  };
  const hasCodeOrUrl = (value: PiCodexLoginState) => value.state === "pending" && (value.userCode !== undefined || value.authUrl !== undefined);

  return {
    async start() {
      if (state.state !== "pending") {
        controller = new AbortController();
        const { signal } = controller;
        set({ state: "pending", startedAt: now() });
        const interaction: AuthInteraction = {
          signal,
          async prompt(prompt) {
            if (prompt.type === "select") {
              if (!prompt.options.some((option) => option.id === method)) throw new Error(`Pi Codex login does not offer the ${method} method`);
              return method;
            }
            throw new Error(`Pi Codex login asked for ${prompt.type} input, which the app sign-in cannot answer; ${PI_CODEX_LOGIN_CLI_HINT}`);
          },
          notify(event) {
            if (state.state !== "pending") return;
            if (event.type === "auth_url") set({ ...state, authUrl: event.url, ...(event.instructions === undefined ? {} : { message: event.instructions }) });
            else if (event.type === "device_code") set({ ...state, verificationUri: event.verificationUri, userCode: event.userCode });
            else if ("message" in event && typeof event.message === "string") set({ ...state, message: event.message });
          },
        };
        void Promise.resolve()
          .then(() => deps.login(interaction))
          .then(
            () => { if (state.state === "pending") set({ state: "completed", completedAt: now() }); },
            (error: unknown) => {
              if (state.state !== "pending") return;
              set({ state: "failed", error: signal.aborted ? "cancelled" : (error instanceof Error ? error.message : String(error)), failedAt: now() });
            },
          );
      }
      const deadline = now() + (deps.codeWaitMs ?? 30_000);
      while (state.state === "pending" && !hasCodeOrUrl(state) && now() < deadline) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 250);
          waiters.push(() => { clearTimeout(timer); resolve(); });
        });
      }
      return state;
    },
    status: () => state,
    cancel() {
      if (state.state !== "pending") return state;
      controller?.abort();
      set({ state: "failed", error: "cancelled", failedAt: now() });
      return state;
    },
  };
}
