# DMG timed register API — 2026-11-20

Authorized after the Code workspace rollout. Implement the existing shared
build / schedule / compile / captureState contract for Game Boy APU operations,
then expose it through DMG Synth Code and existing Web Audio clients. No npm
publication, release, Tauri import, remote CI, new renderer or mixer change.

- [x] Define a bounded recorder for the existing root/Pulse/Wave/Noise register
  controls, notes and raw Gates. Reuse GameboySynth conversion/validation;
  no duplicate frequency, Envelope, Sweep or packed-register formulas.
- [x] Record serializable operations and absolute atSample/atSeconds offsets
  without copying/changing live state. Support referenceSampleRate (44100 by
  default), stable equal-time order and repeated trigger writes.
- [x] Keep sent-register and configured-voice metadata distinct, including
  initialized/power state and chip clock. Resolve packed partial updates at
  application time. Bound Wave RAM payloads to the APU's 32 four-bit samples;
  its existing DAC-stop/retrigger semantics remain explicit. Lifecycle/reset,
  clock changes or unsupported operations must reject explicitly rather than
  silently behave differently from immediate APIs.
- [x] Add detached compatible captureState snapshots and compile current /
  client / reset / supplied snapshot. Client/reset/snapshot paths do not ask
  the renderer for state; captures do not stop audio. Compile returns only
  operation-produced structured register writes and never changes live state.
- [x] Reuse Performance Queue for Worklet sample-clock execution, compact
  repeats, named replacement/cancel, staged Run/Apply transactions and loop
  ownership. Reject the whole invalid reservation while retaining existing
  schedules. No JavaScript timer fallback or callback in the audio thread.
- [x] Integrate with DMG's borrowed physical APU, manual keyboard/CH edits,
  accepted author checkpoint, Gate ownership and Stop. Canceled old schedules
  must not release later manual notes. View/file changes do not retire Code.
- [x] Wire existing Playground/Main/Worker/runtime Web Audio routes and types
  where the shared client is exposed; retain immediate APIs and report Native
  timed execution/capture limits explicitly. No unimplemented backend claim.
- [x] Add editable Synth examples and readable API documentation. Avoid a new
  examples button; preserve existing edited files and working/saved semantics.
- [x] Verify real APU register order/PCM, partial updates, repeated triggers,
  snapshot reuse/immutability, compile/execution agreement, interleaved manual
  writes, invalid reservations and 44.1/48 kHz timing. Test lifecycle/Apply/Stop
  and source/readable ZIP in physically muted browser checks.
- [x] Synchronize canonical runtime/declarations and generated mirrors with
  existing build tools, complete required artifact checks, and record verified
  capabilities separately from remaining backend work.

Shared contract: [rollout index](todo_synth_timed_register_api_20261119.md).
DMG tracking: [alignment TODO](todo_dmg_synth_fm2612_alignment_20261119.md).

## Verified implementation

- Canonical modules: `gameboy_operations.js`, `gameboy_timed_state.js`,
  `gameboy_timed_client.js` and `gameboy_timed_processor.js`. The resolver
  delegates register conversion to an isolated existing `GameboySynth`.
- Root / Pulse / Wave / Noise controls retain physical CH1–4 semantics. Captures
  retain 48 sent bytes, 48 configured voice bytes, clock and power/initialized
  metadata. They are operation-resolution snapshots, not oscillator save states.
- `reset` is genuinely powered off: raw traces compile locally; high-level
  operations require initialized state. Shared clients can compile from their
  existing complete `client` shadow. The borrowed Synth facade deliberately
  rejects `client` because no complete local shadow exists; supplied captures
  provide the local reusable comparison path.
- Existing immediate APIs remain immediate. Lifecycle/reset and clock changes
  are outside the recorder. Native capture and execution reject explicitly;
  a timer fallback and new continuous synchronization were not added.
- Editable Files defaults: `examples/timed-pulse.js`, `timed-noise.js` and
  `timed-wave.js`. Existing edits and pending deletions are kept, and insertion
  is atomic if a project is full. New Cassette includes the same examples.
- Stop teardown retires reservations and the borrowed lease even if native
  release/checkpoint cleanup fails; the original fatal error is reported once.

## Local verification — 2026-11-20

- `npm run test:dmg-synth`: **336/336** passed, including actual-WASM timed
  integration and the readable package checks.
- `npm run test:dmg-timed`: **69/69** focused recorder/client/Worklet/runtime/type tests;
  additionally all five native-fault teardown regressions passed. Real APU
  compile/execution agreement uses both 44100 and 48000 Hz output rates.
- Shared timing/ownership regression set: **264/264** passed across Performance
  Queue, Runtime, AY, YM2612, HuC6280, PS1, WonderSwan, Sega PSG and OPLL.
  The HuC mirror check now accounts for generated import cache tokens while
  retaining the exact executable body and import paths.
- `node scripts/check_fm2612_types.mjs`: complete local package built with
  **400 modules and 461 checked declarations**; installed NodeNext/Bundler and
  browser consumers include positive/negative Game Boy timed API checks.
  `node scripts/check_web_runtime.mjs dist/fm2612` passed.
- Runtime artifact check: **33 builds, 68 outputs, 75 mirrors**, unchanged
  native/WASM receipts. Playground's explicit package inventory includes all
  four new modules.
- Physically muted browser matrix: **8/8 cases, 48 stage checks**, source and
  actual extracted readable ZIP × Chromium/WebKit × real Monaco/fallback.
  Build/compile/captures, compact repeats, ownership/manual Gate, valid/failed
  Apply, stopLoop, Stop/restore, Wave RAM, source navigation, narrow layout and
  nonzero paused VGM position passed. Public Main/primary and transferred real
  Worker → AudioWorklet routes also passed at 48000 Hz in both browsers.
  Evidence: `build/dmg-timed-20261120/browser-matrix.json` and its four reports.
  This is automated PCM/behavior verification; no listening was performed.
- Tested readable ZIP: **143 files**, SHA-256
  `16eeb6344ebf9bd4489cf008b8245323d37a165dd9446b1cb6dbaf383722aaa2`,
  at `build/dmg-timed-20261120/package/tetorica_dmg_synth_timed-final_itch.zip`.
- Ordinary playback parity: **180 cases / 737280 stereo frames**, old/new
  canonical clients + actual WASM Worklets + shared Performance Processor,
  44100/48000 Hz and 4194304/4000000 Hz chip clocks. All PCM was bit-identical
  with timed operations inactive. See `gameboy_timed_default_pcm_01.json` and
  the exact source revision receipt; original mixer reports/levels were retained.
  Both existing mixer generation freshness checks passed. The new exact-source
  guard, mutation rejection and existing calibration/generator tests passed
  **71/71**; independent review restored all 120 before-source bodies exactly
  to the pinned predecessor commit. SID source artifact checks also passed.

## Remaining separately authorized work

- [ ] Human listening to Pulse / Wave / Noise examples and manual performance.
- [ ] Native sample-clock execution and authoritative captures, if requested.
- [ ] Publish the new package APIs in a later npm release, if requested.
- [ ] Looper / Event Rec, highlighting and common output-only channel switches
  remain the separate alignment backlog; they are not part of this port.

No commit, push, tag, publication, remote CI or Tauri import was performed.
