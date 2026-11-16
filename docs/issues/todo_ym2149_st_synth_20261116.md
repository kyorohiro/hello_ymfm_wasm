# Tetorica YM2149 ST Synth

Confirmed on 2026-11-16. The base is ASWAN Synth's layout / Files / Code integration, connected to the existing Atari ST YM2149 endpoint. VGM / VGZ, SNDH and YM reference playback and the browser AY / YM2149 timed operation API are implemented. Concrete high-rate sound-making examples remain follow-up work.

Latest checkpoint: [restart handoff](thread_handoff_20261116_ym2149_timed_api.md).

## Identity

- [x] Product name: **Tetorica YM2149 ST Synth**.
- [x] Repository / distribution slug: `tetorica-ym2149-st-synth`.
- [x] Adopt the cool-gray housing, royal-blue text, white keys, diagonal vents and cyan square-wave icon. Add `ST` to its `SYNTH` text while preserving the original concept.
- [x] Save the selected icon as `docs/tetorica_ym2149_st_synth.png` and `.webp`, at the existing series size of 1254 × 1254 pixels.
- Icon edit prompt: [ym2149_st_icon_prompt_20261116.txt](ym2149_st_icon_prompt_20261116.txt).

## Basic browser Synth first

- [x] Add `docs/synth-ym2149-st/` with the familiar masthead, hamburger menu, Files, Master, Envelope / Waveform / Spectrum and Keyboard / Code layout. Match the chosen icon's gray / blue / white palette.
- [x] Reuse the existing YM2149 endpoint at **2,000,000 Hz, type `0x10`, flags `1`**. Explicitly initialize the client and retain the existing AudioWorklet's output centering. One shared client and AudioContext must serve controls, keyboard and Code.
- [x] Add Auto / CH1 / CH2 / CH3. Align display, parameter editing and keyboard target; selecting Auto must preserve per-channel differences until the user edits a value. Track note ownership so stale releases cannot stop a stolen voice.
- [x] Expose tone period / frequency, tone and noise gates, fixed volume and hardware-envelope selection for each channel. Show that noise period and envelope period / shape are shared hardware settings; writing Shape retriggers the shared envelope.
- [x] Keep numeric controls usable while playing, following the existing Synth drag / minus / plus controls and select-focus behavior. Handle the chip's lowest representable tone when showing keyboard ranges.
- [x] Reuse virtual Files, local project persistence, preset save/load and Cassette import/export. Preset files should remain readable and editable.
- [x] Add Code using the existing shared runtime. Default code should use the chip object returned by `useSoundChip("ay8910")`, `setBpm()` and `beat()`; keyboard and parameter edits should remain usable during Code playback and tab changes.
- [x] Verify actual YM2149 PCM, three-channel allocation, shared-envelope behavior, preset round trips, Code Stop / Apply, keyboard release ownership and Chromium / WebKit layout with physical output muted during automation.
- [x] Add a readable itch.io package, launch links and documentation after the browser entry works.

## Verification

Initial implementation and readable itch ZIP are complete. See [verification_ym2149_st_synth_20261116.md](verification_ym2149_st_synth_20261116.md) and the [packaged Chromium / WebKit report](verification_ym2149_st_synth_browser_20261116.json). Automated speaker outputs were muted; listening remains a user check.

## Follow-up design / research

### Next sound-making examples — proposed, not started

- [ ] Extend the existing periodic Envelope retrigger (Sync-buzzer) Code example: vary melody and retrigger motion independently, inspect R13 writes through `compile()`, and compare Waveform / Spectrum. Keep host timing distinct from original CPU / MFP timing.
- [ ] Add a timed volume-modulation Code example after checking the first example's usability.
- [ ] Explore sample playback through volume writes with explicit rate / timing limits. Do not treat this as a PCM transfer or whole-machine implementation.

These are the next tasks discussed before restart; no example / default-code change has been made yet.

