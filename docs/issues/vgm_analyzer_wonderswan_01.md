# WonderSwan in VGM Analyzer

Date: 2026-10-27. Implemented and locally verified. No npm publication or commit
was performed. Machine-readable evidence: [vgm_analyzer_wonderswan_01.json](vgm_analyzer_wonderswan_01.json).

## Supported behavior

The Browser Analyzer and shared Node/CLI core now recognize and play a single
WonderSwan VGM/VGZ. Four wavetable voices, Noise, Sweep and direct/streamed
Voice PCM use the existing SDK 0.1.4 WASM core. No external ROM is required.

VGM 1.71 header offset `0xC0` supplies `wonderswanClock`. `0xBC` writes relative
sound-register offsets, and `0xC6` writes physical RAM with a **big-endian**
address. The chip-selection bit is separated from the address. DAC stream chip
IDs `0x21` / `0xA1` route relative register writes without aliasing instances.
The parser validates the 16 KiB RAM range and command bounds. No undocumented
WonderSwan RAM data-block type was invented. Format references:
[VGM 1.71 specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt),
[libvgm command handlers](https://github.com/ValleyBell/libvgm/blob/master/player/vgmplayer_cmdhandler.cpp).

`WonderSwanAudioEngine` applies the same tick-aligned waveform midpoint
correction and cold first-fetch fence as the Playground speaker path. Raw
unipolar chip PCM and the generated WASM remain unchanged. The Analyzer Mixer
wraps the corrected engine output once; the unmeasured WonderSwan default is
unity `1.0`. Source/channel mute advances synthesis while suppressing output.

Normal seeking silently resets and replays register/RAM writes. Stop/replay
reconstructs waveform RAM and registers, retaining the user's mute settings.
No DSP checkpoint/save-state support is claimed. Changing the file's clock
recreates the Browser engine. Heterogeneous mixed headers retain the existing
per-chip Mixer/mute/WAV policy; combined note/instrument analysis is disabled.

The UI provides four channel mutes, Live/Song Note-ish, sheet music and
MIDI / MusicXML / LilyPond / WAV export. Note extraction records wavetable base
pitches only; CH2 Voice PCM, CH3 Sweep and CH4 Noise intervals are omitted.
Waveform harmonics, RAM rewriting, original timbres and modulation are not
transcribed. Mute IDs are `wonderswan-ch-1` through `wonderswan-ch-4`; score
channel IDs are `wonderswan-ch1` through `wonderswan-ch4`.

TFI/VGI/SBI, instrument editing and sample extraction are unavailable. The
existing core does not implement Hyper Voice / DMA; unsupported register writes
fail explicitly. Dual-chip / variant headers are rejected before allocation.
The support dialog, static support page, CLI guide and npm README state these
limits. Module cache version is `wonderswan-vgm-1`.

## Main changes

- `web/ym2612vgm.js`, `vgmplayer.js`: header, command description/dispatch,
  RAM and timed stream routing; generated `docs/js` mirrors are synchronized.
- `web/wonderswanaudioengine.js`: synchronous, device-free speaker renderer.
- `docs/vgm_analyzer/playback_core.js`, `source_mutes.js`, `mixer_ui.js`:
  recipe, configuration/mixed routing and four-channel controls.
- `wonderswan_notes.js`, notes/MIDI/score/timeline modules and
  `vgm_analyzer.js`: observation, export and UI support.
- Command Editor accepts `0xBC` data edits while preserving RAM commands and
  fixed command boundaries. RAM writes remain read-only in that editor.
- CLI factory/staging, standalone Analyzer packaging and BSD-3-Clause notices.
  Original synthetic fixtures contain no game, BIOS or ROM data.

## Validation

- New parser/engine tests: 11 passed. Real Playground Worklet speaker parity:
  24 configurations at 44.1/48/96 kHz and two clocks, **72,864 stereo frames
  with exact PCM equality**. Real stream writes match timed direct writes.
- Shared Analyzer integration and Command Editor: 9 passed, including actual
  WASM, independent mixed-source output, gain exactly once, four mutes,
  reset/replay, seek, WAV and honest export preflight. All-supported-clock
  mixed-engine tests also passed with WonderSwan included.
- Analyzer suite: **554 passed, 0 failed, 1 existing skip**.
- Core/Web suite: 3,571 tests. A pre-existing YM2608 comparison used calibrated
  CLI gain `1.03357` against a unity direct engine; the explicit test reference
  now installs the same Mixer. HEAD/current/calibrated-reference WAVs match
  exactly for FM, SSG, ADPCM-B and rhythm. No production YM2608 change was made.
  The final broad run passed 3,569 tests with two existing Worker timeouts under
  concurrent host load. Both affected files passed separately: **59/59**.
  Those tests also passed in the earlier broad run; their deadlines were not
  weakened. Logs and baseline proof are recorded in the JSON.
- Full WASM SDK regression: **28 artifacts / 55 outputs / 40,360 exact
  comparisons, difference zero**, with an unchanged input snapshot. Reused
  the previously actually rebuilt SDK 0.1.4 artifacts; no new WASM build.
- Existing Analyzer calibration was remeasured: 18 extra-source and 12 PSG
  captures. Every measurement/default value matched the previous reports;
  only source hashes were refreshed. The calibration guard remains enabled.
  Existing Mixer/preset modules and all 55 WASM outputs are byte-identical.
- Real Browser checks passed on **Chromium and WebKit**, in both normal docs
  and the final flat ZIP. Captured the actual output AudioWorklet through a
  measurement Worklet that emits zeros to the physical device. All four voices
  sound, all channel mutes have exact-zero output, and Noise/Sweep/Voice PCM,
  RAM bank `0x1200`, Note-ish, pause/resume, two-second seek and Stop/replay pass.
- `tetorica-fm2612` package generation/install/runtime/declarations passed after
  adding the new engine's options type. An isolated offline install of the
  VGM tarball passed actual Wave/Noise/Sweep/Voice PCM rendering and mutes,
  score exports, required assets/license and the installed CLI.
- Tauri Analyzer imported **396 files**; import verification and Python **6** /
  Node **4** tests passed. Its Rust/desktop shell was not changed.

## Artifacts and next step

Final Analyzer ZIP:
`release/hello_ymfm_wasm_wonderswan-dev_itch_vgm_analyzer.zip`

SHA-256:
`d9e068525898ec91a54d65af850f547152785a18d29c0882f6a2d9ede3630c06`

Tauri Analyzer imports exactly this ZIP. Both repositories have uncommitted
changes. Playground Tauri and the SDK repository were not modified in this
turn. Package versions remain unchanged and the local tarball is not a release.

Next: audition a real WonderSwan VGM/VGZ in Analyzer, then commit/push the main
and Tauri Analyzer changes and run their CI. Automated output checks do not
verify perceived noise, hardware accuracy, real-time deadlines or actual Tauri
WebView audio. No game soundtrack was used in the automated tests.
