import { groundAction, type MemorySession, type RetrievalResult } from "./kernel/index.js";
import { createHash } from "node:crypto";
import { SAND_BROWSER_DRIVER_VERSION } from "../../runner/tools/sand-browser-driver-source.js";

export interface ProcedureTaskContext {
  domain: string;
  task: string;
  environment: string;
  context: Record<string, string>;
  conditions: string[];
}

export interface BrowserMemoryObservation {
  domain: string;
  environment: string;
  snapshotDigest?: string;
  conditions: string[];
}

/** Read only the actual McpToolResult text projection produced by sand-browser-turn-tools.
 * Page text is not allowed to supply a principal, procedure acceptance or environment identity.
 */
export function observeBrowserResult(toolName: string, result: unknown): BrowserMemoryObservation | null {
  if (!toolName.startsWith("browser_") || result === null || typeof result !== "object") return null;
  const envelope = result as { result?: { case?: string; value?: { isError?: boolean; content?: { content?: { case?: string; value?: { text?: string } } }[] } } };
  const output = envelope.result?.value;
  if (envelope.result?.case !== "success" || !Array.isArray(output?.content)) return null;
  const text = output.content.filter((part) => part.content?.case === "text").map((part) => part.content?.value?.text ?? "").join("\n");
  // Driver emits this line before any page-authored snapshot content. Use only that first header.
  const header = text.split("\n\n")[1] ?? "";
  const urlText = /^Current page: [^\n]* \((https?:\/\/[^\n]+)\)$/.exec(header)?.[1];
  if (!urlText || output.isError) return null;
  let domain: string;
  try { domain = new URL(urlText).hostname; } catch { return null; }
  const snapshot = toolName === "browser_snapshot" ? text.split("\n\n").slice(2).join("\n\n") : "";
  return { domain, environment: `belmont-browser-driver-v${SAND_BROWSER_DRIVER_VERSION}`, conditions: [],
    ...(snapshot ? { snapshotDigest: createHash("sha256").update(snapshot).digest("hex") } : {}),
  };
}

/** The shipped registry has browser tools, but no flight_search/hotel_search/draft_message tool.
 * Map measured browser steps only. Never treat SendMessage as an email/booking API or invent refs.
 * The hook runs before parameter validation and before the existing permission/auto-review path.
 */
export function groundBrowserTool(input: {
  session: MemorySession;
  scope: string;
  query: string;
  at: number;
  toolName: string;
  arguments: Record<string, unknown>;
  task: ProcedureTaskContext;
  retrieval: RetrievalResult;
}): { arguments: Record<string, unknown>; procedureId?: string; bindings: { id: string; version: number; evidenceIds: string[]; argument: string }[] } {
  const original = input.arguments;
  const unchanged = { arguments: original, bindings: [] };
  // The explicit site revision is a precondition supplied by the execution environment, not guessed from text.
  if (!input.task.context.siteRevision || !input.task.context.snapshotDigest) return unchanged;
  const mapping: Record<string, { operation: string; targetField: string; valueField?: string }> = {
    browser_navigate: { operation: "navigate", targetField: "url" },
    browser_fill: { operation: "fill", targetField: "ref", valueField: "value" },
    browser_type: { operation: "fill", targetField: "ref", valueField: "text" },
    browser_click: { operation: "click", targetField: "ref" },
  };
  const mapped = mapping[input.toolName];
  if (!mapped) return unchanged;
  const grounded = groundAction(input.session, {
    scope: input.scope, query: input.query, task: "browser_procedure", at: input.at,
    arguments: { domain: input.task.domain, procedureTask: input.task.task },
    context: { ...input.task.context, environment: input.task.environment },
    conditions: input.task.conditions,
  }, input.retrieval);
  if (grounded.blocked || typeof grounded.arguments.procedureId !== "string") return unchanged;
  const procedure = input.session.read(input.scope, grounded.arguments.procedureId);
  if (procedure?.details?.kind !== "procedure" || procedure.details.preconditions.siteRevision !== input.task.context.siteRevision
    || procedure.details.preconditions.snapshotDigest !== input.task.context.snapshotDigest) return unchanged;
  const steps = procedure.details.steps.filter((step) => step.operation === mapped.operation);
  // Without a matching target, a multi-step procedure does not establish which action is intended.
  const target = original[mapped.targetField];
  const matches = steps.filter((step) => step.target === target);
  if (matches.length !== 1 || !mapped.valueField || Object.hasOwn(original, mapped.valueField)) return unchanged;
  const step = matches[0]!;
  if (step.value === undefined) return unchanged;
  return {
    arguments: { ...original, [mapped.valueField]: step.value },
    procedureId: procedure.id,
    bindings: grounded.memoryBindings.map((binding) => ({ ...binding, argument: mapped.valueField! })),
  };
}
