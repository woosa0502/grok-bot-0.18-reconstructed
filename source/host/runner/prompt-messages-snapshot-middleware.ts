import type { MessageLike, PromptExecutor } from "./send-message-reminder-middleware.js";

/**
 * Silent-stop postmortem, part 2 (2026-09-05): the closing send nudge's detector read the prompt
 * messages through a getter bound to "the executor created last". The real Agent builds a fresh
 * executor for every runStream/summary/step and restores state into it, so the getter could end up
 * on a stale snapshot (pre-compaction, or an empty summarization executor) and the detector saw a
 * turn that had "already reported" — the nudge never fired once in four days of transcripts.
 *
 * This middleware sits innermost in the executor chain and records, on every model call, exactly the
 * messages the model was given (reminders included). The settle step reads that recording: it is
 * what the model last saw, independent of which executor instance happens to be current.
 */
export interface PromptMessagesRecorder {
  /** Messages handed to the model on the most recent stream() of this turn ([] before the first). */
  latest(): readonly MessageLike[];
  record(messages: readonly MessageLike[]): void;
}

export function createPromptMessagesRecorder(): PromptMessagesRecorder {
  let latest: readonly MessageLike[] = [];
  return {
    latest: () => latest,
    record: (messages) => { latest = [...messages]; },
  };
}

export class PromptMessagesSnapshotMiddleware implements PromptExecutor {
  constructor(readonly innerExecutor: PromptExecutor, readonly recorder: PromptMessagesRecorder) {}
  getMessages(): readonly MessageLike[] { return this.innerExecutor.getMessages(); }
  getState(): readonly MessageLike[] { return this.innerExecutor.getState(); }
  clearMessages(): void { this.innerExecutor.clearMessages(); }
  appendMessages(messages: MessageLike | readonly MessageLike[]): void { this.innerExecutor.appendMessages(messages); }
  stream(...args: any[]): unknown {
    // Innermost wrapper: every outer reminder middleware has already appended its message, so this
    // is the exact list the provider call receives.
    this.recorder.record(this.innerExecutor.getMessages());
    return this.innerExecutor.stream(...args);
  }
}

export function createPromptMessagesSnapshotMiddleware(recorder: PromptMessagesRecorder) {
  return (executor: PromptExecutor) => new PromptMessagesSnapshotMiddleware(executor, recorder);
}
