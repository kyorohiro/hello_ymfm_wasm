# Vendored DX7 package

This directory contains the `tetorica-msfa-dx7-wasm@0.3.1` npm release payload,
including live operator level/frequency editing and `setFeedback`.
All 25 original package files still match the release tarball byte for byte.
The engine is now rebuilt from the included fixed `tetorica-soundchip-native`
SDK `0.1.2` (`53b33a15f5c4b919b185cb912016eccfbbb6d3a6`) using
`sh scripts/build_dx7_wasm.sh` at the application root. The SDK-built standalone
`msfa.wasm` matches the deployed release bytes: SHA-256
`f5de761e82ea303420fb3aac79a0a59dd053773b81453b955254dd13aac77d6f`.
JavaScript, declarations, package metadata and public APIs remain the 0.3.1 payload.

This release
clarifies that abrupt frequency/feedback clicks are accepted and no automatic
parameter smoothing or interpolation is added. Runtime JavaScript, declarations
and WASM remain unchanged from 0.3.0.
The upstream Google MSFA revision and Apache-2.0 license are retained; local
DSP/adapter changes are recorded in the bundled research/UPSTREAM documents.
No runtime CDN or npm production dependency is required.

- Tarball: `https://registry.npmjs.org/tetorica-msfa-dx7-wasm/-/tetorica-msfa-dx7-wasm-0.3.1.tgz`
- Verified release tarball integrity: `sha512-FOgNSfj1ecVYbhNsfghIjcG+p7vBNfe8p1A3Vm9x6pEPbeOPi+r1SKqJqWk4PwQYHXX+i5vMW/UeS6DlcsliCg==`
- Package license: `LICENSE` (Apache-2.0).
- Third-party notices: `THIRD_PARTY_NOTICES.md`.
- Upstream MSFA license and revision: `vendor/msfa/COPYING`, `vendor/msfa/UPSTREAM.md`.

`README.vendor.md` is Playground's provenance note. Maintain the JS surface in
`w/tetorica-msfa-dx7-wasm/src`, then run `node scripts/sync_dx7_runtime.mjs`
from the main repository to refresh the checked-in copies and Monaco types.
Use `sh scripts/build_dx7_wasm.sh` to rebuild the engine from the verified SDK;
it writes the central build receipt and refreshes both existing Web/docs assets.
`node scripts/sync_dx7_runtime.mjs --wasm` synchronizes the JS first, then calls
that same SDK build. It does not copy the separate checkout's compiled WASM.
Normal JS synchronization retains the engine. A custom output argument to the
build script writes only that directory and does not refresh runtime assets.
Ordinary builds use this vendored copy and do not require that separate checkout.
The Playground integration lives in the adjacent
`playground_dx7*.js` modules. The original package uses a fixed internal
44,100 Hz synthesis rate and supports 44,100/48,000 Hz output.
