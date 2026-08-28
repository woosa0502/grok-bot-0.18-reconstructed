import type { Context } from "../../packages/context/core.js";
import type { PrivacyMode } from "../../packages/redaction/privacy-mode.js";
import type {
  ConversationAction,
  ConversationStateStructure,
} from "../../packages/proto/generated/agent/v1/agent_pb.js";
import {
  createTurnAgentStreamStart,
  type BuiltTurnAgentForRun,
} from "./turn-agent-composition.js";
import {
  createStreamAttempt,
  type StreamAttemptHost,
} from "./stream-attempt.js";
import { isTransientStreamError } from "./transient-stream-error.js";

type ProductionAttemptHost = Omit<
  StreamAttemptHost<Context, ConversationStateStructure, ConversationStateStructure>,
  "persistCheckpoint" | "startStream"
>;

export interface RecoveredProductionStreamRetryInput {
  readonly agent: Pick<BuiltTurnAgentForRun, "agent">;
  readonly baseState: ConversationStateStructure;
  readonly action: ConversationAction;
  readonly privacyMode: PrivacyMode;
  readonly mcpTools: readonly unknown[];
  readonly attempt: ProductionAttemptHost;
  readonly persistCheckpoint: (
    context: Context,
    checkpoint: ConversationStateStructure,
  ) => Promise<void> | void;
  readonly onCheckpointAccepted?: (
    checkpoint: ConversationStateStructure,
  ) => void;
}

/**
 * Restores the missing production join between the real Agent stream and the
 * original retry/checkpoint owner. A caller may replace the current one-shot
 * startStream call with `createRecoveredProductionStreamRetry(input).run()`.
 *
 * Persistence completes before a checkpoint becomes eligible for resume, so
 * a failed write can never promote an in-memory checkpoint to retry state.
 */
export function createRecoveredProductionStreamRetry(
  input: RecoveredProductionStreamRetryInput,
) {
  let acceptedCheckpointForAttempt = false;
  const stream = createTurnAgentStreamStart({
    agent: input.agent,
    baseState: input.baseState,
    action: input.action,
    privacyMode: input.privacyMode,
    mcpTools: input.mcpTools,
  });

  const automation = input.attempt.transientStreamRetry;
  const guardedAutomation = automation === undefined
    ? undefined
    : {
        ...automation,
        isRetryable: (error: unknown): boolean => {
          const safe = !input.attempt.getStreamOutputProduced()
            || acceptedCheckpointForAttempt;
          const classify = automation.isRetryable ?? isTransientStreamError;
          return safe && classify(error);
        },
      };

  return createStreamAttempt({
    ...input.attempt,
    ...(guardedAutomation === undefined
      ? {}
      : { transientStreamRetry: guardedAutomation }),
    startStream: (context, resumeFrom, persistCheckpoint) => {
      acceptedCheckpointForAttempt = false;
      return stream.startStream(context, resumeFrom, persistCheckpoint);
    },
    persistCheckpoint: async (context, checkpoint, accepted) => {
      await input.persistCheckpoint(context, checkpoint);
      accepted(checkpoint);
      acceptedCheckpointForAttempt = true;
      input.onCheckpointAccepted?.(checkpoint);
    },
  });
}
