import type { HostExtensionContext } from "../../../internal/host-extensions.js";
import {
  createDeadlinePolicy,
  createRealDebouncePolicy,
  createRealPollingPolicy,
  createRealRetryPolicy,
  realClock
} from "../../../internal/scheduling.js";
import { getSandAgentsRootDir } from "../../storage/agent-paths.js";
import { getSandRootDir } from "../../host-paths.js";
import { SAND_SUMMARIZATION_MODEL_ID } from "../../../shared/agents/sand-agent-model.js";
import type { MemoryExtensionContext } from "./extension.js";
import {
  MEMORY_CHANGE_DEBOUNCE_MS,
  type MemoryService
} from "./memory-service.js";
import {
  MEMORY_SYNTHESIS_DEADLINE_MS,
  MEMORY_SYNTHESIS_DEBOUNCE_MS,
  MEMORY_SYNTHESIS_POLL_INTERVAL_MS,
  MEMORY_SYNTHESIS_RETRY_ATTEMPTS,
  MEMORY_SYNTHESIS_RETRY_INITIAL_MS,
  MEMORY_SYNTHESIS_RETRY_MAX_MS,
  MemorySynthesisAttemptError,
  MemorySynthesisService,
  memorySynthesisTelemetryReport
} from "./memory-synthesis-service.js";

type ProductionContext = HostExtensionContext<unknown> & {
  readonly deps: MemoryExtensionContext["deps"];
};

/** Artifact construction at host-main.cjs:626827-626891. */
export function createMemoryProductionExtras(
  context: ProductionContext
): Omit<MemoryExtensionContext, "deps" | "onStop"> {
  return {
    sandRoot: getSandRootDir(),
    agentsRootDir: getSandAgentsRootDir(),
    debounce: createRealDebouncePolicy({
      name: "sand-memory-change",
      delayMs: MEMORY_CHANGE_DEBOUNCE_MS
    }),
    createSynthesis(service: MemoryService) {
      return new MemorySynthesisService({
        debounce: createRealDebouncePolicy({
          name: "sand-memory-synthesis",
          delayMs: MEMORY_SYNTHESIS_DEBOUNCE_MS
        }),
        deadline: createDeadlinePolicy(realClock, {
          name: "sand-memory-synthesis-inference",
          timeoutMs: MEMORY_SYNTHESIS_DEADLINE_MS
        }),
        polling: createRealPollingPolicy({
          name: "sand-memory-temporal-refresh",
          intervalMs: MEMORY_SYNTHESIS_POLL_INTERVAL_MS
        }),
        retry: createRealRetryPolicy({
          name: "sand-memory-synthesis-retry",
          maxAttempts: MEMORY_SYNTHESIS_RETRY_ATTEMPTS,
          initialDelayMs: MEMORY_SYNTHESIS_RETRY_INITIAL_MS,
          maxDelayMs: MEMORY_SYNTHESIS_RETRY_MAX_MS,
          // A verifier rejection is a deliberate semantic verdict, not a
          // transient failure — retrying re-runs the full 2-call
          // propose+verify cycle for the same answer. Parse flakes
          // ("invalid-output") and transport errors stay retryable.
          shouldRetry: error => !(
            error instanceof MemorySynthesisAttemptError
            && error.outcome === "rejected"
          )
        }),
        getTarget: agentId => service.synthesisTargetForAgent(agentId),
        listTargets: () => service.listSynthesisTargets().map(({ agentId, store }) => ({
          agentId,
          target: store
        })),
        createExecutor: () => {
          // Synthesis runs on the summarization channel. createSummarizationSession is
          // provider-aware: the Cursor path keeps the artifact's gemini-2.5-flash
          // request, while a routed local provider (Pi Codex) substitutes its own
          // configured model — the raw createSession call forwarded the gemini id
          // verbatim and Pi rejects it ("Unknown Pi Codex model") on every attempt.
          const port = context.deps.inference.port;
          const session = port.createSummarizationSession != null
            ? port.createSummarizationSession(() => {}, {
                modelId: SAND_SUMMARIZATION_MODEL_ID,
                skipLabeling: true
              })
            : port.createSession(() => {}, {
                modelId: SAND_SUMMARIZATION_MODEL_ID,
                isSummarizationSession: true,
                skipLabeling: true
              });
          return session.getExecutor();
        },
        report: event => context.deps.telemetry.logs.reportMemorySynthesis(memorySynthesisTelemetryReport(event))
      });
    }
  };
}
