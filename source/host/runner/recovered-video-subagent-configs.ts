import { VIDEO_REVIEW_SUBAGENT_CONFIG } from "../../packages/agent/tools/cloud-agents/subagent/video-review-subagent.js";
import { createWatchVideoSubagentConfig } from "../../packages/agent/tools/cloud-agents/subagent/watch-video-subagent.js";

/**
 * Produces the two original video configurations as one host-owned list.
 * This module is intentionally not wired into the live turn composition yet.
 */
export function createRecoveredVideoSubagentConfigs() {
  return [
    VIDEO_REVIEW_SUBAGENT_CONFIG,
    createWatchVideoSubagentConfig({ includeVideoReviewReference: true }),
  ] as const;
}
