# Product facts

Checked: 2026-09-01

## OpenMausBot reference

- Repository: `https://github.com/milind-soni/OpenMausBot`
- Inspected commit: `6140532ea63e50bc234c34c488a79ff908bfc7f5` (current `main` on 2026-09-01)
- License: Apache-2.0. Preserve the upstream license and notices when copying code.
- `ios/` contains a native SwiftUI mobile companion and CompanionCore client.
- `companion/` is a native-device sidecar, not a web client. It exposes a narrow allowlisted API and rejects requests carrying a browser `Origin` header.
- No service worker, web app manifest, or other PWA implementation was present at the inspected commit.

## Local design decisions

- Port the public OpenMaus iOS visual system, not only its information hierarchy: mascot silhouette, exact idle face geometry, named palette, system typography, row geometry, Bézier bubble tail, QR-first pairing, approval card, glass controls, dictation composer and action sheet.
- Preserve the native cyan/blue palette. The earlier no-blue decision is superseded by the user's explicit request to carry the chosen design over unchanged.
- The user chats only with Belmont. Worker bots are read-only managed-work rows.
- Product nouns are substituted (`Scout` → `Belmont`, specialists → managed workers) without changing the visual grammar.
- iOS-owned surfaces—status bar, Dynamic Island, Live Activities and exact native material shaders—cannot be reproduced by browser code. They are excluded from visual parity; the app-owned viewport is in scope.
- The exact OpenMaus silhouette and reference app-icon vectors are retained under `icons/`; Apache-2.0 license and NOTICE copies are under `third-party/openmausbot/`.
- The icon source is the byte-identical 256px Grok Bot renderer icon preserved by Belmont (`icons/grok-bot-app-icon.png`, SHA-256 `79e6a73e634ce7ad8d1982739e9064bcc9c9ec5106bdd7281d7514ee68169ad2`); manifest-ready 192px and 512px files are resized derivatives of that source.
- Browser QR scanning uses the platform `BarcodeDetector` and camera APIs; unsupported browsers retain the nested manual route instead of pretending the scan succeeded.
