# YM2149 volume-register sample example — 2026-11-17

Scope: `examples/volume-sample.js`, using the existing browser AY recorder,
compiler and scheduler. Shared runtime, DSP, WASM, mixer gains and the default
starter `index.js` are unchanged.

## User workflow and behavior

Reload the Synth, open Files, select `examples/volume-sample.js`, switch to Code
and Run. Startup adds missing examples after restoring saved Files; it preserves
edited examples and `index.js`. New Project includes the same current examples.
File discovery, selection and restoration never start audio or Code.

The script generates an original 80 ms percussion waveform at an 8 kHz reference
rate. CH1 Tone, Noise and hardware Envelope are disabled. Each generated sample
maps to the nearest of the included YM2149 model's 16 nonlinear fixed-volume
gains, derived from its resistor table and 1 kΩ load. This avoids the amplitude
error of rounding `sample * 15`. The positive-lobe source deliberately has an
envelope bias and zero endpoints; it is not general signed PCM conversion or a
calibration of a physical chip.

The recorded pattern contains 640 data writes plus R8 = 0 at reference sample
640. `compile(..., {initialState: "client"})` exposes all 641 rows; Console
previews only the first 24 and labels that limit. Each hit reserves one pass,
without `repeatSeconds`. The Worklet applies individual sample writes. The
`drums` loop uses `beat(1)` for hit spacing, so BPM changes the spacing while
the sample duration stays 80 ms. The loop still has the existing JavaScript /
acknowledgement overhead; the beat-level retriggers are not a sample-locked
drum sequencer.

The same reservation name replaces unfinished future work. Faster retriggers
therefore cut tails rather than layer voices. Stop or removing the entire
`drums` loop on Apply cancels future writes, then its `liveCleanup()` callback
writes zero. Keeping a loop while deleting only its `schedule()` line does not
clear an existing reservation; explicit cancellation must run within that owner.
Manual CH1 writes compete in application order; CH2 / CH3 remain available.

## Verification

- `npm run test:ym2149-st-synth`: 170/170 pass, including three new tests and the
  existing deterministic readable-package checks.
- The actual editable script executes against production AY authoring /
  recording / compilation. Tests inspect generated samples, nearest-gain
  quantization, setup, all 641 R8 writes, absolute offsets, the 8 kHz reference
  rate, one-shot options, beat spacing and loop cleanup.
- Real shipped WASM at 44.1 / 48 kHz renders compiled writes. The terminal zero
  occurs at output frame 3,528 / 3,840. Settled output levels match an independent
  source-resistor oracle within 2e-8; timing rounds within half an output frame.
  Raw chip PCM returns to its zero-code electrical baseline after the terminal
  write. The browser speaker path centers / mutes that baseline as before.
- [Source browser report](verification_ym2149_volume_sample_browser_20261117.json)
  and [package browser report](verification_ym2149_volume_sample_package_browser_20261117.json)
  pass Chromium / WebKit. Checks use real Files / Code UI, actual 641-operation
  reservation payloads and acknowledgements, pre-mute PCM pulses and zero-RMS
  rests. Applying BPM 120 → 240 shortens hit spacing while preserving codes and
  the 80 ms duration. Console shows 24 rows of the full compile result.
- Loop removal and mid-shot Stop cancel future writes and silence CH1. A
  subsequent sentinel register value remains stable after cancellation ACK.
  Browser Stop was observed 10.7–24 ms into the 80 ms shot. Each run retains one
  AudioContext / synth Worklet; every physical output passes through zero gain.
- [Package HTTP-cache regression](verification_ym2149_volume_sample_cache_browser_20261117.json)
  passes both browsers. The old startup graph and three-definition example
  module remain cached while versioned current modules supply four definitions,
  including the exact new sample source, without altering saved data or opening
  audio. No Playwright request routing disables the cache under test.
- [Package New Project regression](verification_ym2149_volume_sample_new_project_browser_20261117.json)
  passes both browsers: fresh Files, export contents, cancellation, modal keys,
  reload and saved-data checks include the new example.
- Both mixer-default generators pass `--check`; `git diff --check` passes.
  Browser reports have no uncaught errors or missing local resources.

Browser checks use the local text-editor fallback with external CDN loading
blocked, at 48 kHz output. The WASM tests separately cover both output rates.
Overlapping browser hits were not exercised; same-name replacement uses the
existing scheduler. Human listening and Atari ST CPU / MFP cycle accuracy are
not claimed. No game sample or audio-file import is added.

## Distribution

Generated locally:

- `release/tetorica_ym2149_st_synth_volume-sample-20261117_itch.zip`.
- 202 files, 2,448,297 bytes.
- SHA-256: `305a64309515acc047d1d24ddb995ee517aa7dec517e7c78d2217620563026f9`.

The entry → Synth → Code host → Files → examples chain uses `ym-sample-1`.
The example module and application JavaScript in the stage and ZIP are byte-for-
byte copies of current source. Guide links receive the existing distribution
rewrite; the original inputs remain in the source archive / receipt.

No commit, tag, npm publication or release upload was performed.