### Timed API implementation — browser AY scope completed 2026-11-16

User authorized implementation after reviewing the design additions. Start with browser AY / YM2149; keep existing immediate APIs and legacy YM2612 scheduling compatible. Use an awaitable `compile()` across all baseline modes. Keep unsupported Native / offline scheduling explicit.

- [x] Implement state-free operation recording and shared AY conversion; verify R7 partial updates, R13 repeated writes and retained levels.
- [x] Add bounded compact named reservations to the existing Performance Queue, with exact output-frame timing, atomic replacement and cancellation.
- [x] Connect authoritative capture, current / client / reset / reusable-snapshot compilation, and sample-accurate Worklet execution.
- [x] Connect Main / Worker and Synth Code lifecycle, including Apply rollback, loop cancellation, stale ownership and Stop.
- [x] Add public declarations / completion, a focused [README example](../synth-ym2149-st/README.md#timed-register-operations) and accurate backend limits; verify browser / runtime behavior with physical speaker output muted.
- [x] Record [verification results and limits](verification_ym2149_timed_api_20261116.md), including real browser checks, 464 historical guards and readable distribution validation, without marking unimplemented chips as supported.

### Research and earlier design decisions

- [x] Decide a reference playback / import path: user requested VGM / VGZ and SNDH / YM reference playback on 2026-11-16. Reuse existing AY VGM rendering and evaluate pinned AtariAudio sources for SNDH / YM.
- [x] Design and validate the first named register reservation API for browser AY / YM2149. Keep loop timing separate from physical channel state; account for shared generators, repeat, Stop, Apply, cancellation and manual edits. Other chip resolvers remain follow-up work.
  - [x] Update [the second API proposal](design_ym2149_timed_writes_api_20261116.md) to separate state-free `build(callback)` recording, execution-time `schedule(operations, {name, repeatSeconds})` and inspection through `compile(operations, {initialState})`. Withdraw build-time copying; preserve immediate APIs and legacy YM2612 `scheduleWrites()` compatibility. This step changes design / TODO only.
  - [x] Review AY R7 partial updates / R13 retriggers, OPN Operator fields / Key On/Off, current / reset compile baselines, order and 44.1 / 48 kHz timing. Record acceptance cases and authoritative-state / reset gaps; these are design checks, not runtime test results.
  - [x] Extend the design with asynchronous `captureState()` and reusable `compile(..., {initialState: snapshot})` baselines. Preserve existing `getState()`, `"current"` / `"reset"`, operation recording and live scheduling. Specify coherent register + semantic state, independent work copies, same-instance / configuration validation and comparison cases; no runtime implementation in this step.
  - [x] Design explicit `initialState: "client"` inspection from existing local state, without readback or new continuous synchronization. Audit AY registers / retained levels / endpoint configuration and OPN / Native semantic-versus-raw gaps; require complete coherent state while allowing a stale / optimistic renderer view. Keep all other baseline / build / schedule contracts unchanged.
  - [x] Use an awaitable `compile()` with ordered authoritative capture for `"current"`, and local work for client / reset / supplied snapshots.
  - [x] Implement and verify non-stopping AY snapshot capture / reuse, compatibility rejection, historical comparisons and no snapshot / live-state mutations.
  - [x] Implement AY client-baseline adapters with complete retained metadata / cached configuration, explicit incomplete-state rejection and no readback / fallback / constant synchronization. Native AY supports valid local / reset inspection; timed execution / authoritative capture rejects explicitly.
  - [x] Implement shared AY resolution, recording, compilation and compact reservations. Verify Main / Worker, Performance Queue, atomic replacement, Run / Apply / Stop, loop generation, guarded scheduled Gates and manual ownership.
  - [ ] Add OPN resolver / authoritative state coverage and its packed-field / key-command tests before exposing this API on YM2612. Existing legacy `scheduleWrites()` is unchanged.
- [ ] Demonstrate audio-rate envelope retriggering (Sync-buzzer), timed volume modulation and sample playback through volume writes. Distinguish host-sample timing from exact original-machine cycle behavior.
- [ ] Leave STE DMA, a complete Atari ST machine, Looper / Event Rec and Tauri as separate follow-ups.

## Reference playback implementation

- [x] Pin and retain AtariAudio's native sources, dependency notices and rebuild recipe; isolate its reference-player WASM from the existing editable AY/YM Synth and SDK artifacts.
- [x] Prepare bounded VGM / VGZ sources using the existing parser and AY renderer, with explicit errors for unsupported chips / configurations. Preserve repeated Shape writes and chip / song clocks.
- [x] Decode SNDH and YM using AtariAudio, including subtune selection and bounded rendering. Expose observed YM register state for Live controls; distinguish raw requested volume from a static editable sound.
- [x] Store original VGM / VGZ in Files `/vgm/` and SNDH / YM in `/music/`, retain them in Cassette, and use one compact song selector above the output monitor. Import / failure / cancellation must preserve the current edited instrument.
- [x] Add Play / Pause / Resume / Stop, position display / seek, Auto update and CH1–CH3 Live display. Use the existing AudioContext / Master / passive output visualizer. Code and reference playback are mutually exclusive.
- [x] Pause selected-channel keyboard audition without discarding the paused song position; capture the selected hardware sound to the editable Synth and save a readable preset through Files.
- [x] Verify actual PCM / snapshots, malformed input and cancellation, resource cleanup, transport fences, all three formats and real Chromium / WebKit playback with speaker output muted.
- [x] Update readable itch packaging, CI / docs and record remaining format or timer limitations accurately.

See [reference verification and format limits](verification_ym2149_st_reference_20261116.md). Human listening and arbitrary collection compatibility remain user checks; commercial music is not included.

## Single Output VGM support

User reported `AY flags 0x2: Support coming soon` and authorized support. This bit selects MAME's tied-channel nonlinear output; clearing the flag or using the existing independent-channel average is not equivalent.

- [x] Port the pinned MAME `build_3D_table` / `mix_3D` path for AY and YM, retaining the existing output of flags 0 / 1 / 0x10 / 0x11.
- [x] Add the same native support to the canonical native SDK, update the authenticated source snapshot, rebuild AY WASM and synchronize runtime artifacts.
- [x] Accept bit 1 in JavaScript validation, retain source flags in VGM / Live snapshots, and avoid applying independent-channel speaker centering to the nonlinear output.
- [x] Compare against original MAME routines; verify actual WASM timing, muting, envelope / fixed-volume combinations and unchanged legacy output.
- [x] Check flags 0x2 VGM replay through source and readable package in Chromium / WebKit with physical output muted; refresh documentation and calibration provenance as required.
- [x] Establish pre-change results for the complete historical calibration guard suite and reconcile obsolete DSP-dependent test assumptions without weakening live validation.
- [x] Retain the original cache identities of two unrelated passive UI modules; authenticate their exact equivalence to the aliases captured in the new calibration reports.
- [x] Rebuild the final readable package after the passive cache restoration and verify the complete historical guard suite plus packaged browser checks.

See [Single Output verification](verification_ym2149_st_single_output_20261116.md). Human listening with the original user file remains a follow-up.

## Existing implementation references

- `tetorica_src/runtime/ay8910synth.js`: tone, noise, volume, envelope and raw register authoring.
- `tetorica_src/runtime/playground_ay8910_audio.js` and `playground_ay8910.js`: endpoint and register client.
- `tetorica_src/runtime/playground_ay8910_worklet.js`: existing sound output and performance queue integration.
- `docs/playground/playground_ay8910_voice_panel.js`: working hardware controls.
- `docs/playground/playground_mode.js`: existing Atari ST model / clock selection.
- `docs/synth-aswan/`: reusable Synth shell and Code / Files patterns.

