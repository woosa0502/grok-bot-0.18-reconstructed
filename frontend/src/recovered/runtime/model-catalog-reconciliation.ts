import type {
  AgentDesktopBridge,
  AgentModelSelection,
} from "../contracts/desktop-bridge.js";

type JsonRecord = Record<string, unknown>;

interface ModelParameterValue {
  readonly id: string;
  readonly value: string;
}

interface ModelVariant {
  readonly parameterValues: readonly ModelParameterValue[];
  readonly isMaxMode: boolean;
  readonly isDefaultMaxConfig: boolean;
}

interface CatalogModel {
  readonly raw: JsonRecord;
  readonly name: string;
  readonly defaultOn: boolean;
  readonly visibleInRoutedModelView: boolean;
  readonly cloudMigrateToModel: string | undefined;
  readonly primaryEffort: "standard" | "grind";
  readonly variants: readonly ModelVariant[];
}

export interface ModelCatalogProjection {
  readonly payload: unknown;
  readonly allowedModelIds?: ReadonlySet<string>;
  readonly fallback?: AgentModelSelection;
}

export interface ModelCatalogReconciliationResult extends ModelCatalogProjection {
  readonly storedModel: AgentModelSelection;
  readonly didReplaceDefault: boolean;
}

export const SHIPPED_DEFAULT_AGENT_MODEL: AgentModelSelection = {
  modelId: "grok-4.5",
  maxMode: true,
  parameters: [
    { id: "effort", value: "high" },
    { id: "fast", value: "true" },
  ],
};

const ROUTED_MODEL_IDS = new Set([
  "default",
  "premium",
  "auto-low",
  "auto-medium",
  "auto-high",
]);

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function optionalBoolean(value: unknown): boolean {
  return value === true;
}

function parameterValue(value: unknown): ModelParameterValue | null {
  const raw = record(value, "Model parameter value");
  if (typeof raw.id !== "string" || typeof raw.value !== "string") return null;
  return { id: raw.id, value: raw.value };
}

function variant(value: unknown): ModelVariant {
  const raw = record(value, "Model variant");
  const values = Array.isArray(raw.parameterValues)
    ? raw.parameterValues.map(parameterValue).filter((item) => item !== null)
    : [];
  return {
    parameterValues: values,
    isMaxMode: optionalBoolean(raw.isMaxMode),
    isDefaultMaxConfig: optionalBoolean(raw.isDefaultMaxConfig),
  };
}

function modelEffort(value: unknown): "standard" | "grind" {
  if (value === 2) return "grind";
  if (typeof value === "string" && value.toUpperCase().endsWith("GRIND")) {
    return "grind";
  }
  return "standard";
}

function primaryModelEffort(raw: JsonRecord): "standard" | "grind" {
  const values = Array.isArray(raw.cloudAgentEffortModes)
    && raw.cloudAgentEffortModes.length > 0
    ? raw.cloudAgentEffortModes
    : [raw.cloudAgentEffortMode];
  const efforts = values.map(modelEffort);
  return efforts.includes("standard") ? "standard" : efforts[0] ?? "standard";
}

function catalogModel(value: unknown): CatalogModel {
  const raw = record(value, "Available model");
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    throw new TypeError("Available model names must be non-empty strings.");
  }
  return {
    raw: { ...raw },
    name: raw.name,
    defaultOn: optionalBoolean(raw.defaultOn),
    visibleInRoutedModelView: optionalBoolean(raw.visibleInRoutedModelView),
    cloudMigrateToModel: typeof raw.cloudMigrateToModel === "string"
      ? raw.cloudMigrateToModel.trim() || undefined
      : undefined,
    primaryEffort: primaryModelEffort(raw),
    variants: Array.isArray(raw.variants) ? raw.variants.map(variant) : [],
  };
}

function deduplicateNamedModels(models: readonly CatalogModel[]): CatalogModel[] {
  const selected = new Map<string, CatalogModel>();
  for (const model of models) {
    const current = selected.get(model.name);
    if (
      current === undefined
      || (current.primaryEffort === "grind" && model.primaryEffort === "standard")
    ) {
      selected.set(model.name, model);
    }
  }
  return [...selected.values()];
}

function defaultMaxVariant(model: CatalogModel): ModelVariant | undefined {
  return model.variants.find((candidate) => candidate.isDefaultMaxConfig)
    ?? model.variants.find((candidate) => candidate.isMaxMode)
    ?? model.variants[0];
}

function fallbackFor(model: CatalogModel): AgentModelSelection {
  const selected = defaultMaxVariant(model);
  return {
    modelId: model.name,
    maxMode: true,
    parameters: selected?.parameterValues.map(({ id, value }) => ({ id, value })) ?? [],
  };
}

/**
 * Reconstructs the shipped renderer's allowed-model projection. With no model
 * filter, the payload passes through and no automatic fallback is selected.
 */
export function projectAvailableModelCatalog(
  payload: unknown,
  modelFilterAllowedIds: readonly string[] | null | undefined,
): ModelCatalogProjection {
  if (payload == null || modelFilterAllowedIds == null) return { payload: null };
  if (modelFilterAllowedIds.length === 0) return { payload };

  const root = record(payload, "Available model response");
  if (!Array.isArray(root.models)) {
    throw new TypeError("Available model response must contain a models array.");
  }
  const filter = new Set(modelFilterAllowedIds);
  const filtered = root.models.map(catalogModel).filter((model) => filter.has(model.name));
  const named = deduplicateNamedModels(
    filtered.filter(
      (model) =>
        !model.visibleInRoutedModelView
        && !ROUTED_MODEL_IDS.has(model.name)
        && model.cloudMigrateToModel === undefined,
    ),
  );
  const sectioned = named.map((model, index) => model.raw.namedModelSectionIndex === undefined
    ? { ...model, raw: { ...model.raw, namedModelSectionIndex: index } }
    : model);
  const selectedByOriginal = new Map(
    named.map((model, index) => [model, sectioned[index]] as const),
  );
  const preferred = sectioned.find((model) => model?.defaultOn) ?? sectioned[0];
  return {
    payload: {
      ...root,
      models: filtered.map((model) => selectedByOriginal.get(model)?.raw ?? model.raw),
    },
    allowedModelIds: new Set(sectioned.map((model) => model?.name).filter((name) => name !== undefined)),
    ...(preferred === undefined ? {} : { fallback: fallbackFor(preferred) }),
  };
}

/** Loads the catalog and restores an invalid persisted default to the shipped fallback. */
export async function reconcileDefaultModelCatalog(input: {
  readonly bridge: Pick<
    AgentDesktopBridge,
    "getAvailableModels" | "getDefaultModel" | "setDefaultModel"
  >;
  readonly modelFilterAllowedIds: readonly string[] | null | undefined;
}): Promise<ModelCatalogReconciliationResult> {
  const [payload, persisted] = await Promise.all([
    input.bridge.getAvailableModels(),
    input.bridge.getDefaultModel(),
  ]);
  const projection = projectAvailableModelCatalog(
    payload,
    input.modelFilterAllowedIds,
  );
  const current = persisted ?? SHIPPED_DEFAULT_AGENT_MODEL;
  const shouldReplace = projection.allowedModelIds !== undefined
    && projection.fallback !== undefined
    && !projection.allowedModelIds.has(current.modelId);
  if (!shouldReplace) {
    return { ...projection, storedModel: current, didReplaceDefault: false };
  }
  const saved = await input.bridge.setDefaultModel(projection.fallback);
  return {
    ...projection,
    storedModel: saved ?? projection.fallback,
    didReplaceDefault: true,
  };
}
