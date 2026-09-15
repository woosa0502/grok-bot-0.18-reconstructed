// An operator toggle can disable a proved feature; it cannot create worker proof.
import fs from "node:fs";
import path from "node:path";

export function sitesOverlayHealth(engine, identity, enabled) {
  const unsupported = { sitesOverlay: false, sitesOverlayProof: null };
  if (!enabled || typeof engine.evaluationCapabilities !== "function") return unsupported;
  // This is host/engine-owned evidence, NEVER populated from POST /sessions or a model response.
  const proof = engine.evaluationCapabilities();
  if (!proof || proof.contract !== "session-sites-v1" || proof.engine !== engine.version ||
      !/^[a-f0-9]{64}$/.test(proof.bundleSha256 ?? "") || proof.workerForwarding !== true ||
      proof.readIsolation !== true || proof.extractionDisabled !== true) return unsupported;
  return { sitesOverlay: true, sitesOverlayProof: { ...proof, instanceId: identity.instanceId } };
}

export function validateSitesOverlayRequest(sitesDir, stateDir, capability) {
  if (sitesDir === undefined) return;
  const error = (message, statusCode = 400) => Object.assign(new Error(message), { code: "INVALID_EVALUATION_OVERLAY", statusCode });
  if (capability.sitesOverlay !== true) throw error("Worker sites overlay has not been proved for this engine instance", 409);
  if (typeof sitesDir !== "string" || !path.isAbsolute(sitesDir)) throw error("Evaluation sitesDir must be an absolute directory");
  let base, target;
  try { base = fs.realpathSync(path.join(stateDir, "learn-eval")); target = fs.realpathSync(sitesDir); }
  catch { throw error("Evaluation directory is missing"); }
  const relative = path.relative(base, target);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || !fs.statSync(target).isDirectory())
    throw error("Evaluation sitesDir must be inside this service's learn-eval root");
}
