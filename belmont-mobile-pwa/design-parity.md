# Design parity ledger

Reference: OpenMausBot iOS at `6140532ea63e50bc234c34c488a79ff908bfc7f5`.

## 2026-09-01 pivot: skin now follows the local desktop renderer

Per the user's direction, the iOS reference fixed only the layout skeleton
(roster → chat navigation, bottom composer, mascot avatars, pairing flow).
The visual identity now comes from the local Belmont desktop renderer
(`frontend/src/recovered/features/runtime-theme-token-installer.ts`, the
130-entry sand palette):

- Colors: bg `#fcfcfc`/`#070707`, ink `#141414`/`#fcfcfc`, accent `#1084fe`,
  text-accent `#0c64c1`/`#459ffe`, borders at 20,20,20 alpha steps.
- Bubbles: agent `#eeeeee`/`#262626`, user `#070707`/`#5a5a5a`, flat 18px
  radius, 8×12 padding — the iOS Bézier tail engine was removed.
- Typography: 13px base / 12px secondary / 11px code, matching the desktop
  `--cursor-font-size` scale; PP Neue Montreal for Latin and Pretendard for Korean.
- Cards: neutral 1px `--sand-border-weak` border on elevated fill, blue accent
  buttons — replacing the cyan-tinted iOS approval card.
- The Maus mascot, glass layout skeleton and pairing hierarchy stay from the
  iOS port. Everything below them is desktop-token driven.

## Closed deltas

- Letter/monogram avatars → exact public Maus silhouette, named color palette, expression-0 eye rings, anchored face transform and mouth stroke.
- Monochrome/no-blue theme → OpenMaus cyan mascot, blue user bubbles and native light/dark bubble colors.
- Search-in-header roster → centered Linear project header and floating Updates/Search/Create glass bar.
- Generic list layout → 22px unread lane, 52px mascot, 17px title, role capsule, 15px preview/timestamp and row divider.
- Flat chat header → 44px glass back/computer controls, floating 60px mascot and 32px identity capsule.
- Generic rounded bubbles → a dynamically sized single SVG Shape with the same 22px corners and four scaled Bézier tail segments from `SpeechBubble.swift`.
- Generic approval panel → 22px cyan tint/border card, 40px Allow/Deny capsules and always-allow line.
- Generic modal → 30px glass action sheet, 64px rows, 44px icon wells and dimmed transcript/composer.
- Marketing-style connection page → native `PairingView` hierarchy: 124px blue device hero, QR-first CTA, collapsed discovery and nested manual entry.
- Composer without dictation → 32px microphone control alongside the native send control; supported browsers use Web Speech recognition.
- Scanner placeholder → camera-facing platform QR scanner, platform-decoded image selection, fail-closed OpenMaus invite parsing and explicit computer confirmation.
- Full-box CSS mascot gradient → SVG object-bounding-box gradient over the transformed silhouette, so the light/dark endpoints span the body exactly as in the native source.
- OpenMaus install icon → Linear project mark for the favicon, Apple touch icon, profile control and standard 192px/512px PWA manifest entries. Belmont keeps its animated agent avatar inside the app.

## Browser-equivalent, not pixel-identical native output

- CSS `backdrop-filter` substitutes SwiftUI `ultraThinMaterial`.
- PWA safe-area insets substitute native layout guides.
- iOS status bar and Dynamic Island are left to the operating system and are not drawn inside the PWA.
- Idle, listening/waiting, working and happy/done states render exact upstream 48-point eye rings and mouth geometry. The full 25-expression 30fps native morph/blink/gaze engine is not copied because it is motion behavior rather than a static screen primitive.

## Render evidence

- `artifacts/14-openmaus-pair-final.png`
- `artifacts/15-openmaus-pair-other-final.png`
- `artifacts/16-openmaus-roster-final.png`
- `artifacts/17-openmaus-chat-final.png`
- `artifacts/18-openmaus-chat-sent-final.png`
- `artifacts/20-openmaus-scanner-final.png`
- `artifacts/21-openmaus-chat-shape-final.png`
- `artifacts/22-openmaus-qr-confirmation-final.png`
- `artifacts/23-openmaus-chat-shape-dark-final.png`
- `artifacts/24-openmaus-roster-states-final.png`
- `artifacts/25-openmaus-chat-current-dark.png`
- `artifacts/26-openmaus-message-run-final.png`
- `artifacts/27-openmaus-roster-current.png`
- `artifacts/28-openmaus-chat-current-dark.png`
- `artifacts/29-grok-icon-gradient-light.png`
- `artifacts/30-grok-icon-gradient-dark.png`
- `artifacts/40-linear-brand-live-home.png`
- `artifacts/41-linear-brand-live-chat.png`
- `artifacts/42-linear-brand-live-dark.png`

The earlier `09`–`30` files predate the Linear identity pass and are retained as historical render artifacts. `40`–`42` are the current-source Linear roster and Belmont chat light/dark render set; `20`, `22` and `26` remain valid scanner, confirmation and grouped-message layout evidence because the later identity changes do not affect those structures.
