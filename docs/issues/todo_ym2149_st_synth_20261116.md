# Tetorica YM2149 ST Synth

Confirmed on 2026-11-16. Basic browser implementation started after the user's instruction to proceed. The base is ASWAN Synth's layout / Files / Code integration, connected to the existing Atari ST YM2149 endpoint. Reference playback and high-rate register reservation remain later work.

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

- [ ] Decide a reference playback / import path. Investigate available YM and SNDH collections and their timing / CPU requirements before committing to a file format or promising complete replay.
- [ ] Design and validate a named register reservation API for high-rate effects after the basic Synth works. Keep loop timing separate from physical channel state; account for shared generators, repeat, Stop, Apply, cancellation and manual edits.
- [ ] Demonstrate audio-rate envelope retriggering (Sync-buzzer), timed volume modulation and sample playback through volume writes. Distinguish host-sample timing from exact original-machine cycle behavior.
- [ ] Leave STE DMA, a complete Atari ST machine, Looper / Event Rec and Tauri as separate follow-ups.

## Existing implementation references

- `tetorica_src/runtime/ay8910synth.js`: tone, noise, volume, envelope and raw register authoring.
- `tetorica_src/runtime/playground_ay8910_audio.js` and `playground_ay8910.js`: endpoint and register client.
- `tetorica_src/runtime/playground_ay8910_worklet.js`: existing sound output and performance queue integration.
- `docs/playground/playground_ay8910_voice_panel.js`: working hardware controls.
- `docs/playground/playground_mode.js`: existing Atari ST model / clock selection.
- `docs/synth-aswan/`: reusable Synth shell and Code / Files patterns.

