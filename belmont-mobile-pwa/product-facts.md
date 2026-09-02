# Product facts

Checked: 2026-09-02

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
- The project and installed app are named `Linear`; `Belmont` is the single chief-of-staff bot. Product nouns are substituted (`Scout` → `Belmont`, specialists → managed workers) without changing the interaction grammar.
- iOS-owned surfaces—status bar, Dynamic Island, Live Activities and exact native material shaders—cannot be reproduced by browser code. They are excluded from visual parity; the app-owned viewport is in scope.
- The exact OpenMaus silhouette and reference app-icon vectors are retained under `icons/`; Apache-2.0 license and NOTICE copies are under `third-party/openmausbot/`.
- The active project mark is `icons/linear-app-icon.svg`, with 256px, 192px and 512px PNG derivatives used by the browser and installed PWA. Preserved Grok Bot artwork remains historical source material and is no longer the installed icon.
- Browser QR scanning uses the platform `BarcodeDetector` and camera APIs; unsupported browsers retain the nested manual route instead of pretending the scan succeeded.
