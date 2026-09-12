// Additive overlay. Kernel files are installed alongside this file under ./kernel/.
// This does not silently replace MemoryService or change existing UI contracts.
export { createLearningRuntime, MemoryLearningHostHooks } from "./kernel/index.js";
export type { ActionRequest, GroundedAction, ExperienceEnvelope } from "./kernel/index.js";
