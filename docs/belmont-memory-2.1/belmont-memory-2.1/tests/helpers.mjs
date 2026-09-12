import { MemoryKernel } from "../dist/index.js";
export const NOW = Date.parse("2026-09-11T00:00:00Z");
export const KEY = new Uint8Array(32).fill(29); // synthetic tests ONLY
export function setup(options = {}) {
  const kernel = new MemoryKernel({ path: ":memory:", tombstoneKey: KEY, now: () => NOW, ...options });
  const common = { scopes: ["user:demo", "project:belmont"], capabilities: ["read", "capture", "propose", "index"] };
  const user = kernel.session({ ...common, id: "ui:user", actor: "user", capabilities: [...common.capabilities, "explicit", "forget"] });
  const agent = kernel.session({ ...common, id: "agent:belmont", actor: "agent" });
  const aside = kernel.session({ ...common, id: "aside:browser", actor: "aside" });
  const migrator = kernel.session({ ...common, id: "host:migrator", actor: "migrator", capabilities: [...common.capabilities, "migrate"] });
  return { kernel, user, agent, aside, migrator };
}
let serial = 0;
export function capture(session, content, source = "user-message", scope = "user:demo", extra = {}) {
  return session.capture({ scope, content, source, sourceRef: `test:${++serial}`, occurredAt: NOW, expectedEpoch: session.snapshot(scope).epoch, ...extra });
}
export function proposal(session, evidence, content, extra = {}) {
  const scope = extra.scope ?? evidence.scope;
  return { scope, type: "episodic", content, evidenceIds: [evidence.id], idempotencyKey: `p:${++serial}`, basedOn: session.snapshot(scope), ...extra };
}
export function remember(session, content, extra = {}) {
  const e = capture(session, content, "user-message", extra.scope ?? "user:demo");
  const p = proposal(session, e, content, extra); const result = session.propose(p);
  if (result.status !== "committed") throw new Error(JSON.stringify(result));
  return { ...result, evidence: e, proposal: p };
}
