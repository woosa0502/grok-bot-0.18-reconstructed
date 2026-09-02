# Linear mobile design port

Status: implemented reference specification  
Reference snapshot: OpenMausBot `6140532ea63e50bc234c34c488a79ff908bfc7f5`  
Checked: 2026-09-02

## Source of truth

- Native layout: `ios/App/ChatListView.swift`, `ChatView.swift`, `PairingView.swift`, `Glass.swift`, `SpeechBubble.swift`.
- Mascot: `ios/App/MausAvatar.swift` and `src/components/CursorAvatar.tsx`.
- Rendered references: `ios/AppStore/screenshots/iPhone-6.9/*.png`.
- OpenMaus reference app icon: `public/app-icon.svg`; the installed Linear PWA deliberately uses its separate project mark requested by the user.

## Tokens carried over

- System type: self-hosted PP Neue Montreal for Latin glyphs and Pretendard Variable for Korean glyphs. Existing mobile sizes and hierarchy remain unchanged.
- User bubble: `#377FE6`.
- Bot bubble: `#E9E9EB` light, `#262629` dark.
- Mascot colors: all ten upstream named values plus neutral fallback `#8E8E93`, resolved from real bot payload names.
- Chat controls: 44px circular glass controls, 0.5px material stroke, 26px blur/saturation approximation.
- Roster avatar: 52px; row primary/secondary text 17px/15px; 13px role capsule.
- Chat avatar: 60px; 32px name capsule; 22px message and approval radii.
- Composer: 44px plus button, 44px minimum text capsule, 32px microphone and send buttons.
- Action sheet: 30px radius, 64px action rows, 44px icon wells, 18px horizontal padding.

## Core assets

- The mascot fill is an SVG `objectBoundingBox` gradient on that transformed silhouette itself, preserving the upstream top-right → bottom-left extent and 0%/55%/100% stops.
- OpenMaus/Grok Bot reference vectors (`maus-*.svg`, `openmaus-app-icon.svg`, `grok-bot-app-icon*.png`) were removed with the Linear rebrand; the shipped identity is the files below.
- `icons/linear-app-icon.svg`: canonical Linear project mark, a brushed-silver ridge on a near-black app tile.
- `icons/linear-app-icon.png` and `icons/linear-app-icon-{192,512}.png`: favicon, Apple touch icon and PWA install derivatives rendered from the canonical SVG.
- `fonts/PPNeueMontreal-{Light,Regular,Semibold}.woff2`: Latin UI faces packaged for the phone PWA.
- `fonts/PretendardVariable.woff2`: Korean UI fallback packaged for the phone PWA.
- `third-party/openmausbot/LICENSE` and `NOTICE`: upstream attribution.

## Linear and Belmont naming contract

- `Linear` is the project, installed application and visual identity.
- `Belmont` is the chief-of-staff bot inside Linear.
- `Scout` becomes the single user-facing manager, `Belmont`.
- Specialist bot colors and role pills stay visually identical, but their rows are read-only status/details surfaces.
- Users never receive a worker composer; every user message is routed to Belmont.
- OpenMaus visual structure is preserved even where the Belmont product semantics are stricter.

## Explicit exclusions

- Browser code cannot own the iOS status bar, Dynamic Island, Live Activities or SwiftUI's exact material renderer.
- The PWA uses CSS backdrop-filter equivalents inside the app viewport.
- This is not the official OpenMausBot or Grok Bot app and does not claim trademark affiliation.
