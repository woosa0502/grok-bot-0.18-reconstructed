export type TranscriptMirrorRoute = "journal" | "legacy";

export interface TranscriptJournalPort<Checkpoint, Store> {
  ownsConversation(conversationId: string): Promise<boolean>;
  claimConversation(conversationId: string): Promise<void>;
  releaseConversation(conversationId: string): Promise<void>;
  recover(
    ctx: unknown,
    conversationId: string,
    checkpoint: Checkpoint,
    blobStore: Store
  ): Promise<unknown>;
  prepareCheckpoint(
    ctx: unknown,
    conversationId: string,
    checkpoint: Checkpoint,
    blobStore: Store,
    finalizeCheckpoint?: boolean
  ): Promise<unknown>;
  commitCheckpoint(ctx: unknown, conversationId: string): Promise<unknown>;
  abortCheckpoint(ctx: unknown, conversationId: string): Promise<unknown>;
  skipCheckpoint(
    ctx: unknown,
    conversationId: string,
    checkpoint: Checkpoint,
    blobStore: Store
  ): Promise<unknown>;
}

export interface LegacyTranscriptMirrorPort<Checkpoint, Store> {
  write(
    ctx: unknown,
    conversationId: string,
    checkpoint: Checkpoint,
    blobStore: Store,
    stateBlobId: Uint8Array
  ): Promise<unknown>;
}

interface LegacyPending<Checkpoint, Store> {
  readonly checkpoint: Checkpoint;
  readonly blobStore: Store;
}

/**
 * Pins a conversation to one persistence regime. Once a journal marker owns a
 * conversation, turning the experiment off cannot route it back to the legacy
 * writer. Route promises are cached so concurrent first writes cannot race two
 * claims or split a transcript between implementations.
 */
export class RoutedTranscriptMirror<Checkpoint, Store> {
  readonly legacyPending = new Map<
    string,
    LegacyPending<Checkpoint, Store>
  >();

  constructor(
    readonly journal: TranscriptJournalPort<Checkpoint, Store>,
    readonly legacy: LegacyTranscriptMirrorPort<Checkpoint, Store>,
    readonly isJournalEnabled: () => Promise<boolean>,
    readonly routes = new Map<string, Promise<TranscriptMirrorRoute>>()
  ) {}

  route(conversationId: string): Promise<TranscriptMirrorRoute> {
    const selected = this.routes.get(conversationId);
    if (selected != null) return selected;

    const route = this.selectRoute(conversationId);
    this.routes.set(conversationId, route);
    return route;
  }

  private async selectRoute(
    conversationId: string
  ): Promise<TranscriptMirrorRoute> {
    // Ownership-first: once the journal owns a conversation it must keep driving that
    // conversation — checking the enable gate *before* ownership (the previous order) could
    // route an already-journal-owned conversation back to the legacy writer, splitting its
    // checkpoint bookkeeping across the two regimes on the same .jsonl.
    if (await this.journal.ownsConversation(conversationId)) {
      if (await this.isJournalEnabled()) return "journal";
      // The journal is disabled and its recover() lifecycle is unwired here, so it cannot
      // safely keep driving the WAL. Rather than silently flip the route and leave a stale
      // `.journal-mode` marker that would pull the conversation back onto the journal on a
      // later enable (diverging from the legacy writes made in between), migrate it to legacy
      // explicitly by releasing the claim. The committed .jsonl and durable store are kept. (F-002)
      await this.journal.releaseConversation(conversationId);
      return "legacy";
    }
    if (!await this.isJournalEnabled()) return "legacy";
    await this.journal.claimConversation(conversationId);
    return "journal";
  }

  async recover(
    ctx: unknown,
    conversationId: string,
    checkpoint: Checkpoint,
    blobStore: Store
  ): Promise<void> {
    if (await this.route(conversationId) !== "journal") return;
    await this.journal.recover(ctx, conversationId, checkpoint, blobStore);
  }

  async prepareCheckpoint(
    ctx: unknown,
    conversationId: string,
    checkpoint: Checkpoint,
    blobStore: Store,
    finalizeCheckpoint = false,
    writeLegacyCheckpoint = finalizeCheckpoint
  ): Promise<void> {
    if (await this.route(conversationId) === "journal") {
      await this.journal.prepareCheckpoint(
        ctx,
        conversationId,
        checkpoint,
        blobStore,
        finalizeCheckpoint
      );
      return;
    }

    if (writeLegacyCheckpoint) {
      this.legacyPending.set(conversationId, { checkpoint, blobStore });
    }
  }

  async commitCheckpoint(
    ctx: unknown,
    conversationId: string,
    stateBlobId: Uint8Array
  ): Promise<void> {
    if (await this.route(conversationId) === "journal") {
      await this.journal.commitCheckpoint(ctx, conversationId);
      return;
    }

    const pending = this.legacyPending.get(conversationId);
    if (pending == null) return;
    this.legacyPending.delete(conversationId);

    // The legacy mirror is observational. Failure must not roll back a durable
    // agent-store checkpoint or fail the turn.
    await this.legacy.write(
      ctx,
      conversationId,
      pending.checkpoint,
      pending.blobStore,
      stateBlobId
    ).then(
      () => undefined,
      () => undefined
    );
  }

  async abortCheckpoint(
    ctx: unknown,
    conversationId: string
  ): Promise<void> {
    if (await this.route(conversationId) === "journal") {
      await this.journal.abortCheckpoint(ctx, conversationId);
      return;
    }
    this.legacyPending.delete(conversationId);
  }

  async skipCheckpoint(
    ctx: unknown,
    conversationId: string,
    checkpoint: Checkpoint,
    blobStore: Store
  ): Promise<void> {
    let selected = this.routes.get(conversationId);
    let recoverOwnedJournal = false;

    if (selected == null) {
      // Ownership-first, matching selectRoute(): the enable gate must not be consulted before
      // ownership. An owned conversation keeps driving the journal while it is enabled; when it
      // is disabled it is migrated to legacy explicitly (releasing the stale marker) rather than
      // silently disowned by call order.
      if (await this.journal.ownsConversation(conversationId)) {
        if (await this.isJournalEnabled()) {
          recoverOwnedJournal = true;
          selected = Promise.resolve("journal");
          this.routes.set(conversationId, selected);
        } else {
          await this.journal.releaseConversation(conversationId);
          this.routes.set(conversationId, Promise.resolve("legacy"));
          this.legacyPending.delete(conversationId);
          return;
        }
      } else {
        // Unowned: a skip (no state change) must not claim a new journal — the first real
        // prepareCheckpoint does that. Fall through to the legacy path without caching a route.
        this.legacyPending.delete(conversationId);
        return;
      }
    }

    if (await selected === "journal") {
      if (recoverOwnedJournal) {
        await this.journal.recover(
          ctx,
          conversationId,
          checkpoint,
          blobStore
        );
      }
      await this.journal.skipCheckpoint(
        ctx,
        conversationId,
        checkpoint,
        blobStore
      );
      return;
    }

    this.legacyPending.delete(conversationId);
  }

}

// Compatibility names used by earlier recovered modules.
export type TranscriptMirrorPort<Checkpoint, Store> =
  TranscriptJournalPort<Checkpoint, Store>;
export type LegacyMirrorPort<Checkpoint, Store> =
  LegacyTranscriptMirrorPort<Checkpoint, Store>;
