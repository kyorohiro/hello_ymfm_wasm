# Tetorica YM2149 ST Synth

Confirmed on 2026-11-16. The base is ASWAN Synth's layout / Files / Code integration, connected to the existing Atari ST YM2149 endpoint. VGM / VGZ, SNDH and YM reference playback is implemented. High-rate JavaScript register reservation remains later work.

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

- [x] Decide a reference playback / import path: user requested VGM / VGZ and SNDH / YM reference playback on 2026-11-16. Reuse existing AY VGM rendering and evaluate pinned AtariAudio sources for SNDH / YM.
- [ ] Design and validate a named register reservation API for high-rate effects after the basic Synth works. Keep loop timing separate from physical channel state; account for shared generators, repeat, Stop, Apply, cancellation and manual edits.
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

