# Grok Bot 원장 누락 감사 — 독립 재추출 대조

- 생성: 2026-08-25, 울트라코드 워크플로우(9표면 독립추출 → 원장 344 대조)
- 원장 등록: 344개 / 독립 추출 누락 합계: **1412건** (표면 내 dedup 전)
- 판정: 원장은 전수 아님(스스로 IN_PROGRESS·분모 미동결). 아래는 코드에 있으나 원장에 없는 원자 기능.


## Renderer · 대화/작성/전사/첨부/미디어/검색/음성  (누락 189건, 추출 273 / 매칭 84)
- 표면 판정: ~31% of atomic renderer features are represented (84/273). The ledger captures coarse send/receive/attach/react/find/sidebar capabilities (CHAT/ATT/SEARCH/BOT rows) but misses nearly the entire rich-rendering layer (markdown, code+copy, KaTeX math, mermaid, PDF, spreadsheet, media viewer), the message lifecycle (queued/failed/offline sends, threads, reply-quotes, dividers), the composer rich-text editor (@/slash/#/emoji suggestions, paste-files), voice edge/error/progress states, and the email/slack/link/timeline/connector/tool-result cards.

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | Composer | Paste files into the prompt editor → The pasted files are staged as attachments | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:handlePaste` |
| high | Voice | Transcription returns non-empty text → The transcribed text is inserted into the editor and the editor refocuses | `frontend/src/recovered/features/conversation/workspace/composer.tsx:85` |
| high | Composer/Editor | Type '@' followed by a query → A Mention listbox appears with matching members/workflows/MCP references | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:mentionSuggestion` |
| high | Composer/Editor | Type '/' followed by a query → A 'Reference a skill' workflow listbox appears with matching workflows/actions | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:workflowSuggestion` |
| high | Composer/Editor | Type '#' followed by digits/title → A Pull request listbox appears with up to 8 matching PR candidates | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:prSuggestion` |
| high | Composer/Editor | Type ':' followed by 2+ characters → An Emoji listbox appears with matching emoji (max 96) | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:emojiExtension` |
| high | Transcript | Receive an assistant message with markdown → Headings, lists, tables, blockquotes, horizontal rules, and paragraphs render | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:AssistantTextBlock` |
| high | Transcript | Assistant text contains inline/display math → KaTeX-rendered math is displayed (falls back to code text while loading) | `frontend/src/recovered/features/conversation/workspace/math.tsx:AssistantMath` |
| high | Transcript | Assistant sends a fenced code block → A code figure with syntax class and a Copy code button renders | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:AssistantCodeBlock` |
| high | Transcript | Click the Copy code button on a code block → The code is written to clipboard and the button shows 'Copied' for ~1.2s | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:AssistantCodeCopyButton` |
| high | Transcript | Assistant sends a mermaid code block → A rendered Mermaid diagram figure is shown (falls back to code on failure) | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:455` |
| high | Transcript | Click a tool-call row → The row expands to show the summary and any tool-result card; clicking again collapses | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:TranscriptToolCallRow` |
| high | Transcript | A user message fails to send → 'Failed to send' plus Resend and Delete buttons are shown | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:FailedSendActions` |
| high | Transcript | Click Resend on a failed message → onResendFailedSend fires for that entry | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:81` |
| high | Transcript | Open the More message-actions menu and click Start a thread → onStartThread fires for the message | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:217` |
| high | Transcript | A message has a thread with replies → A 'View thread, N replies' affordance is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/thread-affordance.tsx:ThreadAffordance` |
| high | Transcript | Click the View thread affordance → onOpen(rootId) opens the thread | `frontend/src/recovered/features/conversation/cards/transcript-card/thread-affordance.tsx:26` |
| high | PDF viewer | Click a PDF attachment chip → A modal PDF viewer opens rendering pages with page count in the header | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:PdfAttachmentViewer` |
| high | Spreadsheet viewer | Open a spreadsheet attachment → A modal table viewer renders the sheet with a row count in the header | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx:SpreadsheetViewer` |
| high | Email draft card | View an editable email draft → To/Subject/Message fields, 'Ready to send', and Send email/Discard buttons render | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx:EmailDraftTranscriptCard` |
| high | Slack draft card | View an editable Slack draft → Workspace/To/Thread rows, a message field, and Send message/Discard buttons render | `frontend/src/recovered/features/conversation/cards/transcript-card/views/slack-draft.tsx:SlackDraftTranscriptCard` |
| high | Tool result card | Expand a tool-result card → The command/path heading, status, working directory, output, and diff render | `frontend/src/recovered/features/conversation/tool-results/view.tsx:ToolResultCard` |
| medium | Composer | Enter text or add an attachment → The prompt shell expands (data-expanded) and the Send button appears | `frontend/src/recovered/features/conversation/workspace/composer.tsx:162` |
| medium | Composer | Attach a file while voice is recording/processing → Attach button is disabled (voiceBusy) | `frontend/src/recovered/features/conversation/workspace/composer.tsx:200` |
| medium | Composer | Receive an attachment notice (e.g. limit warning) → A polite live-region status message is shown above the editor | `frontend/src/recovered/features/conversation/workspace/composer.tsx:164` |
| medium | Voice | Transcription is in progress → A 'Transcribing…' spinner status replaces the mic/send buttons | `frontend/src/recovered/features/conversation/workspace/composer.tsx:211` |
| medium | Voice | Deny microphone permission → Error 'Microphone access denied...' is shown and the session is non-recoverable | `frontend/src/recovered/features/conversation/workspace/voice.tsx:errorCode` |
| medium | Voice | Start voice with no microphone device → Error 'No microphone found...' is shown | `frontend/src/recovered/features/conversation/workspace/voice.tsx:DEFAULT_ERROR_MESSAGES` |
| medium | Voice | Record for less than 500ms then stop → The recording is discarded and the session returns to idle without transcribing | `frontend/src/recovered/features/conversation/workspace/voice.tsx:VOICE_MIN_RECORDING_MS` |
| medium | Voice | Record continuously up to 5 minutes → Recording auto-stops at the 300000ms ceiling and transcribes | `frontend/src/recovered/features/conversation/workspace/voice.tsx:VOICE_MAX_RECORDING_MS` |
| medium | Composer/Editor | Type '@' with no matches → The listbox shows 'No matches for query' or 'Nothing to mention yet' | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:477` |
| medium | Composer/Editor | Press ArrowDown/ArrowUp in an open suggestion listbox → The active option moves and wraps around the list | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:onKeyDown` |
| medium | Composer/Editor | Press Enter or Tab in an open suggestion listbox → The active suggestion is inserted as a chip/emoji | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:onKeyDown` |
| medium | Composer/Editor | Press Escape in an open suggestion listbox → The listbox is dismissed without inserting | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:onKeyDown` |
| medium | Composer/Editor | Select a mention suggestion → A @mention chip is inserted followed by a space | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:mentionSuggestion.command` |
| medium | Composer/Editor | Press Cmd/Ctrl+V while focus is outside the prompt → Editor focus is restored and pasted text is inserted (or files staged) | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:onPaste` |
| medium | Composer/Editor | Persisted rich text JSON is malformed → The editor falls back to the plain-text prompt content | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:promptEditorContent` |
| medium | Transcript | Assistant text contains a task-list item → A checkbox (checked/unchecked) renders before the item text | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:416` |
| medium | Transcript | Assistant text contains an http(s) link → A link opens in a new tab with rel=noopener; non-http URLs render as plain text | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:renderAssistantInlineText` |
| medium | Transcript | KaTeX fails to render an expression → A red katex-error span with the raw expression and title is shown | `frontend/src/recovered/features/conversation/workspace/math.tsx:renderKatexMarkup` |
| medium | Transcript | Assistant message includes images → An 'Agent attachments' image strip renders below the text | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:SendMessageTextImages` |
| medium | Transcript | Assistant message has a channel tag → A channel tag chip with a 'Sent to {channel}' title is shown | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:543` |
| medium | Transcript | Tool call is pending/failed → A spinning loading icon (pending) or an x-circle icon (failed) shows on the row | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:toolCallIconName` |
| medium | Transcript | Click a Thinking row → The thinking text expands/collapses | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:TranscriptThinkingRow` |
| medium | Transcript | A user message is queued and transport is up → A 'Waiting to send…' status with a Cancel button is shown | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:QueuedSendNotice` |
| medium | Transcript | A user message is queued while transport is down → A 'Will send when reconnected' status is shown | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:73` |
| medium | Transcript | Click Cancel on a queued send → onCancelQueuedSend fires for that entry | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:74` |
| medium | Transcript | Click Delete on a failed message → onDeleteFailedSend fires for that entry | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:82` |
| medium | Transcript | A user message was composed while offline → A 'Sent while offline · {date}' notice with a formatted timestamp is shown | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:SentWhileOfflineNotice` |
| medium | Transcript | Open the More menu and click Copy → The message text is copied (Copy item present only when onCopy provided) | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:219` |
| medium | Transcript | View a message that is read-only or failed/pending/queued → Copy/reply/thread actions are suppressed (not actionable) | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:isOrdinaryMessageActionable` |
| medium | Transcript | A message is a reply to another message → A reply-quote preview button shows the referenced message label | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:776` |
| medium | Transcript | Click a reply quote whose target is in scope → Jumps to the replied message ('Jump to replied message') | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx:ReplyQuote` |
| medium | Transcript | Click a reply quote whose target is out of scope → Opens the reply thread ('Open reply thread') | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx:109` |
| medium | Transcript | Hover/focus a reply quote → A referenced-message preview tooltip with author, time and quoted content appears | `frontend/src/recovered/features/conversation/workspace/referenced-message-preview.tsx:ReferencedMessagePreviewTrigger` |
| medium | Transcript | There are unread new messages → An unread divider showing 'N new message(s)' is rendered | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:702` |
| medium | Transcript | View a retired permission-request entry → A read-only permission-request row with the permission title is rendered | `frontend/src/recovered/features/conversation/cards/permission-request/view.tsx:PermissionRequestLeaf` |
| medium | Reactions | A message has grouped reactions → Reaction pills render with emoji and count>1, aria-pressed if mine | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-picker.tsx:ReactionPills` |
| medium | Emoji picker | Click 'More emoji' to expand the full picker → An emoji picker with a search field and category sections opens | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx:EmojiPickerContentView` |
| medium | Emoji picker | Type a query in the emoji search field → A Results section shows matching emoji (up to the search limit) | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx:searchEmoji` |
| medium | Emoji picker | Click an emoji cell → The emoji is selected (onSelect) for the reaction | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx:EmojiCell` |
| medium | Attachments/Media | An audio attachment is present → An inline audio player with controls renders | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:207` |
| medium | Attachments/Media | Media viewer opens with multiple items → Prev/Next nav buttons, a 'Media N of M' title, and a filmstrip render | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:MediaViewer` |
| medium | Attachments/Media | Press ArrowLeft/ArrowRight in the media viewer → The viewer cycles to the previous/next media item | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:onKeyDown` |
| medium | Attachments/Media | Scroll the mouse wheel over the media image → The image zooms in/out (clamped between 1x and 5x) | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:onWheel` |
| medium | Attachments/Media | Drag the zoomed media image → The image pans within the viewer | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:onPointerMove` |
| medium | PDF viewer | Open a PDF larger than the 25MB preview cap → 'PDF too large to preview' with a Download button is shown | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:376` |
| medium | PDF viewer | PDF fails to render → 'Couldn't render this PDF' with a Download button is shown | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:379` |
| medium | PDF viewer | Click Zoom in/out in the PDF toolbar or press +/- → Pages scale between 0.5x and 4x | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:onKeyDown` |
| medium | PDF viewer | Press PageDown/PageUp/Arrow keys in the PDF viewer → The current page advances/retreats and scrolls into view | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:361` |
| medium | PDF viewer | Click the Download button in the PDF header → onDownload fires to save the file | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:386` |
| medium | Spreadsheet viewer | Open a spreadsheet too large to preview → 'Spreadsheet too large to preview' with a Download link is shown | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx:134` |
| medium | Spreadsheet viewer | Workbook has multiple sheets; click a sheet tab → The selected sheet's table is shown (aria-pressed on active tab) | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx:171` |
| medium | Spreadsheet viewer | Click a non-empty cell → A cell-detail panel shows the column/row label and full cell text | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx:selectCell` |
| medium | Mermaid viewer | Click a rendered mermaid diagram or its expand button → A full-screen diagram viewer opens | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx:MermaidDiagramFigure` |
| medium | Mermaid viewer | Diagram source is invalid → 'Couldn't render this diagram.' note plus the code fallback are shown | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx:221` |
| medium | Auto-review approval card | Approval resolves to Always allow → A note that a rule was added to Auto-review settings (with redacted rule) is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/auto-review-approval.tsx:settledNote` |
| medium | Auto-review approval card | View a command whose summary contains secrets → URLs and credential-like values in the proposed rule are redacted | `frontend/src/recovered/features/conversation/cards/transcript-card/views/auto-review-approval.tsx:redactProposedRule` |
| medium | Connector card | Click Add on a connector → The connector connect flow starts (provider.connect) | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx:connect` |
| medium | Connector card | Connector needs auth → The action button shows 'Authorize' and triggers authenticate | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx:actionLabel` |
| medium | Connector card | Connector authorization fails → '{name} authorization didn't finish.' with a Retry button is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx:108` |
| medium | Connector card | Connector is managed by team policy → A 'Team' badge is shown and the action is disabled/hidden | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx:disabledByPolicy` |
| medium | Connector card | View suggested related connectors → Up to 4 suggestion buttons render; clicking one connects it | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx:connectSuggestion` |
| medium | Connectors list card | View a connectors list message → A card per connector is rendered with per-connector status/actions | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connectors.tsx:ConnectorsTranscriptCard` |
| medium | Cloud agent card | Click the title or View PR when a PR exists → onOpenPullRequest opens the PR url | `frontend/src/recovered/features/conversation/cards/transcript-card/views/cloud-agent.tsx:onOpenPr` |
| medium | Cloud agent card | Click Open in Cursor → provider.open opens the cloud agent in Cursor | `frontend/src/recovered/features/conversation/cards/transcript-card/views/cloud-agent.tsx:onOpen` |
| medium | Email draft card | Enter invalid recipients or empty body → The Send email button is disabled (valid false) | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx:valid` |
| medium | Email draft card | Email draft is sent → A 'Sent to {recipient} — {subject}' summary is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx:EmailSent` |
| medium | Slack draft card | Slack draft is sending/sent → 'Sending…' status while sending; a 'Sent to {target}' summary once sent | `frontend/src/recovered/features/conversation/cards/transcript-card/views/slack-draft.tsx:SlackSent` |
| medium | Link card | View a bare-link message/attachment → A link card with title, description, image, and hostname renders | `frontend/src/recovered/features/conversation/cards/transcript-card/views/link-card.tsx:LinkCardView` |
| medium | Link card | Click a link card → The URL opens externally (provider.openExternal) instead of navigating | `frontend/src/recovered/features/conversation/cards/transcript-card/views/link-card.tsx:openExternal` |
| medium | Timeline event card | View a channel-connected/disconnected or name-changed event → A single-line event description with a timestamp renders | `frontend/src/recovered/features/conversation/cards/timeline-event.tsx:TimelineEventCard` |
| medium | Timeline event card | View an automation-changed event → An event row with an 'Open routine {name}' button renders | `frontend/src/recovered/features/conversation/cards/timeline-event-automation.tsx:AutomationChangedTimelineEventCard` |
| medium | Timeline event card | Click the Open routine button → onOpenAutomation fires with the automation id | `frontend/src/recovered/features/conversation/cards/timeline-event-automation.tsx:48` |
| medium | Tool result card | Tool result is streaming → The output region is a polite live log (aria-live) | `frontend/src/recovered/features/conversation/tool-results/view.tsx:52` |
| medium | Conversation outline | Outline has subagents → Tabs render for the conversation and each subagent with a status marker | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx:OutlineTabs` |
| medium | Transcript load error | The transcript fails to load → A 'Couldn't load conversation' alert with a Retry button is shown | `frontend/src/recovered/features/conversation/workspace/transcript-load-error.tsx:TranscriptLoadErrorSurface` |
| medium | Transcript load error | Click Retry on the transcript error → onRetry fires to reload the conversation | `frontend/src/recovered/features/conversation/workspace/transcript-load-error.tsx:22` |
| medium | Chat header | Click the agent identity when settings toggle is available → onToggleSettings fires (opens agent settings, aria-expanded reflects state) | `frontend/src/recovered/features/conversation/workspace/chat-header.tsx:32` |
| medium | Chat header | Toggle the computer/info control (non-group agent) → onToggleInfo fires to open/close the details panel | `frontend/src/recovered/features/conversation/workspace/chat-header.tsx:35` |
| medium | Sidebar | Cmd/Ctrl-click an agent row → The agent is toggled into the multi-select set | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:252` |
| medium | Sidebar | Shift-click an agent row → A range selection of agents is made | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:256` |
| medium | Sidebar | An agent has a draft/waiting-reason/last message → The row shows 'Draft: …' / 'Waiting for you: …' / the last message preview | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:210` |
| medium | Sidebar | An agent is working → The row shows a Working activity preview and a status corner dot | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:275` |
| medium | Sidebar | An agent needs attention or has unread → A 'Needs attention'/'Unread activity' marker (dot) is shown | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-status.ts:projectSidebarAgentStatus` |
| medium | Sidebar | Hover/focus an agent row (preview enabled) → A hover-card preview with avatar, time, and draft/last-entry text appears | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-preview-content.tsx:AgentPreviewCompositor` |
| low | Composer | Drag content that is not files over the composer → No drop overlay appears (hasFileDragData false) | `frontend/src/recovered/features/conversation/workspace/composer.tsx:hasFileDragData` |
| low | Composer | Reply target is an image/file/link → The composer placeholder changes to 'Reply to attachment…/file…/link…' | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx:replyComposerPlaceholder` |
| low | Composer | Have no reply target → Placeholder shows the default 'Ask anything, or drop a file.' | `frontend/src/recovered/features/conversation/workspace/composer.tsx:71` |
| low | Composer | Send is accepted (acceptedSendGeneration increments) → The editor content is cleared | `frontend/src/recovered/features/conversation/workspace/composer.tsx:96` |
| low | Voice | No audio stream (waveform static state) → The waveform draws a static bar pattern instead of live frequency bars | `frontend/src/recovered/features/conversation/workspace/voice.tsx:drawStatic` |
| low | Composer/Editor | Press Ctrl+A/Ctrl+E on macOS in the editor → Caret moves to the start/end of the current visual line (emacs line motion) | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx:MacEmacsLineMotion` |
| low | Transcript | Expand a tool-call with no summary → 'No additional details.' is shown | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:588` |
| low | Transcript | Right-click over a link/image/input or an active selection → The native context menu is allowed; the actions menu does not open | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:isMessageContextTargetExcluded` |
| low | Transcript | Press Escape with the message actions menu open → The menu closes and focus returns to the trigger | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:handleKeyDown` |
| low | Transcript | Pointer-down outside an open message actions menu → The menu closes without restoring focus | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:handlePointerDown` |
| low | Transcript | Thread summary has zero/invalid count → No thread affordance is rendered | `frontend/src/recovered/features/conversation/cards/transcript-card/thread-affordance.tsx:19` |
| low | Transcript | The reply target message was deleted/unavailable → The quote shows '(deleted)' / preview shows '(unavailable)' | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx:replyQuoteLabel` |
| low | Transcript | View a time boundary between message groups → A time-separator divider with a label is rendered | `frontend/src/recovered/features/conversation/workspace/transcript.tsx:701` |
| low | Transcript | View a notice transcript entry → A notice card with text and timestamp is rendered | `frontend/src/recovered/features/conversation/cards/notice/view.tsx:TranscriptNoticeCard` |
| low | Reactions | Hover a reaction pill → A tooltip 'X reacted with {emoji}' (You for self) is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-picker.tsx:reactionTooltip` |
| low | Reactions | Reaction transport fails → The failure is silently swallowed (no error copy) | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-actions.ts:react` |
| low | Reactions | Press Escape with the reaction picker open → The picker closes and focus returns to the trigger | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-picker.tsx:onKeyDown` |
| low | Reactions | No agentId/transport/controller available for reactions → The reaction action/pills do not render (canReact false) | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-picker.tsx:MessageReactionAction` |
| low | Emoji picker | Search a query with no matches → 'No emoji found' is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx:189` |
| low | Emoji picker | Emoji catalog is still loading → 'Loading emoji…' status is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx:statusView` |
| low | Emoji picker | Emoji catalog fails to load → A fail-closed error live-region (alert) with no invented copy is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx:77` |
| low | Emoji picker | Use arrow keys/Home/End on an emoji cell → Focus moves across the 8-column grid to the destination cell | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx:emojiGridDestination` |
| low | Attachments/Media | Media is loading in a card → A 'Loading media…' status is shown | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:209` |
| low | Attachments/Media | Press Escape in the media viewer → The viewer closes and focus is restored to the trigger | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:118` |
| low | Attachments/Media | Double-click the media image → The image resets to fit (1x, centered) | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:fit` |
| low | Attachments/Media | Click a filmstrip thumbnail → The viewer jumps to that media item | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:194` |
| low | Attachments/Media | Click the media viewer backdrop or close (×) → The viewer closes | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:185` |
| low | Attachments/Media | Media fails to load in the viewer → 'Couldn't load media' alert is shown | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:177` |
| low | Attachments/Media | View a non-previewable file attachment → A file chip with icon, name, kind and size renders | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx:210` |
| low | PDF viewer | PDF bytes are still loading → 'Loading PDF…' status is shown | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:381` |
| low | PDF viewer | PDF file is missing → 'File unavailable' alert is shown | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:378` |
| low | PDF viewer | Press Escape or click the backdrop in the PDF viewer → The viewer closes and focus is restored | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx:357` |
| low | Spreadsheet viewer | Spreadsheet is loading → 'Loading spreadsheet…' status is shown | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx:133` |
| low | Spreadsheet viewer | Spreadsheet is missing or unreadable → 'File unavailable' / 'Couldn't read this spreadsheet' is shown | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx:135` |
| low | Spreadsheet viewer | View a sheet with no data rows → 'This sheet is empty' is shown | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx:86` |
| low | Spreadsheet viewer | Press Escape / click backdrop / close (×) → The spreadsheet viewer closes | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx:151` |
| low | Mermaid viewer | Scroll wheel / +/- keys / zoom buttons in the diagram viewer → The diagram zooms between 0.1x and 8x | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx:zoom` |
| low | Mermaid viewer | Press 0/f or double-click / click Fit in the diagram viewer → The diagram fits to the viewport | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx:fit` |
| low | Mermaid viewer | Drag the diagram → The diagram pans (cursor becomes grabbing) | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx:onPointerMove` |
| low | Mermaid viewer | Press Escape or click Close in the diagram viewer → The diagram viewer closes | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx:onKeyDown` |
| low | Find in chat | Query has no matches → Prev/Next buttons are disabled (hasMatches false) | `frontend/src/recovered/features/conversation/workspace/find-in-chat.tsx:192` |
| low | Find in chat | Search text spanning excluded regions (inputs, timestamps, reply quotes) → Those regions are skipped and not highlighted | `frontend/src/recovered/features/conversation/workspace/find-in-chat.tsx:FIND_EXCLUDED_SELECTOR` |
| low | Widget card | View a widget after it was answered → A resolved state shows the selected option with a check | `frontend/src/recovered/features/conversation/cards/transcript-card/views/widget.tsx:WidgetResolved` |
| low | Widget card | View a widget after it was dismissed → A dismissed state with a 'Dismissed' pill is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/widget.tsx:WidgetDismissed` |
| low | Widget card | Widget is stale/response pending or no agent scope → Options and dismiss are disabled (canAct false) | `frontend/src/recovered/features/conversation/cards/transcript-card/views/widget.tsx:canAct` |
| low | Secret request card | Submit with empty/whitespace value or while pending/stale → The Save securely button is disabled (canSubmit false) | `frontend/src/recovered/features/conversation/cards/transcript-card/views/secret-request.tsx:canSubmit` |
| low | Secret request card | View a secret request already provided → A 'Saved securely and kept private' card with a Saved badge is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/secret-request.tsx:40` |
| low | Auto-review approval card | View a settled/expired/failed approval → A status label ('Allowed once'/'Always allowed'/'Denied'/'Expired'/'Status unavailable') is shown instead of buttons | `frontend/src/recovered/features/conversation/cards/transcript-card/views/auto-review-approval.tsx:statusLabel` |
| low | Auto-review approval card | Approval is stale / no agent scope → The action buttons are disabled (canAct false) | `frontend/src/recovered/features/conversation/cards/transcript-card/views/auto-review-approval.tsx:canAct` |
| low | Connector card | Connector is connected → An 'Added' status with a check is shown instead of an action button | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx:105` |
| low | Connector card | Connector authorization is waiting → 'Waiting for {name} authorization…' with a Reopen button is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx:107` |
| low | Connector card | An install/authorize action is in flight → The card is aria-busy and action buttons are disabled | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx:busy` |
| low | Listener connect card | Platform is already connected → A 'Connected' status with a check-circle is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/listener-connect.tsx:70` |
| low | Listener connect card | Connection status is still loading → 'Checking connection status' is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/listener-connect.tsx:70b` |
| low | Cloud agent card | Cloud agent info is loading → A skeleton/aria-busy placeholder card is shown | `frontend/src/recovered/features/conversation/cards/transcript-card/views/cloud-agent.tsx:41` |
| low | Cloud agent card | Card is stale or provider missing → Action buttons are disabled | `frontend/src/recovered/features/conversation/cards/transcript-card/views/cloud-agent.tsx:disabled` |
| low | Email draft card | Email body exceeds 8 visual lines → The body collapses with a Show more/Show less toggle | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx:collapsed` |
| low | Email draft card | Email draft is sending → A 'Sending…' status shows and fields are disabled | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx:37` |
| low | Slack draft card | Empty Slack body → The Send message button is disabled (valid false) | `frontend/src/recovered/features/conversation/cards/transcript-card/views/slack-draft.tsx:valid` |
| low | Link card | Link metadata is loading → The card is aria-busy and shows the URL until metadata resolves | `frontend/src/recovered/features/conversation/cards/transcript-card/views/link-card.tsx:38` |
| low | Link card | On reconnect or window focus after a failed metadata fetch → Watched failed link cards re-fetch metadata (healWatchedFailures) | `frontend/src/recovered/features/conversation/cards/transcript-card/url-card.ts:healWatchedFailures` |
| low | Timeline event card | Automation id or handler is missing → The Open routine button is disabled | `frontend/src/recovered/features/conversation/cards/timeline-event-automation.tsx:47` |
| low | Local tool permission card | Store/RPC ownership missing → The card renders nothing (fail-closed) | `frontend/src/recovered/features/conversation/cards/transcript-card/views/local-tool-permission.tsx:16` |
| low | Conversation outline | Use ArrowLeft/Right/Home/End on outline tabs → Tab selection moves and the focused tab updates | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx:move` |
| low | Conversation outline | Outline has no activity yet → 'No conversation activity yet.' is shown | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx:194` |
| low | Conversation outline | Drag the outline panel header → The panel moves (useMovablePanel) | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx:onHeaderPointerDown` |
| low | Conversation outline | Press Escape or click Close in the outline panel → The panel closes | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx:onClose` |
| low | Chat header | View the conversation header → The agent avatar, name, and a 'Working' indicator (when running) render | `frontend/src/recovered/features/conversation/workspace/chat-header.tsx:ConversationAgentHeader` |
| low | Sidebar | Press Escape / click outside an open agent hover preview → The preview closes | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-preview-content.tsx:closeEscape` |
| low | Sidebar | View an empty section (expanded) → 'Drag chats here' placeholder is shown | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:500` |
| low | Sidebar | Section is first/last or synthetic → Move up/down/Rename/Delete items disable accordingly | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:381` |
| low | Sidebar | Press Escape in the section name editor → Rename is cancelled without committing | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:424` |
| low | Sidebar | Click Clear on the selection bar → The multi-agent selection is cleared | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:171` |
| low | Sidebar | Press Escape while resizing the sidebar → The resize is cancelled and cleaned up | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:onKeyDown` |
| low | Sidebar section delete | Cancel the section delete dialog → The dialog closes without deleting and focus is restored | `frontend/src/recovered/features/conversation/workspace/sidebar-section-delete-confirmation.tsx:close` |
| low | Sidebar section delete | Section deletion fails → An error alert with the failure message is shown and the dialog stays open | `frontend/src/recovered/features/conversation/workspace/sidebar-section-delete-confirmation.tsx:59` |
| low | Sidebar list | Sidebar list has a provided status node → The listStatus node is shown in place of the agent list | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:458` |
| low | Reactions state | Record a used emoji → It is stored as a recent emoji (capped at 50) for the picker | `frontend/src/recovered/features/conversation/workspace/sidebar-collapse-state.ts:recordEmojiRecent` |
| low | Transcript card frame | An attachment classifies as box/legacy-link/file/media → The card is wrapped in the matching frame variant (tab/link/file/none) | `frontend/src/recovered/features/conversation/cards/transcript-card/root.tsx:transcriptCardFrameForEntry` |
| low | Transcript card | A lazy card leaf is still loading → A placeholder of the registry-defined height is shown (Suspense fallback) | `frontend/src/recovered/features/conversation/cards/transcript-card/root.tsx:85` |
| low | Send-message text card | A send-message:text is a bare link → It renders as a link card instead of plain text | `frontend/src/recovered/features/conversation/cards/transcript-card/views/send-message-text.tsx:27` |
| low | Reply thread | Fork a submission from a thread root → The submission gains replyToId and isFork when scope/agent match | `frontend/src/recovered/features/conversation/workspace/conversation-workspace-controller.ts:projectForkSubmission` |
| low | Workspace preview | Mount the standalone ConversationWorkspacePreview → Renders null (no standalone preview dialog exists in shipped artifacts) | `frontend/src/recovered/features/conversation/workspace/view.tsx:ConversationWorkspacePreview` |

## Renderer · 설정/플러그인/권한/컴퓨터/터미널/자동화/접근/창/업데이트/딥링크/피드백/복구  (누락 177건, 추출 342 / 매칭 165)
- 표면 판정: Ledger covers ~48% (165/342) of this surface — the core capabilities (settings panels, router/usage/updates, plugin & MCP CRUD, skills, permission approve-deny, computer fullscreen/handoff/teach/rebuild, automations, window controls, feedback, deep links, error boundary) are registered, but it misses several whole sub-features (settings account/Cursor sign-in flow, trial cancellation, upgrade CTA, egress toggle, terminal output panel, access-cover blocked overlay, global keyboard shortcuts incl. command palette, info pane, app-alert host, settings toasts) plus most loading/error/pending/empty micro-states.

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | Settings/general | Account state is logged-out → Card shows 'Not signed in' and 'Sign In with Cursor' button | `frontend/src/recovered/features/settings/overlay/panels.tsx:GeneralSettingsPanel` |
| high | Settings/general | Click 'Sign In with Cursor' → Cursor login flow is initiated from settings | `frontend/src/recovered/features/settings/overlay/desktop.ts:runAccountAction` |
| high | Settings/general | Security key supported (darwin/win32): toggle switch → Hardware security key use enabled/disabled | `frontend/src/recovered/features/settings/overlay/panels.tsx:174` |
| high | Settings/usage | Trial cancellable: click Cancel Trial → 'Cancel your trial?' confirm dialog opens | `frontend/src/recovered/features/settings/overlay/panels.tsx:418` |
| high | Settings/usage | Click Cancel Trial (confirm) → Trial cancelled and usage refreshed on success | `frontend/src/recovered/features/settings/overlay/panels.tsx:382` |
| high | Settings/updates | Toggle egress switch (feature-gate or enabled) → Egress tunnel routed through desktop is toggled on/off | `frontend/src/recovered/features/settings/overlay/panels.tsx:642` |
| high | Terminal/output | View a terminal output panel → Shows command, cwd, status and read-only selectable output | `frontend/src/recovered/features/terminal/output/view.tsx:TerminalOutputPanel` |
| high | Access/cover | Sand access is blocked (not visible) → Access cover overlay shows landing with reason title/body | `frontend/src/recovered/features/access/cover/view.tsx:AccessCover` |
| high | WindowChrome/shortcuts | Press Cmd/Ctrl+K → Command palette toggled | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts:48` |
| medium | Settings/overlay | showUsage is false → Usage & Billing item omitted from the sections nav | `frontend/src/recovered/features/settings/overlay/view.tsx:settingsSectionsForUsage` |
| medium | Settings/overlay | Active section becomes hidden (usage gate closes) → Active section falls back to the first visible section | `frontend/src/recovered/features/settings/overlay/view.tsx:66` |
| medium | Settings/general | Account state is logging-in → Card shows 'Signing in / Finish from browser' and a Cancel button | `frontend/src/recovered/features/settings/overlay/panels.tsx:104` |
| medium | Settings/general | Click 'Cancel' during login → Pending login is cancelled | `frontend/src/recovered/features/settings/overlay/desktop.ts:288` |
| medium | Settings/general | Account error present → Error message rendered below the account card | `frontend/src/recovered/features/settings/overlay/panels.tsx:139` |
| medium | Settings/general | Click Copy email address (logged-in) → Email copied to clipboard and icon changes to check | `frontend/src/recovered/features/settings/overlay/panels.tsx:107` |
| medium | Settings/general | Type an auto-review rule over 1000 chars → Draft is truncated to 1000 characters | `frontend/src/recovered/features/settings/overlay/auto-review.tsx:99` |
| medium | Settings/general | Add a rule duplicating existing text in same list → Rule is not added (saveInstruction returns null) | `frontend/src/recovered/features/settings/overlay/model.ts:49` |
| medium | Settings/usage | Click the upgrade CTA (open-url) → External URL opened and info/error message shown | `frontend/src/recovered/features/settings/overlay/panels.tsx:364` |
| medium | Settings/usage | Click the upgrade CTA (dashboard-action) → Dashboard action invoked, usage refreshed, message shown | `frontend/src/recovered/features/settings/overlay/panels.tsx:368` |
| medium | Settings/usage | Click Keep Trial in cancel dialog → Dialog closes, trial retained | `frontend/src/recovered/features/settings/overlay/panels.tsx:453` |
| medium | Settings/usage | Cancel trial fails → Error message shown inside the confirm dialog | `frontend/src/recovered/features/settings/overlay/panels.tsx:389` |
| medium | Settings/usage | Usage refresh fails but stale summary exists → Shows 'Couldn't refresh usage — showing the last known values.' plus Retry | `frontend/src/recovered/features/settings/overlay/panels.tsx:425` |
| medium | Settings/updates | Update disabled by reason → Status line shows reason (dev build / Lab / unsupported platform / SAND_DISABLE_UPDATES) | `frontend/src/recovered/features/settings/overlay/updates.ts:disabledUpdateMessage` |
| medium | Settings/computer | Click Update (ready phase) first time → Button changes to 'Click Again to Confirm' | `frontend/src/recovered/features/settings/overlay/computer.ts:75` |
| medium | Settings/computer | Update queued phase → Button shows 'Cancel Update' with 'Update queued' copy | `frontend/src/recovered/features/settings/overlay/computer.ts:94` |
| medium | Settings/computer | Click Cancel Update (queued) → Queued update cancelled | `frontend/src/recovered/features/settings/overlay/computer.ts:66` |
| medium | Settings/computer | Busy-override phase: click Update → Forces update (interrupts working agent) with 'An agent is working' copy | `frontend/src/recovered/features/settings/overlay/computer.ts:70` |
| medium | Settings/notice | A success settings notice fires → Toast with check icon shows and auto-dismisses after 3.5s | `frontend/src/recovered/features/settings/overlay/notice.tsx:30` |
| medium | Settings/notice | An error settings notice fires → Toast with close icon shows and auto-dismisses after 6s | `frontend/src/recovered/features/settings/overlay/notice.tsx:31` |
| medium | Settings/overlay | Settings snapshot load fails → Panel shows error text and a Retry button | `frontend/src/recovered/features/settings/overlay/desktop-surface.tsx:188` |
| medium | Plugins/overlay | Plugins load fails → Shows error text and a Retry button | `frontend/src/recovered/features/plugins/overlay/desktop-surface.tsx:283` |
| medium | Plugins/skill-detail | Click Delete skill → Skill deleted and view returns to list | `frontend/src/recovered/features/plugins/overlay/browser.tsx:412` |
| medium | Permissions/local-tool | Resolution submission fails → Shows 'Your answer didn't go through. Check your connection and try again.' | `frontend/src/recovered/features/permissions/local-tool/view.tsx:157` |
| medium | Computer/info-pane | Open the info pane → Computer preview shown in the details aside | `frontend/src/recovered/features/computer/shell/view.tsx:ComputerInfoPane` |
| medium | Computer/update-confirm | Update confirmation while agents working → Working-agents title/description plus destructive 'Update anyway' secondary | `frontend/src/recovered/features/computer/update/confirmation.ts:101` |
| medium | Terminal/output | Terminal command running → Output region uses aria-live polite for streaming additions | `frontend/src/recovered/features/terminal/output/view.tsx:41` |
| medium | Terminal/output | Terminal command exited with code → Exit code and exited/error status shown | `frontend/src/recovered/features/terminal/output/model.ts:projectTerminalOutput` |
| medium | Automations/trigger | View a configured trigger row → Human-readable sentence per platform (schedule/slack/github/teams/linear/sentry/pagerduty) | `frontend/src/recovered/features/automations/routines/trigger-schema.ts:describeRoutineTrigger` |
| medium | Access/cover | Click the access cover action button → Opens the onboarding URL externally | `frontend/src/recovered/features/access/cover/view.tsx:26` |
| medium | Access/cover | Different block reasons → Copy varies (privacy mode / team setup / access required / trial / Ultra / Premium seat) | `frontend/src/recovered/features/access/cover/model.ts:accessNoticeCopy` |
| medium | WindowChrome/shortcuts | Press Cmd/Ctrl+N → New Bot created | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts:47` |
| medium | WindowChrome/shortcuts | Press Cmd/Ctrl+Shift+M → Tools/Customize opened | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts:50` |
| medium | WindowChrome/shortcuts | Press Alt+Up / Alt+Down → Selects previous / next agent | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts:53` |
| medium | WindowChrome/shortcuts | Press Cmd/Ctrl+[ or Cmd/Ctrl+] → Navigates back / forward in agent history | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts:55` |
| medium | WindowChrome/shortcuts | Press Cmd/Ctrl+1..9 → Focuses the Nth sidebar agent | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts:57` |
| medium | WindowChrome/app-alert | An app alert is requested → Modal alert dialog shows title/description/body/warning | `frontend/src/recovered/features/window-chrome/app-alert/view.tsx:AppAlertHost` |
| medium | Feedback/overlay | Feedback submit fails with a code → Error message shown per code (access-denied/rate-limited/etc) | `frontend/src/recovered/features/feedback/overlay/view.tsx:feedbackCode` |
| low | Settings/overlay | Open with initialSection param → That section is selected on open | `frontend/src/recovered/features/settings/overlay/view.tsx:73` |
| low | Settings/general | Account action is pending → Account action button is disabled | `frontend/src/recovered/features/settings/overlay/panels.tsx:137` |
| low | Settings/general | After copying email, wait 2s → Copy icon reverts from check to copy | `frontend/src/recovered/features/settings/overlay/panels.tsx:98` |
| low | Settings/general | Clipboard write fails on copy email → Icon stays as copy (no check state) | `frontend/src/recovered/features/settings/overlay/panels.tsx:112` |
| low | Settings/general | Theme change in flight → Theme select is disabled until it settles | `frontend/src/recovered/features/settings/overlay/panels.tsx:145` |
| low | Settings/general | Auto-review disabled → Rules editor is hidden | `frontend/src/recovered/features/settings/overlay/auto-review.tsx:86` |
| low | Settings/general | While editing a rule → The add-draft input and Add controls are disabled | `frontend/src/recovered/features/settings/overlay/auto-review.tsx:97` |
| low | Settings/general | Security key change pending → Security-key switch disabled while pending | `frontend/src/recovered/features/settings/overlay/panels.tsx:183` |
| low | Settings/router | Router change pending → Provider select disabled | `frontend/src/recovered/features/settings/overlay/panels.tsx:480` |
| low | Settings/usage | Usage state empty/unavailable → Shows 'No usage information available for this account right now' | `frontend/src/recovered/features/settings/overlay/panels.tsx:321` |
| low | Settings/usage | No meters available on plan → Shows 'No included usage available on your plan right now.' | `frontend/src/recovered/features/settings/overlay/panels.tsx:403` |
| low | Settings/usage | Upgrade action fails → Error notice 'Couldn't complete the upgrade action — try again' | `frontend/src/recovered/features/settings/overlay/panels.tsx:294` |
| low | Settings/usage | Cancel trial pending → Buttons disabled and label shows 'Canceling…' | `frontend/src/recovered/features/settings/overlay/panels.tsx:454` |
| low | Settings/usage | Cancel-trial dialog open → Parent Settings backdrop/escape/focus-trap are suspended | `frontend/src/recovered/features/settings/overlay/desktop-surface.tsx:305` |
| low | Settings/updates | Auto-update gate disabled → Auto-update-when-idle switch is not rendered | `frontend/src/recovered/features/settings/overlay/panels.tsx:603` |
| low | Settings/updates | Update transitioning (checking/available/downloading/staging) → Check for Updates button disabled | `frontend/src/recovered/features/settings/overlay/panels.tsx:580` |
| low | Settings/updates | Egress connected state → Shows connected description with active/relayed stream counts | `frontend/src/recovered/features/settings/overlay/updates.ts:egressTunnelStatusDescription` |
| low | Settings/computer | Wait 3s after first Update click → Confirm state resets to 'Update' | `frontend/src/recovered/features/settings/overlay/computer.ts:58` |
| low | Settings/computer | Rebuild blocked for session → Update/Reset disabled and blocked copy shown | `frontend/src/recovered/features/settings/overlay/computer.ts:95` |
| low | Settings/computer | Update pending → Button shows 'Updating…' and is disabled | `frontend/src/recovered/features/settings/overlay/computer.ts:94` |
| low | Settings/computer | Dev build: click 'Refresh Anyway' → Forces an update even when up to date | `frontend/src/recovered/features/settings/overlay/computer.ts:88` |
| low | Settings/computer | canResetBox is false → Reset disabled and 'Open an agent to reset the shared computer' shown | `frontend/src/recovered/features/settings/overlay/computer-view.tsx:25` |
| low | Settings/computer | Reset pending → Reset button shows 'Resetting…' and disabled | `frontend/src/recovered/features/settings/overlay/computer-view.tsx:48` |
| low | Settings/notice | Click Dismiss on a settings toast → Toast is hidden | `frontend/src/recovered/features/settings/overlay/notice.tsx:115` |
| low | Settings/overlay | Click Retry after settings load error → Settings snapshot reloads | `frontend/src/recovered/features/settings/overlay/desktop-surface.tsx:191` |
| low | Plugins/overlay | Plugins still loading (no snapshot) → Shows 'Loading the marketplace…' | `frontend/src/recovered/features/plugins/overlay/desktop-surface.tsx:282` |
| low | Plugins/overlay | Click Retry after plugins load error → Plugins reload | `frontend/src/recovered/features/plugins/overlay/desktop-surface.tsx:283` |
| low | Plugins/browser | Press Escape in Filter menu → Menu closes and focus returns to the trigger | `frontend/src/recovered/features/plugins/overlay/browser.tsx:450` |
| low | Plugins/browser | Arrow/Home/End keys in Filter menu → Focus moves among menu radio options | `frontend/src/recovered/features/plugins/overlay/browser.tsx:455` |
| low | Plugins/browser | No items match in Marketplace → Shows 'marketplace isn't available' or 'No plugins match X' | `frontend/src/recovered/features/plugins/overlay/browser.tsx:emptyPluginsMessage` |
| low | Plugins/browser | No items match in Yours → Shows 'Nothing installed yet' or 'No installed plugins match X' | `frontend/src/recovered/features/plugins/overlay/browser.tsx:435` |
| low | Plugins/browser | Filters active but nothing matches → Shows 'No plugins match the current filters' | `frontend/src/recovered/features/plugins/overlay/browser.tsx:432` |
| low | Plugins/browser | View an item row → Shows status label (Added/Managed by team/Connected/Disconnected/Error/Auth required) | `frontend/src/recovered/features/plugins/overlay/browser.tsx:pluginItemStatus` |
| low | Plugins/github-auth | Fix launching → Button shows 'Opening…' and is disabled | `frontend/src/recovered/features/plugins/overlay/github-auth-banner.tsx:24` |
| low | Plugins/private | Yours tab with no active agent → Private section shows 'Open an agent to see its private skills' | `frontend/src/recovered/features/plugins/overlay/browser.tsx:239` |
| low | Plugins/private | Private skills load fails → Private section shows an error alert | `frontend/src/recovered/features/plugins/overlay/browser.tsx:239` |
| low | Plugins/private | No private skills for agent → Shows 'No private skills yet…' or 'No private skills match X' | `frontend/src/recovered/features/plugins/overlay/browser.tsx:239` |
| low | Plugins/private | Private skill toggle pending → Toggle disabled while pending | `frontend/src/recovered/features/plugins/overlay/browser.tsx:249` |
| low | Plugins/detail | Click Back in plugin detail → Returns to the plugin list | `frontend/src/recovered/features/plugins/overlay/browser.tsx:528` |
| low | Plugins/detail | Item is busy → Detail action buttons are disabled | `frontend/src/recovered/features/plugins/overlay/browser.tsx:533` |
| low | Plugins/setup | Submit setup form with missing required fields → Required fields marked invalid and 'Fill in the required field(s)' shown | `frontend/src/recovered/features/plugins/overlay/browser.tsx:PluginSetupForm` |
| low | Plugins/setup | Setup submit errors → Error alert shown in form | `frontend/src/recovered/features/plugins/overlay/browser.tsx:640` |
| low | Plugins/setup | Setup form busy/pending → Submit button disabled | `frontend/src/recovered/features/plugins/overlay/browser.tsx:641` |
| low | Plugins/accounts | Press Escape in rename input → Rename cancelled | `frontend/src/recovered/features/plugins/overlay/browser.tsx:695` |
| low | Plugins/accounts | Account status error → Status detail alert shown | `frontend/src/recovered/features/plugins/overlay/browser.tsx:698` |
| low | Plugins/tools | Server tools still loading → Status placeholder shown | `frontend/src/recovered/features/plugins/overlay/browser.tsx:593` |
| low | Plugins/tools | Server tools load fails → Error alert shown | `frontend/src/recovered/features/plugins/overlay/browser.tsx:594` |
| low | Plugins/tools | A tool toggle is pending → All tool toggle buttons disabled | `frontend/src/recovered/features/plugins/overlay/browser.tsx:598` |
| low | Plugins/skill-detail | Save private skill fails → Error alert shown | `frontend/src/recovered/features/plugins/overlay/browser.tsx:404` |
| low | Plugins/skill-detail | Click Publish with empty description → Shows 'Add a description first' | `frontend/src/recovered/features/plugins/overlay/browser.tsx:334` |
| low | Plugins/skill-detail | Publish targets unavailable → Alert with unavailable reason | `frontend/src/recovered/features/plugins/overlay/browser.tsx:408` |
| low | Plugins/surface | Authenticate returns a status → Success/error notice shown (already-authenticated/not-configured/started) | `frontend/src/recovered/features/plugins/overlay/model.ts:pluginAuthenticationNotice` |
| low | Plugins/surface | Remove a browser item → Notice shown (Removed X / team-server / couldn't remove) | `frontend/src/recovered/features/plugins/overlay/desktop.ts:pluginBrowserRemovalNotice` |
| low | Permissions/local-tool | Team ceiling blocks always → 'Always allow' disabled with tooltip explaining team policy in the prompt | `frontend/src/recovered/features/permissions/local-tool/view.tsx:149` |
| low | Permissions/local-tool | A resolution is submitting → All action buttons disabled | `frontend/src/recovered/features/permissions/local-tool/view.tsx:119` |
| low | Permissions/local-tool | Ask is already resolved (not pending) → Shows outcome text (can/cannot/was not allowed/this time) | `frontend/src/recovered/features/permissions/local-tool/view.tsx:148` |
| low | Permissions/local-tool | Transport reconnects while prompt open → Store re-reads permission (noteReconnect) | `frontend/src/recovered/features/permissions/local-tool/view.tsx:130` |
| low | Permissions/local-tool | No request in the dock → Dock renders nothing | `frontend/src/recovered/features/permissions/local-tool/view.tsx:169` |
| low | Permissions/local-tool | Local-tool permission read hits capability-unavailable → Snapshot becomes unavailable state | `frontend/src/recovered/features/permissions/local-tool/store.ts:110` |
| low | Computer/fullscreen | A monitor needs attention (handoff) → Thumbnail shows 'needs you' label and attention dot | `frontend/src/recovered/features/computer/shell/view.tsx:301` |
| low | Computer/fullscreen | Click outside the more-screens menu → Menu closes | `frontend/src/recovered/features/computer/shell/view.tsx:333` |
| low | Computer/fullscreen | Stage VNC becomes ready → Webview is focused after a delay and a focus telemetry event is reported | `frontend/src/recovered/features/computer/shell/view.tsx:452` |
| low | Computer/info-pane | Click 'Close details' → Info pane closes | `frontend/src/recovered/features/computer/shell/view.tsx:532` |
| low | Computer/info-pane | Drag the resize handle → Info pane width changes (clamped to min/max) | `frontend/src/recovered/features/computer/shell/view.tsx:useInfoPaneResize` |
| low | Computer/info-pane | Drag width below collapse threshold and release → Pane collapses/closes | `frontend/src/recovered/features/computer/shell/view.tsx:187` |
| low | Computer/info-pane | Press Escape during resize → Resize drag ends | `frontend/src/recovered/features/computer/shell/view.tsx:193` |
| low | Computer/header | Click the computer header control → Info pane toggles (aria-expanded reflects state) | `frontend/src/recovered/features/computer/shell/view.tsx:ComputerHeaderControl` |
| low | Computer/header | Computer is active → Header control shows 'in use' label/state | `frontend/src/recovered/features/computer/shell/view.tsx:542` |
| low | Computer/handoff-card | Handoff card not waiting → Shows status label (Done/Answered/Skipped/unavailable) and 'Open computer' | `frontend/src/recovered/features/computer/shell/model.ts:handoffStatusLabel` |
| low | Computer/teach | Click Dismiss on armed prompt → Armed teach prompt cleared | `frontend/src/recovered/features/computer/teach-recording/view.tsx:97` |
| low | Computer/teach | Recording another agent (peer) in preview → Shows peer recording label with Stop & save and Discard | `frontend/src/recovered/features/computer/teach-recording/view.tsx:TeachRecordingPreviewPeerRow` |
| low | Computer/overlay | Computer overlay entrypoint mounts → Renders nothing (shipped 0.18 computer view is a no-op) | `frontend/src/recovered/features/computer/overlay/view.tsx:6` |
| low | Computer/update-confirm | Update confirmation for ready action → Shows 'Update X's Computer?' with confirm/cancel labels | `frontend/src/recovered/features/computer/update/confirmation.ts:projectComputerUpdateConfirmationContent` |
| low | Computer/update-confirm | Confirm returns started-untrackable → Shows 'update started, but X can't track its progress' | `frontend/src/recovered/features/computer/update/confirmation.ts:185` |
| low | Computer/update-confirm | Confirm update rejected → Shows the rejection reason message | `frontend/src/recovered/features/computer/update/confirmation.ts:191` |
| low | Computer/update-confirm | Confirm update throws → Failed phase with error message | `frontend/src/recovered/features/computer/update/confirmation.ts:196` |
| low | Computer/status | Window regains focus while connected → Box status refreshed for watched monitors | `frontend/src/recovered/features/computer/shell/controller.ts:194` |
| low | Automations/routines | No routines exist → Shows explanation and 'Create Routine' button | `frontend/src/recovered/features/automations/routines/view.tsx:267` |
| low | Automations/routines | Routines still loading → Busy status placeholder shown | `frontend/src/recovered/features/automations/routines/view.tsx:302` |
| low | Automations/routines | Click Back / Close in the pane → Editor closes / details close callback fires | `frontend/src/recovered/features/automations/routines/view.tsx:303` |
| low | Automations/routines | Press Escape in routines pane with editor open → Editor closes | `frontend/src/recovered/features/automations/routines/view.tsx:303` |
| low | Automations/editor | Blur Name field with valid change → Name committed (empty reverts on existing routine) | `frontend/src/recovered/features/automations/routines/view.tsx:201` |
| low | Automations/editor | Name empty → Name input marked aria-invalid | `frontend/src/recovered/features/automations/routines/view.tsx:94` |
| low | Automations/editor | Instruction empty → Instruction textarea marked aria-invalid | `frontend/src/recovered/features/automations/routines/view.tsx:107` |
| low | Automations/editor | Trigger invalid or missing → Trigger card marked aria-invalid | `frontend/src/recovered/features/automations/routines/view.tsx:116` |
| low | Automations/editor | Save fails → Shows 'Couldn't save this routine.' | `frontend/src/recovered/features/automations/routines/view.tsx:90` |
| low | Automations/trigger | Blur custom schedule with invalid cron → Field marked invalid and not committed | `frontend/src/recovered/features/automations/routines/schedule-editor.ts:resolveRoutineCustomScheduleBlur` |
| low | Automations/run-history | Automations event ingested → Routines list updates from the pushed automations snapshot | `frontend/src/recovered/features/automations/routines/controller.ts:ingest` |
| low | Access/cover | Access reason is notOffered → No action button shown | `frontend/src/recovered/features/access/cover/model.ts:88` |
| low | Access/cover | Access cover not visible → Renders nothing | `frontend/src/recovered/features/access/cover/view.tsx:16` |
| low | Access/cover | Roster restored from persisted cache before live load → Roster shown as restored, suppressing the access cover | `frontend/src/recovered/features/access/cover/roster-snapshot-store.ts:restore` |
| low | Access/cover | Roster live fetch returns malformed payload → Load state error with 'malformed-roster' failure | `frontend/src/recovered/features/access/cover/roster-snapshot-store.ts:241` |
| low | Access/cover | Dev box rebuild event received → Dev rebuild signal marked pending (internal signal) | `frontend/src/recovered/features/access/cover/rebuild-signal.ts:onRebuild` |
| low | Access/cover | Box migration event received → Rebuild state advances migration phase (drives rebuild banner) | `frontend/src/recovered/features/access/cover/computer-rebuild-migration-store.ts:ingest` |
| low | Access/cover | Forever-box phase becomes pulling on last-healthy box → Auto-update rebuild inferred and locks the cover | `frontend/src/recovered/features/access/cover/computer-rebuild-model.ts:205` |
| low | WindowChrome | Platform is macOS → Only the drag region renders (native traffic lights used) | `frontend/src/recovered/features/window-chrome/view.tsx:44` |
| low | WindowChrome | Linux fullscreen → Only drag region renders (window controls hidden) | `frontend/src/recovered/features/window-chrome/view.tsx:46` |
| low | WindowChrome/shortcuts | Press Cmd/Ctrl+I or Cmd/Ctrl+L → Prompt focused (only outside editable fields) | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts:51` |
| low | WindowChrome/shortcuts | Press Escape with overlay armed and not stacked → Top overlay is closed | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts:175` |
| low | WindowChrome/notifications | Click Copy request ID → Request ID copied, data-copied flag set | `frontend/src/recovered/features/window-chrome/notification-host.tsx:278` |
| low | WindowChrome/notifications | Click a tray open-url action → External URL opened | `frontend/src/recovered/features/window-chrome/notification-host.tsx:220` |
| low | WindowChrome/notifications | Click a tray dashboard-action → Action invoked and success/error notice shown | `frontend/src/recovered/features/window-chrome/notification-host.tsx:224` |
| low | WindowChrome/notifications | Tray dashboard-action fails → Error notice 'Couldn't complete the upgrade action — try again' | `frontend/src/recovered/features/window-chrome/notification-host.tsx:231` |
| low | WindowChrome/notifications | Tray count > 1 → Shows ×N count badge | `frontend/src/recovered/features/window-chrome/notification-host.tsx:204` |
| low | WindowChrome/notifications | provider_overloaded error with sand-model experiment → Detail text replaced with model-provider-load message | `frontend/src/recovered/features/window-chrome/notification-host.tsx:205` |
| low | WindowChrome/notifications | Account becomes logged-out → Notification trays cleared | `frontend/src/recovered/features/window-chrome/notification-host.tsx:161` |
| low | WindowChrome/status | Transport connecting/connected/down → Status dot shows working/info/offline with label | `frontend/src/recovered/features/window-chrome/status-badge.tsx:WindowStatusBadge` |
| low | WindowChrome/status | Fullscreen or browser transport → Status dot hidden | `frontend/src/recovered/features/window-chrome/status-badge.tsx:21` |
| low | WindowChrome/workspace | Workspace label present, not fullscreen → Header workspace name heading shown | `frontend/src/recovered/features/window-chrome/workspace-indicator.tsx:WorkspaceIndicator` |
| low | WindowChrome/workspace | Fullscreen or empty label → Workspace indicator hidden | `frontend/src/recovered/features/window-chrome/workspace-indicator.tsx:11` |
| low | WindowChrome/app-alert | Click the alert Confirm button → Primary action performed and alert closes on success | `frontend/src/recovered/features/window-chrome/app-alert/controller.ts:confirm` |
| low | WindowChrome/app-alert | Click the alert Cancel button → Alert cancelled/closed | `frontend/src/recovered/features/window-chrome/app-alert/view.tsx:44` |
| low | WindowChrome/app-alert | Click the alert Secondary button → Secondary action performed | `frontend/src/recovered/features/window-chrome/app-alert/controller.ts:confirmSecondary` |
| low | WindowChrome/app-alert | Alert action performing → Buttons disabled, pending label shown, backdrop/escape disabled | `frontend/src/recovered/features/window-chrome/app-alert/view.tsx:31` |
| low | WindowChrome/app-alert | Alert action returns a failure message → Failure alert text shown and dialog stays open | `frontend/src/recovered/features/window-chrome/app-alert/view.tsx:42` |
| low | WindowChrome/app-alert | A second alert is queued while one is open → Queued alert opens after the current one closes | `frontend/src/recovered/features/window-chrome/app-alert/controller.ts:83` |
| low | WindowChrome/root-shell | Empty workspace → Shows 'No chats yet' | `frontend/src/recovered/features/window-chrome/root-shell-state.tsx:RootShellEmptyWorkspace` |
| low | Update/required | Client is not below minimum → Update-required overlay renders nothing | `frontend/src/recovered/features/update/required/view.tsx:76` |
| low | Update/pill | Update downloading/staging → Update pill shows a progress spinner | `frontend/src/recovered/features/update/status/pill.tsx:49` |
| low | Update/pill | Below-minimum or not ready → Update pill hidden | `frontend/src/recovered/features/update/status/pill.tsx:48` |
| low | DeepLinks/overlay | Click Close (×) or Done → Deep link dialog closes | `frontend/src/recovered/features/deep-links/overlay/view.tsx:33` |
| low | DeepLinks/overlay | Deep link source is protocol vs https → Source label shows 'Custom protocol (sand://)' or 'HTTPS link' | `frontend/src/recovered/features/deep-links/overlay/model.ts:deepLinkSourceLabel` |
| low | DeepLinks/overlay | No deep link → Dialog renders nothing | `frontend/src/recovered/features/deep-links/overlay/view.tsx:14` |
| low | Feedback/overlay | conversationId present: toggle include-conversation-id checkbox → Conversation ID inclusion toggled for submission | `frontend/src/recovered/features/feedback/overlay/view.tsx:81` |
| low | Feedback/overlay | Sending in progress → Cancel disabled; backdrop/escape close disabled | `frontend/src/recovered/features/feedback/overlay/view.tsx:71` |
| low | ErrorBoundary | Click Copy error → Formatted error+stack copied and button shows 'Copied' | `frontend/src/recovered/features/error-boundary/view.tsx:31` |
| low | RootResilience/connection | Connection phase is reconnecting → Roster reconnect notice shown with Retry | `frontend/src/recovered/features/root-resilience/connection-state.tsx:31` |
| low | RootResilience/connection | Connection connected or account not logged-in → Host renders nothing | `frontend/src/recovered/features/root-resilience/connection-state.tsx:28` |
| low | RootResilience/connection | Retry while transport not connected → Retry queued and re-run when transport reconnects; isRetrying stays true | `frontend/src/recovered/features/root-resilience/connection-state.ts:235` |
| low | RootResilience/connection | Account identity changes / logs out → Failure/retry state cleared and queued retries resolved false | `frontend/src/recovered/features/root-resilience/connection-state.ts:onAccount` |

## Renderer · 봇/에이전트정보/로스터/조직도/숨김/온보딩/계정  (누락 166건, 추출 233 / 매칭 67)
- 표면 판정: 약 29% (67/233). 핵심 긍정 경로 능력(계정 정보 표시·이름편집·로그아웃확인 SYS-007~010, 아바타 저장 BOT-008, 숨김 BOT-014~016, 채널 CHANNEL-001~006, 공유룸 SHARE-004~013, 그룹멤버 GROUP-003~009, 조직도 NET-001~004/GROUP-011)는 원장에 대응하나, 온보딩 다단계 마법사 전체·아바타 편집기(AI 생성/업로드/크롭/줌)·로그인 흐름·계정메뉴 주간사용량·다이얼로그 접근성(포커스 트랩/복원/Escape)·오류/빈/비활성 상태가 대거 누락.

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | 소개(About) | 'Copy version info' 버튼을 누르면 → Version/Release Track/OS가 클립보드에 복사되고 버튼이 'Copied'로 바뀐다 | `features/about/overlay/view.tsx:57-70` |
| high | 계정 | 로그아웃 상태에서 'Sign in' 메뉴 항목을 누르면 → login()이 실행되고 성공 시 메뉴가 닫힌다 | `features/account/session/menu.tsx:273-284,324` |
| high | 정보-아바타 | Generate 탭에서 설명을 입력하고 Generate를 누르면 → generateAgentAvatarImage로 아바타가 생성되어 크롭 스테이지로 넘어간다 | `features/agent-info/avatar-editor/view.tsx:154-155,controller.ts:160-179` |
| medium | 소개(About) | 업데이트 상태가 아직 null이면 → 버전 문단이 표시되지 않는다 | `features/about/overlay/view.tsx:79` |
| medium | 계정 | 로그인 상태에서 메뉴를 열면 사용량 요약을 조회하여 → 'Weekly usage' 항목에 사용률 퍼센트가 표시된다 | `features/account/session/menu.tsx:256-271,308-311` |
| medium | 계정 | 'Weekly usage' 항목을 누르면 → included/on-demand 상세와 리셋 시각이 펼쳐지거나 접힌다 | `features/account/session/menu.tsx:309-316` |
| medium | 계정 | 사용량 상세에서 'Change limit'을 누르면 → 메뉴가 닫히고 onOpenUsage가 호출된다 | `features/account/session/menu.tsx:315` |
| medium | 계정 | iOS 링크 기능 게이트(sand_get_grok_bot_ios)가 켜져 있으면 → iOS 메뉴 항목이 표시되고 누르면 onOpenIos가 호출된다 | `features/account/session/menu.tsx:40-45,318` |
| medium | 계정 | 'Help center' 메뉴 항목을 누르면 → 메뉴가 닫히고 onOpenHelp가 호출된다 | `features/account/session/menu.tsx:321` |
| medium | 계정 | 로그인 진행 중(busy)이면 → 'Sign in' 메뉴 항목이 비활성화된다 | `features/account/session/menu.tsx:324` |
| medium | 계정 | 로그인 시도가 실패하면 → onError로 에러 메시지가 전달된다 | `features/account/session/menu.tsx:279-281` |
| medium | 계정 | 이름 입력창에서 Escape를 누르면 → 편집이 취소되고 저장하지 않는다 | `features/account/session/menu.tsx:203-209` |
| medium | 계정 | 이름 입력창에서 포커스를 잃으면(blur) → 입력값이 저장된다 | `features/account/session/menu.tsx:144-157,167-168` |
| medium | 계정 | 이름이 공백만 입력된 채 저장을 시도하면 → 저장하지 않고 편집이 취소된다 | `features/account/session/menu.tsx:118-122,81-92` |
| medium | 계정 | 이름 저장이 실패하면 → onError로 'Couldn't save your name…' 메시지가 표시되고 입력창에 재포커스된다 | `features/account/session/menu.tsx:134-139` |
| medium | 계정 | 로그인 중(logging-in) 상태에서 로그인 상태 뷰를 보면 → 진행 안내 문구와 Reopen·Cancel 버튼이 표시된다 | `features/account/session/sign-in-status.tsx:37-49` |
| medium | 계정 | 로그인 중 상태에서 Reopen 버튼을 누르면 → login()이 재실행된다 | `features/account/session/sign-in-status.tsx:42` |
| medium | 계정 | 로그인 중 상태에서 Cancel 버튼을 누르면 → cancelLogin()이 호출되어 로그인이 취소된다 | `features/account/session/sign-in-status.tsx:44` |
| medium | 계정 | 로그아웃 상태에서 Sign in 버튼을 누르면 → login()이 실행된다 | `features/account/session/sign-in-status.tsx:53` |
| medium | 계정 | 로그인/취소 액션이 실패하면 → aria-live 영역에 에러 메시지가 표시된다 | `features/account/session/sign-in-status.tsx:28-35,46` |
| medium | 계정 | 로그아웃이 진행 중(busy)이면 → confirm·cancel 버튼이 비활성화되고 Escape/배경 닫기가 막힌다 | `features/account/session/sign-out.tsx:46-47,58-59` |
| medium | 계정 | 로그아웃이 실패하면 → role=alert로 에러 메시지가 표시된다 | `features/account/session/sign-out.tsx:36-38,56` |
| medium | 로스터 | 로스터 전송 상태가 CLOUD_AGENT_STORAGE_DISABLED/no_storage로 차단되면 → 'Update Privacy Mode' 프라이버시 차단 다이얼로그가 표시된다 | `features/roster/privacy-blocked.tsx:19-23,84-89` |
| medium | 로스터 | 프라이버시 차단 다이얼로그에서 'Sign out'을 누르면 → logout()이 실행된다 | `features/roster/privacy-blocked.tsx:74-82,92` |
| medium | 로스터 | 프라이버시 차단 다이얼로그에서 'Open Privacy Settings'를 누르면 → openExternal로 cursor.com 프라이버시 설정 URL이 외부로 열린다 | `features/roster/privacy-blocked.tsx:9,93-95` |
| medium | 로스터 | 저장된 에이전트가 하나도 없으면 → 'No saved agents yet.' 빈 상태가 표시된다 | `features/roster/status.tsx:28` |
| medium | 로스터 | 모든 봇이 숨김 상태이면 → 'All bots are hidden'와 'Show Hidden Bots' 버튼이 표시된다 | `features/roster/status.tsx:30-35` |
| medium | 로스터 | 에이전트를 선택하면 → 선택이 계정별로 클라이언트에 저장되어 다음 실행 시 복원된다 | `features/roster/selection-state.ts:123-138,152-172` |
| medium | 로스터 | 저장된 선택 에이전트가 로스터에 더 이상 없으면 → reconcile이 첫 번째 에이전트로 선택을 대체한다 | `features/roster/selection-state.ts:139-151` |
| medium | 숨김대화 | 숨김 변경 RPC가 비-전송 오류로 실패하면 → 낙관적 변경이 이전 값으로 롤백된다 | `features/hidden-chats/overlay/mutation-controller.ts:64-98` |
| medium | 숨김대화 | 숨김 변경 RPC가 전송 실패(transport-failure)이면 → 변경을 유지(held)하고 재연결 시 자동 재시도한다 | `features/hidden-chats/overlay/mutation-controller.ts:82-114,157-159` |
| medium | 온보딩 | 'Meet Grok Bot' 단계에서 Next(또는 Send)를 누르면 → 다음 단계(computer-demo)로 진행된다 | `features/onboarding/signed-in/view.tsx:170,200` |
| medium | 온보딩 | computer-demo 단계에서 Next를 누르면 → jobs 단계로 진행된다 | `features/onboarding/signed-in/view.tsx:171` |
| medium | 온보딩 | computer-demo 단계에서 Back을 누르면 → 이전 단계(meet)로 돌아간다 | `features/onboarding/signed-in/view.tsx:171,220,model.ts:209-212` |
| medium | 온보딩 | tools 단계에서 검색창에 입력하면 → 일치하는 도구만 필터링되어 표시된다 | `features/onboarding/signed-in/view.tsx:158-162,model.ts:231-234` |
| medium | 온보딩 | tools 단계에서 도구 타일을 누르면 → 해당 도구가 선택 토글되고 체크 표시가 나타난다 | `features/onboarding/signed-in/view.tsx:162,model.ts:227-229` |
| medium | 온보딩 | create 단계에서 색상 라디오를 선택하면 → draft 색상이 바뀌고 아바타 미리보기가 갱신된다 | `features/onboarding/signed-in/view.tsx:176` |
| medium | 온보딩 | create 단계에서 모양 라디오를 선택하면 → draft 모양이 바뀌고 아바타 미리보기가 갱신된다 | `features/onboarding/signed-in/view.tsx:177` |
| medium | 온보딩 | create 단계에서 이름을 입력하면 → draft 이름이 갱신되고 pickedTemplateId가 초기화된다 | `features/onboarding/signed-in/view.tsx:178` |
| medium | 온보딩 | create 단계에서 이름이 비어 있으면 → 'Get started' 버튼이 비활성화된다 | `features/onboarding/signed-in/view.tsx:178,model.ts:192-194` |
| medium | 온보딩 | create 단계에서 추천(Suggestion) 카드를 누르면 → draft에 추천 이름·설명·색·모양·templateId가 채워진다 | `features/onboarding/signed-in/view.tsx:179,151` |
| medium | 온보딩 | hand-off 단계에서 컴퓨터 준비 상태에 따라 → 'Setting up your Grok Bot… n%'/'Waking your computer…'/'Getting your team ready…' 문구가 표시된다 | `features/onboarding/signed-in/model.ts:274-279,view.tsx:180` |
| medium | 온보딩 | 에이전트 생성이 전송 실패하면 → 'Can't reach your computer right now…' 메시지와 'Try again' 버튼이 표시된다 | `features/onboarding/signed-in/model.ts:266-272,view.tsx:180` |
| medium | 온보딩 | hand-off 실패 후 'Try again'을 누르면 → create()가 재실행된다 | `features/onboarding/signed-in/view.tsx:180,220` |
| medium | 정보-비동기작업 | 비동기 작업 조회가 malformed 응답이면 → failed 상태가 되고 이전 목록이 있으면 그것을 유지 표시한다 | `features/agent-info/async-tasks/provider.ts:111-120,177-194` |
| medium | 정보-비동기작업 | 비동기 작업 이벤트가 수신되면 → 해당 부모 에이전트의 작업 목록이 즉시 갱신된다 | `features/agent-info/async-tasks/provider.ts:273-285` |
| medium | 정보-아바타 | 아바타 편집기를 열면(그룹이 아니면) → Bot/Generate/Upload 탭이 표시된다(그룹은 Bot 탭 숨김) | `features/agent-info/avatar-editor/view.tsx:127-131` |
| medium | 정보-아바타 | Bot 탭에서 모양 버튼을 누르면 → 캐릭터 모양이 스테이징되고 미리보기가 바뀐다 | `features/agent-info/avatar-editor/view.tsx:40-44,controller.ts:205-222` |
| medium | 정보-아바타 | Bot 탭에서 색상 버튼을 누르면 → 캐릭터 색이 스테이징되고 미리보기가 바뀐다 | `features/agent-info/avatar-editor/view.tsx:45-49` |
| medium | 정보-아바타 | Upload 탭에서 'Browse files'를 누르면 → pickFile로 파일 선택 대화상자가 열리고 이미지가 로드된다 | `features/agent-info/avatar-editor/view.tsx:153,controller.ts:150-157` |
| medium | 정보-아바타 | Upload 드롭존에 이미지를 드래그·드롭하면 → 이미지 파일이 ingest되어 크롭 스테이지로 넘어간다 | `features/agent-info/avatar-editor/view.tsx:153,controller.ts:135-143` |
| medium | 정보-아바타 | 편집기에 이미지를 붙여넣기(paste)하면 → Upload 모드로 전환되고 이미지가 로드된다 | `features/agent-info/avatar-editor/view.tsx:88-98` |
| medium | 정보-아바타 | 크롭 스테이지에서 드래그하면 → 이미지 위치(pan)가 이동한다 | `features/agent-info/avatar-editor/view.tsx:99-114,controller.ts:181` |
| medium | 정보-아바타 | 줌 슬라이더를 조절하면 → 이미지 확대/축소가 반영된다(1~5배) | `features/agent-info/avatar-editor/view.tsx:142,controller.ts:180,model.ts:62-64` |
| medium | 정보-아바타 | 기존 아바타가 있을 때 'Reset'을 누르면 → 아바타 바이트가 지워지거나 스테이징 캐릭터가 커밋되고 닫힌다 | `features/agent-info/avatar-editor/view.tsx:132,116-119,controller.ts:191-203` |
| medium | 정보-아바타 | Bot 탭에서 커스텀 캐릭터가 있을 때 'Reset'을 누르면 → 캐릭터가 기본값으로 되돌아간다(resetCharacter) | `features/agent-info/avatar-editor/view.tsx:132,controller.ts:237-248` |
| medium | 정보-아바타 | 아바타 처리 중 오류가 나면 → aria-live 영역에 에러 메시지가 표시된다 | `features/agent-info/avatar-editor/view.tsx:157,controller.ts:73-75` |
| medium | 정보-아바타 | 25MB를 초과하는 이미지 파일을 넣으면 → 'Choose an image smaller than 25 MB.' 에러가 표시된다 | `features/agent-info/avatar-editor/model.ts:127-128` |
| medium | 정보-아바타 | 손상되어 로드 불가한 이미지를 넣으면 → 'That image could not be loaded.' 에러가 표시된다 | `features/agent-info/avatar-editor/model.ts:96-102` |
| medium | 정보-채널 | 채널 조회가 실패하고 표시할 뷰가 없으면 → 에러 메시지와 Retry 버튼이 표시된다 | `features/agent-info/channels/view.tsx:39-42` |
| medium | 정보-채널 | 액션 메뉴에서 'How to connect'를 누르면 → 연결 가이드 다이얼로그(단계 목록)가 열린다 | `features/agent-info/channels/view.tsx:90,108-140` |
| medium | 정보-멤버 | 멤버가 1명만 남으면(canRemove=false) → Remove 버튼이 비활성화된다 | `features/agent-info/group-members/view.tsx:78,model.ts:160` |
| medium | 정보-멤버 | 멤버 수가 최대(6명)에 도달하면 → 'Groups can have up to 6 members.' 안내가 표시된다 | `features/agent-info/group-members/view.tsx:90,model.ts:9,159` |
| medium | 정보-설정 | 이름 필드를 공백으로 비우고 확정하면 → 저장하지 않고 원래 값으로 되돌아간다 | `features/agent-info/settings/view.tsx:24,model.ts:140` |
| medium | 정보-설정 | 그룹 에이전트이면 → Title 필드와 Notifications 카드가 표시되지 않는다 | `features/agent-info/settings/view.tsx:59,62` |
| medium | 정보-설정 | 설정 저장이 실패하면 → aria-live 영역에 에러 메시지가 표시된다 | `features/agent-info/settings/view.tsx:68,model.ts:153-155,172-174` |
| medium | 정보-공유룸 | 대기 중인 참가 요청이 있으면 → 트리거에 배지(•)와 'n pending join requests' aria 라벨이 표시된다 | `features/agent-info/shared-room/trigger.tsx:20-27` |
| medium | 정보-공유룸 | 호스트가 People에서 다른 사람의 Remove를 누르면 → leaveSharedRoom(대상)으로 해당 사람이 제거된다 | `features/agent-info/shared-room/view.tsx:95,controller.ts:243-249` |
| medium | 정보-공유룸 | 전송이 끊기면(transport down) → 공유 상태가 비워지고 초대/보류 등 임시 상태가 초기화된다 | `features/agent-info/shared-room/controller.ts:173-183` |
| medium | 정보-공유룸 | sharing 이벤트가 수신되면 → 공유룸 상태(멤버·요청 등)가 즉시 갱신된다 | `features/agent-info/shared-room/controller.ts:166-172` |
| medium | 조직도 | 사이드바에서 Agent network 트리거를 누르면 → 현재 선택기를 닫고 조직도 워크스페이스가 열린다 | `features/org-chart/workspace/network-trigger.ts:24-31` |
| medium | 조직도 | 조직도에 에이전트가 없으면 → 'No agents yet. Create a few teammates…' 빈 상태가 표시된다 | `features/org-chart/workspace/graph.tsx:84-90` |
| medium | 조직도 | 조직도 노드가 응답 대기/작업 중/그룹이면 → 'Waiting for you'/'Working…'/'n members' 캡션이 표시된다 | `features/org-chart/workspace/graph.tsx:124` |
| medium | 조직도 | 조직도 씬에서 마우스 휠을 돌리면 → 포인터 위치 기준으로 확대/축소된다 | `features/org-chart/workspace/graph.tsx:37-49,layout.ts:200-209` |
| medium | 조직도 | 조직도 씬을 드래그하면 → 뷰포트가 이동(pan)한다 | `features/org-chart/workspace/graph.tsx:51-77,layout.ts:196-198` |
| medium | 조직도 | 두 에이전트가 모두 턴 진행 중이면(엣지 활동) → 연결선이 'talking'으로 밝게 표시된다 | `features/org-chart/workspace/graph.tsx:111,model.ts:66-72` |
| medium | 조직도 | 인스펙터에서 에이전트 활동 상태에 따라 → 'Working…'(초록)/'Waiting for you'/'Idle' 라벨이 표시된다 | `features/org-chart/workspace/inspector.tsx:18-22,45` |
| low | 소개(About) | 닫기(Close) 아이콘 버튼을 누르면 → About 다이얼로그가 닫힌다 | `features/about/overlay/view.tsx:74` |
| low | 소개(About) | Escape 키를 누르면 → About 다이얼로그가 닫힌다 | `features/about/overlay/view.tsx:36-43` |
| low | 소개(About) | 복사 후 1200ms가 지나면 → 버튼 라벨이 'Copy version info'로 복원된다 | `features/about/overlay/view.tsx:51-55` |
| low | 소개(About) | 업데이트 상태가 null이면 → 'Copy version info' 버튼이 비활성화된다 | `features/about/overlay/view.tsx:83` |
| low | 소개(About) | 클립보드 쓰기가 거부되면 → 에러 없이 버튼이 그대로 유지된다(무동작) | `features/about/overlay/view.tsx:67-69` |
| low | 계정 | 이름 입력창에 201자 이상 입력하려 하면 → maxLength 200으로 제한된다 | `features/account/session/menu.tsx:186` |
| low | 계정 | 로그아웃 확인 다이얼로그가 열리면 → 확인 버튼에 초기 포커스가 잡힌다 | `features/account/session/sign-out.tsx:28,48` |
| low | 로스터 | 프라이버시 차단 다이얼로그에서 Escape를 누르면 → 닫히지 않는다(기본 동작 차단) | `features/roster/privacy-blocked.tsx:45-48` |
| low | 로스터 | 프라이버시 차단 다이얼로그에서 Tab을 누르면 → 포커스가 다이얼로그 내부에서 순환(포커스 트랩)된다 | `features/roster/privacy-blocked.tsx:49-61` |
| low | 로스터 | 프라이버시 차단 다이얼로그 바깥을 누르면 → 포인터 입력이 차단되어 다이얼로그가 유지된다 | `features/roster/privacy-blocked.tsx:62-65` |
| low | 로스터 | 프라이버시 차단 처리가 진행 중(busy)이면 → 두 버튼이 모두 비활성화된다 | `features/roster/privacy-blocked.tsx:92-93` |
| low | 로스터 | 프라이버시 차단 다이얼로그가 열리면 → 'Open Privacy Settings' 버튼에 초기 포커스가 잡힌다 | `features/roster/privacy-blocked.tsx:35-41` |
| low | 로스터 | 재연결 재시도 중(isRetrying)이면 → Retry 버튼이 비활성화되고 'Retrying…'로 표시된다 | `features/roster/reconnect-notice.tsx:13-14` |
| low | 로스터 | 에러 상태에서 재시도 중이면 → Retry 버튼이 비활성화되고 'Retrying…'가 표시된다 | `features/roster/status.tsx:45-46` |
| low | 로스터 | 저장된 선택 상태 envelope가 손상/버전 불일치이면 → 해당 저장값을 지우고 선택 없음으로 시작한다 | `features/roster/selection-state.ts:57-75,163-171` |
| low | 숨김대화 | 숨김 봇이 하나도 없으면 → eye-slash 아이콘과 'No hidden bots'가 표시된다 | `features/hidden-chats/overlay/view.tsx:110-114` |
| low | 숨김대화 | 숨김 봇 다이얼로그에서 Close 아이콘을 누르면 → onClose가 호출되어 닫힌다 | `features/hidden-chats/overlay/view.tsx:106` |
| low | 숨김대화 | 숨김 봇 다이얼로그에서 Escape를 누르면 → 오버레이가 닫힌다 | `features/hidden-chats/overlay/view.tsx:63-68` |
| low | 숨김대화 | 숨김 봇 다이얼로그에서 Tab을 누르면 → 포커스가 내부 요소에서 순환(포커스 트랩)된다 | `features/hidden-chats/overlay/view.tsx:69-87` |
| low | 숨김대화 | 숨김 봇 다이얼로그 바깥을 누르면(pointerdown) → 오버레이가 닫힌다 | `features/hidden-chats/overlay/view.tsx:42-45,50` |
| low | 숨김대화 | 포커스가 다이얼로그 밖으로 나가면 → 포커스가 다이얼로그로 되돌아온다 | `features/hidden-chats/overlay/view.tsx:46-49` |
| low | 숨김대화 | 숨김 봇 다이얼로그가 닫히면 → 이전에 포커스됐던 요소로 포커스가 복원된다 | `features/hidden-chats/overlay/view.tsx:52-58` |
| low | 숨김대화 | 동일 에이전트의 숨김 변경이 진행 중이면 → isPending이 true가 되어 중복 요청이 차단된다 | `features/hidden-chats/overlay/mutation-controller.ts:138-143,160-163` |
| low | 온보딩 | Meet 단계에 진입하면 → 환영 문구가 타이핑 애니메이션으로 표시되고 커서가 깜빡인다 | `features/onboarding/signed-in/view.tsx:170,model.ts:236-239` |
| low | 온보딩 | computer-demo 단계에 진입하면 → 커서가 창 타일을 누르는 데모 애니메이션이 재생된다 | `features/onboarding/signed-in/view.tsx:108-131` |
| low | 온보딩 | jobs 단계에 진입하면 → 작업 말풍선(Invoice Chaser 등)이 나타나고 캐릭터가 배치된다 | `features/onboarding/signed-in/view.tsx:172,model.ts:60-64` |
| low | 온보딩 | tools 단계에서 검색 결과가 없으면 → 'No tools match "쿼리"' 문구가 표시된다 | `features/onboarding/signed-in/view.tsx:162` |
| low | 온보딩 | 추천 레일을 마우스 휠로 스크롤하면 → 세로 델타가 가로 스크롤로 변환되고 가장자리 마스크가 갱신된다 | `features/onboarding/signed-in/view.tsx:133-144` |
| low | 온보딩 | 단계를 전환할 때마다 → onboarding step 텔레메트리(방향 포함)가 보고된다 | `features/onboarding/signed-in/view.tsx:200,model.ts:218-225` |
| low | 온보딩 | prefers-reduced-motion이 켜져 있으면 → 장면 비트가 즉시 최종값이 되고 전환 애니메이션 시간이 0이 된다 | `features/onboarding/signed-in/view.tsx:51-63,93` |
| low | 온보딩 | 선택한 일상 도구가 있으면 에이전트 생성 요청에 → 설명에 해당 도구 목록 문장이 덧붙는다 | `features/onboarding/signed-in/model.ts:246-262` |
| low | 온보딩 | 선택한 도구에 따라 추천 목록을 만들면 → 도구에 맞는 추천이 우선 배치되고 최대 10개까지 채워진다 | `features/onboarding/signed-in/suggestions.ts:71-91` |
| low | 온보딩 | 컴퓨터 준비 프로브가 실패하면 → 2.5초 후 재시도하고 준비되면 대기자를 깨운다 | `features/onboarding/signed-in/computer-readiness.ts:95-108,130-138` |
| low | 온보딩 | create 단계에서 sales-forecast 아바타가 착지 전환을 마치면 → 미리보기 아바타가 나타난다(isAvatarLanded) | `features/onboarding/signed-in/view.tsx:95,222,175` |
| low | 봇캐릭터 | 페르소나 마크에 색/모양이 지정되지 않으면 → 에이전트 id 해시로 결정론적 색·모양이 선택된다 | `features/onboarding/signed-in/character.tsx:51-58` |
| low | 봇캐릭터 | 포인터를 움직이면(isFollowingPointer/followTarget) → 캐릭터의 눈이 포인터 방향으로 시선을 따라간다 | `features/onboarding/signed-in/character.tsx:259-286,301-303` |
| low | 봇캐릭터 | prefers-reduced-motion이거나 paused이면 → 캐릭터 애니메이션 프레임 루프가 실행되지 않는다 | `features/onboarding/signed-in/character.tsx:288-309` |
| low | 봇캐릭터 | 상태가 excited/happy/celebrate이면 → 캐릭터에 미소(입 곡선)가 그려진다 | `features/onboarding/signed-in/character.tsx:322` |
| low | 봇캐릭터 | 상태가 sleeping이면 → 눈 높이가 낮아져(2px) 감은 눈으로 표시된다 | `features/onboarding/signed-in/character.tsx:313,319-320` |
| low | 정보-비동기작업 | 진행 중인 비동기 작업이 없으면 → 'No async tasks in progress.' 빈 상태가 표시된다 | `features/agent-info/async-tasks/view.tsx:91-92` |
| low | 정보-비동기작업 | 비동기 작업 패널 헤더를 드래그하면 → 패널이 이동한다(useMovablePanel) | `features/agent-info/async-tasks/view.tsx:78,83` |
| low | 정보-비동기작업 | 비동기 작업 패널의 Close 버튼을 누르면 → onClose가 호출되어 패널이 닫힌다 | `features/agent-info/async-tasks/view.tsx:88` |
| low | 정보-비동기작업 | 30초 시계 틱이 발생하면 → 작업 행의 상대 시각(now/Xm ago 등)이 갱신된다 | `features/agent-info/async-tasks/view.tsx:50-53,clock.ts:32-68` |
| low | 정보-비동기작업 | 비동기 작업 기능이 capability-unavailable이면 → unavailable 상태로 프로젝션된다 | `features/agent-info/async-tasks/provider.ts:112-113` |
| low | 정보-비동기작업 | 재연결(noteReconnect)되면 → 진행 중이던 조회를 무효화하고 감시 중 항목을 새로고침한다 | `features/agent-info/async-tasks/provider.ts:236-247` |
| low | 정보-아바타 | Generate 텍스트영역에서 Cmd/Ctrl+Enter를 누르면 → 생성이 시작된다 | `features/agent-info/avatar-editor/view.tsx:154` |
| low | 정보-аба타 | 설명이 비어 있으면 → Generate 버튼이 비활성화된다 | `features/agent-info/avatar-editor/view.tsx:155` |
| low | 정보-아바타 | 생성 진행 중이면 → 입력이 readOnly가 되고 상태 스피너와 'Generating…' 버튼이 표시된다 | `features/agent-info/avatar-editor/view.tsx:149-153` |
| low | 정보-아바타 | Zoom in/Zoom out 버튼을 누르면 → 줌이 0.5 단위로 증감된다 | `features/agent-info/avatar-editor/view.tsx:141,143` |
| low | 정보-아바타 | 저장 진행 중이면 → 버튼이 'Saving…'로 바뀌고 컨트롤들이 비활성화된다 | `features/agent-info/avatar-editor/view.tsx:145,60` |
| low | 정보-аба타 | 크롭 스테이지에서 'Restart'를 누르면 → 크롭이 초기 소스 선택 상태로 리셋된다 | `features/agent-info/avatar-editor/view.tsx:145,controller.ts:182-186` |
| low | 정보-아바타 | 편집기에서 Escape를 누르면 → 편집기가 닫힌다 | `features/agent-info/avatar-editor/view.tsx:71-75,84-85` |
| low | 정보-아바타 | 편집기 바깥(트리거 제외)을 누르면 → 편집기가 닫힌다 | `features/agent-info/avatar-editor/view.tsx:66-70` |
| low | 정보-아바타 | Cancel 버튼을 누르면 → 편집기가 닫힌다 | `features/agent-info/avatar-editor/view.tsx:148,158,62` |
| low | 정보-아바타 | 계정 키가 없으면(아바타 프로덕션 스코프) → status가 signed-out이 되어 컨트롤러가 만들어지지 않는다 | `features/agent-info/avatar-editor/production-adapter.ts:80-82` |
| low | 정보-아바타 | 아바타 브리지가 사용 불가하면 → status가 bridge-unavailable이 된다 | `features/agent-info/avatar-editor/production-adapter.ts:83-86` |
| low | 정보-채널 | 채널 에러 상태에서 Retry를 누르면 → 채널 목록을 다시 로드한다 | `features/agent-info/channels/view.tsx:41,model.ts:286` |
| low | 정보-채널 | 커넥터 목록이 비어 있으면 → 'No connectors available.'가 표시된다 | `features/agent-info/channels/view.tsx:43-44` |
| low | 정보-채널 | 자격증명 팝오버에서 Cancel을 누르면 → 토큰이 지워지고 팝오버가 닫힌다 | `features/agent-info/channels/view.tsx:101` |
| low | 정보-채널 | 채널 행의 액션(⋯) 메뉴를 누르면 → 'How to connect'와 (연결 시)Refresh/Disconnect 메뉴가 열린다 | `features/agent-info/channels/view.tsx:87-96` |
| low | 정보-채널 | 가이드 다이얼로그에서 'Got it'/Escape/바깥클릭을 하면 → 가이드가 닫히고 트리거로 포커스가 복원된다 | `features/agent-info/channels/view.tsx:115-138` |
| low | 정보-채널 | 해당 채널의 작업이 진행 중(busy)이면 → Connect/Reconnect/Disconnect/Refresh 버튼이 비활성화된다 | `features/agent-info/channels/view.tsx:59-61,84-93` |
| low | 정보-멤버 | 제거 확인에서 Cancel을 누르면 → 제거되지 않고 알림이 닫힌다 | `features/agent-info/group-members/model.ts:97,253` |
| low | 정보-멤버 | 추가할 후보 봇이 없으면 → 'Create more Bots to add them here.' 안내가 표시된다 | `features/agent-info/group-members/view.tsx:90` |
| low | 정보-멤버 | 멤버 추가/제거가 진행 중(pending)이면 → 'Add Member' 버튼이 비활성화되고 Remove도 막힌다 | `features/agent-info/group-members/view.tsx:83,model.ts:160` |
| low | 정보-멤버 | 추가 메뉴에서 Escape를 누르면 → 메뉴가 닫히고 트리거로 포커스가 복원된다 | `features/agent-info/group-members/view.tsx:42-48` |
| low | 정보-멤버 | 추가 메뉴 바깥을 누르면 → 메뉴가 닫힌다 | `features/agent-info/group-members/view.tsx:49-52` |
| low | 정보-멤버 | 대상이 공유룸이거나 미로그인/구세대 스코프이면 → 멤버 라우트가 열리지 않는다(fail closed) | `features/agent-info/group-members/route.ts:39-51` |
| low | 정보-설정 | 편집 필드에서 Escape를 누르면 → 변경이 취소되고 원래 값으로 복원된다 | `features/agent-info/settings/view.tsx:28` |
| low | 정보-설정 | 한 줄 필드에서 Enter를 누르면 → blur되어 값이 커밋된다 | `features/agent-info/settings/view.tsx:29,21-26` |
| low | 정보-설정 | 필드 값이 이전과 동일하면 → 업데이트 RPC를 호출하지 않는다 | `features/agent-info/settings/view.tsx:24,model.ts:141-142` |
| low | 정보-설정 | 저장이 진행 중(pending)이면 → Notifications 스위치가 비활성화된다 | `features/agent-info/settings/view.tsx:65` |
| low | 정보-설정 | 권위 있는 roster 이벤트로 에이전트가 갱신되면 → 설정 필드가 최신 값으로 반영된다 | `features/agent-info/settings/model.ts:94-116` |
| low | 정보-공유룸 | 공유룸 헤더 트리거를 누르면 → onOpen이 호출되어 공유룸 관리 다이얼로그가 열린다 | `features/agent-info/shared-room/trigger.tsx:24` |
| low | 정보-공유룸 | 공유가 비활성이거나 roomId가 없으면 → 공유룸 헤더 트리거가 표시되지 않는다 | `features/agent-info/shared-room/trigger.tsx:19` |
| low | 정보-공유룸 | 초대 링크의 Copy 버튼을 누르면 → 링크가 클립보드에 복사되고 버튼이 'Copied'로 바뀐다 | `features/agent-info/shared-room/view.tsx:29-41` |
| low | 정보-공유룸 | 초대 링크 클립보드 복사가 실패하면 → 버튼이 'Try again'으로 표시된다 | `features/agent-info/shared-room/view.tsx:33-36,40` |
| low | 정보-공유룸 | 초대 링크 입력창에 포커스하면 → 링크 텍스트가 전체 선택된다 | `features/agent-info/shared-room/view.tsx:39` |
| low | 정보-공유룸 | 초대 생성이 error를 반환하면 → role=alert로 에러 메시지가 표시된다 | `features/agent-info/shared-room/view.tsx:80,controller.ts:214-216` |
| low | 정보-공유룸 | 해당 요청 처리가 진행 중이면 → Approve·Deny 버튼이 비활성화된다 | `features/agent-info/shared-room/view.tsx:87-88` |
| low | 정보-공유룸 | People 목록에서 호스트 멤버는 → 'Host' 라벨이 표시되고 Remove 버튼이 없다 | `features/agent-info/shared-room/view.tsx:95` |
| low | 정보-공유룸 | 에이전트 추가/제거가 진행 중이면 → 해당 에이전트의 Add/Remove 버튼이 비활성화된다 | `features/agent-info/shared-room/view.tsx:102` |
| low | 정보-공유룸 | 공유룸 다이얼로그에서 Done/Escape/배경클릭을 하면 → onClose로 다이얼로그가 닫히고 포커스가 복원된다 | `features/agent-info/shared-room/view.tsx:54-70,76,105` |
| low | 정보-공유룸 | 전송이 다시 연결되면(context 있음) → 공유 상태를 자동으로 새로고침한다 | `features/agent-info/shared-room/controller.ts:182` |
| low | 조직도 | 게이트는 켜졌으나 에이전트가 없으면 → 조직도 진입점이 retained(empty-roster)로 유지된다 | `features/org-chart/workspace/entrypoint.ts:9-11` |
| low | 조직도 | 조직도의 Close 버튼을 누르면 → onClose로 조직도가 닫힌다 | `features/org-chart/workspace/view.tsx:37` |
| low | 조직도 | 조직도 빈 영역을 더블클릭하면 → 뷰포트가 기본(scale 1, 0,0)으로 리셋된다 | `features/org-chart/workspace/graph.tsx:79-82` |
| low | 조직도 | 인스펙터의 Close 버튼을 누르면 → 인스펙터가 닫힌다(선택 해제) | `features/org-chart/workspace/inspector.tsx:40,view.tsx:39` |
| low | 조직도 | 인스펙터에 설명/마지막 메시지가 있으면 → About·Last activity 섹션과 시각이 표시된다 | `features/org-chart/workspace/inspector.tsx:47,49` |

## Host extensions · 세션/전사/추론/메모리/첨부/검색/알림/승인/권한/인증/비밀/티칭/트레이  (누락 160건, 추출 234 / 매칭 74)
- 표면 판정: ~32% of atomic behaviors matched (74/234). Ledger covers the core happy-path host APIs (send, agents, channels, automations, workflows, memory list/delete, attachment upload/read, search, widgets, permission/approval resolve) but entirely misses several feature areas — wallpaper tone-scheduler, mobile-push delivery, image generation, link previews, agent web-search/web-fetch, the spend-guard, and clear-conversation — plus the large majority of boundary/error/lifecycle/recovery states across session, transcript, local-tool-permission, auto-review, attachments, and inference (9 high-severity gaps, ~60 medium, rest low). No overclaims: every ledger row in this surface is backed by code in the RPC coordinator / IPC layer.

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | wallpaper | Scheduler starts or the time-of-day tone boundary is reached → Desktop wallpaper is repainted to the current tone on every live X display; whole wallpaper feature area is absent from the ledger | `source/host/extensions/wallpaper/wallpaper-service.ts:sync` |
| high | notifications | An agent finishes a turn while the window is unfocused → A mobile push notification is sent; ledger has notification toggles/focus but never the push delivery itself | `source/host/extensions/notifications/mobile-push-notifier.ts:fire` |
| high | notifications | An agent transitions to needing user input → A push notification is sent with awaitingUserResponse=true | `source/host/extensions/notifications/mobile-push-notifier.ts:fire` |
| high | attachments | Generate an image from a description → An image is generated and persisted into the agent media store, returning its path; no image-generation row in the ledger | `source/host/extensions/attachments/generate-image-service.ts:createSandGenerateImageService` |
| high | attachments | Fetch a link preview for a URL → Returns OpenGraph title/description/image/favicon metadata; no link-preview row in the ledger | `source/host/extensions/attachments/attachments-service.ts:fetchLinkMetadata` |
| high | inference | Agent runs a web search → Returns an answer plus source documents (url/title/text); no web-search capability in the ledger (BROWSER rows are automation) | `source/host/extensions/inference/cursor-web-tools.ts:createCursorWebSearchService` |
| high | inference | Agent runs a web fetch on a URL → Returns page content, or an error with an isTimeout flag; no web-fetch capability in the ledger | `source/host/extensions/inference/cursor-web-tools.ts:createCursorWebFetchService` |
| high | session | Clear a conversation → Transcript entries and transient state are wiped and a conversation-cleared mutation is published; no clear-conversation row in the ledger | `source/host/extensions/session/agent-db.ts:clearConversation` |
| high | transcript | User is away past the idle threshold with many unread routine results → A spend-guard nudge widget 'keep my routines running?' appears with Keep/Pause/Never-ask options; no spend-guard feature in the ledger | `source/host/extensions/transcript/automation-spend-guard-runtime.ts:apply` |
| medium | trays | An error condition pushes an error tray → A new error tray appears and a 'pushed' event fires; ledger only has get/dismiss/clear, never the push/create mechanism | `source/host/extensions/trays/trays-service.ts:pushError` |
| medium | trays | pushError with a dedupeKey matching an existing tray → Existing tray updated in place and its count increments instead of a new tray | `source/host/extensions/trays/trays-service.ts:27` |
| medium | trays | pushError beyond the MAX_TRAYS (20) cap → Oldest trays dropped and emit 'dismissed' so the list stays at 20 | `source/host/extensions/trays/trays-service.ts:enforceCap` |
| medium | trays | An agent is deleted so its trays are cleared → All trays belonging to that agent are dismissed | `source/host/extensions/trays/trays-service.ts:clearForAgent` |
| medium | wallpaper | Wallpaper helper scripts are absent at startup → Wallpaper feature reports disabled and no painting occurs | `source/host/extensions/wallpaper/box-wallpaper-commands.ts:isAvailable` |
| medium | wallpaper | User time zone changes → Wallpaper re-syncs and repaints for the new local time | `source/host/extensions/wallpaper/wallpaper-service.ts:start` |
| medium | teach-recording | Start recording with no private monitor available → Fails with 'Teach recording requires a private desktop monitor.' | `source/host/extensions/teach-recording/teach-recording-service.ts:143` |
| medium | teach-recording | Start recording while the feature gate is off → Fails with a disabled error ('the feature gate is off') | `source/host/extensions/teach-recording/teach-recording-service.ts:159` |
| medium | teach-recording | Start recording while one is already active → Returns the current recording status (idempotent no-op) | `source/host/extensions/teach-recording/teach-recording-service.ts:160` |
| medium | teach-recording | Recording exceeds the max duration cap → Auto-stops and saves, sending the learning prompt | `source/host/extensions/teach-recording/teach-recording-service.ts:armCap` |
| medium | teach-recording | Stop with save but the learning workflow is unavailable → Fails with workflow_unavailable error | `source/host/extensions/teach-recording/teach-recording-service.ts:178` |
| medium | teach-recording | Recover pending recordings on startup → Undelivered completed recordings deliver their learning prompt to the agent | `source/host/extensions/teach-recording/teach-recording-service.ts:recoverPending` |
| medium | teach-recording | Queue contains a forged/unsigned entry → The entry is quarantined (moved to a rejected folder) and never delivered | `source/host/extensions/teach-recording/teach-recording-service.ts:quarantineQueueFiles` |
| medium | secrets | Set box secrets that fail validation → Throws SandBoxSecretsValidationError and nothing is applied | `source/host/extensions/secrets/secrets-service.ts:setSecrets` |
| medium | notifications | The window was focused within the last 5 minutes when a turn finishes → The push notification is suppressed (treated as user present) | `source/host/extensions/notifications/mobile-push-notifier.ts:resolvePresence` |
| medium | auth | getAccessToken when no token can be obtained → Throws SandCredentialsWaitingError with 'Waiting for an inference credential…' | `source/host/extensions/auth/auth-service.ts:87` |
| medium | local-tool-permission | User resolves an ask with 'always' → Global permission is set to always and the request is granted (distinct from allow-once) | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts:resolveRequest` |
| medium | local-tool-permission | User resolves an ask with 'never' → Global permission is set to never and the request is denied (distinct from one-off deny) | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts:resolveRequest` |
| medium | local-tool-permission | An ask sits unanswered past its TTL → It expires with SAND_LOCAL_TOOLS_ASK_EXPIRED_MESSAGE | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts:ask` |
| medium | local-tool-permission | The tool-call request is aborted before the user answers → Settled with SAND_LOCAL_TOOLS_ASK_CANCELLED_MESSAGE | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts:join` |
| medium | local-tool-permission | An ask is raised but the ask surface cannot show it → Denied with SAND_LOCAL_TOOLS_ASK_UNAVAILABLE_MESSAGE | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts:74` |
| medium | local-tool-permission | An ask is raised but the agent has no live local computer → Denied with SAND_NO_LOCAL_MACHINE_MESSAGE | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts:75` |
| medium | local-tool-permission | The tool target exceeds 10000 chars → Denied with SAND_LOCAL_TOOLS_TARGET_TOO_LARGE_MESSAGE | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts:79` |
| medium | local-tool-permission | A new turn begins for an agent → Its pending asks expire and outstanding approvals are retired | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts:beginTurn` |
| medium | local-tool-permission | Resolve a permission ask that is no longer pending → Settles the stale card or throws 'no longer waiting for an answer' | `source/host/extensions/local-tool-permission/local-tool-permission-resolution.ts:resolveLocalToolPermissionAsk` |
| medium | local-tool-permission | Boot sweep runs after background work is ready → Stale pending local-tool permission cards from before boot are expired | `source/host/extensions/local-tool-permission/extension.ts:18` |
| medium | auto-review | An auto-review approval is created → An approval card is sent (status pending) and an awaiting badge is set; ledger only has the resolve action | `source/host/extensions/auto-review/auto-review-service.ts:#handleApprovalEvent` |
| medium | auto-review | Resolve an auto-review approval that is already stale/settled → Settles the stale card, or throws SAND_AUTO_REVIEW_STALE | `source/host/extensions/auto-review/auto-review-service.ts:39` |
| medium | auto-review | Session ends with pending approvals → Pending approvals expire (status expired) | `source/host/extensions/auto-review/auto-review-service.ts:expirePendingApprovals` |
| medium | auto-review | All approvals for an agent clear → The auto-review awaiting badge is cleared for that agent | `source/host/extensions/auto-review/sand-auto-review-awaiting.ts:handleEvent` |
| medium | auto-review | Startup after any prior pending approvals → Pending approval cards are expired and stale awaiting badges swept | `source/host/extensions/auto-review/extension.ts:sweepBadges` |
| medium | attachments | Ingest an attachment over its per-type byte limit → Throws AttachmentTooLargeError (ledger only covers a multi-file count limit) | `source/host/extensions/attachments/attachments-service.ts:ingestAttachment` |
| medium | attachments | Ingest an empty attachment → Throws SandAttachmentError 'Attachment is empty.' | `source/host/extensions/attachments/attachments-service.ts:ingestAttachmentBytes` |
| medium | attachments | Upload with no active agent and no agentId → Throws 'No active agent to attach to.' | `source/host/extensions/attachments/attachments-service.ts:resolveDir` |
| medium | attachments | Read an image path outside the sand root → Returns null (refused) | `source/host/extensions/attachments/attachments-service.ts:readHostAttachmentImage` |
| medium | attachments | Read a binary attachment as text → Returns {kind:'binary'} with byte size instead of text | `source/host/extensions/attachments/attachments-service.ts:readAttachmentText` |
| medium | attachments | Read an attachment chunk for playback of an HEVC video → An h264 playback rendition is transcoded and served | `source/host/extensions/attachments/video-playback-rendition.ts:withVideoPlaybackSource` |
| medium | attachments | Generated image cannot be persisted → Throws SandGenerateImagePersistError | `source/host/extensions/attachments/generate-image-service.ts:22` |
| medium | attachments | A link preview redirects to an authentication page → Returns null (no preview shown) | `source/host/extensions/attachments/attachments-service.ts:isAuthenticationDestination` |
| medium | attachments | Link preview URL resolves to a non-public host or IP → Throws SandLinkPreviewError (SSRF blocked) | `source/host/extensions/attachments/safe-link-preview-fetch.ts:parseSafeLinkPreviewUrl` |
| medium | attachments | Stage host attachments into the running box → Eligible files upload to /workspace/uploads and a host→box path map is returned | `source/host/extensions/attachments/box-staging.ts:stageAttachmentsIntoBox` |
| medium | content-search | Search when the index is not ready → Falls back to a linear scan across agent transcripts so search still returns results | `source/host/extensions/transcript/roster-search.ts:searchAgentsByLinearScan` |
| medium | memory | Agent writes a memory in agent scope via the state tool → Fact is saved and 'Remembered in your memory' is returned (ledger covers reflection/list/delete, not the agent write) | `source/host/extensions/memory/agent-state.ts:writeMemory` |
| medium | memory | Agent writes a memory that is empty or already recorded → Returns 'nothing was saved … empty or already recorded' | `source/host/extensions/memory/agent-state.ts:remember` |
| medium | memory | Agent writes a memory in project scope without having joined it → Returns 'you haven't joined project … Join it first' | `source/host/extensions/memory/agent-state.ts:shardFor` |
| medium | memory | Agent removes a memory by exact content → Returns 'Forgot from …' (agent forget-by-content, distinct from UI delete-by-id) | `source/host/extensions/memory/agent-state.ts:removeMemory` |
| medium | memory | Agent removes a memory whose text does not exactly match → Returns 'no fact with exactly that text is recorded' | `source/host/extensions/memory/agent-state.ts:removeMemory` |
| medium | memory | Memory dreaming/synthesis gate is enabled → Turn exchanges feed background memory synthesis that updates memory files | `source/host/extensions/memory/memory-synthesis-service.ts:runAgent` |
| medium | memory | Agent updates its own profile name/description via the state tool → Returns 'Updated your name/description.' and the profile is written | `source/host/extensions/memory/agent-state.ts:updateProfile` |
| medium | memory | Agent updates its own settings (hiddenFromSidebar/notifyOnAgentUpdates) via the state tool → Settings are written and the changed fields are reported | `source/host/extensions/memory/agent-state.ts:updateSettings` |
| medium | memory | Agent creates/joins/leaves a project via the state tool → Project folder is created/joined/left with a confirming message or a slug-invalid error; no project rows in ledger | `source/host/extensions/memory/agent-state.ts:createProject` |
| medium | memory | Agent sets an avatar that is not a recognized image type → Returns 'that file is not a recognized image' | `source/host/extensions/memory/agent-state.ts:setAvatar` |
| medium | memory | Agent sets an avatar over 5MB or empty → Returns 'the image must be under 5 MB and non-empty.' | `source/host/extensions/memory/agent-state.ts:setAvatar` |
| medium | memory | Agent clears its avatar → Returns 'Cleared your picture — back to the default.' | `source/host/extensions/memory/agent-state.ts:clearAvatar` |
| medium | inference | Check readiness with no auth token and no mock response → Reports not ready (sends cannot run) | `source/host/extensions/inference/extension.ts:52` |
| medium | inference | Inference provider is codex but ChatGPT is not signed in → Errors with 'Codex is not signed in with ChatGPT. Run codex login' | `source/host/extensions/inference/provider-session.ts:codexCredentials` |
| medium | inference | Inference provider is claude-code but the CLI is not installed → Errors with 'Claude Code is not installed…' | `source/host/extensions/inference/provider-session.ts:claudeExecutor` |
| medium | inference | Inference provider is openrouter with no API key → Errors with 'OpenRouter needs OPENROUTER_API_KEY. Add it in Settings → Router.' | `source/host/extensions/inference/provider-session.ts:openRouterCredential` |
| medium | session | App boots with a previously persisted active agent → That agent is restored as the active session | `source/host/extensions/transcript/session-runtime.ts:ensureSession` |
| medium | session | A turn is attempted while stored conversation exceeds the hard limit and GC can't shrink it → Throws SandConversationTooLargeError telling the user to start a new conversation | `source/host/extensions/session/conversation-size-limits.ts:ensureConversationCapacityForTurn` |
| medium | session | An agent's store.db is missing but the folder has durable footprint → A minimal summary is reconstructed so the agent still appears | `source/host/extensions/session/session-mutations.ts:recoverAgentWithMissingDb` |
| medium | transcript | Send a prompt while no turn executor is attached → Throws RUNNER_UNATTACHED_MESSAGE | `source/host/extensions/transcript/send-pipeline.ts:161` |
| medium | transcript | Submit a secret that fails to store → Tray error 'Could not store the secret' is shown | `source/host/extensions/transcript/widget-responses.ts:375` |
| medium | transcript | React (adding) to an agent's message → The agent is resumed with a hidden 'user reacted …' note | `source/host/extensions/transcript/widget-responses.ts:511` |
| medium | transcript | Kickstart/onboarding turn fails → Tray error under INTRODUCTION_FAILED title is shown | `source/host/extensions/transcript/agent-lifecycle.ts:170` |
| medium | transcript | Clone a group agent → Fails with 'Groups can't be duplicated yet.' | `source/host/extensions/transcript/agent-lifecycle.ts:249` |
| medium | transcript | Delete the last remaining agent → The transcript is cleared and no active session remains | `source/host/extensions/transcript/agent-lifecycle.ts:459` |
| medium | transcript | Create a group whose member set duplicates an existing group → Switches to the existing group instead of creating a new one | `source/host/extensions/transcript/group-chat-glue.ts:113` |
| medium | transcript | Create a group with no existing members → Throws 'A group needs at least one existing member agent.' | `source/host/extensions/transcript/group-chat-glue.ts:107` |
| medium | transcript | A group turn runs → Members respond in bounded round-robin and their messages stream into the room | `source/host/extensions/transcript/group-chat-orchestrator.ts:run` |
| medium | transcript | A group turn errors → Tray error 'Group chat failed' is shown | `source/host/extensions/transcript/group-chat-glue.ts:240` |
| medium | transcript | User answers the spend-guard nudge 'Pause them all' → All enabled routines are disabled and an ack is sent | `source/host/extensions/transcript/automation-spend-guard-runtime.ts:handleWidgetAnswer` |
| medium | transcript | User answers the spend-guard nudge 'Keep them running' / 'Don't ask again' → Routines keep running and the guard snoozes 30d (or opts out permanently) | `source/host/extensions/transcript/automation-spend-guard-runtime.ts:handleWidgetAnswer` |
| medium | transcript | User stays away past the pause delay after a nudge → All routines auto-pause, a tray 'Routines paused while you were away' shows, and a paused widget appears | `source/host/extensions/transcript/automation-spend-guard-runtime.ts:pauseForAwayUser` |
| medium | transcript | User answers the paused widget 'Resume routines' / 'Keep them paused' → Guard-paused routines re-enable, or stay paused, with an ack | `source/host/extensions/transcript/automation-spend-guard-runtime.ts:handleWidgetAnswer` |
| medium | transcript | The agent sends a message addressed to a channel → The message is delivered to that channel | `source/host/extensions/transcript/turn-runtime.ts:handleAgentUpdate` |
| medium | transcript | Channel delivery fails → Tray 'Message not delivered' shows and a delivery-failure follow-up wakes the agent | `source/host/extensions/transcript/background-wakes.ts:deliverToChannel` |
| medium | transcript | The agent emits a listener-connect message → A listener-connect card is surfaced for the owning agent | `source/host/extensions/transcript/turn-runtime.ts:notifyListenerConnect` |
| medium | transcript | The agent emits a connector connect card → A connector-connect card is surfaced for the owning agent | `source/host/extensions/transcript/turn-runtime.ts:notifyConnectorConnect` |
| medium | transcript | A named activity update arrives during a run → The agent's currentActivity label is shown in the roster | `source/host/extensions/transcript/run-lifecycle.ts:trackActivityFromUpdate` |
| medium | transcript | A run wedges past the watchdog window → The wedged run is interrupted by the scheduler watchdog | `source/host/extensions/transcript/run-lifecycle.ts:44` |
| medium | transcript | An inbound channel message arrives for an agent → The agent is woken, the message appears, and it runs a hidden turn | `source/host/extensions/transcript/background-wakes.ts:runInboundWake` |
| medium | transcript | Emit a timeline event to an agent → An event entry is appended and the agent is woken if idle | `source/host/extensions/transcript/background-wakes.ts:emitTimelineEvent` |
| medium | transcript | An agent posts to a group it belongs to → Returns 'Posted to "{group}".' and members respond on their turns | `source/host/extensions/transcript/shared-rooms.ts:postToGroup` |
| medium | transcript | A background subagent finishes → The parent agent is woken and may SendMessage the result | `source/host/extensions/transcript/completion-revivals.ts:handleBackgroundSubagentCompletion` |
| medium | transcript | A background shell command finishes → The agent is woken with the command outcome to continue or report | `source/host/extensions/transcript/completion-revivals.ts:handleBackgroundShellCompletion` |
| medium | transcript | An MCP server finishes authorizing → The agent resumes and tells the user the server is connected | `source/host/extensions/transcript/box-handoff-resume.ts:resumeAfterMcpAuth` |
| medium | transcript | A Slack/GitHub listener finishes connecting → The agent resumes and confirms the connection to the user | `source/host/extensions/transcript/box-handoff-resume.ts:resumeAfterListenerConnect` |
| medium | transcript | A resume-after-host-update turn fails → Tray 'Agent failed to resume after host update' is shown | `source/host/extensions/transcript/upgrade-recreate-resume.ts:168` |
| medium | transcript | Resolve a box-request card entry → The box-request entry is stamped with the resolution and re-rendered | `source/host/extensions/transcript/box-request-entries.ts:resolveBoxRequestEntry` |
| low | trays | Dismiss a tray with an unknown id → Returns false and the list is unchanged | `source/host/extensions/trays/trays-service.ts:52` |
| low | trays | Clear all trays when the list is already empty → No 'cleared' event is emitted | `source/host/extensions/trays/trays-service.ts:51` |
| low | wallpaper | Tone helper returns an unusable/empty plan → Logs the failure and retries after 60s without repainting | `source/host/extensions/wallpaper/box-wallpaper-commands.ts:resolvePlan` |
| low | teach-recording | Stop recording that belongs to a different agent → Fails with agent_mismatch error | `source/host/extensions/teach-recording/teach-recording-service.ts:164` |
| low | secrets | Apply secrets to a box that has no environment sync → Gives up applying and logs 'this box has no environment sync' | `source/host/extensions/secrets/secrets-service.ts:runApplyLoop` |
| low | secrets | Apply to box fails transiently → Retries with backoff until applied; apply wait may end unconfirmed | `source/host/extensions/secrets/secrets-service.ts:runApplyLoop` |
| low | secrets | Read persisted secrets at startup → Previously saved secrets are re-applied to the box automatically | `source/host/extensions/secrets/secrets-service.ts:applyPersisted` |
| low | notifications | Agent-upserted deltas arrive before the baseline is seeded → They are buffered and flushed once the baseline seeds | `source/host/extensions/notifications/mobile-push-notifier.ts:flushPreSeedDeltas` |
| low | notify-bus | The notify stream connects → All topic handlers fire once for a safety catch-up of missed events | `source/host/extensions/notify-bus/notify-bus-client.ts:handleFrame` |
| low | notify-bus | A notify frame arrives for a topic → That topic's handlers fire, driving background wakes | `source/host/extensions/notify-bus/notify-bus-client.ts:handleFrame` |
| low | notify-bus | The notify stream idles past 35s → A stall watchdog aborts and the client reconnects | `source/host/extensions/notify-bus/notify-bus-client.ts:streamOnce` |
| low | notify-bus | The stream errors → Reconnect is retried with backoff between 1s and 60s | `source/host/extensions/notify-bus/notify-bus-client.ts:runLoop` |
| low | notify-bus | The sand_notify_bus feature gate turns off → The notify client is stopped | `source/host/extensions/notify-bus/extension.ts:applyGate` |
| low | turn-execution | A runner is requested before the executor is bound → Throws UNBOUND_EXECUTION_MESSAGE | `source/host/extensions/turn-execution/turn-execution-service.ts:require` |
| low | turn-execution | A second executor is bound → Throws DOUBLE_BIND_MESSAGE | `source/host/extensions/turn-execution/turn-execution-service.ts:bindExecutor` |
| low | turn-execution | isRunReady while no executor is bound → Returns false (sends cannot execute) | `source/host/extensions/turn-execution/turn-execution-service.ts:isRunReady` |
| low | auth | getAccessToken with no valid token but a renewal credential present → Triggers an immediate renewal then returns the fresh token | `source/host/extensions/auth/auth-service.ts:getAccessToken` |
| low | auth | Inference credential nears expiry → It is renewed automatically before the leeway window | `source/host/extensions/auth/credential-renewer.ts:cycle` |
| low | auth | Credential renewal fails → Backs off and retries, logging the failure streak (redacted) | `source/host/extensions/auth/credential-renewer.ts:cycle` |
| low | auth | A credential renewal succeeds → The user's full name is refreshed from the backend getMe | `source/host/extensions/auth/user-full-name-service.ts:resolve` |
| low | auth | getUserFullName after the signed-in principal changed → Returns undefined until re-resolved for the new principal | `source/host/extensions/auth/user-full-name-service.ts:getUserFullName` |
| low | attachments | Ingest a non-absolute source path → Throws 'Attachment path must be absolute' | `source/host/extensions/attachments/attachments-service.ts:189` |
| low | attachments | Fetch a link preview already cached within 24h → Returns the cached metadata without refetching | `source/host/extensions/attachments/attachments-service.ts:readCachedLinkMetadata` |
| low | attachments | Link preview URL is not HTTPS → Throws 'Link previews require HTTPS.' | `source/host/extensions/attachments/safe-link-preview-fetch.ts:29` |
| low | attachments | Link preview follows more than 5 redirects → Throws 'Too many redirects while fetching link preview.' | `source/host/extensions/attachments/safe-link-preview-fetch.ts:97` |
| low | attachments | Stage attachments that are videos or exceed 50MB → They are skipped and not staged into the box | `source/host/extensions/attachments/box-staging.ts:22` |
| low | attachments | Generated-image resource write targets a path outside the media store → Refused with an error result | `source/host/extensions/attachments/generate-image-resource-accessor.ts:write` |
| low | content-search | Search with an empty/whitespace query → Returns an empty result list (input edge, distinct from no-matches state) | `source/host/extensions/transcript/roster-search.ts:19` |
| low | content-search | The sand_global_search gate turns off → Indexing stops and mutation subscription is removed | `source/host/extensions/content-search/extension.ts:applyGate` |
| low | content-search | A transcript entry is added/updated/deleted → The search index is updated incrementally in the background | `source/host/extensions/content-search/extension.ts:subscribe` |
| low | content-search | The search index becomes corrupt → It rebuilds up to 3 times, then marks search unavailable | `source/host/extensions/content-search/search-index-service.ts:scheduleRebuild` |
| low | content-search | The search index worker crashes → It respawns up to 3 times, then marks search unavailable | `source/host/extensions/content-search/search-index-service.ts:dispatchJob` |
| low | content-search | SQLite fts5 module is missing → Index file is recreated or search is marked unavailable | `source/host/extensions/content-search/search-index-service.ts:openAndMigrate` |
| low | memory | Memory dreaming gate is off → Synthesis is skipped and reported as skipped_gate | `source/host/extensions/memory/extension.ts:11` |
| low | memory | Synthesis proposes changes → Changes are verified then committed to memory (or rejected as invalid) | `source/host/extensions/memory/memory-synthesis-service.ts:runAgent` |
| low | memory | Temporal memory review becomes due (24h) → Memory is re-synthesized to age dated facts | `source/host/extensions/memory/memory-synthesis-service.ts:queueTemporalTargets` |
| low | inference | Codex access token returns 401 during a request → Credentials are refreshed once and the request retried | `source/host/extensions/inference/provider-session.ts:codexAuthenticatedFetch` |
| low | inference | SAND_AGENT_MOCK_RESPONSE env is set → A scripted mock session drives tool calls instead of real inference | `source/host/extensions/inference/cursor-session.ts:createSession` |
| low | inference | A model experiment is applied on hydrated user id → onModelExperimentApplied listeners fire | `source/host/extensions/inference/extension.ts:onModelExperimentApplied` |
| low | session | Switch to the already-active agent → Returns the current transcript with no reload | `source/host/extensions/transcript/session-runtime.ts:199` |
| low | session | Stored conversation exceeds the soft limit → Background garbage collection is scheduled (min 30-min interval) | `source/host/extensions/session/conversation-size-limits.ts:scheduleConversationSizeMaintenance` |
| low | session | Store a connector credential for an unsafe agent/platform id or empty field → Returns false; nothing is written | `source/host/extensions/session/connector-secret-store.ts:setSecret` |
| low | session | Box handoff is started while one is already pending → Returns already-pending with the live request id/instruction | `source/host/extensions/session/box-handoff-service.ts:24` |
| low | session | An agent's store db is corrupt on write with no other live handles → It recovers in place and retries the write | `source/host/extensions/session/agent-db.ts:recoverInPlace` |
| low | session | An agent's store db write hits a locked (busy) db → The write is dropped and onBusyError is reported (send may be non-durable) | `source/host/extensions/session/agent-db.ts:runWrite` |
| low | transcript | A send echo persists non-durably on a locked db → The echo still ships and the send proceeds, with a warning logged | `source/host/extensions/transcript/send-pipeline.ts:320` |
| low | transcript | Respond to a widget with an empty value → Not accepted (accepted:false) | `source/host/extensions/transcript/widget-responses.ts:71` |
| low | transcript | Respond to a dismissOnMoveOn widget after the user already moved on → Not accepted (the widget is treated as passed) | `source/host/extensions/transcript/widget-responses.ts:recordWidgetResponse` |
| low | transcript | Dismiss a widget that is already responded/dismissed or not a widget → Not accepted (accepted:false) | `source/host/extensions/transcript/widget-responses.ts:329` |
| low | transcript | Set members on a shared-room-backed group → No change; returns the current stamped summary | `source/host/extensions/transcript/group-chat-glue.ts:163` |
| low | transcript | A turn ends without any SendMessage delivery → Up to 3 hidden reply-nudge turns run to get the agent to deliver | `source/host/extensions/transcript/turn-runtime.ts:ensureUserReply` |
| low | transcript | A turn ends on silent tool calls after only an opening ack → A hidden closing-send nudge runs to deliver the result | `source/host/extensions/transcript/turn-runtime.ts:ensureUserReply` |
| low | transcript | A newer send supersedes an in-flight turn (recoverable) → The stale turn is cancelled (outcome superseded) with no error surfaced | `source/host/extensions/transcript/turn-runtime.ts:runTurn` |
| low | transcript | A tool call goes pending then fails during a turn → An outline tool-call item shows the status and a tool-call error diagnostic is reported once | `source/host/extensions/transcript/turn-runtime.ts:handleAgentUpdate` |
| low | transcript | The agent is composing a SendMessage → The isComposingMessage badge shows while the send tool call is pending | `source/host/extensions/transcript/run-lifecycle.ts:trackComposingFromUpdate` |
| low | transcript | The runner reports 'retrying' → The isRetrying badge shows until output resumes | `source/host/extensions/transcript/run-lifecycle.ts:trackRetryingFromUpdate` |
| low | transcript | An agent messages itself → Returns "An agent can't message itself." | `source/host/extensions/transcript/agent-to-agent-messaging.ts:61` |
| low | transcript | An agent messages a nonexistent agent → Returns 'That agent no longer exists.' / 'No agent found with id …' | `source/host/extensions/transcript/agent-to-agent-messaging.ts:62` |
| low | transcript | An agent posts to a group it is not a member of → Returns "You can only post to a group you're a member of." | `source/host/extensions/transcript/shared-rooms.ts:73` |
| low | transcript | An auto-review-status / local-tool-permission-status update arrives → The matching approval/ask card's status is settled in the transcript | `source/host/extensions/transcript/turn-runtime.ts:settleNestedStatus` |
| low | transcript | A new box-request card is appended while a prior one is still open → The prior box request is auto-resolved as 'dismissed' | `source/host/extensions/transcript/box-request-entries.ts:trackBoxRequestEntry` |

## Host 서브시스템 · 봇/자동화/그룹/워크플로/커넥터/저장소/박스/클라우드/격리/포트 + gateway 123  (누락 157건, 추출 267 / 매칭 110)
- 표면 판정: 게이트웨이 커맨드 표면은 사실상 완비(92/98 매칭)되어 있으나, host 내부 경계/오류/격리/전사-미러/클라우드에이전트 도구 계열은 거의 미등재 — 전체 267개 중 110개(약 41%)만 원장에 대응. 사용자 체감 기능은 90%+ 커버되나 내부 견고성/경계 로직은 대부분 공백.

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | cloud-agents/tool | CloudAgent launch를 prompt/repo_url과 함께 호출한다 → 클라우드 에이전트가 시작되고 URL과 PR 안내가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:runCloudAgentAction` |
| medium | gateway | getAgentThread 커맨드로 스레드를 요청한다 → 해당 에이전트의 스레드가 반환된다 | `source/host/gateway-protocol.ts:SAND_GATEWAY_COMMANDS.getAgentThread` |
| medium | gateway | 요청 호스트명이 127.0.0.1/localhost/::1인지 검사한다 → 루프백 호스트만 허용되어 외부 접속은 거부된다 | `source/host/gateway-protocol.ts:isLoopbackHost` |
| medium | agents/messaging | 에이전트 메시지 텍스트가 8000자를 넘긴다 → clampAgentMessage가 텍스트를 8000자로 자른다 | `source/host/agents/agent-messaging.ts:clampAgentMessage` |
| medium | agents/avatar | 아바타 파일이 5MB를 초과한다 → readValidatedAvatar가 null을 반환해 아바타로 채택되지 않는다 | `source/host/agents/agent-avatar.ts:AVATAR_MAX_BYTES` |
| medium | agents/avatar | 아바타 후보 경로가 에이전트 디렉터리 밖을 가리킨다 → resolveAvatarPathWithinDir가 null을 반환해 경로가 거부된다 | `source/host/agents/agent-avatar.ts:resolveAvatarPathWithinDir` |
| medium | agents/clone | 원본 store.db가 없는데 에이전트를 복제한다 → SandAgentCloneError가 발생하고 대상 디렉터리가 정리된다 | `source/host/agents/agent-clone.ts:cloneAgentDir` |
| medium | automations/store | 루틴 생성 시 에이전트당 50개(AUTOMATION_MAX_PER_AGENT)에 도달했다 → upsert가 null을 반환해 루틴이 생성되지 않는다 | `source/host/automations/automation-store.ts:FileAutomationStore.upsert` |
| medium | automations/store | 이름/프롬프트/트리거가 비거나 무효한 루틴을 만든다 → upsert/update가 null을 반환해 저장이 거부된다 | `source/host/automations/automation-store.ts:FileAutomationStore.upsert` |
| medium | automations/trigger | 슬랙 트리거를 reaction 매치 + emoji 필터 + bySelf로 저장한다 → 본인 특정 이모지 반응에만 발화하는 리스너가 만들어진다 | `source/host/automations/automation-trigger.ts:parseSlack` |
| medium | automations/trigger | github 트리거에 ci-passed/ci-failed가 있는데 ciBranch가 없다 → CI 이벤트가 제거되고 남은 이벤트가 없으면 트리거 파싱이 null로 실패한다 | `source/host/automations/automation-trigger.ts:parseGithub` |
| medium | automations/trigger | github repo가 owner/name 형식이 아니다 → isValidGithubRepo 실패로 트리거 저장이 거부된다 | `source/host/automations/automation-trigger.ts:parseGithub` |
| medium | automations/listener-integrations | 슬랙 채널 리스너가 있는데 봇이 채널에 없다 → '@Cursor를 채널에 초대하라'는 스코프 이슈 안내가 만들어진다 | `source/host/automations/listener-integrations.ts:describeScopeIssues` |
| medium | groups/chat | 그룹에 그룹을 멤버로 넣으려 한다 → SandGroupNestingError로 '그룹은 다른 그룹을 포함할 수 없다'가 발생한다 | `source/host/groups/group-chat.ts:assertMembersAreNotGroups` |
| medium | groups/chat | 그룹 메시지에서 @이름/@everyone/@all로 멤버를 언급한다 → 언급된 멤버만(또는 전체) 응답자로 선정된다 | `source/host/groups/group-chat.ts:resolveResponders` |
| medium | groups/chat | 그룹 멤버 턴에서 추가할 말이 없다 → '(pass)'를 보내 조용히 턴을 넘긴다 | `source/host/groups/group-chat.ts:isPassContent` |
| medium | groups/store | 그룹 멤버가 GROUP_MAX_MEMBERS(6)를 초과하도록 지정한다 → normalizeMemberIds가 6명까지만 유지한다 | `source/host/groups/group-store.ts:normalizeMemberIds` |
| medium | groups/xuser | 공유(크로스유저) 방에서 멤버가 턴을 수행한다 → 'SHARED ROOM' 가드레일(비공개 유출 금지, SendMessage만)이 시스템 프롬프트에 추가된다 | `source/host/groups/xuser.ts:buildSharedRoomGuardrailPrompt` |
| medium | workflows/store | managed/plugin 소스 워크플로를 활성/비활성 토글하려 한다 → setEnabledForAgent가 그대로 반환해 managed/plugin은 토글되지 않는다 | `source/host/workflows/workflow-store.ts:FileWorkflowStore.setEnabledForAgent` |
| medium | workflows/store | 본인이 게시하지 않은 plugin 워크플로를 수정하려 한다 → update가 null을 반환해 수정이 거부된다 | `source/host/workflows/workflow-store.ts:FileWorkflowStore.update` |
| medium | workflows/store | managed/plugin 워크플로를 삭제하려 한다 → remove가 false를 반환해 삭제되지 않는다 | `source/host/workflows/workflow-store.ts:FileWorkflowStore.remove` |
| medium | workflows/library | WORKFLOW_MAX_PER_AGENT 한도에서 워크플로를 생성한다 → create가 null을 반환해 생성이 거부된다 | `source/host/workflows/workflow-library.ts:GlobalWorkflowLibrary.create` |
| medium | cloud-agents/tool | CloudAgent 파괴적 액션을 confirm 없이 호출한다 → '파괴적이니 confirm:true로 다시 호출하라'는 안내가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:runCloudAgentAction` |
| medium | cloud-agents/tool | CloudAgent launch에 필수 필드(prompt/repo_url)가 빠졌다 → requireCloudAgentField가 필수 입력 오류를 던진다 | `source/host/cloud-agents/cloud-agent-tool.ts:requireCloudAgentField` |
| medium | cloud-agents/tool | CloudAgent에 존재하지 않는 model을 넘긴다 → 'Unknown model' 오류와 사용 가능 모델 목록이 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:validateModelSelection` |
| medium | cloud-agents/tool | CloudAgent에 잘못된 model_params를 넘긴다 → 'Invalid model_params' 오류로 허용값 목록이 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:validateModelParams` |
| medium | cloud-agents/tool | CloudAgent dump를 이 세션에서 안 다룬 id로 호출한다 → 'watch 먼저 하라'는 제한 안내가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:runCloudAgentAction` |
| medium | cloud-agents/tool | CloudAgent dump로 전사를 덤프한다 → JSONL 전사가 박스 파일로 쓰이고 경로/바이트/라인 수가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:runCloudAgentAction` |
| medium | cloud-agents/tool | CloudAgent watch로 에이전트를 감시한다 → 완료 시 자동 부활 예고와 함께 감시가 등록된다 | `source/host/cloud-agents/cloud-agent-tool.ts:runCloudAgentAction` |
| medium | cloud-agents/tool | CloudAgent reply를 interrupt:true로 실행 중 런에 보낸다 → 실행을 중단하고 후속을 즉시 전달했다는 메시지가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:runCloudAgentAction` |
| medium | cloud-agents/tool | CloudAgent rename/cancel/archive/unarchive/delete/list_artifacts를 호출한다 → 각 생명주기 동작이 수행되고 상태/결과 메시지가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:runCloudAgentAction` |
| medium | cloud-agents/images | 허용 폴더/워크스페이스 밖 이미지를 첨부한다 → '/workspace로 복사한 뒤 첨부하라'는 refused 안내가 반환된다 | `source/host/cloud-agents/cloud-agent-images.ts:loadCloudAgentImage` |
| medium | local-exec/machine | 경로가 local-exec 루트 밖(심링크 포함)을 가리킨다 → SandLocalExecPathError로 경로가 거부된다 | `source/host/local-exec/local-exec-machine.ts:containPath` |
| medium | local-exec/approvals | 모든 로컬 도구 승인을 지운다 → 승인 파일이 삭제되어 모든 승인이 취소된다 | `source/host/local-exec/local-tool-approvals.ts:clearLocalToolApprovals` |
| medium | box/mcp | 박스가 구형 이미지라 MCP 미지원 응답을 준다 → '설정 → 업데이트에서 컴퓨터를 업데이트하라'는 SandBoxMcpUnsupportedError가 발생한다 | `source/host/box/box-mcp.ts:loadBoxMcpServersViaTransport` |
| medium | box/env | 박스 환경변수 동기화를 요청한다 → updateEnvironmentVariables로 박스에 env가 반영된다(replace 여부 포함) | `source/host/box/box-env.ts:applyBoxEnvironmentViaTransport` |
| medium | box/protected-path | 보호된 host-only 스토어 경로를 읽으려 한다 → SandProtectedPathError로 '보호된 경로라 거부됨'이 발생한다 | `source/host/box/protected-path-guard.ts:assertPathOutsideProtectedRoots` |
| low | gateway | 게이트웨이가 빈 body로 커맨드를 받으면 parseCommandArgs가 {} 로 파싱한다 → 본문 없는 커맨드도 빈 인자 객체로 정상 실행된다 | `source/host/gateway-protocol.ts:parseCommandArgs` |
| low | gateway | body 길이>0이면 JSON.parse로 인자를 파싱한다 → 잘못된 JSON이면 파싱 예외가 발생한다 | `source/host/gateway-protocol.ts:parseCommandArgs` |
| low | gateway | 슬림 게이트웨이 listAgents는 인라인 아바타를 null로 제거한다 → 요약 행 avatarDataUrl이 제거되어 전송량이 줄어든다 | `source/host/gateway-protocol.ts:SAND_GATEWAY_SLIM_COMMANDS.listAgents` |
| low | gateway | agents 이벤트의 인라인 아바타를 stripInlineAvatarsFromEvent가 제거한다 → 에이전트 목록/업서트 이벤트에서 큰 아바타가 제거되어 전달된다 | `source/host/gateway-protocol.ts:stripInlineAvatarsFromEvent` |
| low | agents/messaging | 디렉터리 프롬프트에 팀원이 40명을 초과한다 → 처음 40명만 나열되고 '…and more' 안내가 붙는다 | `source/host/agents/agent-messaging.ts:AGENT_DIRECTORY_PROMPT_LIMIT` |
| low | agents/messaging | 다른 에이전트가 없는 상태로 디렉터리 프롬프트를 만든다 → 'no other agents yet' 안내와 CreateAgent 제안이 포함된다 | `source/host/agents/agent-messaging.ts:renderAgentDirectorySystemPrompt` |
| low | agents/messaging | 인바운드 웨이크에 이미지 첨부가 함께 온다 → 첨부 이미지 개수와 url/alt 목록이 프롬프트에 추가된다 | `source/host/agents/agent-messaging.ts:buildAgentInboundWakePrompt` |
| low | agents/messaging | 메시지에서 다른 에이전트를 언급한다 → 언급된 에이전트 목록이 컨텍스트 블록으로 붙는다(없으면 null) | `source/host/agents/agent-messaging.ts:buildMentionedAgentsContext` |
| low | agents/avatar | 아바타 바이트 시그니처로 MIME을 판별한다 → sniffAvatarMimeType이 올바른 MIME을 반환하고 미인식 시 null | `source/host/agents/agent-avatar.ts:sniffAvatarMimeType` |
| low | agents/avatar | 같은 파일 아바타를 다시 요청한다(mtime/size 동일) → 캐시된 data URL/버전이 반환된다(LRU 128 초과 시 축출) | `source/host/agents/agent-avatar.ts:readAvatarWithinDir` |
| low | agents/avatar | 디렉터리에 관례적 아바타 파일명이 여러 개 있다 → conventionalAvatarRank 순으로 정렬되어 우선순위 높은 파일이 선택된다 | `source/host/agents/agent-avatar.ts:listConventionalAvatarFilenames` |
| low | agents/clone | 이름이 빈 에이전트를 복제한다 → 복제 이름이 'copy'로 설정된다 | `source/host/agents/agent-clone.ts:cloneAgentDisplayName` |
| low | agents/clone | 복제 도중 예외가 발생한다 → 대상 디렉터리가 rmSync로 정리되고 예외가 재던져진다 | `source/host/agents/agent-clone.ts:cloneAgentDir` |
| low | agents/profile | 프로필 JSON이 손상되었거나 객체가 아니다 → readSandProfileFile이 null을 반환하고 기본값으로 처리된다 | `source/host/agents/agent-profile.ts:readSandProfileFile` |
| low | agents/profile | 프로필을 저장한다 → 임시 파일 후 rename하는 원자적 쓰기로 profile.json이 갱신된다 | `source/host/agents/agent-profile.ts:writeSandProfileFile` |
| low | agents/settings | 에이전트 설정을 읽는다 → notifyOnAgentUpdates 기본 true, hiddenFromSidebar 기본 false로 채워진다 | `source/host/agents/settings-file.ts:readSandSettingsFile` |
| low | agents/workflow-enablement | 이미 같은 상태인 워크플로에 같은 상태를 다시 설정한다 → 변경 없음으로 조기 반환되어 파일을 다시 쓰지 않는다 | `source/host/agents/agent-workflow-enablement.ts:AgentWorkflowEnablement.setEnabled` |
| low | automations/store | 같은 이름 루틴으로 id가 충돌한다 → uniqueId가 -2..-999 접미사/타임스탬프로 고유 폴더 id를 만든다 | `source/host/automations/automation-store.ts:FileAutomationStore.uniqueId` |
| low | automations/store | 루틴 목록을 조회한다 → nextRunAt 오름차순(그다음 createdAt)으로 정렬되어 반환된다 | `source/host/automations/automation-store.ts:FileAutomationStore.list` |
| low | automations/store | 안전하지 않은 폴더 id로 루틴을 조회·삭제한다 → isSafeFolderId 실패로 null/false가 반환되어 거부된다 | `source/host/automations/automation-store.ts:FileAutomationStore.get` |
| low | automations/store | 에이전트 자동화 정의를 점검한다 → agent_missing/dir_missing/valid/configs_invalid/dir_empty 상태와 유효 개수가 반환된다 | `source/host/automations/automation-store.ts:inspectAgentAutomationDefinitions` |
| low | automations/store | 저장 config에 잘못된 run 항목이 섞여 있다 → parseStoredRun이 무효 항목을 걸러내고 유효한 것만 startedAt 내림차순 반환한다 | `source/host/automations/automation-store.ts:FileAutomationStore.readRuns` |
| low | automations/prompt | 스케줄 루틴이 예정 시각에 도래한다 → [automation]/AUTOMATION_WAKE_CUE 웨이크 프롬프트가 저장 프롬프트와 함께 주입된다 | `source/host/automations/automation.ts:buildAutomationWakePrompt` |
| low | automations/prompt | 이벤트 리스너가 매칭 이벤트로 루틴을 깨운다 → 이벤트 소스별 컨텍스트 블록과 '외부 데이터' 경고가 포함된 웨이크 프롬프트가 생성된다 | `source/host/automations/automation.ts:buildAutomationWakePrompt` |
| low | automations/prompt | 웨이크 이벤트가 25개(MAX_EVENTS_IN_AUTOMATION_WAKE)를 초과한다 → clampWakeEvents가 처음 25개만 남긴다 | `source/host/automations/automation.ts:clampWakeEvents` |
| low | automations/prompt | 루틴 이름이 80자(AUTOMATION_MAX_NAME_LENGTH)를 넘긴다 → clampAutomationName이 80자로 잘라 저장한다 | `source/host/automations/automation.ts:clampAutomationName` |
| low | automations/prompt | 루틴 상태 리마인더를 렌더한다 → 루틴 없으면 null, 있으면 각 루틴 next run/last run 상태 스냅샷이 생성된다 | `source/host/automations/automation.ts:renderAutomationRuntimeStatusReminder` |
| low | automations/status-reminder | 자동화 스토어 위치가 없다 → 상태 리마인더 provider가 null을 반환한다 | `source/host/automations/automation-status-reminder.ts:createAutomationStatusReminderProvider` |
| low | automations/trigger | 트리거 그룹 리스너가 TRIGGER_MAX_GROUP_LISTENERS를 초과한다 → parseMembers가 한도까지만 담고 나머지는 버린다 | `source/host/automations/automation-trigger.ts:parseMembers` |
| low | automations/trigger | 슬랙 이벤트로 리스너 매칭을 검사한다 → 채널/멘션/키워드/반응 규칙에 맞으면 매칭 true | `source/host/automations/automation-trigger.ts:slackListenerMatches` |
| low | automations/trigger | github userAllowlist가 이벤트 주체와 매칭되는지 검사한다 → 허용목록에 없는 사용자의 이벤트는 발화하지 않는다 | `source/host/automations/automation-trigger.ts:githubListenerMatches` |
| low | automations/trigger | 트리거 이벤트를 사람이 읽을 문장으로 요약한다 → 소스별 사람 친화적 설명 문자열이 만들어진다 | `source/host/automations/automation-trigger.ts:describeTriggerEvent` |
| low | automations/notices | userAllowlist 없는 github 리스너가 특정 날짜 이전에 만들어졌다 → github-listener-scope 공지가 한 번 웨이크 프롬프트에 붙는다 | `source/host/automations/routine-notices.ts:routineNoticeWakeLines` |
| low | automations/listener-integrations | 활성 자동화의 리스너 플랫폼 수를 센다 → github/slack 플랫폼별 활성 리스너 개수가 반환된다 | `source/host/automations/listener-integrations.ts:countListenerPlatforms` |
| low | groups/chat | 멤버 턴이 중단되었다가 재전달된다 → 재전달 안내(previous attempt interrupted)가 붙은 프롬프트가 생성된다 | `source/host/groups/group-chat.ts:buildGroupRedriveNote` |
| low | groups/chat | 그룹 히스토리가 GROUP_PROMPT_HISTORY_LIMIT(24)를 넘긴다 → 최근 24개만 프롬프트에 포함된다 | `source/host/groups/group-chat.ts:formatGroupHistory` |
| low | groups/store | group.json에 멤버/원격멤버/공유방이 모두 비어 있다 → readSandGroupConfig가 null을 반환해 그룹이 아닌 것으로 처리된다 | `source/host/groups/group-store.ts:readSandGroupConfig` |
| low | groups/remote-room | remote-room.json에 roomId/hostAuthId가 없다 → readSandRemoteRoomConfig가 null을 반환한다 | `source/host/groups/remote-room-store.ts:readSandRemoteRoomConfig` |
| low | groups/remote-room | 원격 방 멤버가 24명을 초과한다 → normalizeRemoteRoomMembers가 24명까지만 유지한다 | `source/host/groups/remote-room-store.ts:normalizeRemoteRoomMembers` |
| low | groups/xuser | 원격 턴 메시지가 24개/8000자를 넘긴다 → 메시지 24개·텍스트 8000자로 클램프되어 전달된다 | `source/host/groups/xuser.ts:toXuserTurnMessages` |
| low | groups/xuser | 공유방 게스트 이름이 비어 있다 → clampGuestName이 'Someone'으로 대체한다 | `source/host/groups/xuser.ts:clampGuestName` |
| low | workflows/store | 이름이 빈 워크플로를 생성한다 → create가 null을 반환해 생성이 거부된다 | `source/host/workflows/workflow-store.ts:FileWorkflowStore.create` |
| low | workflows/store | trigger가 있는 스펙으로 워크플로를 만든다 → cron 자동화로 전환되어 automation으로 저장된다 | `source/host/workflows/workflow-store.ts:FileWorkflowStore.createAutomation` |
| low | workflows/store | 레거시 per-agent workflows 디렉터리가 있는 채로 스토어를 연다 → 레거시 워크플로가 전역 라이브러리로 마이그레이션·활성화된다 | `source/host/workflows/workflow-store.ts:FileWorkflowStore.migrateLegacyPerAgentWorkflows` |
| low | workflows/library | 레거시 recipe.md 파일명 워크플로가 있다 → renameLegacyRecipeFiles가 WORKFLOW_FILENAME으로 리네임한다 | `source/host/workflows/workflow-library.ts:GlobalWorkflowLibrary.renameLegacyRecipeFiles` |
| low | workflows/parse-cache | stat이 안 바뀐 채 워크플로 레코드를 다시 읽는다 → StatKeyedParseCache가 캐시 값을 반환해 재파싱을 건너뛴다 | `source/host/workflows/stat-keyed-parse-cache.ts:StatKeyedParseCache.read` |
| low | workflows/parse-cache | 파일이 방금(2초 이내) 수정되었다 → mtime 틱 은닉 위험으로 캐시하지 않고 매번 파싱한다 | `source/host/workflows/stat-keyed-parse-cache.ts:mtimeTickCouldStillHideAnEdit` |
| low | connectors/attachment | 채널 첨부로 http/https URL을 전달한다 → transport 'url'로 해석되고 이미지 여부가 판별된다 | `source/host/connectors/channel-attachment.ts:resolveChannelAttachment` |
| low | connectors/attachment | 채널 첨부로 file:// 로컬 파일을 전달한다 → 파일을 읽어 transport 'upload'로 MIME과 함께 해석된다 | `source/host/connectors/channel-attachment.ts:resolveChannelAttachment` |
| low | connectors/attachment | 채널 첨부가 0바이트이거나 50MB를 넘긴다 → null이 반환되어 첨부가 거부된다 | `source/host/connectors/channel-attachment.ts:CHANNEL_ATTACHMENT_MAX_UPLOAD_BYTES` |
| low | connectors/attachment | 이미지가 아닌 로컬 파일을 채널 첨부로 보낸다 → videoMime 또는 application/octet-stream 업로드 첨부가 만들어진다 | `source/host/connectors/channel-attachment.ts:resolveChannelAttachment` |
| low | cloud-agents/tool | CloudAgent 액션 실행 전 신호가 취소된다 → CANCELLED_BEFORE_CLOUD_AGENT_CALL 메시지가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:CANCELLED_BEFORE_CLOUD_AGENT_CALL` |
| low | cloud-agents/tool | CloudAgent list를 scope 'launched'로 호출했는데 없다 → 'scope:all 을 쓰라'는 안내가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:runCloudAgentAction` |
| low | cloud-agents/tool | 백엔드가 detail과 함께 요청을 거부한다 → backendRejectionMessage로 사용자 친화적 거부 사유가 반환된다 | `source/host/cloud-agents/cloud-agent-tool.ts:backendRejectionMessage` |
| low | cloud-agents/images | 클라우드 에이전트에 file:// 이 아닌 URL을 이미지로 첨부한다 → 'file:// url이 아니다'라는 안내로 거부된다 | `source/host/cloud-agents/cloud-agent-images.ts:loadCloudAgentImages` |
| low | cloud-agents/images | 이미지가 아닌 파일을 클라우드 에이전트 이미지로 첨부한다 → '인식되는 이미지가 아니다'라는 안내로 거부된다 | `source/host/cloud-agents/cloud-agent-images.ts:loadCloudAgentImages` |
| low | cloud-agents/images | 첨부 이미지가 ATTACHMENT_BYTE_LIMIT를 초과한다 → too-large 안내가 반환된다 | `source/host/cloud-agents/cloud-agent-images.ts:loadCloudAgentImage` |
| low | local-exec/provider | local-exec 업로드 파일이 maxFileBytes를 초과한다 → file-error가 반환되어 업로드가 거부된다 | `source/host/local-exec/local-exec-provider.ts:SandLocalExecProvider.handleUpload` |
| low | local-exec/provider | local-exec 다운로드 대상이 maxFileBytes를 초과한다 → file-error가 반환되어 다운로드가 거부된다 | `source/host/local-exec/local-exec-provider.ts:SandLocalExecProvider.handleDownload` |
| low | local-exec/provider | SSE 요청 스트림이 35s 동안 정지한다 → stall 워치독이 연결을 중단하고 백오프 후 재연결한다 | `source/host/local-exec/local-exec-provider.ts:SandLocalExecProvider.streamRequests` |
| low | local-exec/provider | 응답 POST가 3회 실패한다 → 해당 프레임 배치를 드롭하고 경고 로그를 남긴다 | `source/host/local-exec/local-exec-provider.ts:SandLocalExecProvider.postBatch` |
| low | local-exec/provider | 연결이 3회 연속 실패(STALE)한다 → onConnectionStale로 백엔드에서 새 연결을 재해결한다 | `source/host/local-exec/local-exec-provider.ts:SandLocalExecProvider.runLoop` |
| low | local-exec/provider | exec 요청이 cancel 프레임을 받는다 → executor.cancel과 controller.abort로 실행이 중단된다 | `source/host/local-exec/local-exec-provider.ts:SandLocalExecProvider.handleCancel` |
| low | local-exec/machine | 요청한 작업 디렉터리가 이 머신에 없다 → 루트로 대체 실행되고 'working directory does not exist' 안내가 출력된다 | `source/host/local-exec/local-exec-machine.ts:resolveShellWorkingDirectory` |
| low | local-exec/approvals | 로컬 도구 승인을 은퇴(retire)시킨다 → retirements에 추가되어 readLiveLocalToolApprovals에서 제외된다 | `source/host/local-exec/local-tool-approvals.ts:retireLocalToolApproval` |
| low | local-exec/daemon | local-exec 데몬이 게이트웨이 연결을 아직 못 받았다 → NO_LOCAL_EXEC_CONNECTION_MESSAGE로 연결 대기 상태가 알려진다 | `source/host/local-exec/local-exec-daemon.ts:NO_LOCAL_EXEC_CONNECTION_MESSAGE` |
| low | local-exec/daemon | 슈퍼바이저 하트비트가 감독 윈도우 안에 있다 → isSupervised가 true를 반환해 감독 상태로 보고된다 | `source/host/local-exec/local-exec-daemon.ts:runLocalExecDaemon` |
| low | local-exec/sentry | SAND_SENTRY_ENVIRONMENT/RELEASE가 설정되어 있다 → local-exec 데몬 Sentry가 초기화되고 치명 오류를 캡처한다 | `source/host/local-exec/sentry.ts:initSandSentryDaemon` |
| low | mcp-auth | MCP 인증 결과가 'cancelled'로 온다 → 재개하지 않고 조용히 반환한다 | `source/host/mcp-auth/host-mcp-auth-completion.ts:HostMcpAuthCompletion.resolve` |
| low | mcp-auth | connect 카드 등록 뒤 TTL(1시간)이 지난다 → prune가 만료된 대기 항목을 제거한다 | `source/host/mcp-auth/mcp-auth-wait-registry.ts:McpAuthWaitRegistry.prune` |
| low | box/capabilities | 박스가 environment sync/MCP를 지원하지 않는다 → BoxEnvironmentSyncUnsupportedError/BoxMcpUnsupportedError가 발생한다 | `source/host/box/box-capabilities.ts:boxApplyEnvironment` |
| low | box/monitor-layout | 컴퓨터 사용 좌표 안내를 생성한다 → 'Display is 1280×800' 좌표 경계 안내 문장이 만들어진다 | `source/host/box/box-monitor-layout.ts:displaySpaceSentence` |
| low | box/loopback | exec-daemon이 준비 타임아웃(90s) 안에 응답하지 않는다 → SandBoxDaemonUnreachableError가 발생하고 준비 상태 텔레메트리가 보고된다 | `source/host/box/loopback-sand-box.ts:LoopbackSandBox.waitUntilReadyUncoordinated` |
| low | box/loopback | 데몬 워치독 폴이 실패했다 다시 ok가 된다 → ready_after_retry 텔레메트리가 보고되고 상태가 ready로 복구된다 | `source/host/box/loopback-sand-box.ts:LoopbackSandBox.pollDaemonWatchdog` |
| low | box/loopback | 에이전트가 자기 윈도우(fork)를 확보한다 → start-window로 별도 디스플레이가 열리고 VNC URL이 발급된다 | `source/host/box/loopback-sand-box.ts:LoopbackSandBox.ensureWindow` |
| low | box/loopback | 없는 박스 파일을 다운로드한다 → BoxFileUnreadableError(file missing)가 발생한다 | `source/host/box/loopback-sand-box.ts:LoopbackSandBox.downloadFile` |
| low | box/windows | start-window가 다른 에이전트 소유 라이브 fork 디스플레이를 요구받는다 → exit code 75로 SandBoxNoMonitorAvailableError가 발생한다 | `source/host/box/box-windows.ts:runWindowScript` |
| low | box/windows | 윈도우 소유자 토큰이 형식에 맞지 않는다 → SandBoxWindowError로 실행이 거부된다 | `source/host/box/box-windows.ts:runWindowScript` |
| low | box/shared-desktop | 공유 데스크톱에서 모든 모니터가 사용 중이다 → SAND_BOX_NO_MONITOR_AVAILABLE_MESSAGE로 '빈 화면이 없다' 안내가 나온다 | `source/host/box/shared-desktop-sand-box.ts:SharedDesktopSandBox.ensureReady` |
| low | box/shared-desktop | 윈도우 배정 파일이 손상되었다 → parseAssignments가 isCorrupt로 표시하고 재시도/무시로 복구한다 | `source/host/box/shared-desktop-sand-box.ts:parseAssignments` |
| low | box/shared-desktop | 에이전트 윈도우를 해제(releaseWindow)한다 → fork 윈도우가 stop-window로 정리되고 배정이 갱신·영속화된다 | `source/host/box/shared-desktop-sand-box.ts:SharedDesktopSandBox.releaseWindow` |
| low | box/store-policy | SAND_BOX_STORE_LOCAL_DIR가 절대경로로 설정되어 있다 → 백엔드가 local-fs로 결정된다(아니면 v2/agent-store) | `source/host/box/box-store-backend-policy.ts:resolveBackendKind` |
| low | box/transfer | 박스 간 파일 전송에서 원본 파일이 없다 → BoxTransferError 'source file not found'가 발생한다 | `source/host/box/box-transfer.ts:transferFileBetweenBoxes` |
| low | box/transfer | 전송 파일이 256MB 한도를 넘긴다 → BoxTransferError 'file is too large to transfer'가 발생한다 | `source/host/box/box-transfer.ts:transferFileBetweenBoxes` |
| low | box/file-transfer | exec-daemon으로 박스에 파일을 업로드한다 → .part 임시 파일 후 mv로 원자적 설치되고 실패 시 .part가 정리된다 | `source/host/box/box-file-transfer.ts:uploadFileViaExecDaemon` |
| low | box/exec-daemon-process | exec-daemon 포트가 이미 점유된 채 시작을 시도한다 → 'refusing contaminated startup' 오류로 시작이 거부된다 | `source/host/box/exec-daemon-process.ts:startBoxExecDaemonProcess` |
| low | box/exec-daemon-process | exec-daemon 종료 시 SIGTERM 후 5s 타임아웃을 넘긴다 → SIGKILL로 강제 종료하고 '강제 종료 필요' 오류를 던진다 | `source/host/box/exec-daemon-process.ts:startBoxExecDaemonProcess` |
| low | box/remote-accessor | 박스 ping을 분류한다 → outcome이 ok/timeout/refused/crash로 분류되어 반환된다 | `source/host/box/box-remote-accessor.ts:classifyPingFailure` |
| low | ports/user-computer | 단일 사용자 컴퓨터에 요청 id 불일치/연결 끊김이 있다 → resolve가 undefined를 반환해 컴퓨터를 해석할 수 없다 | `source/host/ports/user-computer.ts:createSingleUserComputer` |
| low | ports/box | 모니터 없는 환경에서 컴퓨터 사용 실행을 시도한다 → noMonitorComputerUseExecutor가 SandBoxNoMonitorAvailableError를 던진다 | `source/host/ports/box.ts:noMonitorComputerUseExecutor` |
| low | ports/transport | send-message 업데이트를 전송한다 → lastSentMessageId가 갱신되어 조회 가능해진다 | `source/host/ports/transport.ts:createSandTransport` |
| low | ports/mcp-state | MCP 상태 실행기가 도구 목록을 조회한다 → provider별로 그룹화된 서버/도구 상태(connected)가 반환된다 | `source/host/ports/mcp-state-executor.ts:createSandMcpStateExecutor` |
| low | ports/analytics | 메시지 길이로 버킷을 계산한다 → empty/xs/s/m/l/xl 버킷이 산출된다 | `source/host/ports/sand-analytics-types.ts:sandMessageLengthBucket` |
| low | storage/agent-paths | 안전하지 않은 에이전트 id로 디렉터리를 해석한다 → SandInvalidAgentIdError로 잘못된 id가 거부된다 | `source/host/storage/agent-paths.ts:resolveSandAgentDir` |
| low | storage/folder-id | 슬래시/백슬래시/널/./.. 포함 폴더 id를 검사한다 → isSafeFolderId가 false를 반환해 경로 탈출을 막는다 | `source/host/storage/folder-id.ts:isSafeFolderId` |
| low | storage/sqlite | SQLite 작업이 database is locked(BUSY)로 실패한다 → retrySqliteBusy가 지수 백오프로 최대 5회 재시도한다 | `source/host/storage/sqlite-busy.ts:retrySqliteBusy` |
| low | storage/store-db | 에이전트 DB를 체크포인트한다 → WAL이 TRUNCATE 체크포인트되어 완전히 접혔는지 여부가 반환된다 | `source/host/storage/store-db.ts:checkpointSandAgentDb` |
| low | storage/sqlite-recovery | 손상된 SQLite DB를 격리한다 → 타임스탬프 .corrupt 파일로 격리되고 사이드카가 함께 처리된다 | `source/host/storage/sqlite-recovery.ts:quarantineCorruptSqliteDb` |
| low | agent-isolation/blob-db | conversation-blobs.db가 열 때 손상으로 판정된다 → 복구가 실행되어 살릴 수 있는 blob을 옮긴 새 DB로 재구축된다 | `source/host/agent-isolation/conversation-blob-db.ts:openConversationBlobDb` |
| low | agent-isolation/blob-db | 이전 복구가 중단되어 pending 마커가 남아 있다 → findPendingRecovery가 발견해 복구를 이어서 마무리한다 | `source/host/agent-isolation/conversation-blob-db.ts:openConversationBlobDb` |
| low | agent-isolation/blob-store | 레거시 blob DB가 있고 마이그레이션이 unstarted다 → 레거시 blob이 ATTACH로 흡수되고 adoption-complete로 표시된다 | `source/host/agent-isolation/conversation-blob-store.ts:adoptLegacyBlobs` |
| low | agent-isolation/blob-store | root blob 없이 대화 가비지 수집을 실행한다 → outcome 'skipped', reason 'no-root'로 건너뛰어진다 | `source/host/agent-isolation/conversation-blob-store.ts:collectGarbage` |
| low | agent-isolation/blob-store | 가비지 수집에서 미해결 proto 참조가 있다 → outcome 'skipped', reason 'unresolved-refs'로 삭제를 보류한다 | `source/host/agent-isolation/conversation-blob-store.ts:collectGarbage` |
| low | agent-isolation/blob-store | 가비지 수집 삭제 바이트가 임계(64MB 또는 1/8)를 넘긴다 → VACUUM이 실행되어 DB가 압축된다 | `source/host/agent-isolation/conversation-blob-store.ts:collectGarbage` |
| low | agent-isolation/worker-pool | blob 워커가 최대(64)에 도달한 채 새 워커가 필요하다 → evictForCapacity가 가장 오래 쉰 비활성 워커를 종료해 자리를 만든다 | `source/host/agent-isolation/agent-worker-pool.ts:AgentWorkerPool.evictForCapacity` |
| low | agent-isolation/worker-pool | 워커가 idle 타임아웃(5분)을 넘긴다 → sweepIdle가 유휴 워커를 닫고 0이면 스윕을 멈춘다 | `source/host/agent-isolation/agent-worker-pool.ts:AgentWorkerPool.sweepIdle` |
| low | agent-isolation/worker-pool | blob 워커가 비정상 종료(exit≠0)한다 → die가 모든 대기 요청을 reject하고 연결을 정리한다 | `source/host/agent-isolation/agent-worker-pool.ts:AgentWorkerConnection.die` |
| low | agent-isolation/worker-pool | 워커 로그 라인이 8KB를 초과한다 → forwardStream이 '…[truncated]'로 잘라 전달한다 | `source/host/agent-isolation/agent-worker-pool.ts:forwardStream` |
| low | agent-isolation/store-worker | blob 워커가 DB를 못 열고 부팅 실패한다 → 오류 코드를 로그로 남기고 process.exit(1)로 종료된다 | `source/host/agent-isolation/agent-store-worker.ts:runAgentStoreWorker` |
| low | agent-isolation/legacy-retirement | adoption 미완 상태에서 레거시 blob 은퇴 가능 여부를 검증한다 → isRetirable false, reason 'adoption-incomplete'가 반환된다 | `source/host/agent-isolation/legacy-blob-retirement.ts:verifyLegacyBlobRetirement` |
| low | transcript-mirror/journal | 저널 프리페어 중 캐노니컬 파일이 저널 밖에서 변경되었다 → TranscriptJournalCorruptionError로 체크포인트가 거부된다 | `source/host/transcript-mirror/transcript-mirror.ts:FileTranscriptMirror.prepareCheckpoint` |
| low | transcript-mirror/journal | pending WAL이 있는 채 대화를 복구한다 → 해시가 맞으면 WAL 적용해 커밋, 이전 체크포인트면 제거해 롤백한다 | `source/host/transcript-mirror/transcript-mirror.ts:FileTranscriptMirror.recover` |
| low | transcript-mirror/router | 저널이 소유한 대화를 실험 플래그를 꺼도 다시 라우팅한다 → 한 번 journal이 소유하면 legacy로 되돌아가지 않고 journal로 고정된다 | `source/host/transcript-mirror/transcript-mirror-router.ts:RoutedTranscriptMirror.selectRoute` |
| low | transcript-mirror/legacy | 레거시 전사 전체 쓰기가 기존보다 라인 수가 적다 → 더 짧은 전사로 덮어쓰지 않고 기존 파일을 유지한다 | `source/host/transcript-mirror/legacy-transcript-mirror.ts:LegacyFileTranscriptMirror.writeFull` |
| low | transcript-mirror/legacy | 전사 blob이 5MB 임계를 넘긴다 → '[Oversize transcript blob omitted]' 자리표시자로 대체된다 | `source/host/transcript-mirror/legacy-transcript-mirror.ts:hydrateBlobIds` |
| low | transcript-mirror/deriver | turn 마지막 스텝이 assistant/thinking이고 finalize가 아니다 → deferredStep으로 보류되어 다음 체크포인트까지 미출력된다 | `source/host/transcript-mirror/transcript-occurrence-deriver.ts:ArtifactTranscriptOccurrenceDeriver` |
| low | transcript-mirror/deriver | 확정된 durable 턴/스텝이 체크포인트 후 바뀐다 → TranscriptJournalCorruptionError로 전사 파생이 거부된다 | `source/host/transcript-mirror/transcript-occurrence-deriver.ts:ArtifactTranscriptOccurrenceDeriver.deriveTurn` |
| low | transcript-mirror/offload | 오프로드 풀에서 같은 대화에 새 체크포인트가 쓰기 중 도착한다 → 최신 잡으로 합쳐지고 모든 대기자가 그 결과로 해소된다 | `source/host/agent-isolation/transcript-mirror-offload.ts:TranscriptMirrorOffloadPool.write` |
| low | transcript-mirror/offload | 미러 워커가 사용 불가하거나 쓰기에 실패한다 → transcript_mirror_stale 진단이 보고되지만 턴은 실패하지 않는다 | `source/host/agent-isolation/transcript-mirror-offload.ts:warnStaleMirror` |
| low | transcript-mirror/worker | 미러 워커가 체크포인트 blob을 찾지 못한다 → MissingTranscriptStateError로 에러 응답이 반환된다 | `source/host/agent-isolation/transcript-mirror-worker.ts:runTranscriptMirrorWorker` |

## Coordinator + packages · 게이트웨이 라우팅/OAuth/WebAuthn/local-exec + hooks/mcp/shell-exec/agent-exec/추론  (누락 146건, 추출 169 / 매칭 23)
- 표면 판정: ~14% (23/169): the ledger covers this surface's user-facing chat/router/subagent/MCP-OAuth/WebAuthn-ceremony/computer-use touchpoints, but the whole coordinator↔gateway transport/reachability/reconnect/stall layer, the entire hooks subsystem (zero hook rows in the ledger), and nearly all shell-exec + local-exec executor behaviors (read/ls/grep/shell/background-shell/sandbox/mcp-fs/record-screen) are absent; no overclaims found (the extracted code corroborates every surface-relevant ledger row, and the reverse-engineered source tree isn't in this repo to disprove any).

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | hooks/config | User saves a hooks config with an invalid hook type, matcher regex, timeout, or loop_limit → Validation returns specific error strings identifying the offending field | `source/packages/hooks/validators/hooksConfig.ts:45` |
| high | hooks/claude-import | A Claude Code hooks config is imported → Transformed to Cursor hook steps/tool matchers; unsupported tools/events dropped with warnings | `source/packages/hooks/claude-code-mapper.ts:53` |
| high | hooks/preToolUse | A preToolUse hook returns permission allow/deny/ask → Response validated; user_message/agent_message/updated_input/additional_context applied | `source/packages/hooks/validators/preToolUseResponse.ts:6` |
| high | hooks/exec | A hook denies a tool action → '<action> was blocked by a hook: <message>' plus settings hint and no-workarounds note | `source/packages/hooks-exec/hook-error-handling.ts:50` |
| medium | coordinator/transport | Gateway SSE stream connects → Posts transport-state 'connected' to renderer and seeds the agents roster | `source/node-agent-coordinator/main.ts:149` |
| medium | coordinator/transport | Gateway SSE stream goes down → Posts transport-state 'down' to renderer and invalidates health cache | `source/node-agent-coordinator/main.ts:143` |
| medium | coordinator/transport | Renderer port begins serving while gateway stream is not live → Immediately posts transport-state 'down' so the offline banner shows on connect | `source/node-agent-coordinator/main.ts:244` |
| medium | coordinator/sse-fanout | Gateway emits an 'agents' SSE event with a routed inference provider active → Roster re-projected with local transcript rows merged before forwarding to renderer | `source/node-agent-coordinator/main.ts:120` |
| medium | gateway/command | Coordinator dispatches a gateway command that returns HTTP < 500 → Throws SandGatewayCommandError with the extracted gateway error message | `source/node-agent-coordinator/gateway/gateway-client.ts:267` |
| medium | gateway/command | Coordinator dispatches a gateway command that returns HTTP 5xx → Throws SandGatewayUnreachableError kind http_5xx and reports reachability | `source/node-agent-coordinator/gateway/gateway-client.ts:271` |
| medium | gateway/command | createAgent fails on a pre-dispatch/transient error → Retries up to 3 times with backoff, reusing a mint-dedupe-proven base URL when known | `source/node-agent-coordinator/gateway/gateway-client.ts:303` |
| medium | gateway/command | createAgent hits a permanent refusal kind (no_storage/box_blocked/access_denied) → Retry skipped and the refusal error surfaced immediately | `source/node-agent-coordinator/gateway/gateway-client.ts:313` |
| medium | gateway/send | sendPrompt POST fails before dispatch or on a dedupe-proven endpoint → Send retried once with the same clientNonce | `source/node-agent-coordinator/gateway/gateway-client.ts:348` |
| medium | gateway/send | sendPrompt POST exceeds the 15s send-post deadline → Send fails as a timeout-classified unreachable error | `source/node-agent-coordinator/gateway/gateway-client.ts:375` |
| medium | gateway/roster | listAgents/countAgents read exceeds the 15s roster-read deadline → Roster read fails as SandGatewayUnreachableError kind timeout after one retry | `source/node-agent-coordinator/gateway/gateway-client.ts:340` |
| medium | gateway/dev-controls | setDevGatewayOffline induced=true is dispatched → resolveConnection throws 'gateway offline: induced by dev controls' and the stream drops | `source/node-agent-coordinator/gateway/gateway-client.ts:210` |
| medium | gateway/pause | Client is paused and a gateway connection is resolved → Throws box_blocked with the client-pause message and suppresses reachability reports | `source/node-agent-coordinator/gateway/gateway-client.ts:209` |
| medium | gateway/stall | SSE stream is idle past the 35s stall timeout → Stream aborted and reconnect classified as 'stall-timeout' | `source/node-agent-coordinator/gateway/gateway-client.ts:443` |
| medium | gateway/stream | SSE connect exceeds the 15s connect deadline → Attempt aborts and retries with exponential backoff (1s→10s) | `source/node-agent-coordinator/gateway/gateway-client.ts:424` |
| medium | gateway/forever-box | Gateway returns forever-box status with a loopback VNC URL and a VNC proxy is configured → VNC URLs rewritten to the proxy primary/fork URLs before reaching the renderer | `source/node-agent-coordinator/gateway/box-vnc-proxy.ts:27` |
| medium | gateway/reachability | A gateway fetch fails with a system errno (ECONNREFUSED/ENOTFOUND/ETIMEDOUT) → Failure classified into refused/dns/timeout/network reachability outcome | `source/node-agent-coordinator/gateway/gateway-reachability.ts:72` |
| medium | oauth/callback | OAuth callback arrives with an error param or missing code → Browser receives HTTP 400 and the MCP OAuth error page | `source/node-agent-coordinator/oauth/mcp-oauth-callback-listener.ts:23` |
| medium | oauth/callback | completeMcpOAuth throws while handling a callback → Browser receives HTTP 500 and the MCP OAuth error page | `source/node-agent-coordinator/oauth/mcp-oauth-callback-listener.ts:38` |
| medium | webauthn/consent | User declines the WebAuthn consent prompt → Gateway receives grant 'declined' + NotAllowedError 'The security key request was declined on your computer.' | `source/node-agent-coordinator/webauthn/provider.ts:76` |
| medium | webauthn/cancel | Gateway sends a cancel frame for an in-flight WebAuthn ceremony → The in-flight signer attempt is aborted | `source/node-agent-coordinator/webauthn/provider.ts:128` |
| medium | webauthn/signer | Security key signer emits presence-required/select-device events → Status shown: 'Touch your security key now'/'Touch the security key you want to use' | `source/node-agent-coordinator/webauthn/signer.ts:20` |
| medium | webauthn/signer | Signer reports pin-not-set/pin-blocked/uv-blocked/uv-invalid → Status message shown (key has no PIN / key is locked / fingerprint locked / didn't match) | `source/node-agent-coordinator/webauthn/signer.ts:23` |
| medium | webauthn/signer | Signer requests a PIN → requestWebAuthnPin prompt shown; empty/undefined PIN cancels the ceremony | `source/node-agent-coordinator/webauthn/signer.ts:121` |
| medium | webauthn/signer | Signer is aborted mid-request → Child killed and NotAllowedError 'the security key request was cancelled' returned | `source/node-agent-coordinator/webauthn/signer.ts:109` |
| medium | webauthn/signer | Signer helper binary cannot be spawned or exits with no result → NotAllowedError 'could not start the security key helper'/'exited with no result' | `source/node-agent-coordinator/webauthn/signer.ts:155` |
| medium | inference-router/validation | A local routed sendPrompt is missing agentId or prompt → Throws 'Local inference routing requires an agentId and prompt' | `source/node-agent-coordinator/inference-router.ts:189` |
| medium | inference-router/roster | A locally-routed agent has no remote roster row → A synthetic 'Grok' roster row projected from its profile/first message | `source/node-agent-coordinator/inference-router.ts:100` |
| medium | client-side-tool-v2/replay | Renderer port (re)begins serving → Retained tool call/result lifecycle replayed in sequence order to the renderer | `source/node-agent-coordinator/client-side-tool-v2-relay.ts:61` |
| medium | coordinator/rpc | Renderer cancels an in-flight request → Request aborted and replied with COORDINATOR_CANCELLED failure | `source/node-agent-coordinator/renderer-port-server.ts:85` |
| medium | agent-exec/controlled | Host sends an abort control message for a running tool exec → The exec context is cancelled and the tool stops | `source/packages/agent-exec/controlled.ts:143` |
| medium | agent-exec/controlled | A tool exec throws → A throw control message carrying error message, stack, and error code is streamed back | `source/packages/agent-exec/controlled.ts:182` |
| medium | agent-exec/subagent | A follow-up is sent to a still-running subagent without interrupt → Error 'Sub-agent is currently running...' plus the interrupt retry hint | `source/packages/agent-exec/subagent.ts:19` |
| medium | agent-exec/readonly | A readonly-mode subagent attempts a write/delete/mcp/shell tool → Permission denied with 'This operation is not allowed in readonly mode...' | `source/packages/agent-exec/readonly-resource-accessor.ts:39` |
| medium | agent-exec/mcp | An MCP tool output exceeds the 40KB text threshold → Aggregate text written to an agent-tools file and replaced by an output-location reference | `source/packages/agent-exec/agent-tools-file.ts:15` |
| medium | agent-exec/tool-output | A tool writes large output to an agent-tools file → Message 'Content written to file: <path> Size: <n> KB, <n> lines' shown | `source/packages/agent-exec/agent-tools-file.ts:110` |
| medium | chat-inference/image-resize | A user/tool message contains an image over the size cap → Image resized in place; if resizing fails it is dropped as '[image omitted: failed to process N bytes]' | `source/packages/chat-inference/middleware/image-resizing-middleware.ts:36` |
| medium | chat-inference/token-limit | A provider error message matches an input/output token limit signature → Reclassified as InputTokenLimitError or OutputTokensLimitExceededError | `source/packages/chat-inference/token-limit-error-classification.ts:41` |
| medium | hooks/config | A hooks config sets the deprecated stop_hook_loop_limit → A deprecation warning logged and the value ignored | `source/packages/hooks/validators/hooksConfig.ts:60` |
| medium | hooks/config | A hook timeout over 3600s is configured → Warns '[hooks] Hook timeout ... is very long (>1 hour)' but accepts it | `source/packages/hooks/validators/hooksConfig.ts:23` |
| medium | hooks/beforeReadFile | A beforeReadFile hook returns a permission other than allow/deny → Validation error 'Invalid permission value. Expected one of: allow, deny...' | `source/packages/hooks/validators/beforeReadFileResponse.ts:8` |
| medium | hooks/sessionStart | A sessionStart hook returns env/additional_context/continue/user_message → Env validated as string map and applied; other fields validated as typed | `source/packages/hooks/validators/sessionStartResponse.ts:6` |
| medium | hooks/stop | A stop/subagentStop hook returns a followup_message → Followup message string validated and delivered | `source/packages/hooks/validators/stopResponse.ts:4` |
| medium | hooks/workspaceOpen | A workspaceOpen hook returns pluginPaths → Paths validated as a non-empty string array | `source/packages/hooks/validators/workspaceOpenResponse.ts:4` |
| medium | hooks/exec | A hook fails to execute (fail-closed) → '<action> was blocked because a configured hook failed to execute...' safety message shown | `source/packages/hooks-exec/hook-error-handling.ts:60` |
| medium | mcp-core/timeout | An MCP tool call runs longer than the max total timeout (60 min) → The MCP tool call times out | `source/packages/mcp-core/config/mcp-tool-call-timeout.ts:1` |
| medium | shell-exec/run | Agent runs a shell command via the stateful bash/zsh/powershell executor → stdin_ready, streamed stdout/stderr, and an exit event with code emitted | `source/packages/shell-exec/bash.ts:121` |
| medium | shell-exec/state | A shell command changes the working directory or shell state → cwd/env state preserved for the next command in the same session | `source/packages/shell-exec/bash.ts:238` |
| medium | shell-exec/cancel | A running shell command is aborted → Child gets SIGTERM, then SIGKILL after 1s, and exit reports aborted=true | `source/packages/shell-exec/core.ts:32` |
| medium | shell-exec/bash-missing | Bash cannot be found on the system → Throws "Can't find Bash" | `source/packages/shell-exec/bash.ts:154` |
| medium | shell-exec/powershell-missing | Neither pwsh nor powershell is on PATH → Throws "Neither 'pwsh' ... nor 'powershell' ... found in PATH" | `source/packages/shell-exec/platform-shell.ts:47` |
| medium | shell-exec/sudo | SUDO_ASKPASS is set and a command uses sudo → sudo rewritten to 'sudo -A' so askpass provides the password | `source/packages/shell-exec/sudo.ts:5` |
| medium | shell-exec/output-suppress | A shell produces output faster than the suppression threshold → Shows '[This shell is producing too much output to stream. The command will still run.]' | `source/packages/shell-exec/output-suppression.ts:2` |
| medium | shell-exec/sandbox | A sandbox policy is requested but the helper binary is unavailable/unsupported → Throws SandboxUnsupportedError explaining the policy is not supported and to use insecure_none | `source/packages/shell-exec/sandbox/sandbox.ts:31` |
| medium | shell-exec/sandbox | A sandboxed command tries to write a protected file (.git/hooks, .cursor/*.json, .ssh, mcp.json, permissions.json) → Write blocked by the hardcoded write-protection mapping | `source/packages/shell-exec/sandbox/hardcoded-policy.ts:236` |
| medium | shell-exec/sandbox-denies | A sandboxed macOS command triggers Sandbox deny events → Deny events captured from the system log and surfaced as a sandbox_denies event | `source/packages/shell-exec/sandbox/macos/seatbelt.ts:33` |
| medium | local-exec/read | Agent reads a text file → ReadSuccess with content, totalLines, fileSize, and truncated/rangeApplied flags | `source/packages/local-exec/read.ts:335` |
| medium | local-exec/read | Agent reads with an offset/limit range → Only the requested line range returned with rangeApplied=true (supports negative tail offset) | `source/packages/local-exec/read.ts:124` |
| medium | local-exec/read | Read content exceeds the 8MB text cap → Content truncated with truncated=true | `source/packages/local-exec/read.ts:340` |
| medium | local-exec/read | Read target is a directory → ReadInvalidFile 'Path is a directory, not a file' | `source/packages/local-exec/read.ts:312` |
| medium | local-exec/read | Read target is an unsupported binary file → ReadInvalidFile 'Binary files of type <ext> are not supported by the read executor' | `source/packages/local-exec/read.ts:118` |
| medium | local-exec/read | Read target is an image / PDF / video → Returns the (image-resized) binary data payload rather than text | `source/packages/local-exec/read.ts:318` |
| medium | local-exec/read | Read target does not exist → ReadFileNotFound result | `source/packages/local-exec/read.ts:344` |
| medium | local-exec/read | Read is blocked by permissions or hits EACCES/EPERM → ReadPermissionDenied result | `source/packages/local-exec/read.ts:308` |
| medium | local-exec/read | Read a non-UTF8 text file → Encoding detected (utf-16/latin1 fallback) and cached per file | `source/packages/local-exec/read.ts:289` |
| medium | local-exec/ls | Agent lists a directory → Directory tree with sorted files/dirs and per-extension counts returned | `tool-results/b8vqfpmtc.txt:17` |
| medium | local-exec/ls | ls target does not exist or is not a directory → LsError 'Path does not exist'/'Path is not a directory' | `tool-results/b8vqfpmtc.txt:19` |
| medium | local-exec/ls | ls traversal exceeds the 5s timeout → LsTimeout result with the partial directory tree | `tool-results/b8vqfpmtc.txt:22` |
| medium | local-exec/ls | ls output exceeds the 2500-char budget → Nodes past the budget marked childrenWereProcessed=false (counts still tallied) | `tool-results/b8vqfpmtc.txt:29` |
| medium | local-exec/grep | Agent runs grep and results exceed the client line limit → Results sliced and clientTruncated/ripgrepTruncated flags set | `source/packages/local-exec/grep-output.ts:84` |
| medium | local-exec/shell | Agent runs a foreground shell command → Streams a start event (with sandbox policy), stdout/stderr, then an exit event with code+cwd | `source/packages/local-exec/shell-stream.ts:304` |
| medium | local-exec/shell | A shell command matches the admin command denylist → Rejected 'Denied: this command was blocked by administrator policy (denylist rule: <pattern>)...' | `source/packages/local-exec/services/admin-command-denylist.ts:185` |
| medium | local-exec/shell | A shell command cannot be conclusively analyzed against the denylist → Fail-closed rejection 'this command could not be conclusively analyzed... so it was blocked' | `source/packages/local-exec/services/admin-command-denylist.ts:23` |
| medium | local-exec/shell | A shell command is blocked (needsApproval/cursorIgnore/adminBlock/cursorFiles/user-rejected) → ShellRejected with the block-reason message | `source/packages/local-exec/utils/edit-block-handler.ts:22` |
| medium | local-exec/shell | A foreground shell command exceeds its timeout with BACKGROUND behavior → Emits a 'backgrounded' event with the shellId (timeout reason) | `source/packages/local-exec/shell-stream.ts:310` |
| medium | local-exec/shell | A foreground shell exceeds the default 30s timeout without background behavior → Command aborted and exit reports abortReason TIMEOUT | `source/packages/local-exec/shell-timeout.ts:3` |
| medium | local-exec/shell | forceBackgroundByToolCallId is called on a live foreground shell → Shell moved to background and a ShellSuccess with shellId + interleaved output returned | `source/packages/local-exec/shell-stream.ts:303` |
| medium | local-exec/shell | forceBackgroundByToolCallId targets a tool call with no active shell → ForceBackgroundShellResult status NOT_FOUND | `source/packages/local-exec/shell-stream.ts:303` |
| medium | local-exec/shell | A shell hard timeout elapses → The background/foreground shell is killed | `source/packages/local-exec/shell-stream.ts:308` |
| medium | local-exec/shell | A shell command's sandbox policy is unsupported at spawn → Emits a sandboxUnsupported event naming the policy type and reason | `source/packages/local-exec/shell-stream.ts:309` |
| medium | local-exec/shell | A running foreground shell is aborted by the user → Exit event with aborted=true and abortReason USER_ABORT | `source/packages/local-exec/shell-stream.ts:310` |
| medium | local-exec/shell-core | Shell stdout or stderr exceeds the 1MB buffer cap → Emits stdout_trimmed/stderr_trimmed and stops forwarding further output | `source/packages/local-exec/shell-core.ts:389` |
| medium | local-exec/shell-core | Shell output exceeds the configured file-output threshold → Merged output written to an agent-tools file and an output-location returned at exit | `source/packages/local-exec/shell-core.ts:388` |
| medium | local-exec/background-shell | Agent spawns a background shell → BackgroundShellSpawnSuccess with a shellId (and pid) | `source/packages/local-exec/background-shell.ts:214` |
| medium | local-exec/background-shell | A background shell finishes → A completion wakeup enqueued with status success/error/aborted (exit_code detail, outputPath) | `source/packages/local-exec/background-shell-lifecycle.ts:170` |
| medium | local-exec/background-shell | Agent writes stdin containing an EOT (\x04) to a background shell → Preceding data written and the shell's stdin closed | `source/packages/local-exec/background-shell-lifecycle.ts:283` |
| medium | local-exec/background-shell | Agent writes stdin to a shell that no longer exists or has no stdin → Throws 'Shell not found'/'Shell stdin not available' | `source/packages/local-exec/background-shell-lifecycle.ts:281` |
| medium | local-exec/background-shell | A background shell's output matches a configured output-notification pattern → A task_progress wakeup with the reason title and matched text enqueued (batched, debounced 5s) | `source/packages/local-exec/background-shell-observability.ts:206` |
| medium | local-exec/background-shell | Output notification matches reach the limit (default 100) → A 'Notification limit reached (N)' wakeup emitted and further notifications stop | `source/packages/local-exec/background-shell-observability.ts:232` |
| medium | local-exec/background-shell | A background shell runs → Its output logged to terminals/<shellId>.txt with live YAML frontmatter (status, running_for_ms) and footer | `source/packages/local-exec/background-shell-observability.ts:371` |
| medium | local-exec/mcp-fs | An MCP server reaches a live state (ready/needsAuth/error) → Its tool descriptors written under mcps/<server>/tools and stale servers removed | `source/packages/local-exec/mcp-file-system-writer.ts:383` |
| medium | local-exec/mcp-fs | An MCP server needs authentication → A STATUS.md needs-auth message written and a virtual mcp_auth tool exposed | `source/packages/local-exec/mcp-file-system-writer.ts:383` |
| medium | local-exec/mcp-fs | An MCP server is in an error state → A STATUS.md error message instructing the user to check the MCP status written | `source/packages/local-exec/mcp-file-system-writer.ts:39` |
| medium | local-exec/record-screen | A screen recording save filename contains slashes → Rejected with reason SLASHES_NOT_ALLOWED | `source/packages/local-exec/record-screen-paths.ts:41` |
| medium | local-exec/record-screen | A screen recording save filename lacks an .mp4 extension or exceeds 128 chars → Extension appended and the name truncated to 128 chars | `source/packages/local-exec/record-screen-paths.ts:52` |
| low | coordinator/bootstrap | Coordinator starts but the carrier bootstrap intake is rejected (missing/invalid --bootstrap, no data channel) → Writes rejection detail to stderr and exits with code 2 | `source/node-agent-coordinator/main.ts:66` |
| low | coordinator/bootstrap | Coordinator adopts a valid carrier and finishes composing → Local-exec supervisor starts and gateway client SSE loop begins | `source/node-agent-coordinator/main.ts:300` |
| low | coordinator/lifecycle | An uncaughtException or unhandledRejection fires in the coordinator → Crash reported via reportProcessCrash and process settles with exit code 1 | `source/node-agent-coordinator/main.ts:285` |
| low | coordinator/lifecycle | Renderer data port reports a protocol breach → Breach detail written to stderr and process settles with exit code 1 | `source/node-agent-coordinator/main.ts:273` |
| low | coordinator/pause | Renderer sends setGatewayPaused paused=true → Local-exec daemon retired and WebAuthn provider stopped | `source/node-agent-coordinator/main.ts:247` |
| low | coordinator/pause | Renderer sends setGatewayPaused paused=false → Local-exec daemon re-established and WebAuthn provider restarted | `source/node-agent-coordinator/main.ts:249` |
| low | coordinator/oauth-forward | Gateway emits an mcp-oauth-pending SSE event → Pending OAuth tracked and a loopback callback listener started for its redirect origin | `source/node-agent-coordinator/main.ts:104` |
| low | gateway/reconnect | forceReconnect is called on the gateway client → Active event-loop attempt aborted and a fresh SSE connection scheduled | `source/node-agent-coordinator/gateway/gateway-client.ts:176` |
| low | gateway/dns-diagnostics | A DNS-classed gateway failure occurs against a *.cursorvm.com endpoint → System/independent/wildcard/general DNS probes run and a diagnosis reported (throttled 1/min) | `source/node-agent-coordinator/gateway/gateway-dns-diagnostics.ts:98` |
| low | gateway/health | Cached connection is stale and a /health probe succeeds → Connection reused and last-healthy timestamp refreshed | `source/node-agent-coordinator/gateway/host-supervisor.ts:135` |
| low | gateway/health | /health probe exceeds the 1.5s timeout or returns not-ok → Probe reports the reachability outcome and a fresh connection is resolved | `source/node-agent-coordinator/gateway/host-supervisor.ts:48` |
| low | oauth/loopback | MCP OAuth redirect_uri is not a localhost HTTP URL or lacks a port → Loopback registry throws a descriptive error and no listener binds | `source/node-agent-coordinator/oauth/mcp-oauth-loopback-registry.ts:17` |
| low | oauth/loopback | An unmatched request hits the loopback callback server → Server responds 404 Not found | `source/node-agent-coordinator/oauth/mcp-oauth-loopback-registry.ts:117` |
| low | oauth/pending | A pending OAuth is not completed within its TTL (10-11 min) → Pending entry expires and its loopback listener drained/closed | `source/node-agent-coordinator/oauth/mcp-oauth-forwarder.ts:139` |
| low | inference-router/store | Transcript store on disk is corrupt or fails to parse → Falls back to an empty store (schemaVersion 2, no agents) | `source/node-agent-coordinator/inference-router.ts:65` |
| low | inference-router/store | An agent accumulates more than 200 stored entries → Only the most recent 200 entries per agent are persisted | `source/node-agent-coordinator/inference-router.ts:77` |
| low | routed-mcp-bridge/limit | An MCP bridge request body exceeds 1MB → Server responds HTTP 413 | `source/node-agent-coordinator/routed-mcp-bridge.ts:50` |
| low | client-side-tool-v2/relay | Host stream sends a client-side-tool-v2 call/result event → Validated once, deduped by sequence/epoch, materialized to the renderer | `source/node-agent-coordinator/client-side-tool-v2-relay.ts:26` |
| low | coordinator/rpc | Renderer sends a frame with the wrong protocol version in hello → Server declares a protocol breach and shuts the session down | `source/node-agent-coordinator/renderer-port-server.ts:66` |
| low | coordinator/rpc | Renderer calls a method no coordinator table serves → Reply fails with COORDINATOR_UNKNOWN_METHOD | `source/node-agent-coordinator/gateway/gateway-request-dispatcher.ts:22` |
| low | local-exec-daemon/supervise | No local-exec daemon discovery file exists → A new daemon spawned and adopted once it publishes matching discovery | `source/node-agent-coordinator/local-exec/supervisor.ts:219` |
| low | local-exec-daemon/supervise | An existing daemon has in-flight work → The running daemon is adopted rather than replaced | `source/node-agent-coordinator/local-exec/supervisor.ts:231` |
| low | local-exec-daemon/supervise | Daemon respawns exceed the limit of 10 → Supervisor enters 'failed' state with reason 'respawn limit reached' | `source/node-agent-coordinator/local-exec/supervisor.ts:306` |
| low | local-exec-daemon/supervise | Daemon spawn does not publish matching discovery within the 5s readiness timeout → Spawn cleaned up and treated as failed | `source/node-agent-coordinator/local-exec/supervisor.ts:184` |
| low | agent-exec/controlled | A controlled exec runs longer than 3s between messages → Heartbeat control messages streamed to keep the exec alive | `source/packages/agent-exec/controlled.ts:160` |
| low | agent-exec/controlled | No handler matches an exec server message type → Streams a throw 'No handler found for server message of type <case>' | `source/packages/agent-exec/controlled.ts:207` |
| low | agent-exec/subagent | The same subagent tool call is retried (same toolCallId) → The previously completed result returned without re-running | `source/packages/agent-exec/subagent.ts:171` |
| low | agent-exec/background-work | A completion wakeup is enqueued with a groupKey that already exists → The older same-group wakeup replaced (deduped) in the queue | `source/packages/agent-exec/wakeup/index.ts:9` |
| low | chat-inference/continuation | The last message before streaming is a non-empty assistant message → A continuation user message 'Your previous response was interrupted...' injected | `source/packages/chat-inference/middleware/continuation-injector-middleware.ts:9` |
| low | chat-inference/trailing-empty | Trailing empty assistant messages exist before streaming → They are removed before the request is sent | `source/packages/chat-inference/middleware/trailing-empty-assistant-removal-middleware.ts:4` |
| low | hooks/sanitize | Hook-supplied content contains <system_reminder> tags → Tags rewritten to <system_reminder_> to neutralize injection | `source/packages/hooks/sanitize-system-reminder.ts:1` |
| low | shell-exec/close-hang | A shell's close event does not fire within the close timeout after exit → Warns about a background process holding fds and proceeds anyway to avoid a hang | `source/packages/shell-exec/bash.ts:264` |
| low | shell-exec/detect | No usable shell is detected for the platform → Falls back to the naive /bin/sh -c executor | `source/packages/shell-exec/naive.ts:149` |
| low | shell-exec/output-limit | Shell output is buffered and exceeds 256KB or 50ms passes → Buffered stdout/stderr coalesced and flushed to the consumer | `source/packages/shell-exec/output-limiter.ts:19` |
| low | shell-exec/sandbox | A shell command runs under a sandbox policy on a supported platform → Command runs inside the sandbox helper with the resolved read/write/network policy | `source/packages/shell-exec/sandbox/sandbox.ts:8` |
| low | shell-exec/sandbox | On Windows a filesystem sandbox is requested → Sandbox reported unsupported (Windows helper is network-proxy only) | `source/packages/shell-exec/sandbox/helper-support.ts:144` |
| low | shell-exec/sandbox | On Linux the sandbox preflight probe fails (unsupported kernel features) → Sandbox marked unsupported with the preflight failure reason | `source/packages/shell-exec/sandbox/helper-support.ts:122` |
| low | shell-exec/sandbox | Merged sandbox policy sources have conflicting types → Throws 'Cannot merge policies of different types...' | `source/packages/shell-exec/sandbox/policy-merge.ts:313` |
| low | shell-exec/env | A sandboxed command runs on Linux → Socket env vars (SSH_AUTH_SOCK, DBUS, XDG_RUNTIME_DIR, WAYLAND_DISPLAY) scrubbed from its env | `source/packages/shell-exec/env-filter.ts:1` |
| low | shell-exec/parse | tree-sitter natives are unavailable when analyzing a shell command → Analysis degrades to parsingFailed instead of crashing | `source/packages/shell-exec/shell-parser.ts:154` |
| low | local-exec/background-shell | An output-notification pattern exceeds 500 chars → Observer construction throws 'Output notification pattern exceeds 500 characters' | `source/packages/local-exec/background-shell-observability.ts:124` |
| low | local-exec/mcp-fs | The MCP writer initializes → A managed block written to ~/.cursor/.gitignore to un-ignore projects/mcps/skills/etc. | `source/packages/local-exec/mcp-file-system-writer.ts:145` |
| low | local-exec/computer-use | Computer-use detects the display via xrandr → Resolution/refresh parsed and a 1280-wide API coordinate space configured | `source/packages/local-exec/computer-use/display.ts:216` |
| low | local-exec/computer-use | Computer-use display and API aspect ratios differ by >0.02 → CoordinateScaler throws an 'Aspect ratio mismatch' error | `source/packages/local-exec/computer-use/scaling.ts:235` |
| low | local-exec/forced-egress | Forced shell egress enabled and a command is all dependency installers → Command runs with network default 'allow' (dependency egress policy) | `source/packages/local-exec/forced-egress.ts:167` |
| low | local-exec/forced-egress | Forced shell egress enabled for a non-dependency or unparseable command → Command runs with a loopback-only network policy | `source/packages/local-exec/forced-egress.ts:170` |
| low | shell-exec/build-cache | A sandbox policy enables the shared build cache → Package-manager cache env vars (npm/pnpm/cargo/pip/etc.) redirected to a shared session dir | `source/packages/shell-exec/sandbox/cache-env.ts:36` |

## Electron main · 창/계정/어댑터/첨부/인증/박스/딥링크/다운로드/미디어/모델/알림/1Password/설정/비밀/시작/업데이트/VNC/MCP/코디네이터  (누락 140건, 추출 192 / 매칭 52)
- 표면 판정: 약 27% (52/192). 상위 사용자 기능(테마 전환, 업데이트 확인/트랙/설치, MCP 서버·계정·플러그인 관리와 OAuth, 첨부 업로드/이미지·텍스트·청크 읽기·다운로드, 로그아웃, 이름 변경, 주간 사용량, 음성 전사, 봇 아바타 선택, 컴퓨터 업데이트/재구축 진행, WebAuthn 승인/거절, 피드백 전송, 딥링크 라우팅)은 원장에 있으나, Electron main의 오류·보안 경계와 통째로 빠진 영역이 대부분 미등록: 로컬 Docker 런타임(상태·재생성·소유권 가드), 1Password 프로비저닝, VNC 클립보드/입력 브리지, 네이티브 컨텍스트 메뉴(이미지 복사·저장, 편집 메뉴), 도크 배지, sand-media 프로토콜(Range/206/416), 비밀 reveal·delete와 신뢰 경계, 코디네이터 수명주기·포트 신뢰 검증, Cursor 로그인 플로우(시작·타임아웃·MDM·계정 바인딩), AI 아바타 생성, 보안키 PIN 플로우, macOS Applications 이동, experiments/webauthn-proxy/egress 설정 게터. overclaims는 참조 소스(source/electron-main)가 이 저장소에 없어 코드 부재를 실증할 수 없으므로 0건으로 보고.

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | secrets | Invoke sand:secrets-reveal with a string key → Returns the decrypted secret value for that key | `source/electron-main/secrets/secrets-ipc.ts:127` |
| high | secrets | Invoke sand:secrets-delete with string keys → Removes those secrets and returns {synced} | `source/electron-main/secrets/secrets-ipc.ts:137` |
| high | account | User signs in to Cursor → Opens the login URL in the external browser and enters logging-in state | `source/electron-main/account/cursor-auth.ts:319` |
| high | avatar | User generates an avatar from a text description → Returns the generated image as a data URL | `source/electron-main/media/avatar-images.ts:17` |
| high | models | Renderer requests the available models list → Fetches and returns the user's available models catalog | `source/electron-main/models/cursor-model-catalog.ts:9` |
| medium | secrets | An untrusted frame/webview invokes any secrets IPC channel → Throws UntrustedSecretsSenderError 'Secrets are only accessible from the Sand app window.' | `source/electron-main/secrets/secrets-ipc-guard.ts:26` |
| medium | secrets | Invoke sand:secrets-reveal with a non-string key → Returns null (no reveal) | `source/electron-main/secrets/secrets-ipc.ts:129` |
| medium | secrets | Upsert a secret while no account is signed in → Throws SandSecretsAccountRequiredError 'Box secrets can only change while an account is signed in' | `source/electron-main/secrets/user-secrets-store.ts:106` |
| medium | secrets | Upsert secrets that fail box-secret validation → Throws SandBoxSecretsValidationError with the validation message | `source/electron-main/secrets/user-secrets-store.ts:117` |
| medium | secrets | OS keychain/keyring is unavailable when storing tokens → Warns once that Cursor tokens are kept in memory for this session only and will not persist across restart | `source/electron-main/secrets/secret-store.ts:132` |
| medium | secrets | Reveal a secret while encrypted storage is unavailable → Returns null instead of the secret value | `source/electron-main/secrets/user-secrets-store.ts:89` |
| medium | mcp | Renderer invokes sand:mcp-team-popularity → Returns per-plugin team install counts (empty map if not in a team) | `source/electron-main/mcp/mcp-desktop.ts:9` |
| medium | mcp | A routed MCP tool is executed against the desktop app (not the box) → Returns an McpError 'MCP tools run on Grok Bot's computer, not the desktop app' | `source/electron-main/mcp/desktop-mcp-manager.ts:109` |
| medium | settings | Renderer reads sand:webauthn-proxy-get-sync → Returns whether the WebAuthn proxy is enabled | `source/electron-main/prefs/settings-ipc.ts:2` |
| medium | deep-link | Same deep link received twice within 2s → Second one is deduped and dropped | `source/electron-main/deep-link/deep-link-controller.ts:8` |
| medium | deep-link | Deep link arrives while renderer not ready and 16 already queued → Link is dropped (pending queue full) | `source/electron-main/deep-link/deep-link-controller.ts:8` |
| medium | deep-link | Deep link arrives before renderer ready then renderer becomes ready → Queued links are flushed and dispatched on markReady | `source/electron-main/deep-link/deep-link-controller.ts:11` |
| medium | vnc | Trusted box-desktop VNC webview requests readClipboard → Returns the host OS clipboard text | `source/electron-main/vnc/vnc-edge.ts:3` |
| medium | vnc | Trusted box-desktop VNC webview calls writeClipboard with text → Writes the non-empty text to the host OS clipboard | `source/electron-main/vnc/vnc-edge.ts:3` |
| medium | vnc | A non-box-VNC-partition/untrusted frame calls a box-VNC edge method → Denied: 'The box-VNC edge is only accessible from the trusted box-desktop webview.' | `source/electron-main/vnc/vnc-edge.ts:2` |
| medium | vnc | The box-VNC guest webview attempts to zoom via pinch/keyboard → Zoom is pinned to 1x and the input is routed to the host, preventing zoom | `source/electron-main/vnc/vnc-trust.ts:22` |
| medium | webauthn | User closes the security-key prompt window → Consent resolves as denied (approved:false) | `source/electron-main/coordinator/coordinator-executors.ts:379` |
| medium | webauthn | Security key requires a PIN; PIN panel shown and user clicks Continue → Submits the entered PIN and shows 'Checking your PIN…' | `source/electron-main/coordinator/coordinator-executors.ts:301` |
| medium | webauthn | A previously entered PIN was rejected and PIN prompt re-shown → Shows 'That PIN was not accepted.' with remaining-attempts count when known | `source/electron-main/coordinator/coordinator-executors.ts:286` |
| medium | attachments | Renderer resolves a media attachment whose path is a video → Returns {kind:'video', src: sand-media url} | `source/electron-main/attachments/attachments.ts:80` |
| medium | attachments | Renderer resolves a media attachment whose path is audio → Returns {kind:'audio', src: sand-media url} | `source/electron-main/attachments/attachments.ts:81` |
| medium | attachments | Renderer reads attachment bytes for a file larger than the byte cap → Returns {kind:'too-large', size} instead of bytes | `source/electron-main/attachments/attachments.ts:68` |
| medium | attachments | Renderer stages an empty (0-byte) attachment → Returns {ok:false, reason:'empty'} | `source/electron-main/attachments/attachments.ts:89` |
| medium | attachments | Renderer stages an attachment exceeding the per-name byte limit → Returns {ok:false, reason:'too-large'} | `source/electron-main/attachments/attachments.ts:90` |
| medium | attachments | Renderer stages a file with an unsafe filename → Returns {ok:false, reason:'failed'} | `source/electron-main/attachments/attachments.ts:88` |
| medium | attachments | Renderer commits with a path outside the staging dir → Returns null (rejects the commit) | `source/electron-main/attachments/attachments.ts:95` |
| medium | attachments | Renderer requests link metadata for a URL → Returns link preview metadata with bounded preview image and favicon data URLs | `source/electron-main/attachments/attachments.ts:99` |
| medium | attachments | Attachment download fails (invalid source/unavailable/transfer error) → Shows error dialog 'Couldn't save this file' and returns false | `source/electron-main/attachments/attachments.ts:75` |
| medium | media | An image context menu is opened on a link → Menu shows 'Open link' and 'Copy link address' | `source/electron-main/media/avatar-images.ts:135` |
| medium | media | An image context menu is opened on an image → Menu shows 'Copy image', 'Save image…', and (if src) 'Copy image address' | `source/electron-main/media/avatar-images.ts:141` |
| medium | media | User clicks 'Copy image' on a data: image → Writes the decoded image to the clipboard | `source/electron-main/media/avatar-images.ts:82` |
| medium | media | User clicks 'Save image…' and confirms the dialog → Writes the image bytes to the chosen path with correct extension | `source/electron-main/media/avatar-images.ts:117` |
| medium | media | Context menu opened on editable text → Shows Undo/Redo/Cut/Copy/Paste/Select All with accelerators, each enabled per editFlags | `source/electron-main/media/avatar-images.ts:148` |
| medium | media | Renderer requests sand-media:// for a local media file with a Range header → Serves a 206 partial-content response with content-range | `source/electron-main/media/media-protocol.ts:57` |
| medium | account | Login poll completes with valid tokens → Stores tokens and emits logged-in status (with profile) | `source/electron-main/account/cursor-auth.ts:327` |
| medium | account | Login times out / never finishes → Emits logged-out with 'Cursor sign-in did not finish. Try again.' | `source/electron-main/account/cursor-auth.ts:325` |
| medium | account | Login is refused by MDM sign-in policy → Emits logged-out with the sign-in policy violation message | `source/electron-main/account/cursor-auth.ts:323` |
| medium | account | User cancels an in-progress login → Aborts login and returns logged-out status | `source/electron-main/account/cursor-auth.ts:290` |
| medium | account | Logout fails to remove saved credentials → Emits logged-out with 'couldn't remove the saved Cursor sign-in… may return after restart' | `source/electron-main/account/cursor-auth.ts:53` |
| medium | account | Access token refresh returns not-ok / expired → Revokes credentials and emits 'Cursor sign-in expired. Sign in again…' | `source/electron-main/account/cursor-auth.ts:340` |
| medium | account | The machine is bound to a different Cursor account and a new account signs in → Sign-in refused with 'This computer is linked to another Cursor account. Sign in with that account to continue.' | `source/electron-main/account/cursor-auth.ts:59` |
| medium | account | Renderer cancels the Sand trial while gate is off → Returns {ok:false, message:"This isn't available right now"} | `source/electron-main/account/cursor-auth-wiring.ts:172` |
| medium | account | Renderer requests Sand access status → Returns access state (granted/unavailable/paymentRequired/unknown/checking) with block reason | `source/electron-main/account/access.ts:82` |
| medium | account | Renderer requests privacy-mode-enabled while signed out → Returns true (privacy mode on by default) | `source/electron-main/account/cursor-auth-wiring.ts:171` |
| medium | avatar | User picks an avatar source larger than 25 MB → Rejected with 'Choose an image smaller than 25 MB.' | `source/electron-main/media/avatar-images.ts:10` |
| medium | notifications | An agent transitions to needs-input while window unfocused → Shows a critical OS notification | `source/electron-main/notifications/os-notification-manager.ts:83` |
| medium | notifications | An agent finishes (agent-done) while window unfocused → Shows a silent OS notification | `source/electron-main/notifications/os-notification-manager.ts:83` |
| medium | notifications | User clicks an agent OS notification → Restores/shows/focuses the window and opens the agent | `source/electron-main/notifications/os-notification-manager.ts:90` |
| medium | dock-badge | Agents have unread messages → Dock badge count is set to the sum of unread counts (min 1 each) | `source/electron-main/notifications/dock-badge.ts:7` |
| medium | box | User resets the Computer (force recreate) with no backend connection → Returns rejected 'Reset Grok Bot's Computer is unavailable without a backend connection.' | `source/electron-main/box/box-recreate-commands.ts:9` |
| medium | box | Backend refuses a computer recreate/update → Throws 'Couldn't update/reset the computer… It is unchanged.' | `source/electron-main/box/box-host-connector.ts:104` |
| medium | box | The box connection is blocked by the backend → connect() throws a blocked error carrying the block title/detail and holds for retry-after | `source/electron-main/box/box-host-connector.ts:87` |
| medium | box | Box connect returns Unauthenticated/PermissionDenied → Throws the gateway access-denied message marker | `source/electron-main/box/box-host-connector.ts:93` |
| medium | box | Box connect indicates cloud-agent storage disabled → Throws the no-storage message marker | `source/electron-main/box/box-host-connector.ts:86` |
| medium | box | The sand_client_pause feature gate is on and a box connect/recreate is attempted → Refused with SandClientPausedError (client pause blocked message) | `source/electron-main/box/box-client-pause.ts:23` |
| medium | box | Local Docker runtime selected but Docker is not running/installed → Status returns available:false with detail 'Docker is not running.'/'Docker is not installed.' | `source/electron-main/box/local-docker-host-connector.ts:106` |
| medium | box | Local Docker container name exists but is not owned by Grok Bot → Status detail 'Container grok-bot-local-vm exists but is not owned by Grok Bot.' | `source/electron-main/box/local-docker-host-connector.ts:109` |
| medium | box | Local Docker VM is running and its gateway is healthy → Status ready:true with detail 'Local Docker VM is ready.' | `source/electron-main/box/local-docker-host-connector.ts:111` |
| medium | box | Recreate the computer while on local-docker runtime → Restarts the local VM container and reconnects (started-untrackable) | `source/electron-main/box/local-docker-host-connector.ts:253` |
| medium | box | Force-reset the computer while on local-docker runtime → Force-removes and recreates the local VM container | `source/electron-main/box/local-docker-host-connector.ts:263` |
| medium | box | Stop an unowned local Docker container → Throws 'Refusing to stop unowned container grok-bot-local-vm.' | `source/electron-main/box/local-docker-host-connector.ts:225` |
| medium | update | Windows installer signature is invalid or not from allowlisted signer → Staging throws a signature verification error and the update is discarded | `source/electron-main/update/win32-installer.ts:18` |
| medium | startup | Packaged macOS app launched from outside Applications → Shows dialog 'Move Grok Bot to the Applications folder?' with Move/Not Now | `source/electron-main/startup/startup-move-check.ts:70` |
| medium | coordinator | The coordinator utility process exits unexpectedly → Automatically relaunches the coordinator with backoff so the connection recovers | `source/electron-main/coordinator/coordinator-runtime.ts:148` |
| medium | coordinator | User/host requests a coordinator restart → Launches a fresh coordinator and disposes the previous one | `source/electron-main/coordinator/coordinator-runtime.ts:209` |
| medium | coordinator | Host is not bound to the signed-in account during coordinator start → Coordinator kept unavailable and the refused account credentials are revoked | `source/electron-main/coordinator/coordinator-account-runtime.ts:221` |
| low | secrets | Client-persistence write with a non-string key or value → Throws 'client persistence: write needs a string key and value' | `source/electron-main/secrets/secrets-ipc.ts:149` |
| low | secrets | Client-persistence read/write/remove/listKeys/migrate from app window → Reads/writes/removes/lists/migrates namespaced client-persistence entries | `source/electron-main/secrets/secrets-ipc.ts:143` |
| low | mcp | Renderer invokes sand:mcp-plugin-logo with a url → Returns the resolved plugin logo (null if url not a string) | `source/electron-main/mcp/mcp-desktop.ts:9` |
| low | settings | Renderer reads sand:egress-tunnel-get-sync → Returns whether the egress tunnel is enabled | `source/electron-main/prefs/settings-ipc.ts:2` |
| low | settings | Renderer reads sand:egress-tunnel-status-get-sync → Returns the current egress tunnel status | `source/electron-main/prefs/settings-ipc.ts:2` |
| low | experiments | Renderer reads sand:experiments-snapshot-sync → Returns the current experiments snapshot (null if service not up) | `source/electron-main/experiments/experiments-ipc.ts:2` |
| low | experiments | Experiment snapshot changes → Emits experiments-changed to the renderer with the new snapshot | `source/electron-main/adapters/experiments.ts:50` |
| low | theme | OS theme changes while preference is 'system' → Broadcasts updated resolved theme state to the renderer | `source/electron-main/prefs/theme-controller.ts:59` |
| low | theme | Window is created under resolved dark vs light theme → Window background painted #0B0B0B (dark) or #FCFCFC (light) | `source/electron-main/prefs/theme-controller.ts:16` |
| low | vnc | Trusted VNC webview calls reportUserPresence → Host is notified of the user presence boolean | `source/electron-main/vnc/vnc-edge.ts:3` |
| low | vnc | A box-VNC page/asset request returns HTTP >=400 the first time for a host → Reports an asset failure with token info and resource type | `source/electron-main/vnc/vnc-trust.ts:16` |
| low | webauthn | User presses Enter on the security-key consent prompt → Triggers Approve (same as clicking Approve) | `source/electron-main/coordinator/coordinator-executors.ts:321` |
| low | webauthn | User presses Escape on the security-key consent prompt → Consent is denied | `source/electron-main/coordinator/coordinator-executors.ts:325` |
| low | webauthn | User submits an empty PIN → Submit is ignored (does not spend a key attempt) | `source/electron-main/coordinator/coordinator-executors.ts:303` |
| low | webauthn | User clicks Cancel on the PIN prompt → PIN resolves null and shows 'Cancelling…' | `source/electron-main/coordinator/coordinator-executors.ts:307` |
| low | webauthn | Coordinator pushes a status update during the ceremony → Prompt working-state text is updated live via __sandStatus | `source/electron-main/coordinator/coordinator-executors.ts:350` |
| low | attachments | Renderer resolves media for an unsupported/invalid source → Returns null | `source/electron-main/attachments/attachments.ts:79` |
| low | attachments | User cancels the Save dialog during attachment download → Returns false, nothing saved | `source/electron-main/attachments/attachments.ts:104` |
| low | media | User clicks 'Save image…' and cancels the dialog → Nothing is saved | `source/electron-main/media/avatar-images.ts:121` |
| low | media | Context menu opened on non-editable selected text → Shows a single 'Copy' item | `source/electron-main/media/avatar-images.ts:157` |
| low | media | Context menu built with no applicable sections → Menu has zero items and is not shown | `source/electron-main/media/avatar-images.ts:170` |
| low | media | Renderer requests sand-media:// for a local media file without Range → Serves a full 200 media response | `source/electron-main/media/media-protocol.ts:60` |
| low | media | Renderer requests sand-media:// with a Range beyond the file size → Returns 416 with accept-ranges and content-range headers | `source/electron-main/media/media-protocol.ts:48` |
| low | media | Renderer requests sand-media:// for a missing/non-media path → Returns 404 (or 400 for an unparseable URL) | `source/electron-main/media/media-protocol.ts:63` |
| low | account | User updates account name longer than 200 chars → Throws 'updateCursorAccountName requires a bounded name string.' | `source/electron-main/account/cursor-auth-wiring.ts:164` |
| low | account | Renderer requests usage summary but the usage-page gate is off → Returns null (usage page unavailable) | `source/electron-main/account/cursor-auth-wiring.ts:169` |
| low | account | Renderer invokes a dashboard action that is unsupported → Returns {ok:false, message:"This action isn't supported by this version of Grok Bot"} | `source/electron-main/account/cursor-auth-wiring.ts:175` |
| low | account | Renderer invokes a dashboard action / cancel-trial while signed out → Returns {ok:false, message:'Sign in to Cursor to continue'} | `source/electron-main/account/cursor-auth-wiring.ts:176` |
| low | account | Renderer requests PR-review preferences while signed in → Returns user and team PR-review open destinations | `source/electron-main/account/cursor-auth-wiring.ts:170` |
| low | account | Dev-login invoked against a non-dev backend → Throws refusing dev-login against a non-dev backend | `source/electron-main/account/cursor-auth.ts:310` |
| low | avatar | User selects a file that is not a valid image → Throws AvatarInputError 'Selected file is not a valid image.' | `source/electron-main/media/avatar-images.ts:17` |
| low | avatar | User requests avatar generation with an empty description → Throws AvatarInputError 'Describe the avatar to generate first.' | `source/electron-main/media/avatar-images.ts:17` |
| low | notifications | Agent events arrive while the window is focused → No notification is shown for focused-window transitions | `source/electron-main/notifications/os-notification-manager.ts:41` |
| low | notifications | OS notifications are unsupported on this platform → No notifications shown; deltas only observed silently | `source/electron-main/notifications/os-notification-manager.ts:39` |
| low | dock-badge | An unread agent is hidden from the sidebar → That agent is excluded from the dock badge total | `source/electron-main/notifications/dock-badge.ts:11` |
| low | dock-badge | Dock badge manager is reset → Badge count cleared to 0 | `source/electron-main/notifications/dock-badge-manager.ts:53` |
| low | box | Local Docker VM container does not yet exist → Status detail 'Ready to create the local VM.' | `source/electron-main/box/local-docker-host-connector.ts:108` |
| low | box | Local Docker VM container running but gateway not yet healthy → Status detail 'Container is starting.' | `source/electron-main/box/local-docker-host-connector.ts:111` |
| low | box | Local Docker VM container exists but is stopped → Status detail 'Local Docker VM is stopped.' | `source/electron-main/box/local-docker-host-connector.ts:111` |
| low | box | Start local Docker VM but the runtime bundle is missing → Throws refusing to start a stock local VM | `source/electron-main/box/local-docker-host-connector.ts:127` |
| low | box | Local Docker VM never exposes its gateway within 3 minutes → Throws 'Local Docker VM did not expose its gateway within three minutes.' | `source/electron-main/box/local-docker-host-connector.ts:215` |
| low | update | User triggers quitAndInstall while no update is ready → Returns false, nothing happens | `source/electron-main/update/sand-update-service.ts:70` |
| low | update | Update is disabled (env/lab-build/unpackaged/unsupported platform) → State is 'disabled' with the specific reason and no checks run | `source/electron-main/update/update-gate.ts:2` |
| low | update | Squirrel does not finish staging within the timeout → State returns to idle with an error lastCheck (retry next check) | `source/electron-main/update/sand-update-service.ts:84` |
| low | startup | User confirms 'Move to Applications' → App moves to Applications and stops the current bootstrap (relaunches from new location) | `source/electron-main/startup/move-to-applications-folder.ts:23` |
| low | startup | User chooses 'Not Now' on the move dialog → Bootstrap continues from the current location | `source/electron-main/startup/move-to-applications-folder.ts:22` |
| low | startup | Move to Applications fails → Shows error dialog 'Grok Bot couldn't move to Applications' and continues | `source/electron-main/startup/startup-move-check.ts:83` |
| low | startup | An idle legacy daemon is detected at startup and can be retired → Terminates it and relaunches this instance cleanly | `source/electron-main/startup/legacy-daemon-retirement.ts:4` |
| low | startup | Isolated user-data dir specified via argv/env → App user-data and session-data paths set to the isolated dir | `source/electron-main/startup/desktop-user-data-bootstrap.ts:48` |
| low | feedback | User submits feedback with an empty/too-long/invalid message → Returns {ok:false, code:'invalid-feedback'} | `source/electron-main/feedback/feedback-report.ts:4` |
| low | feedback | User submits feedback while signed out or with mismatched account → Returns {ok:false, code:'not-signed-in'} | `source/electron-main/feedback/feedback-report.ts:6` |
| low | feedback | Feedback backend responds 402/403/429 → Returns code subscription-required / access-denied / rate-limited respectively | `source/electron-main/feedback/feedback-report.ts:6` |
| low | feedback | Feedback backend is unreachable or errors otherwise → Returns {ok:false, code:'unavailable'} | `source/electron-main/feedback/feedback-report.ts:6` |
| low | auth | Packaged non-lab app starts up → Registers the app as the default protocol client for the sand: deep-link scheme | `source/electron-main/auth/auth-callback-registration.ts:56` |
| low | onepassword | Dev control runs 1Password CLI inspection → Returns CLI readiness (platform supported, selected candidate, detail) | `source/electron-main/onepassword/onepassword-cli-dev-controls.ts:13` |
| low | onepassword | Dev control prepares the managed 1Password CLI while already running → Returns unavailable 'Managed 1Password CLI preparation is already running' | `source/electron-main/onepassword/onepassword-cli-dev-controls.ts:13` |
| low | onepassword | Dev control cancels an in-progress managed-CLI preparation → Aborts the preparation controller | `source/electron-main/onepassword/onepassword-cli-dev-controls.ts:13` |
| low | onepassword | 1Password provisioning attempted while sink is unavailable → Throws sink-unavailable '1Password provisioning is unavailable until a credential consumer is configured.' | `source/electron-main/onepassword/onepassword-provisioning-contract.ts:21` |
| low | onepassword | 1Password authorization prompt is dismissed by the user → Classified as a 'denied' provisioning error 'The request was not approved in the 1Password desktop app.' | `source/electron-main/onepassword/onepassword-op-executor.ts:12` |
| low | onepassword | Managed 1Password CLI download URL is not vendor-owned → Throws SandOnePasswordCliError 'The 1Password CLI download URL is not vendor-owned.' | `source/electron-main/onepassword/onepassword-cli-runtime.ts:53` |
| low | coordinator | Renderer requests the coordinator message port via sand:coordinator-port-request → Posts the coordinator port to the trusted renderer over sand:coordinator-port | `source/electron-main/coordinator/production-provider.ts:625` |
| low | coordinator | An untrusted frame requests the coordinator port → Rejected by assertTrustedCoordinatorPortRequester (no port handed out) | `source/electron-main/coordinator/production-provider.ts:627` |
| low | coordinator | Coordinator sends an unknown control command → Replies with failure code 'main-unknown-command' | `source/electron-main/coordinator/coordinator-control-server.ts:6` |
| low | coordinator | Coordinator posts a malformed/out-of-order control frame → Protocol breach: posts shutdown and settles the session as protocol-error | `source/electron-main/coordinator/coordinator-control-server.ts:5` |
| low | coordinator | Signed-in account switches to a different account → Stops the old coordinator, resets account state, and starts one for the new account | `source/electron-main/coordinator/coordinator-account-runtime.ts:289` |
| low | coordinator | Box transport connects → Runs host-settings resync (timezone, notifications, model, MCP merge, secrets, focus) and flushes telemetry | `source/electron-main/coordinator/coordinator-resync.ts:7` |
| low | local-exec | Coordinator requests a local-exec daemon spawn → Spawns and returns a verified process identity for the daemon | `source/electron-main/coordinator/coordinator-executors.ts:482` |
| low | local-exec | Coordinator requests termination of a local-exec process it does not own → Returns {terminated:false} without killing anything | `source/electron-main/coordinator/coordinator-executors.ts:519` |
| low | egress-tunnel | Box connection info changes while tunnel enabled → Reconfigures the egress tunnel with the new box connection | `source/electron-main/box/egress-tunnel-wiring.ts:47` |

## Grok/워커 에이전트 도구 · runner (브라우저/컴퓨터/파일/봇/서브에이전트/MCP/셸/read/meta/dynamic)  (누락 139건, 추출 205 / 매칭 66)
- 표면 판정: ~32% (66/205): the ledger captures the happy-path tool capabilities (navigate/click/type/screenshot, copy in/out, create/update agent, MCP add/remove/auth/status/instructions, subagent check/message/stop, send message, react, memory/routine/workflow writes, box-help, secret submit) but systematically misses six whole themes — per-tool validation/error cases, the entire auto-review RUNTIME (browser/computer/mcp/automation/cloud-agent/shell classification + approval-card + controller TTL/limit/expiry lifecycle), SendMessage message-type variants (attachment/widget/cursor-agent/secret-request + options), subagent-runtime completion/error/steer + browserUse/computerUse delegation, the shell tool and its background execution, and runner plumbing (stream-retry, turn-run edges, box-readiness errors, toolset gating, reminders, navigation-audit, bot-block-detection, large-output spill, reference docs).

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | computer-tool | Computer with a 'then' batch of follow-up actions → runs up to 9 follow-up actions in sequence in one call — a distinct batching capability with no ledger row | `source/host/runner/tools/sand-computer-tool.ts:79` |
| high | browser-subagent | delegate a web task via Task with subagent_type browserUse → a background subagent drives the box browser at the page level and reports when done — a distinct delegation capability, not just generic SUB-001 | `source/host/runner/tools/sand-browser-use-subagent.ts:4` |
| high | computer-subagent | delegate a desktop task via Task with subagent_type computerUse → a background subagent drives the box desktop by screenshot/click/type and reports when done — distinct delegation capability | `source/host/runner/tools/sand-computer-use-subagent.ts:7` |
| high | send-message | SendMessage type=attachment with a url → the file/media is sent as a standalone attachment — a distinct message type with no ledger row (TOOL-003 is generic text) | `source/host/runner/tools/send-message-tool.ts:47` |
| high | send-message | SendMessage type=widget → an interactive question card with 1-6 selectable options is shown and the turn ends; ledger has only the user-side respond/dismiss (PERM-006/007), not the agent sending it | `source/host/runner/tools/send-message-tool.ts:42` |
| high | send-message | SendMessage with a channel address (text/attachment) → delivered to the connected messaging channel instead of the in-app chat | `source/host/runner/tools/send-message-schema.ts:43` |
| high | background-shell | a backgrounded shell command completes → its completion (success/error with exit code) wakes the agent — the shell tool + background execution capability is absent from the ledger | `source/host/runner/shell-terminal-watch.ts:210` |
| medium | browser-tool | browser_navigate with no url → validation fails with 'url is required' and nothing navigates | `source/host/runner/tools/sand-browser-tools.ts:573` |
| medium | browser-tool | browser_click with no ref → validation fails with 'ref is required' | `source/host/runner/tools/sand-browser-tools.ts:554` |
| medium | browser-tool | browser_mouse_click_xy missing x or y → validation fails with 'x is required'/'y is required' | `source/host/runner/tools/sand-browser-tools.ts:573` |
| medium | browser-tool | browser_drag with no sourceRef → validation fails with 'sourceRef is required' | `source/host/runner/tools/sand-browser-tools.ts:561` |
| medium | browser-tool | browser_cdp using an Input.* or browser-wide/storage/cookie/target command → the command is denied (dedicated tools must be used instead); ledger BROWSER-013 covers only the allowed-execution path, not the denial | `source/host/runner/tools/sand-browser-tools.ts:564` |
| medium | browser-tool | browser_tabs with an action outside the enum → validation fails with 'action must be one of list, new, close, select' (BROWSER-014 also omits the 'new' create sub-action) | `source/host/runner/tools/sand-browser-tools.ts:578` |
| medium | browser-tool | any browser action when the box has not assigned a window yet → error 'The box has not assigned this agent a browser window yet; try again in a moment' | `source/host/runner/tools/sand-browser-tools.ts:212` |
| medium | browser-tool | browser driver fails to install on the box → error 'Could not install the browser driver on the box: ...' | `source/host/runner/tools/sand-browser-tools.ts:237` |
| medium | browser-tool | a browser action that returns ok:false from the driver → the tool result is marked isError with the driver's error text | `source/host/runner/tools/sand-browser-tools.ts:299` |
| medium | browser-auto-review | browser_click/mouse_click_xy/drag in enforce mode without an element description → blocked: 'Browser click and drag actions require an element field...' | `source/host/runner/sand-browser-auto-review.ts:91` |
| medium | browser-auto-review | a mutating browser action classified as risky in enforce mode → an approval card with a human summary is shown and the action waits on the user; ledger PERM-004/005 cover only the generic approve/deny resolve, not the per-surface trigger/card | `source/host/runner/sand-browser-auto-review.ts:117` |
| medium | browser-auto-review | user denies (or approval times out on) a blocked browser action → error with the denial reason; action does not run | `source/host/runner/sand-browser-auto-review.ts:133` |
| medium | browser-auto-review | page changes between review and execution of a browser action → blocked: 'The page changed after review; take a fresh browser_snapshot and retry' | `source/host/runner/sand-browser-auto-review.ts:94` |
| medium | browser-auto-review | a browser action arg exceeds size caps (url/text/value/key/params 2000/256) → blocked: 'Browser Auto-review rejected oversized <field>' | `source/host/runner/sand-browser-auto-review.ts:18` |
| medium | computer-tool | Computer action=drag missing coords and path → validation error 'Drag requires x, y, x2, and y2 or a path with at least 2 points' | `source/host/runner/tools/sand-computer-tool.ts:62` |
| medium | computer-tool | Computer action=wait with durationMs → waits the given ms (capped at 30000); not covered by COMPUTER-002's mouse/keyboard scope | `source/host/runner/tools/sand-computer-tool.ts:132` |
| medium | computer-tool | Computer click/drag in enforce mode with no description → validation error requiring a concise description of the intended UI target | `source/host/runner/tools/sand-computer-tool.ts:83` |
| medium | computer-tool | Computer 'then' batch in enforce mode → only reviewable (non-mutating-bypass) follow-up actions are accepted in the batch | `source/host/runner/tools/sand-computer-tool.ts:76` |
| medium | computer-tool | a Computer action returns an executor error → result reads 'Computer action failed: <error>' | `source/host/runner/tools/sand-computer-tool.ts:172` |
| medium | computer-auto-review | a mutating computer action classified risky in enforce mode → approval card with a summary of the click/drag/type/key is shown and waits on the user | `source/host/runner/sand-computer-auto-review.ts:167` |
| medium | computer-auto-review | user denies a blocked computer action → blocked with the denial reason; action never runs | `source/host/runner/sand-computer-auto-review.ts:172` |
| medium | computer-auto-review | box display state changes between review and execution → blocked: 'The page changed after review; inspect the latest screenshot and retry' | `source/host/runner/sand-computer-auto-review.ts:156` |
| medium | computer-auto-review | computer action text/key/path exceeds caps (2000/256/64) → blocked: 'Computer Auto-review rejected oversized <field>' | `source/host/runner/sand-computer-auto-review.ts:44` |
| medium | computer-auto-review | no box monitor/display available during computer review → blocked with the 'every desktop monitor is in use' message | `source/host/runner/sand-computer-auto-review.ts:205` |
| medium | file-transfer | CopyToBox with no computer connected → error 'No computer is connected right now...' | `source/host/runner/tools/sand-file-transfer-tools.ts:78` |
| medium | file-transfer | CopyToBox with an unknown computer id → error 'Unknown computer "id". Connected computers: ...' | `source/host/runner/tools/sand-file-transfer-tools.ts:83` |
| medium | file-transfer | CopyToBox/CopyFromBox while the box is still preparing → error 'The computer is still starting up...' | `source/host/runner/tools/sand-file-transfer-tools.ts:89` |
| medium | agent-messaging | SendToAgent with images → a 1:1 recipient receives the images with the message (groups are text-only) | `source/host/runner/tools/sand-agent-management-tools.ts:52` |
| medium | agent-messaging | SendToAgent targeting your own agent id → refused: 'You can't message yourself with SendToAgent...' | `source/host/runner/tools/sand-agent-management-tools.ts:112` |
| medium | agent-messaging | SendToAgent with an image url lacking file:// or https:// → validation error 'each images url must include a file:// or https:// scheme' | `source/host/runner/tools/sand-agent-management-tools.ts:60` |
| medium | agent-management | UpdateAgent with neither name nor description → 'Nothing to update: provide a new name and/or description.' | `source/host/runner/tools/sand-agent-management-tools.ts:161` |
| medium | agent-management | UpdateAgent with an unknown agent id → 'No agent found with id <id>.' | `source/host/runner/tools/sand-agent-management-tools.ts:165` |
| medium | mcp-management | GetPlugin with an unknown id → 'No plugin with id "id".' | `source/host/runner/tools/sand-mcp-management-tools.ts:327` |
| medium | mcp-management | InstallPlugin where a connector needs auth → a connect card is emitted automatically into the chat | `source/host/runner/tools/sand-mcp-management-tools.ts:338` |
| medium | mcp-management | any MCP mutation while a question widget is awaiting the user's selection → blocked with the 'this turn is waiting on the user's selection' message | `source/host/runner/tools/sand-mcp-management-tools.ts:240` |
| medium | mcp-management | AddMcpServer with an invalid or non-http(s) url → validation message asking for a valid https endpoint | `source/host/runner/tools/sand-mcp-management-tools.ts:146` |
| medium | mcp-management | AddMcpServer with credentials embedded in the url → refused: pass them as headers instead so they aren't stored in plaintext | `source/host/runner/tools/sand-mcp-management-tools.ts:149` |
| medium | mcp-management | UninstallMcpServer on a plugin-owned server → refused: '...use UninstallPlugin.' | `source/host/runner/tools/sand-mcp-management-tools.ts:361` |
| medium | mcp-management | UninstallMcpServer on a team-provided server → refused: '...provided by the user's team, so it can't be removed here.' | `source/host/runner/tools/sand-mcp-management-tools.ts:362` |
| medium | mcp-management | UninstallMcpServer with an unknown server id → 'No installed MCP server "token". Run GetMcpServerStatus...' | `source/host/runner/tools/sand-mcp-management-tools.ts:360` |
| medium | mcp-management | UninstallPlugin on a team-required plugin → refused: '...required by the user's team and cannot be uninstalled.' | `source/host/runner/tools/sand-mcp-management-tools.ts:374` |
| medium | mcp-management | AuthenticateMcpServer with force_reauth on an authed server → signs the server out and starts a fresh sign-in with a new connect card | `source/host/runner/tools/sand-mcp-management-tools.ts:260` |
| medium | mcp-management | AuthenticateMcpServer whose check is unreachable → reports the server's error and warns Settings would hit the same failure | `source/host/runner/tools/sand-mcp-management-tools.ts:268` |
| medium | mcp-auto-review | a risky MCP tool call in enforce mode → an approval card summarizing the server/tool/args is raised (secrets redacted) | `source/host/runner/sand-auto-review-tool-escalations.ts:88` |
| medium | subagent-management | MessageSubagent on a subagent that is not running → the not-running message is returned | `source/host/runner/tools/sand-subagent-management-tools.ts:125` |
| medium | subagent-management | MessageSubagent when reviewSteer blocks the steer → the review's reason is returned and nothing is injected | `source/host/runner/tools/sand-subagent-management-tools.ts:116` |
| medium | subagent-management | StopSubagent on a subagent not running → the not-running message is returned | `source/host/runner/tools/sand-subagent-management-tools.ts:136` |
| medium | subagent-runtime | a background subagent (Task) finishes with output → the parent is revived with the subagent's trimmed result text (SUB-001 covers start only, not completion→parent) | `source/host/runner/subagent-runtime.ts:382` |
| medium | subagent-runtime | a background subagent throws an error → the parent is revived with the error message as the result | `source/host/runner/subagent-runtime.ts:388` |
| medium | subagent-runtime | a steer arrives while a subagent turn is finishing → the subagent restarts with the steer prompt prepended instead of settling | `source/host/runner/subagent-runtime.ts:283` |
| medium | computer-subagent | dispatch a second computerUse subagent while one is running → disallowed — only one can run at a time because they share the single screen | `source/host/runner/tools/sand-computer-use-subagent.ts:18` |
| medium | send-message | SendMessage type=text with images → images render inside the same chat bubble below the text (one full-width, several as a gallery) | `source/host/runner/tools/send-message-schema.ts:40` |
| medium | send-message | SendMessage type=cursor-agent with a bcId → a clickable card referencing the Cursor cloud agent is shown | `source/host/runner/tools/send-message-tool.ts:43` |
| medium | send-message | SendMessage type=secret-request → a masked secure input is shown; value goes straight to the connector, turn ends | `source/host/runner/tools/send-message-tool.ts:44` |
| medium | send-message | SendMessage with reply_to set → the message threads to the referenced earlier message (agent-side; CHAT-017 is the user-side reply preview) | `source/host/runner/tools/send-message-schema.ts:42` |
| medium | send-message | SendMessage while the turn is already awaiting the user → blocked: message not delivered until the user responds | `source/host/runner/tools/send-message-tool.ts:18` |
| medium | send-message | SendMessage type=text with no content → validation error 'content is required when type is text' | `source/host/runner/tools/send-message-schema.ts:25` |
| medium | send-message | SendMessage type=attachment with no or invalid url → validation error requiring a file:// or https:// url | `source/host/runner/tools/send-message-schema.ts:28` |
| medium | send-message | widget with allowCustom:true → the user can type a free-text answer instead of picking an option | `source/host/runner/tools/send-message-schema.ts:44` |
| medium | send-message | widget with dismissOnMoveOn:true → the question auto-dismisses if the user sends a newer message without answering | `source/host/runner/tools/send-message-schema.ts:44` |
| medium | reaction | ReactToMessage with an invalid message address → '"address" isn't a valid message address...' | `source/host/runner/tools/sand-reaction-tool.ts:35` |
| medium | update-state | update_state routine.create/update passing both schedule and trigger → error: 'pass either schedule or trigger, never both' | `source/host/runner/tools/sand-state-tool.ts:208` |
| medium | update-state | update_state routine.update with an id that doesn't exist → error: 'no routine with folder "id" exists...' | `source/host/runner/tools/sand-state-tool.ts:236` |
| medium | update-state | saving a routine whose trigger platform isn't connected → a listener-connect card is shown and a note says it won't fire until connected | `source/host/runner/tools/listener-connect-cards.ts:38` |
| medium | update-state | update_state routine.create/update classified risky in enforce mode → a confirmation card is shown and the tool result carries the user's answer | `source/host/runner/tools/sand-state-tool.ts:243` |
| medium | update-state | update_state profile.set (name/description) → the agent's own profile name/description changes (ledger has ORCH-006 guard only, no positive self-profile-set row) | `source/host/runner/tools/sand-state-tool.ts:297` |
| medium | update-state | update_state project.create/join/leave → creates and joins / joins / leaves the named project — no project capability row in the ledger | `source/host/runner/tools/sand-state-tool.ts:300` |
| medium | update-state | update_state while an auto-review approval is pending → blocked by assertNoPendingAutoReviewApproval before applying | `source/host/runner/tools/sand-state-tool.ts:331` |
| medium | automation-auto-review | a routine write classified risky in enforce mode → an approval card summarizing the routine's name/trigger/prompt is shown | `source/host/runner/sand-automation-auto-review.ts:114` |
| medium | box-help | request_box_help while a prior hand-off is still pending → not sent: 'The user still has the box... Do not ask again.' | `source/host/runner/tools/box-help-tool.ts:102` |
| medium | cloud-agent-review | cloud agent launch/reply classified risky in enforce mode → an approval card summarizing the launch/follow-up is shown (ledger CLOUD-001 reads info only, no lifecycle rows) | `source/host/runner/sand-cloud-agent-auto-review.ts:177` |
| medium | cloud-agent-review | cloud agent delete in enforce mode → approval required: 'Deleting a cloud agent is permanent and cannot be undone' | `source/host/runner/sand-cloud-agent-auto-review.ts:257` |
| medium | cloud-agent-review | cloud agent cancel/archive/unarchive/rename in enforce mode → an approval card with the lifecycle-specific reason is shown | `source/host/runner/sand-cloud-agent-auto-review.ts:270` |
| medium | cloud-agent-review | a lifecycle action needing approval where approvals aren't available → blocked: 'this action needs Auto-review approval, which isn't available in this conversation' | `source/host/runner/sand-cloud-agent-auto-review.ts:282` |
| medium | auto-review-controller | an approval sits unanswered past the 10-minute TTL → it auto-expires and the action is denied with the block reason | `source/host/runner/sand-auto-review.ts:133` |
| medium | auto-review-controller | a 5th approval is requested for one agent → denied: 'Too many actions are already waiting for Auto-review approval' | `source/host/runner/sand-auto-review.ts:118` |
| medium | auto-review-controller | the user sends a new message while approvals are pending → pending approvals are expired (user_redirect) and denied | `source/host/runner/sand-auto-review.ts:160` |
| medium | auto-review-controller | a host update interrupts a pending approval → denied with 'A host update interrupted this approval... the user did NOT deny it' | `source/host/runner/sand-auto-review.ts:75` |
| medium | auto-review-controller | an auto-review surface changes to non-enforce → pending approvals on that surface expire with 'Auto-review settings changed; retry' | `source/host/runner/auto-review-gate.ts:43` |
| medium | auto-review-controller | a second side effect starts while an approval is pending → blocked: 'Another action is waiting for Auto-review approval; no new side effect may start yet' | `source/host/runner/auto-review-gate.ts:48` |
| medium | auto-review-controller | a blocked action is denied → the model is told not to retry or route around it via another public file host/pastebin | `source/host/runner/sand-auto-review.ts:71` |
| medium | shell-auto-review | a shell command classified risky in enforce mode → an approval card describing the command and location (local vs Grok Bot's computer) is shown — implies a shell tool the ledger has no row for | `source/host/runner/sand-auto-review-tool-escalations.ts:38` |
| medium | background-shell | a watched background command still runs after ~5 hours → settles with 'The command is still running... check its output file for the result' | `source/host/runner/shell-terminal-watch.ts:246` |
| medium | background-cloud | a watched cloud agent completes → its result text (or '(finished without producing any output)') wakes the agent | `source/host/runner/background-work.ts:48` |
| medium | stream-retry | a transient network/provider error mid-turn (before output or with a resume checkpoint) → the turn retries with backoff and a 'retrying' indicator is emitted | `source/host/runner/stream-attempt.ts:70` |
| medium | box-readiness | a box tool runs while the box is still starting → error 'The computer is still starting up (downloading its image or booting)...' | `source/host/runner/remote-box-resources.ts:107` |
| medium | box-readiness | a box tool runs while the box daemon is wedged/unreachable → error 'The computer isn't responding — it may be wedged...' | `source/host/runner/remote-box-resources.ts:119` |
| medium | box-readiness | a computer/monitor action when every desktop monitor is in use → error 'Every desktop monitor on the shared computer is in use right now...' | `source/host/runner/remote-box-resources.ts:252` |
| medium | toolset | a tool call exceeds its execution timeout → a ToolCallExecutionTimeoutError is returned for that tool | `source/host/runner/tools/turn-toolset.ts:1520` |
| medium | large-output | an MCP/shell tool produces text over the file-output threshold → the output is spilled to a box file (capped at 1MB) and referenced by path | `source/host/runner/large-output-spill.ts:23` |
| low | browser-tool | browser_navigate with newTab:true → the URL opens in a new tab instead of the current one | `source/host/runner/tools/sand-browser-tools.ts:552` |
| low | browser-tool | a browser action returns a screenshot → the result renders as an image; without an image it renders as text | `source/host/runner/tools/sand-browser-tools.ts:644` |
| low | browser-tool | navigating action succeeds → an onPossibleNavigation hook fires to trigger navigation audit/probe | `source/host/runner/tools/sand-browser-tools.ts:633` |
| low | browser-auto-review | a non-mutating browser op (snapshot/screenshot/bounding_box/highlight/scroll) → skips auto-review entirely and runs | `source/host/runner/sand-browser-auto-review.ts:14` |
| low | browser-auto-review | a mutating browser action in shadow mode → classifier runs in the background and the action always proceeds | `source/host/runner/sand-browser-auto-review.ts:109` |
| low | computer-tool | any Computer call whose sequence does not end in screenshot → a trailing screenshot is appended automatically so the model sees the result | `source/host/runner/tools/sand-computer-tool.ts:258` |
| low | computer-tool | unicode typing enabled and a type action runs → bindUnmappedCharacters is set so non-ASCII characters can be typed | `source/host/runner/tools/sand-computer-tool.ts:285` |
| low | computer-auto-review | a bypass computer action (screenshot/move/wait/scroll) → auto-review is skipped and the action runs | `source/host/runner/sand-computer-auto-review.ts:19` |
| low | file-transfer | a transferred file is under 1KB vs larger → the reported size renders as bytes vs KB/MB/GB | `source/host/runner/tools/sand-file-transfer-tools.ts:56` |
| low | mcp-management | SearchPlugins with no query → lists the whole plugin catalog sorted by name | `source/host/runner/tools/sand-mcp-management-tools.ts:319` |
| low | mcp-management | SearchPlugins with a non-matching query → 'No plugins match "query".' | `source/host/runner/tools/sand-mcp-management-tools.ts:319` |
| low | mcp-management | UninstallPlugin on a plugin not installed → '... is not installed — nothing to uninstall.' | `source/host/runner/tools/sand-mcp-management-tools.ts:373` |
| low | mcp-management | SetMcpInstructions with an empty string → custom instructions are cleared back to the connector default | `source/host/runner/tools/sand-mcp-management-tools.ts:395` |
| low | mcp-management | AuthenticateMcpServer on an already-authenticated server → a 'already authenticated and connected' confirmation card is shown | `source/host/runner/tools/sand-mcp-management-tools.ts:263` |
| low | mcp-management | multi-account disabled → RemoveMcpAccount/RenameMcpAccount tools are not offered at all | `source/host/runner/tools/sand-mcp-management-tools.ts:416` |
| low | subagent-runtime | a background subagent finishes producing no text → result reads '(the task finished without producing any text output)' | `source/host/runner/subagent-runtime.ts:385` |
| low | subagent-runtime | a stopped subagent settles → no completion is reported and its pending wake is disarmed | `source/host/runner/subagent-runtime.ts:364` |
| low | computer-subagent | only one desktop window/monitor free when allocating for a subagent → window allocation returns null so a second subagent cannot get its own screen | `source/host/runner/computer-use.ts:88` |
| low | send-message | SendMessage carrying a field that doesn't match its type (e.g. widget on text) → validation error: nothing sent, re-send as separate typed messages | `source/host/runner/tools/send-message-schema.ts:21` |
| low | send-message | SendMessage with images on a non-text type → validation error: images can only be set for type:text | `source/host/runner/tools/send-message-schema.ts:23` |
| low | send-message | a successful SendMessage → returns 'Message sent to user' with the message id | `source/host/runner/tools/send-message-tool.ts:123` |
| low | update-state | update_state avatar.clear → the agent's picture reverts to the default (BOT-008 covers set only) | `source/host/runner/tools/sand-state-tool.ts:304` |
| low | update-state | update_state with a target/action pair that isn't a valid route → error listing the valid actions for that target | `source/host/runner/tools/sand-state-tool.ts:287` |
| low | box-help | request_box_help with reason/domain/idp_domain → the sign-in step is classified (auth/captcha/payment) with normalized destination/IdP hosts | `source/host/runner/tools/box-help-tool.ts:10` |
| low | reminder | 6+ non-SendMessage tool calls without a SendMessage → a system reminder is injected telling the model to actually SendMessage now | `source/host/runner/send-message-reminder-middleware.ts:40` |
| low | reminder | a turn opens with tool calls before any text SendMessage acknowledgement → a start-of-turn ack reminder is injected | `source/host/runner/start-of-turn-ack-reminder-middleware.ts:76` |
| low | reminder | the box is near disk capacity during a turn → a disk-pressure reminder is injected once per episode | `source/host/runner/send-message-reminder-middleware.ts:31` |
| low | background-shell | a watched command's terminal output file disappears → settles with 'The command's terminal output file no longer exists...' | `source/host/runner/shell-terminal-watch.ts:223` |
| low | background-shell | reading a background command's output is no longer permitted → settles with 'Grok Bot is no longer allowed to read this command's output...' | `source/host/runner/shell-terminal-watch.ts:233` |
| low | stream-retry | the provider produces no first token within the stall deadline → a FirstTokenStallError fires and the attempt is retried | `source/host/runner/stream-attempt.ts:46` |
| low | stream-retry | a conversation-too-large or context-overflow refusal → not retried (treated as a dead end) | `source/host/runner/transient-stream-error.ts:23` |
| low | turn-run | the turn is interrupted before dispatch → throws SandTurnInterruptedBeforeDispatchError | `source/host/runner/turn-run-shell.ts:656` |
| low | turn-run | MCP tool discovery fails during a turn → the failure is noted and the turn continues without MCP tools | `source/host/runner/turn-run-shell.ts:687` |
| low | toolset | a subagent (non computer/browser) runner builds its toolset → an empty fenced toolset is returned (no tools offered) | `source/host/runner/tools/turn-toolset.ts:1303` |
| low | toolset | the runner is a shared-room runner with box tools disabled → only SendMessage is offered; with box tools enabled a small shared set is offered | `source/host/runner/tools/turn-toolset.ts:1497` |
| low | toolset | box desktop unavailable when building tools → computer/browser/screenshot/request_box_help tools are withheld | `source/host/runner/tools/turn-toolset.ts:1446` |
| low | toolset | cloud agents disabled by team → the CloudAgent tool is not offered | `source/host/runner/tools/turn-toolset.ts:1427` |
| low | toolset | dynamic tools enabled and a dispatched dynamic tool call resolves its name → the effective tool name's timeout is applied to the streaming invocation | `source/host/runner/tools/mcp-meta-tools.ts:77` |
| low | bot-block-detection | the box browser navigates to a captcha/challenge/access-denied page → the block is classified (family/confidence) from the page's host/path/title | `source/host/runner/bot-block-detection.ts:7` |
| low | navigation-audit | the box browser's active page URL changes after a shell/computer action → a browserNavigation audit record is emitted for the new URL | `source/host/runner/sand-action-audit.ts:206` |
| low | send-message-encoding | a box media path is attached in a SendMessage → the box file is downloaded and persisted so it renders inline/as an attachment | `source/host/runner/tools/send-message-encoding.ts:52` |
| low | box-reference-docs | the box is provisioned → debugging-the-box.md and app-ui.md reference docs are written under /home/box/reference | `source/host/runner/box-reference-docs.ts:54` |

## Host extensions · 박스동기/클라우드/공유/업그레이드/셋업/MCP/webauthn/UA/텔레메트리  (누락 138건, 추출 186 / 매칭 48)
- 표면 판정: 약 26% (48/186). 사용자-대면 UI 조작(박스저장소 STORE-*, 컴퓨터관리 BOX-*, 공유 SHARE-*, MCP/플러그인/스킬, 설정 SET-*)은 잘 덮음. 반면 클라우드 에이전트 전체 수명주기(launch/list/reply/cancel/artifacts/transcript, getInfo만 등록됨), 모든 텔레메트리·감사로그·state-backstop·source-map·experiments·browser-UA 내부, host-upgrade 내부, disk-pressure, box-store-sync 내부동작, managed-setup, local-exec 오류경계, 그리고 대부분의 오류/경계 상태가 원장에 없음.

| 심각도 | 영역 | 원자 기능(행동→결과) | 소스 |
| --- | --- | --- | --- |
| high | Cloud agents | cloud agent를 launch(repo/prompt/environment)로 실행하면 → 백그라운드 컴포저를 생성하고 bcId와 cursor.com 에이전트 URL을 반환(원장은 getInfo만 등록) | `source/host/extensions/cloud-agents/cloud-agents-service.ts:launch` |
| high | Cloud agents | launch 후 완료 대기(awaitCompletion)를 호출하면 → 10초 폴링으로 완료/에러/브랜치/PR/변경통계 요약 텍스트를 반환 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts:awaitCompletion` |
| high | Cloud agents | cloud agent 목록(list, limit/includeArchived)을 조회하면 → bcId/name/status/branch/prUrl/archived/URL 목록을 반환 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:list` |
| high | Cloud agents | cloud agent에 후속 메시지(reply, interrupt 옵션)를 보내면 → 비동기 후속 턴을 추가하고 runId를 반환 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:reply` |
| high | Cloud agents | cloud agent를 취소(cancel)/이름변경(rename)/보관(setArchived)/삭제(delete)하면 → 백그라운드 컴포저에 pause/rename/archive/delete를 각각 적용 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:cancel` |
| high | Cloud agents | cloud agent 산출물 목록(listArtifacts)을 조회하면 → 경로와 크기(bytes) 목록을 반환 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:listArtifacts` |
| high | Cloud agents | cloud agent 전사 덤프(getTranscriptDump)를 요청하면 → 대화를 JSONL 문자열로 변환해 라인 수와 상태를 반환 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:getTranscriptDump` |
| high | Cross-user sharing | 릴레이 폴에서 room-post/room-entry 이벤트를 받으면 → 게스트 메시지/미러 항목을 전사에 추가해 표시(들어오는 공유 메시지 표시 자체가 미등록) | `source/host/extensions/cross-user-sharing/xuser-sharing-service.ts:handleRoomPost` |
| medium | Box store sync | 주기 사이클이 돌 때 박스가 유휴이고 15분이 지났으면 → 크롬 세션/팩 포함 idle-only 스냅샷을 업로드하고 스토어 DB까지 캡처(자동 백업 동작 자체가 원장에 없음) | `source/host/extensions/box-store-sync/box-store-sync-service.ts:runCycle` |
| medium | Box store sync | 크롬 세션 DB(Cookies/Login Data) 파일이 바뀌면 워처가 감지 → 5초 디바운스 후 chrome-session-only 스냅샷을 즉시 업로드 | `source/host/extensions/box-store-sync/chrome-session-watcher.ts:handleFsEvent` |
| medium | Box store sync | 에이전트 턴이 끝나 store.db 스냅샷을 예약하면 → 5초 디바운스 후 해당 에이전트 store.db 번들을 업로드 | `source/host/extensions/box-store-sync/box-store-sync.ts:scheduleStoreDbSnapshot` |
| medium | Box store sync | 플러시 시 store.db 캡처가 완료되지 못하면 → ok=false, reason='store-db-incomplete'로 실패 처리(경계 상태 미등록) | `source/host/extensions/box-store-sync/box-store-sync.ts:evaluateBoxStoreFlush` |
| medium | Box store sync | 플러시 시 크롬 세션 스테이징이 실패하면 → ok=false, reason='chrome-session-stage-failed'로 실패 처리 | `source/host/extensions/box-store-sync/box-store-sync.ts:evaluateBoxStoreFlush` |
| medium | Box store sync | 에이전트를 잊기(forgetAgent)를 요청하면 → 해당 agentId의 매니페스트 항목을 삭제하고 재저장, 삭제 개수를 로그로 남김(clear는 STORE-003으로 있으나 개별 forget은 없음) | `source/host/extensions/box-store-sync/box-store-sync.ts:forgetAgent` |
| medium | Box store sync | 박스 다운로드(복원) 시 매니페스트 경로가 루트를 벗어나는 안전하지 않은 경로면 → 'unsafe manifest path' 실패로 기록하고 해당 항목을 건너뜀(경로탈출 방어 미등록) | `source/host/extensions/box-store-sync/box-store-download.ts:download` |
| medium | Box store sync | 복원 중 blob의 sha/size가 매니페스트와 불일치하면 → 'sha/size mismatch' 실패로 기록하고 파일을 설치하지 않음(무결성 방어 미등록) | `source/host/extensions/box-store-sync/box-store-download.ts:restoreSmallGroup` |
| medium | Box lifecycle | 박스 안에서 recreateInBox(preserveData/force)를 호출하면 → 백엔드에 재생성을 요청하고 started 여부와 사유를 반환(호스트측 reset/update와 별도 in-box 경로) | `source/host/extensions/box-lifecycle/box-lifecycle-service.ts:recreateInBox` |
| medium | Computer(forever-box) | 재생성 요청 시 업데이트 서비스에 닿지 못하면 → 'Couldn't reach the service that updates this computer. It is unchanged.' 오류를 던지고 컴퓨터는 그대로 유지 | `source/host/extensions/forever-box/forever-box-service.ts:recreate` |
| medium | Computer(forever-box) | 재생성을 시도했으나 서비스가 시작을 거절하면 → 'Couldn't update/reset the computer (사유). It is unchanged.' 오류 메시지를 표시 | `source/host/extensions/forever-box/forever-box-service.ts:recreate` |
| medium | Computer(forever-box) | 자동 이미지 업데이트가 반복 실패하면 → 트레이에 'Computer update failed' 에러를 한 번 푸시하고 업데이트 안내를 표시 | `source/host/extensions/forever-box/forever-box-service.ts:maybeAutoUpdate` |
| medium | Computer(forever-box) | 추가 데스크톱 창(ensureWindow)을 요청했는데 박스가 다중 창을 지원하지 않으면 → 'This box does not support multiple desktop windows.' 오류를 던짐 | `source/host/extensions/forever-box/host-box.ts:ensureWindow` |
| medium | Computer(forever-box) | 추가 데스크톱 창(ensureWindow)을 요청하면 → 해당 windowIndex의 vncUrl을 만들고 windows 목록을 갱신해 통지(추가 화면 생성; 원장은 전환/목록만 있음) | `source/host/extensions/forever-box/host-box.ts:ensureWindow` |
| medium | Disk pressure | 볼륨 여유 공간이 소프트 임계(8GiB/15%) 아래로 떨어지면 → disk pressure를 'soft'로 분류하고 transition 텔레메트리 보고 및 구독자에게 soft 통지 | `source/host/extensions/forever-box/disk-pressure-guard.ts:classifyDiskPressure` |
| medium | Disk pressure | 볼륨 여유 공간이 하드 임계(2GiB/5%) 아래로 떨어지면 → disk pressure를 'hard'(error 레벨)로 분류하고 구독자에게 hard 통지 | `source/host/extensions/forever-box/disk-pressure-guard.ts:classifyDiskPressure` |
| medium | Disk pressure | 디스크 압력 상태에서 에이전트가 리마인더 에피소드를 청구(claim)하면 → 미처리 에피소드 id를 배정하고 커밋 시 처리 완료로 원장에 영속화 | `source/host/extensions/forever-box/disk-pressure.ts:createDiskPressureReminderEpisodes` |
| medium | Cloud agents | repo_url 없이(그리고 저장 환경도 없이) launch하면 → 'repo_url is required to launch a cloud agent.' 오류를 던짐 | `source/host/extensions/cloud-agents/cloud-agent-request-composition.ts:resolveLaunchRepoReference` |
| medium | Cloud agents | named private worker 환경에 starting_ref를 지정해 launch하면 → 자체 체크아웃이라 특정 ref로 시작 불가라는 오류를 던짐 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:launch` |
| medium | Cloud agents | model_params만 주고 model을 비운 채 launch/reply하면 → 'model is required when model_params are provided.' 오류를 던짐 | `source/host/extensions/cloud-agents/cloud-agent-request-composition.ts:buildCloudAgentRequestedModel` |
| medium | Cloud agents | 존재하지 않는 저장 환경 id/name으로 launch하면 → 'No saved environment...'와 사용 가능한 환경 목록 안내 오류를 던짐 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts:resolveSavedEnvironment` |
| medium | Cloud agents | self-hosted pool 환경인데 계정에 활성 팀이 없으면 → 'A self-hosted pool requires an active team...' 오류를 던짐 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:resolvePrivateWorkerTeamId` |
| medium | Cloud agents | 계정에 활성 팀이 여러 개인데 team_id 미지정으로 launch하면 → 'multiple active teams. Set environment.team_id to one of: ...' 오류를 던짐 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:resolvePrivateWorkerTeamId` |
| medium | Cloud agents | 완료 대기 중 최대 5시간이 지나도 끝나지 않으면 → 'still running after N minutes' 타임아웃 안내를 error 상태로 반환 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts:awaitCompletion` |
| medium | Cloud agents | 모델 카탈로그(listModels)를 조회하면 → 백엔드에서 사용 가능한 모델 목록을 5분 캐시로 반환 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts:listModels` |
| medium | Cloud agents | 팀 관리자가 Sand에서 cloud agents를 비활성화한 계정이면 → isDisabledByTeamAdmin가 true를 반환하여 cloud agent 사용을 차단 | `source/host/extensions/cloud-agents/cloud-agents-service.ts:isDisabledByTeamAdmin` |
| medium | Cross-user sharing | 공유 기능 게이트(sand_multiplayer)가 꺼져 있을 때 공유 API를 호출하면 → 'Sharing isn't enabled for your account.' 오류를 반환 | `source/host/extensions/cross-user-sharing/extension.ts:createCrossUserSharingExtension` |
| medium | Cross-user sharing | 존재하지 않는 에이전트로 방 생성을 시도하면 → 'That agent no longer exists.' 오류를 반환 | `source/host/extensions/cross-user-sharing/xuser-sharing-service.ts:mintRoomForAgent` |
| medium | Cross-user sharing | 로그인하지 않은 상태로 공유 방을 만들려 하면 → 'Sign in to create shared groups.' 오류를 반환 | `source/host/extensions/cross-user-sharing/xuser-sharing-service.ts:createSharedRoom` |
| medium | Cross-user sharing | 호스트가 원격 멤버 턴을 요청(turn-request)받으면 → '{name} is responding in {room} at the request of {host}.' 활동 알림을 추가하고 원격 턴을 실행 | `source/host/extensions/cross-user-sharing/xuser-remote-turns.ts:runRequestedTurn` |
| medium | Cross-user sharing | 릴레이 호출이 403을 반환하면 → 'Sharing isn't enabled for your account.' 메시지로 변환 | `source/host/extensions/cross-user-sharing/xuser-relay.ts:describeRelayError` |
| medium | Cross-user sharing | 릴레이 호출이 429를 반환하면 → 'You're doing that too often. Try again in a minute.' 메시지로 변환 | `source/host/extensions/cross-user-sharing/xuser-relay.ts:describeRelayError` |
| medium | Cross-user sharing | 공유된 에이전트를 삭제(noteAgentDeleted)하면 → 떠남/멤버제거 의무를 원장에 기록하고 플러시하여 방에서 자동 이탈 | `source/host/extensions/cross-user-sharing/xuser-departure-obligations.ts:noteAgentDeleted` |
| medium | Cross-user sharing | 공유 방에 이미지가 포함된 메시지를 발행하면 → 이미지를 인라인 base64로 첨부하되 항목당 4장·총 1.1MB 한도 내에서만 전송 | `source/host/extensions/cross-user-sharing/xuser-entry-publisher.ts:inlineImages` |
| medium | Host upgrade | 이미 최신 버전인데 업데이트를 요청하면 → started:false, reason='already-latest'와 버전을 반환 | `source/host/extensions/host-upgrade/host-upgrade-service.ts:updateHostNow` |
| medium | Host upgrade | 호스트 버전 상태(getVersionState)를 조회하면 → 현재/최신 호스트 버전과 업데이트 가용 여부를 반환 | `source/host/extensions/host-upgrade/host-upgrade-service.ts:getVersionState` |
| medium | WebAuthn proxy | 보안키 의식(requestCeremony)을 요청했는데 등록된 제공자(머신)가 없으면 → NotAllowedError와 SAND_NO_WEBAUTHN_MACHINE_MESSAGE를 반환 | `source/host/extensions/webauthn-proxy/webauthn-proxy-bridge.ts:requestCeremony` |
| medium | WebAuthn proxy | 보안키 제공자가 있으나 하트비트가 끊겨 stale이면 → NotAllowedError와 SAND_WEBAUTHN_MACHINE_UNAVAILABLE_MESSAGE를 반환 | `source/host/extensions/webauthn-proxy/webauthn-proxy-bridge.ts:requestCeremony` |
| medium | WebAuthn proxy | 보안키 의식이 타임아웃 창을 넘기면 → 제공자에 cancel을 보내고 'The security key ceremony timed out...' 오류를 반환 | `source/host/extensions/webauthn-proxy/webauthn-proxy-bridge.ts:requestCeremony` |
| medium | WebAuthn proxy | 데스크톱 사용자가 보안키 동의를 거절(grant declined)하면 → consent_declined 원인으로 실패 텔레메트리를 남기고 의식이 실패 | `source/host/extensions/webauthn-proxy/webauthn-proxy-bridge.ts:submitResponses` |
| medium | WebAuthn proxy | WebAuthn 프록시 활성/비활성(applyEnablement)을 적용하면 → 박스 마커 파일을 쓰거나 지우고 크롬 정책 명령을 실행해 applied/unchanged/not-a-box를 반환 | `source/host/extensions/webauthn-proxy/webauthn-proxy-marker.ts:applyWebAuthnProxyMarker` |
| medium | Managed setup | 인증되면 관리 스킬(managed skills)이 startup으로 갱신되면 → 백엔드에서 관리 스킬을 받아 캐시 디렉터리에 SKILL.md로 실체화(팀 제공 스킬 유입 미등록) | `source/host/extensions/managed-setup/managed-skills-service.ts:refresh` |
| medium | Managed setup | 팀 규칙(resolveTeamRules)을 조회하면 → Sand/ALL 대상 팀 규칙을 병합해 Cursor 규칙 형식으로 반환(팀 없으면 빈 목록) | `source/host/extensions/managed-setup/team-rules.ts:createSandTeamRulesResolver` |
| medium | MCP | 박스에서 MCP 툴 실행(executeTool)이 실패하면 → 'Box MCP execution failed for "{name}": ...' 오류 결과를 반환하고 오류 클래스를 기록 | `source/host/extensions/mcp/box-mcp-exec.ts:createBoxSandMcpExec` |
| medium | MCP | 설명(description)이 빈 스킬을 게시하려 하면 → 'Add a description before publishing...' 오류를 던짐 | `source/host/extensions/mcp/skill-publish.ts:upload` |
| medium | MCP | 라이브러리에 없는 워크플로를 게시하려 하면 → 'That skill no longer exists in your library.' 오류를 던짐 | `source/host/extensions/mcp/skill-publish.ts:requireLibraryRecord` |
| medium | MCP | 내가 게시하지 않은 플러그인의 스킬을 resync/unpublish하려 하면 → 'belongs to a plugin you did not publish.' 오류를 던짐 | `source/host/extensions/mcp/skill-publish.ts:requirePublishedPluginSkill` |
| medium | Local exec | 로컬 컴퓨터 exec를 실행했는데 등록된 제공자가 없으면 → SAND_NO_LOCAL_MACHINE_MESSAGE 오류를 던짐 | `source/host/extensions/local-exec/local-exec-bridge.ts:requireProvider` |
| medium | Local exec | 로컬 컴퓨터 제공자의 하트비트가 끊겨 stale이면 → 'computer unavailable' 메시지 오류를 던짐 | `source/host/extensions/local-exec/local-exec-bridge.ts:requireProvider` |
| medium | Local exec | 로컬 툴 권한 게이트가 차단(blockedReason)된 상태에서 exec/업로드/다운로드하면 → 차단 사유를 담은 권한 거부 오류를 던짐(정책 차단 강제 미등록) | `source/host/extensions/local-exec/gateway-local-exec-sand-box.ts:createExecInstance` |
| medium | Local exec | 권한 승인이 필요한데 액션을 설명할 수 없는(describe 불가) 로컬 exec이면 → SAND_LOCAL_TOOLS_UNDESCRIBABLE_MESSAGE 권한 거부 오류를 던짐 | `source/host/extensions/local-exec/gateway-local-exec-sand-box.ts:createExecInstance` |
| medium | Local exec | 로컬 exec 응답이 응답 워치독 유휴 한도를 넘기면 → cancel을 보내 스트림을 닫고 'computer unavailable' 오류를 던짐 | `source/host/extensions/local-exec/local-exec-bridge.ts:request` |
| medium | Local exec | 로컬 파일 업로드가 최대 파일 바이트를 넘으면 → localExecFileTooLargeMessage 오류를 던짐 | `source/host/extensions/local-exec/gateway-local-exec-sand-box.ts:uploadFile` |
| medium | Local exec | 연결된 로컬 컴퓨터 목록(listComputers)/활성 컴퓨터를 조회하면 → id/label/connected 여부의 컴퓨터 목록과 활성 컴퓨터를 반환 | `source/host/extensions/local-exec/local-exec-bridge.ts:listComputers` |
| medium | Settings | 에이전트 기본 모델(agentDefaultModel)을 설정하면 → 유효한 선택이면 저장되고, null이면 지움(모델 선택 컨트롤 미등록) | `source/host/extensions/settings/settings-service.ts:setHostSettings` |
| medium | Settings | 컴퓨터 사용 모델(computerUseModel)을 설정하면 → 유효한 선택이면 저장되고, null이면 지움 | `source/host/extensions/settings/settings-service.ts:setHostSettings` |
| medium | Settings | WebAuthn 프록시 사용(webauthnProxyEnabled)을 토글하면 → 설정을 저장하여 이후 조회/적용에 반영(활성 토글 미등록; SET-011은 미지원 플랫폼 설명만) | `source/host/extensions/settings/settings-service.ts:setHostSettings` |
| medium | Action audit | MCP 툴 호출/셸 명령/브라우저 이동/컴퓨터 사용 세션이 발생하면(record) → 에이전트별 audit.jsonl에 액션 라인을 추가 기록 | `source/host/extensions/action-audit/action-audit-service.ts:createSandActionAuditor` |
| medium | Codebase telemetry | 사용자의 프라이버시 모드가 NoStorage/NoTraining 등으로 조회되면 → 프라이버시 모드에 따라 코드베이스 스냅샷 업로드 동작을 게이팅하고 5분마다 갱신 | `source/host/extensions/codebase-telemetry/privacy-mode.ts:createCodebaseTelemetryPrivacyMode` |
| low | Box store sync | 박스 스토어 동기화가 비활성(SAND_BOX_STORE_SYNC off) 상태로 시작하면 → 동기화가 시작되지 않고 'disabled' 사유 warn 사이클 텔레메트리가 남고 API는 store-sync-disabled를 반환 | `source/host/extensions/box-store-sync/box-store-sync-service.ts:start` |
| low | Box store sync | 동기화 활성 상태로 호스트가 시작되면 → 2분 주기 폴링 사이클이 시작되고 시작 시 누수 임시파일을 정리('snapshot-out only' 로그) | `source/host/extensions/box-store-sync/box-store-sync-service.ts:start` |
| low | Box store sync | 매니페스트 저장 중 다른 창이 이미 정본을 쓴 CAS 충돌이 나면 → 최대 3회 재시도하고 충돌 상세를 warn 텔레메트리로 보고 | `source/host/extensions/box-store-sync/box-store-sync-service.ts:reportBoxStoreManifestConflict` |
| low | Box store sync | 파일이 최대 오브젝트 크기(32GiB)를 넘으면 → oversize로 분류하고 업로드를 건너뛰며 로그로 남김 | `source/host/extensions/box-store-sync/box-store-transfer.ts:syncFile` |
| low | Box store sync | 큰 파일 스냅샷 복사에 필요한 디스크 여유(x2)가 부족하면 → 복사를 다음 사이클로 미루고 error로 분류 | `source/host/extensions/box-store-sync/box-store-transfer.ts:syncLargeFile` |
| low | Box store sync | 크롬 세션 DB가 배타적 잠금이라 vacuum이 busy/locked로 실패하면 → raw-copy 폴백으로 스테이징하고 성공 개수를 로그로 남김 | `source/host/extensions/box-store-sync/chrome-session-stage.ts:stageBoxChromeSession` |
| low | Box lifecycle | 박스 이미지 업데이트 가용성(fetchImageUpdateAvailable)을 조회하면 → 백엔드 run-state의 imageUpdateAvailable 불리언을 반환(하위 질의; getStatus로만 간접 노출) | `source/host/extensions/box-lifecycle/box-lifecycle-service.ts:fetchImageUpdateAvailable` |
| low | Computer(forever-box) | 에이전트 창을 해제(releaseAgent/releaseWindow)하면 → vncUrl을 지우고 state='absent'로 구독자에게 통지 | `source/host/extensions/forever-box/host-box.ts:releaseWindow` |
| low | Computer(forever-box) | 핸드오프용 스크린샷 캡처(captureScreenshot)를 호출하면 → 5초 데드라인 내 스크린샷 바이트를 반환하고 실패/타임아웃 시 null | `source/host/extensions/forever-box/forever-box-service.ts:captureScreenshot` |
| low | Computer(forever-box) | 이미지 업데이트 가용 여부가 바뀌면 → 실행 중 에이전트 상태에 imageUpdateAvailable 플래그를 갱신해 구독자에게 통지 | `source/host/extensions/forever-box/host-box.ts:recordImageUpdateAvailable` |
| low | Disk pressure | 압력이 지속되면 5분 하트비트 주기마다 → heartbeat 트리거로 disk pressure 텔레메트리를 반복 보고 | `source/host/extensions/forever-box/disk-pressure-guard.ts:createDiskPressureGuard` |
| low | Disk pressure | 디스크 압력이 healthy로 회복되면 → 활성 리마인더 에피소드를 종료하고 원장을 정리 | `source/host/extensions/forever-box/disk-pressure.ts:observePressure` |
| low | Cloud agents | 완료 대기 중 rate limit 오류를 받으면 → retryAfter+지터만큼 폴링을 일시 정지하고 이후 재개 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts:awaitCompletion` |
| low | Cross-user sharing | 다른 참가자의 타이핑 이벤트를 받으면 → typingUsers에 추가하고 만료 시각에 자동 제거하여 타이핑 목록을 통지(원격 타이핑 수신 표시; 원장은 송신만) | `source/host/extensions/cross-user-sharing/xuser-sharing-service.ts:handleRoomTyping` |
| low | Cross-user sharing | 원격 멤버 턴이 10분 창에 30회 예산을 초과하면 → 추가 원격 턴 요청을 조용히 무시(예산 소진) | `source/host/extensions/cross-user-sharing/xuser-remote-turns.ts:handleTurnRequest` |
| low | Cross-user sharing | 원격 멤버 턴이 데드라인 내 응답하지 않으면 → 빈 결과를 반환하고 해당 멤버를 10분간 도달 불가로 백오프 | `source/host/extensions/cross-user-sharing/xuser-remote-turns.ts:runRemoteMemberTurn` |
| low | Cross-user sharing | dev 빌드가 프로덕션 백엔드를 가리키는데 opt-in 환경변수가 없으면 → cross-user 공유를 끄고 사유를 콘솔에 경고 | `source/host/extensions/cross-user-sharing/xuser-sharing-environment.ts:resolveXuserSharingEnvironment` |
| low | Cross-user sharing | 같은 turnNonce의 원격 턴 요청이 3일 내 중복 도착하면 → dedupe 스토어가 이미 본 것으로 판단해 재실행하지 않음 | `source/host/extensions/cross-user-sharing/xuser-turn-dedupe-store.ts:markSeenIfNew` |
| low | Host upgrade | 번들 소스를 찾지 못한 채 업데이트를 요청하면 → started:false, reason='no-bundle-source'를 반환 | `source/host/extensions/host-upgrade/host-upgrade-service.ts:updateHostNow` |
| low | Host upgrade | 대상 버전이 슈퍼바이저 ack로 롤백 거부(veto)된 상태면 → started:false, reason='host-version-rolled-back'를 반환 | `source/host/extensions/host-upgrade/host-upgrade-service.ts:updateHostNow` |
| low | Host upgrade | 자동 업데이트가 켜진 상태로 유휴 워치 틱이 돌면 → 최신 번들이 있으면 idle-auto-update로 조용히 스테이징 | `source/host/extensions/host-upgrade/host-upgrade-service.ts:maybeAutoUpdateHostBundle` |
| low | Host upgrade | 번들 fetch/stage가 실패하면 → 박스는 그대로 두고 실패 텔레메트리(outcome=failed, phase)를 보고 | `source/host/extensions/host-upgrade/host-bundle-upgrade.ts:fetchStageAndReportHostBundle` |
| low | Host upgrade | 슈퍼바이저 교체가 실패한 마커가 감지되면(재시도 한도 내) → 스테이지드 버전을 초기화해 다음 유휴 틱에 재스테이징 | `source/host/extensions/host-upgrade/host-bundle-upgrade.ts:noteFailedSwapMarkerForRetry` |
| low | Host upgrade | 업그레이드 준비(prepareForUpgrade)를 호출하면 → 자동화 웨이크 중단, 공유 준비, 전사 조용화(quiesce)를 순차 수행 | `source/host/extensions/host-upgrade/host-upgrade-service.ts:prepareForUpgrade` |
| low | Host upgrade | 업그레이드 마커를 주기적으로 전달(forwardHostUpgradeMarker)하면 → 적용/실패 결과 메타데이터를 텔레메트리로 보고하고 마커 파일을 삭제 | `source/host/extensions/host-upgrade/host-upgrade-marker.ts:forwardHostUpgradeMarkerWith` |
| low | Host upgrade | 최신 버전 파일이 유효한 git sha 형식이 아니면 → 버전 해석을 undefined로 반환하여 업데이트를 진행하지 않음 | `source/host/extensions/host-upgrade/host-bundle-source.ts:fetchLatestHostBundleVersion` |
| low | Managed setup | 특정 관리 스킬 보장(ensureManagedSkill)을 호출했는데 캐시에 없으면 → on_demand 갱신 후 해당 id 존재 여부(boolean)를 반환 | `source/host/extensions/managed-setup/managed-skills-service.ts:ensureSkill` |
| low | Managed setup | 관리 스킬 캐시를 새로 쓰면 → 더 이상 없는 스킬 디렉터리를 정리하고 남은 스킬만 파일로 유지 | `source/host/extensions/managed-setup/managed-skills-cache.ts:materializeManagedSkillFiles` |
| low | Managed setup | 관리 스킬이 disabled이거나 안전하지 않은 id/빈 본문이면 → 해당 스킬을 실체화하지 않고 건너뜀(null) | `source/host/extensions/managed-setup/sand-managed-skills.ts:fetchedManagedSkillToSandSkill` |
| low | MCP | 박스 MCP 서버가 loading/error에서 상태가 바뀌면 → servers-updated 리스너에 갱신된 서버 상태를 통지(후속 상태 확인 예약) | `source/host/extensions/mcp/mcp-service.ts:scheduleStatusFollowUps` |
| low | MCP | 시작 시 레거시 MCP 인증 자격증명 정리(cleanupLegacyAuth)를 수행하면 → 제거 결과(outcome/removedCount)를 텔레메트리로 보고 | `source/host/extensions/mcp/extension.ts:mcpExtension` |
| low | Local exec | ask 게이트에서 라이브 로컬 컴퓨터 유무(checkLiveComputerForAsk)를 확인하면 → 없으면 refused 텔레메트리를 남기고 false, 있으면 true를 반환 | `source/host/extensions/local-exec/local-exec-bridge.ts:checkLiveComputerForAsk` |
| low | Local exec | 로컬 툴 승인이 회수(approval-retired)되면 → 모든 제공자에 retire-approval 프레임을 보내 진행 중 승인을 무효화 | `source/host/extensions/local-exec/local-exec-bridge.ts:retireApproval` |
| low | Local exec | exec 스트림이 throw 제어 프레임으로 실패하면 → 실패를 분류(spawn_enoent 등)해 텔레메트리로 보고하고 원 오류를 다시 던짐 | `source/host/extensions/local-exec/gateway-local-exec-sand-box.ts:createExecInstance` |
| low | Browser UA | 인증 토큰이 갱신되면 UA 소유자 스탬프를 기록하면 → 토큰 sub의 sha256 앞 16자를 /tmp/sand-ua-user에 원자적으로 기록 | `source/host/extensions/browser-ua/ua-owner-stamp-service.ts:createUaOwnerStampWriter` |
| low | Browser UA | UA 토큰 킬스위치 실험이 켜지거나 꺼지면 → /tmp/sand-ua-token-disabled 마커를 쓰거나 제거해 UA 토큰 사용을 차단/허용 | `source/host/extensions/browser-ua/ua-token-kill-switch-service.ts:createUaTokenKillSwitchReconciler` |
| low | Settings | 온보딩 완료 표시(hasSeenOnboarding)를 설정하면 → 플래그를 저장하여 온보딩 재표시 여부에 반영(원장 온보딩은 countAgents 기준만 있음) | `source/host/extensions/settings/settings-service.ts:setHostSettings` |
| low | Settings | 기능 플래그 오버라이드(featureFlagOverrides)를 설정하면 → 오버라이드 구독자(실험 서비스)에게 전달하여 게이트 값을 재정의 | `source/host/extensions/settings/settings-service.ts:setHostSettings` |
| low | Settings | 설정이 변경되면 → 변경된 필드 목록으로 change 구독자에게 통지 | `source/host/extensions/settings/settings-service.ts:subscribeToChanges` |
| low | Source map | 에이전트/박스 스토어 소스 id를 조회·생성(getOrCreate/getOrCreateBoxStore)하면 → 기존 항목이 있으면 반환, 없으면 새 UUID로 local 모드 항목을 만들어 저장 | `source/host/extensions/source-map/source-map-service.ts:getOrCreate` |
| low | Source map | 소스 모드(setMode: local/agent-store)를 변경하면 → 동일 sourceId를 유지한 채 모드를 바꿔 저장 | `source/host/extensions/source-map/source-map-service.ts:setMode` |
| low | State backstop | S3 백스톱이 비활성인 상태로 시작하면 → isEnabled:false로 스냅샷/읽기 요청은 'backstop disabled'를 반환 | `source/host/extensions/state-backstop/extension.ts:createStateBackstopExtension` |
| low | State backstop | 에이전트 store.db 백스톱 스냅샷(scheduleSnapshot/snapshotNow)을 하면 → 5초 디바운스 후 store.db를 S3 오브젝트 스토어에 업로드하고 결과를 반환 | `source/host/extensions/state-backstop/state-backstop-service.ts:snapshotNow` |
| low | State backstop | store.db가 최대 스냅샷 바이트(64MiB)를 넘으면 → 업로드를 건너뛰고 'over cap' 사유의 skipped 결과를 반환 | `source/host/extensions/state-backstop/state-backstop-service.ts:snapshotNow` |
| low | State backstop | 백스톱 스냅샷 읽기(readSnapshot)를 하면 → S3에서 해당 에이전트 state/store.db 바이트를 반환(없으면 null) | `source/host/extensions/state-backstop/state-backstop-service.ts:readSnapshot` |
| low | Action audit | 백엔드 전달 게이트(sand_action_audit_logs)가 켜져 있고 플러시 주기가 오면 → 대기 감사 이벤트를 최대 50개 배치로 백엔드에 전송하고 아웃박스를 갱신 | `source/host/extensions/action-audit/action-audit-service.ts:createSandActionAuditor` |
| low | Action audit | 백엔드 전송이 rate limit으로 실패하면 → retry-after(최소 30초) 백오프를 적용하고 아웃박스를 영속화 | `source/host/extensions/action-audit/action-audit-service.ts:flushFailureBackoffMs` |
| low | Action audit | 대기 감사 이벤트가 최대 2000개를 넘으면 → 가장 오래된 이벤트를 버려 최신 2000개만 유지 | `source/host/extensions/action-audit/action-audit-service.ts:createSandActionAuditor` |
| low | Action audit | stdio가 아닌 원격 MCP 툴 호출은 → 백엔드로 전달하지 않고(로컬 기록만) 필터링 | `source/host/extensions/action-audit/action-audit-service.ts:isBackendForwardable` |
| low | Experiments | 기능 게이트(checkFeatureGate/checkGate)를 조회하면 → Statsig 게이트 값을 반환하여 기능 노출을 제어 | `source/host/extensions/experiments/extension.ts:experimentsExtension` |
| low | Experiments | 멀티태스크/스포트라이트 게이트를 조회하면 → 환경변수 또는 게이트로 멀티태스크·스포트라이트 활성 여부를 결정 | `source/host/extensions/experiments/extension.ts:experimentsExtension` |
| low | Experiments | 동적 툴/에이전트 네트워크/MCP 멀티계정/브라우저 서브에이전트 게이트를 조회하면 → 각 기능의 활성 여부를 반환해 해당 UI/동작 노출을 제어(NET-001은 에이전트 네트워크만 덮음) | `source/host/extensions/experiments/extension.ts:experimentsExtension` |
| low | Experiments | 인증이 갱신되어 첫 자격증명이 도착하면 → 실험 서비스가 인증 상태 변경을 처리해 게이트를 재부트스트랩 | `source/host/extensions/experiments/extension.ts:experimentsExtension` |
| low | Experiments | 설정의 featureFlagOverrides가 바뀌면 → 실험 서비스가 오버라이드를 교체해 게이트 값에 반영 | `source/host/extensions/experiments/extension.ts:experimentsExtension` |
| low | Codebase telemetry | csnaps 바이너리를 사용할 수 없으면 → 'Codebase Telemetry unavailable' 경고를 남기고 no-op flush만 제공 | `source/host/extensions/codebase-telemetry/extension.ts:codebaseTelemetryExtension` |
| low | Codebase telemetry | 에이전트 요청 시작/종료 이벤트가 발생하면 → 코드베이스 스냅샷을 트리거하여 업로드(중복 사유는 무시) | `source/host/extensions/codebase-telemetry/codebase-snapshot-trigger.ts:handle` |
| low | Codebase telemetry | 코드베이스 텔레메트리 어댑터가 치명적 실패로 종료되면 → 어댑터를 닫고 30초 지연 후 세션을 자동 재시작 | `source/host/extensions/codebase-telemetry/codebase-telemetry-service.ts:scheduleRestart` |
| low | Telemetry | 사용자가 메시지를 전송하면(reportMessageSent) → 글자수/버킷/첨부수/리치텍스트/포크/그룹 여부를 담아 sand.message.sent 분석 이벤트를 기록 | `source/host/extensions/telemetry/host-telemetry-service.ts:reportMessageSent` |
| low | Telemetry | 자동화 실행(reportAutomationRun)이 발생하면 → 트리거/결과/그룹여부/발송메시지수를 담아 sand.automation.run 분석 이벤트를 기록 | `source/host/extensions/telemetry/analytics-service.ts:withAutomationRunAnalytics` |
| low | Telemetry | 호스트 콘솔 로그(log/info/warn/error)가 찍히면 → 원본 출력 후 구조화 로그 텔레메트리로 전달(재귀 방지) | `source/host/extensions/telemetry/host-telemetry-service.ts:installConsoleForwarding` |
| low | Telemetry | 박스 로그 배송(box log shipping)이 활성일 때 폴링하면 → /tmp 로그 파일을 오프셋 기반으로 읽어 배치로 텔레메트리에 배송하고 오프셋을 체크포인트 | `source/host/extensions/telemetry/box-log-shipper.ts:pollOnce` |
| low | Telemetry | 박스 로그가 최대 지연 바이트(16MiB)보다 뒤처지면 → 'skipped N bytes (too far behind)' 라인을 삽입하고 오프셋을 점프 | `source/host/extensions/telemetry/box-log-shipper.ts:pumpFile` |
| low | Telemetry | 박스 로그 오프셋 저장이 디스크 오류로 실패하면 → errorClass를 분류(no_space 등)해 save_failed 보고 후 주기 재시도 | `source/host/extensions/telemetry/box-log-shipper.ts:noteOffsetSaveFailed` |
| low | Telemetry | 슈퍼바이저 데스크톱 헬스 파일을 30초마다 전달하면 → 컴포넌트 up/down/crashloop 집계로 healthy/degraded/crashloop 레벨을 텔레메트리로 보고 | `source/host/extensions/telemetry/desktop-health-forwarder.ts:forwardDesktopHealthWith` |
| low | Telemetry | 호스트 크래시 마커가 존재하면 주기적으로 전달하면 → 종료 신호/사유/업타임 메타데이터로 process_exit 이벤트를 보고하고 마커를 삭제 | `source/host/extensions/telemetry/host-crash-marker.ts:forwardHostCrashMarkerWith` |
| low | Telemetry | 호스트 라이프사이클 단계가 5분 넘게 진전이 없으면 → 워치독이 해당 단계를 'stuck'으로 텔레메트리에 보고 | `source/host/extensions/telemetry/host-lifecycle-progress.ts:armWatchdog` |
| low | Telemetry | 호스트 라이프사이클 단계가 실패(fail)하면 → 해당 단계를 outcome='failed'로 텔레메트리에 보고 | `source/host/extensions/telemetry/host-lifecycle-progress.ts:fail` |
| low | Telemetry | 디스크 압력 리포트를 텔레메트리로 변환하면 → hard=error/soft=warn 레벨과 볼륨/사용률 메타데이터로 이벤트를 생성 | `source/host/extensions/telemetry/disk-pressure-telemetry.ts:diskPressureTelemetry` |
| low | Telemetry | 인증 자격증명 갱신 결과가 나오면 → outcome/연속실패수/소요시간을 담아 credential-renewal 텔레메트리로 보고 | `source/host/extensions/telemetry/host-telemetry-service.ts:subscribeToCredentialRenewalTelemetry` |
| low | Telemetry | SAND_DISABLE_TELEMETRY=1로 실행하면 → 이벤트루프/압력프로파일러/데스크톱헬스/박스로그배송 텔레메트리를 시작하지 않음 | `source/host/extensions/telemetry/host-telemetry-service.ts:start` |
| low | Telemetry | 치명적 종료(flushForFatalExit)가 호출되면 → 2초 데드라인 내 로그 배송 체크포인트와 구조화 로그를 강제 플러시 | `source/host/extensions/telemetry/host-telemetry-service.ts:flushForFatalExit` |