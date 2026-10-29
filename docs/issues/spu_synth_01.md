# Tetorica SPU Synth — standalone sound laboratory

Date: 2026-10-29

Product name: **Tetorica SPU Synth**

Description: **PlayStation 1 SPU synthesizer / emulator**

## Implemented

- Independent `/synth-spu/index.html`, styled after `/synth/`. Linked from the
  English and Japanese landing pages.
- The existing generated PS1 WASM, `Ps1Synth`, resampler, voice inspector and
  Playground voice editor are reused. No new C++ core, SDK snapshot edits,
  Native backend changes or shared chip-runtime changes.
- All 24 physical voices have independent editable sine cycles. The editor
  provides PCM drawing and shapes, numerical and draggable ADSR controls,
  raw ADSR words, stereo volume, pitch, per-voice reverb sends, and shared FX.
- Guitar / Bass / Ukulele computer and pointer keyboard, frets, octave shifts,
  sustain, and an atomic ±2-semitone pitch bend. The keyboard plays the selected
  physical voice. Audition identity prevents old releases from ending a newer
  note. Stop cancels pending keyboard starts and clears all voices and FX tails
  without clearing the sample bank.
- File audio is decoded with a preparation-only OfflineAudioContext at
  44.1 kHz, averaged to mono, and encoded in a separate worker. Root MIDI tuning,
  optional full-sample loop and free-RAM bounds are explicit. No silent
  truncation to capacity; loop boundary alignment drops at most 27 PCM frames.
- Versioned `.spu.json` instruments contain sample ADPCM, tuning, complete
  voice preset, shared reverb settings and short-cycle drawing data when
  available. The complete file is validated before applying it. File-loading
  epochs discard stale decode/encode/import responses.
- Audio starts only after a user action. The worklet sends no state messages
  per audio block. View updates are coalesced into requestAnimationFrame after
  explicit edits, notes and Refresh voice. Master gain uses the existing
  calibrated PS1 System value, with a visible 70% initial master control.
- The standalone worklet passes a `locateFile` callback alongside injected WASM
  bytes, matching the existing Playground approach. This fixes the initial
  real-browser startup failure where the Emscripten fallback referenced `URL`,
  which is absent in AudioWorkletGlobalScope. The generated factory is unchanged.
- Startup failure and a later closed AudioContext can be retried explicitly.
  Disconnecting the failed panel cannot implicitly create another audio engine.
  A recreated engine starts with Sine voices, and the instrument labels and
  restart message reflect that reset rather than claiming the old sample remains.

## Verification

`npm run test:spu-synth` passes **15 tests**. These include real-WASM PCM parity
at 44.1/48 kHz, missing-URL/Node-global startup with a failing negative control,
manual leases, live/deferred ADSR, atomic pitch changes, Stop silence,
sample-inclusive preset round trips, reserved ADSR bits, malformed input,
stereo conversion, RAM and loop boundaries, and isolated ZIP/source validation.

The source UI passed Chromium 153.0.8010.12 and WebKit 26.6. Checks use real
AudioWorklet PCM and public controls: 24 voices, 440 Hz playback, Keyboard,
ADSR dragging, no bend retrigger, audio import, preset download and restoration,
and exact silence after Stop. Captured PCM is independently checked with a
continuous pilot. The two source-browser cases contain 12/13 captures and 122,880/126,976
stereo frames respectively, with no reported clock anomalies. Desktop 1440px
and mobile 390px layouts have no horizontal overflow. Physical speaker output
is permanently muted by the checker; this is not human listening evidence.

The final distribution passes both browsers, including idle-without-inspection,
an actual closed AudioContext, explicit user retry, correct Sine labels after
the fresh engine, and new 440 Hz PCM. Chromium has 14 captures / 143,360 frames;
WebKit has 17 captures / 155,648 frames. All captured pilots are continuous and
both report zero clock anomalies. Every ZIP member is byte identical to the
tested stage, all served runtime hashes match, and the ZIP CRC passes.

Evidence: [final browser report](spu_synth_browser_01.json),
[distribution receipt](spu_synth_distribution_01.json), and
[earlier source UI report](spu_synth_source_browser_01.json).
The [pre-label-fix report](spu_synth_browser_pre_recovery_label_01.json) is
preserved unchanged as historical evidence. The final retry checker waits for
the public Audio ready state; merely observing a newly constructed running
AudioContext was too early for asynchronous WASM initialization in WebKit.
`actionlint` passes for the new workflow. Physical output remains muted; no
human listening, hardware comparison or remote CI run is claimed.

## Distribution

```sh
sh scripts/package_itch_spu_synth.sh dev
```

Creates `release/tetorica_spu_synth_dev_itch.zip`. The final application build
contains **45 files / 271,814 bytes**, SHA256
`277d38b00144569ae8257a1f9a65006afaf6680c240cbc3c1ebc9b32eae1d54a`.
The root `index.html` runs directly, and the `/synth-spu/index.html` entry is
also retained. Main, audio worklet and preparation worker are separately
bundled and minified. The original local Emscripten factory remains byte exact.

The archive contains the verified 24-input / 28-file PS1 source closure,
upstream and Tetorica licenses, build receipts, and a ZIP of the original
browser bundle inputs with a hash receipt. All runtime dependencies are local;
no repository checkout or external CDN is required to play the instrument.

`.github/workflows/spu-synth.yml` tests the actual extracted archive in both
browsers and retains the ZIP and diagnostics as a build artifact. This task
does not run remote CI or publish to GitHub Releases, npm or itch.io.

## Current scope and follow-up

This is the first standalone Browser version. The session is in memory; save
instruments before closing/reloading. The keyboard is a selected-voice
instrument rather than an automatic 24-voice allocator. Microphone recording,
the longer-sample crop editor, a complete virtual-file project, output
recording/looper, MIDI and Native output are possible later extensions.
Playground retains its existing recording and Sample Editor features.

Public instructions: [SPU Synth guide](../synth-spu/README.md).
