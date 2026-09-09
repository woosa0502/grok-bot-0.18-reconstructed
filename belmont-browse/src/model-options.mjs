/** Convert CLI/HTTP selection fields without inventing an override for omitted input. */
export function modelOverrides({ model, provider, thinking, fastMode } = {}) {
  if (model !== undefined && typeof model !== "string" && (!model || typeof model !== "object" || Array.isArray(model))) {
    throw Object.assign(new TypeError("model must be a model ID or selection object"), { statusCode: 400, code: "INVALID_MODEL" });
  }
  const result = typeof model === "string" ? { modelId: model } : { ...model };
  for (const [key, value] of Object.entries({ provider, thinkingLevel: thinking, fastMode })) {
    if (value !== undefined) result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}
