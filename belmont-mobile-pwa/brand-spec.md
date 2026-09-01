# OpenMaus mobile design port

Status: implemented reference specification  
Reference snapshot: OpenMausBot `6140532ea63e50bc234c34c488a79ff908bfc7f5`  
Checked: 2026-09-01

## Source of truth

- Native layout: `ios/App/ChatListView.swift`, `ChatView.swift`, `PairingView.swift`, `Glass.swift`, `SpeechBubble.swift`.
- Mascot: `ios/App/MausAvatar.swift` and `src/components/CursorAvatar.tsx`.
- Rendered references: `ios/AppStore/screenshots/iPhone-6.9/*.png`.
- OpenMaus reference app icon: `public/app-icon.svg`; the installed Belmont PWA deliberately uses the preserved Grok Bot renderer icon requested by the user.

## Tokens carried over

- System type: Apple system/SF stack, 17px primary text, 15px secondary text, 13px labels.
- User bubble: `#377FE6`.
- Bot bubble: `#E9E9EB` light, `#262629` dark.
- Mascot colors: all ten upstream named values plus neutral fallback `#8E8E93`, resolved from real bot payload names.
- Chat controls: 44px circular glass controls, 0.5px material stroke, 26px blur/saturation approximation.
- Roster avatar: 52px; row primary/secondary text 17px/15px; 13px role capsule.
- Chat avatar: 60px; 32px name capsule; 22px message and approval radii.
- Composer: 44px plus button, 44px minimum text capsule, 32px microphone and send buttons.
- Action sheet: 30px radius, 64px action rows, 44px icon wells, 18px horizontal padding.

## Core assets

- `icons/maus-silhouette.svg`: exact public mascot silhouette path and upstream transforms.
- The mascot fill is an SVG `objectBoundingBox` gradient on that transformed silhouette itself, preserving the upstream top-right → bottom-left extent and 0%/55%/100% stops.
- `icons/maus-face-{idle,listening,working,happy}.svg`: exact upstream eye rings, anchor transform, mouth curves and 7.5-point stroke for the four PWA-visible states.
- `icons/openmaus-app-icon.svg`: retained OpenMaus reference vector; it is not the installed PWA icon.
- `icons/grok-bot-app-icon.png`: active favicon and Apple touch icon; byte-identical to the preserved Grok Bot renderer asset (`app-icon-C7NKj2u7.png`, SHA-256 `79e6a73e634ce7ad8d1982739e9064bcc9c9ec5106bdd7281d7514ee68169ad2`).
- `icons/grok-bot-app-icon-{192,512}.png`: Lanczos-resized derivatives of that same source image used for the two standard PWA manifest sizes; no alternate artwork is introduced.
- `third-party/openmausbot/LICENSE` and `NOTICE`: upstream attribution.

## Belmont substitution contract

- `Scout` becomes the single user-facing manager, `Belmont`.
- Specialist bot colors and role pills stay visually identical, but their rows are read-only status/details surfaces.
- Users never receive a worker composer; every user message is routed to Belmont.
- OpenMaus visual structure is preserved even where the Belmont product semantics are stricter.

## Explicit exclusions

- Browser code cannot own the iOS status bar, Dynamic Island, Live Activities or SwiftUI's exact material renderer.
- The PWA uses CSS backdrop-filter equivalents inside the app viewport.
- This is not the official OpenMausBot or Grok Bot app and does not claim trademark affiliation.
