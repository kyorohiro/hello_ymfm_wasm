# Vendored DX7 package

This directory contains the `tetorica-msfa-dx7-wasm@0.3.1` npm release payload,
including live operator level/frequency editing and `setFeedback`.
All 25 package files match the release tarball byte for byte. This release
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
After rebuilding native DSP, use `node scripts/sync_dx7_runtime.mjs --wasm`
to refresh the engine explicitly; normal synchronization retains the engine.
Ordinary builds use this vendored copy and do not require that separate checkout.
The Playground integration lives in the adjacent
`playground_dx7*.js` modules. The original package uses a fixed internal
44,100 Hz synthesis rate and supports 44,100/48,000 Hz output.
