# Shared Sega PSG / YM2413 timed API verification

Date: 2026-11-20. Scope: promote the established SMSGEAR timed operation API into the reusable runtime and distribution. No package version bump, npm publication, commit, push or tag is part of this change.

## Implementation

- Canonical modules live in `tetorica_src/runtime/segapsg_{operations,timed_state,timed_client,timed_processor}.js` and the corresponding `ym2413_*` files. Served mirrors retain authored readable code.
- Main and Worker factories expose `build`, `compile`, `captureState`, `schedule` and `clearSchedule`; the generic performance sender recognizes both timed RPC families. Existing Run / Apply / Stop ownership and atomic admission are reused.
- SMSGEAR's old module paths are compatibility re-exports. The application uses the common clients and Worklets without attaching the same capability twice. Public Playground declarations replace its duplicate API definitions.
- Native preserves immediate bridge operations. Local recording / reset compilation are available; authoritative capture and audio-clock scheduling explicitly reject. OPLL client compilation uses its existing complete local shadow. PSG client compilation explicitly rejects the incomplete local shadow.
- Public declarations, source navigation, readable Node / browser / Playground examples, npm file inventory and Playground packaging include the shared API. Existing wildcard package subpath exports are retained.
- Hardware reset / initialize retains its reservation-clearing behavior. Primary runtime chips are already initialized. A redundant reset in a Worker Code entry can execute later through existing lookahead and clear an already-admitted reservation; the shared scheduling examples use the initialized primary instrument. This was reproduced with actual Performance Sender metadata and a reset at frame 4800, without changing runtime reset semantics.

## Verified locally

- Existing SMSGEAR tests: **100 passed**, including actual Worklet/WASM, strict Code examples, current/reset/snapshot compilation, per-drum ownership and cached VGM seek compatibility.
- Targeted shared runtime / Native / Worker tests: **197 passed**, including the new 21-case common integration suite. The public declaration suite adds **2 passed**.
- Monaco source definition tests: **19 passed**. Recorder, snapshot, compiled writes and runtime methods navigate to real readable shared sources.
- [Default Worklet PCM comparison](sega_timed_default_pcm_01.json): **456 cases / 1,867,776 stereo frames**, exact old/new float output. Fixed predecessor commit `24bbdeaf7eb03a44766f291d6998818213c18dc5`; 22.05/44.1/48/96 kHz, two clocks, tone/Noise/stereo/User/ROM/Rhythm scenes and variable audio block sizes. No AudioContext or output device was created.
- Source app and extracted standalone ZIP: Chromium and WebKit passed the existing browser interaction, timed Code and transport checks. Every physical destination was permanently muted; audio was inspected upstream of zero gain.
- SDK import verification and all generated runtime artifact mirrors pass. No C/C++ core or WASM changes are included.

## Distribution and provenance

- Production package build passed and generated / strictly checked **457 declarations**. The full isolated installed-package checker passed, including all existing chip renderers, source/license assets, positive / negative consumers and the exact Node example. Its CLI main-file test now resolves symlinks so `/var` and `/private/var` temporary paths work identically.
- Candidate retained at `build/sega-timed-promotion/tetorica-fm2612-0.2.45.tgz` for local review only: **2,979,781 bytes**, **1,352 files**, SHA-256 `04b9129917a05453beec8e9b3a597dd2cdb4956e204d4b484793b89d3018d20b`. Version **0.2.45** is unchanged and this artifact is **unpublished**.
- The saved candidate's 1,352 file bodies match `dist/fm2612` exactly. Its 20 runtime / WASM source hashes match the browser-tested installed consumer; final installed Node / CLI / NodeNext / Bundler checks also passed against this saved tarball itself.
- Installed consumer browser integration: **16 passed** (Chromium / WebKit × Main / Worker × 44.1 / 48 kHz × PSG / OPLL). Verified reusable snapshots, concrete compilation, named reservations, actual oscillating PCM, Clear and Stop. Physical destinations remained at zero gain. Reports and hashes: `build/sega-timed-promotion/npm-browser.json` and `npm-candidate.json`.
- New [strict source receipt](sega_timed_source_revision_01.json) pins 30 complete fixed-Git predecessor pairs and 676 dependencies. Existing mixer policy source files and gain values remain unchanged. PS1 / WonderSwan / POKEY / SCSP each have fresh raw and verification matrices (8 total), with finite continuous PCM and permanently muted output.
- Verification matrices compare the immutable authoritative `*_ws_timed_*` policies, as the previous YM2413-state revision did. Raw remeasurements remain measurements and do not replace policy gains. In particular, a sixth-decimal POKEY remeasurement difference was not used to rewrite the shipped policy.
- Source freshness guards remain strict. The new guard's 6 tests passed, including dependency / evidence mutation rejection. The broad historical guard suite completed 267 / 268 passes while the receipt was being repinned; the one concurrent-write rejection was then rerun against frozen evidence and passed, along with its entire 5-test AY file. Test-only archival inputs add 26 complete Git originals; earlier receipts and archived entries are retained unchanged.
- Remaining Generator / historical archive tests: **36 passed**, including deterministic defaults, npm policies, negative provenance checks and complete fixed-Git archival integrity. No additional fixes were required.
- Production Playground default and common mixer policy checks both pass. Generated artifacts and SDK import checks also pass.

Human listening with real game material remains separate from these automated checks. This change makes no new hardware accuracy claim.
