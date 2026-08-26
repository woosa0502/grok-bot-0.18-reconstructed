import type { ReactNode } from "react";
import {
  TranscriptCardActionAnchor,
  TranscriptCardInteractionProvider,
  type TranscriptCardInteractionContext,
} from "../cards/transcript-card/message-actions";
import { ThreadAffordance } from "../cards/transcript-card/thread-affordance";
import type { TranscriptComputerHandoff, TranscriptPermissionRequest } from "./model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5105657 (Roe)

interface SharedFrameProps {
  readonly children: ReactNode;
  readonly interactions?: TranscriptCardInteractionContext;
  readonly isReadOnly: boolean;
  readonly threadRootId: string | null;
}

export function ProjectedThreadActionEntryFrame({
  entry,
  children,
  interactions,
  isReadOnly,
  threadRootId,
}: SharedFrameProps & { readonly entry: TranscriptComputerHandoff | TranscriptPermissionRequest }) {
  const content = <TranscriptCardActionAnchor entry={entry} isReadOnly={isReadOnly} threadRootId={threadRootId}>
    <div data-entry-id={entry.id} role="article">{children}</div>
  </TranscriptCardActionAnchor>;
  return interactions == null
    ? content
    : <TranscriptCardInteractionProvider value={interactions}>{content}</TranscriptCardInteractionProvider>;
}

export function ProjectedThreadSummaryEntryFrame({
  entryId,
  children,
  interactions,
  isReadOnly,
  threadRootId,
}: SharedFrameProps & { readonly entryId: string }) {
  const summary = interactions != null && threadRootId == null && !isReadOnly
    ? interactions.getThreadSummary(entryId)
    : null;
  if (summary == null || interactions == null) return <>{children}</>;
  return <div className="sand-thread-root-group">
    {children}
    <ThreadAffordance onOpen={interactions.openThread} role="assistant" summary={summary} />
  </div>;
}
