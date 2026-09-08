# APK recovery to desktop mapping

Status: `PROVISIONAL_REBUILT_CLIENT`

The recovered APK is Grok Bot Android **1.5.0 (versionCode 120)**. Desktop Grok Bot 0.18 is a different baseline. The recovered APK does not contain the original application source. This client uses recovered geometry, icon codepoints, screen identifiers, decompiled behavior evidence, and official screenshots as UI and interaction anchors. Desktop operations are bound to Belmont's supported gateway methods.

## Screen and behavior map

- Onboarding
  - APK anchor: official Google Play onboarding screenshot and recovered BabyGrok geometry
  - Desktop binding: mobile pairing session owned by `server.mjs`
- Home
  - APK anchor: recovered Home component `#22817` and official home screenshot
  - Desktop binding: `listAgents`, `getHostSettings`
- Chat
  - APK anchor: recovered Chat component `#24398` and official chat/approval screenshots
  - Desktop binding: `getAgentTranscriptTail`, `getAgentThread`, `sendPrompt`, `uploadAttachment`, `respondToWidget`, `reactToMessage`, `resolveAutoReviewApproval`, `resolveLocalToolPermission`
- Computer
  - APK anchor: official black computer frame and recovered screen identifiers
  - Desktop binding: `getForeverBoxStatus`, `ensureForeverBox`, `resetForeverBox`, per-window selection, same-origin HTTP asset proxy, WebSocket byte bridge
- New Bot
  - APK anchor: recovered BabyGrok shape and color vocabularies
  - Desktop binding: `createAgent`
- Settings
  - APK anchor: recovered Settings component `#26105`
  - Desktop binding: `getHostSettings`, `setHostSettings`, `getHostStatus`, `getPluginSyncStatus`
- Files
  - APK anchor: recovered attachment, file-preview, image-viewer, and share-target identifiers
  - Desktop binding: `readAttachmentText`, `readAttachmentImage`, `readAttachmentChunk`, `uploadAttachment`, `sendPrompt`
- Automation and extensions
  - APK anchor: recovered routine, failure, plugin, skill, template, and connector identifiers
  - Desktop binding: automation CRUD/run methods, `skillsCatalog`, `listRoutedMcpTools`, and `createAgent`

## 54-surface implementation coverage

The exact identifiers are registered in `src/navigation.ts` and guarded by `tests/surface-coverage.test.mjs` against the recovered inventory.

- `desktop_read_write_connected`
  - Core pairing, roster, chat, thread, reaction, approval, Bot profile/group, computer, routine, template export/import, attachment-share, user-form sending, and host-setting actions
  - Autofill profile-memory synchronization when a manager Bot is available; desktop-side feedback/report/rating log storage
- `desktop_read_connected`
  - Hidden chat, message/media search, failure history, skill catalog, routed-tool inventory, connector status, attachment readers, account/session status
- `intentional_device_local`
  - Browser notification permission, drafts, appearance, haptics, autofill cache, and local language preference
  - Form/autofill/feedback caches are local portions of backend-connected flows, not their entire persistence contract
- `explicitly_unsupported`
  - Granular auto-review rule editing, original-vendor billing/subscription, and app-store submission
  - The usage screen reads Codex account usage; it is not the original-vendor aggregate-usage backend

The 54 count is a route-and-layout recovery count. It is not a claim that all 54 screens have an equivalent Belmont backend contract.

## Direct recovered assets

- BabyGrok geometry JSON is imported into `src/components/BabyGrokAvatar.tsx` at build time from `public/assets/babygrok-geometry.json`.
- Cursor icon codepoints are rendered by `src/components/Icon.tsx` with the recovered `CursorIcons16-Regular.ttf` loaded in `src/styles.css` from `public/assets/fonts/`.
- PP Neue Montreal handles the Linear Latin identity; Pretendard Variable supplies Korean glyphs.

## Deliberate boundaries

- No legacy PWA JavaScript, CSS, routes, or server adapter are imported.
- The canonical Linear app mark is retained because it is the project identity, not a legacy interaction implementation.
- Reconstructed screens are not presented as original Grok Bot source or pixel-identical copies.
- The desktop gateway remains authoritative for bot state, transcript state, approvals, permissions, files, settings, and computer lifecycle.

All copied inputs are checksum-pinned in [asset-provenance.json](asset-provenance.json). That manifest preserves source and license notices; it does not grant redistribution rights for assets whose upstream license is undetermined.
