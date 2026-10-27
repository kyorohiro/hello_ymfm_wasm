# WonderSwan public Worklet factory and examples

Date: 2026-10-27.

The public npm factory now accepts
`createSoundChip('wonderswan', {execution:'worklet'})`. It creates an independent
AudioWorklet endpoint, supports the shared Mixer, and exposes
`WonderSwanWorkletTransport` for `WonderSwanSynth` on the main thread or a
Worker with a transferred MessagePort. This follows the
[direct factory addition](wonderswan_factory_direct_01.md).

The endpoint uses the actual AudioContext sample rate and the requested fixed
chip clock. Register and RAM reads, RAM uploads, monitor mute and flush use
acknowledged asynchronous requests. A bare transferred port has a real command
barrier; pending requests reject when the endpoint or transport is disposed.
Disposing an endpoint does not close a borrowed AudioContext.

## Output and scheduling

The generic Worklet reuses the existing WonderSwan speaker renderer, including
its tick-aligned midpoint correction. Direct raw PCM remains unipolar and
retains its existing DC component. This is an output policy difference, not a
new chip gain or filter. Mixer source volume remains the unmeasured unity value
`1.0`; the separate endpoint output gain defaults to `0.25`, as for other
generic Worklet endpoints. No Mixer preset value changed.

`scheduleWrites()` accepts absolute AudioContext times and absolute registers
`0x80..0x9f`. It validates a complete batch before queue mutation, preserves
order at equal times, and limits pending writes to 65,536. Its acknowledgement
means the writes were accepted, not that playback has finished. Stop, reset,
disposal and performance-owner cancellation remove pending writes and release
owned gates. The packed Playground timeline remains a separate API.

Dense Voice PCM is queued ahead of playback and consumed with a cursor, without
per-byte timers or `Array.shift()`. Commands are prepared while enqueueing.
The speaker renderer borrows prepared output views; a bounded cache covers
short render spans without allocating a typed-array view for every PCM tick.
Heap growth rebuilds that cache, and the existing owned PCM APIs still return
independent buffers.

## Examples

Three Web and Node examples were added to `w/tetorica-fm2612-examples`:

- Four-channel waveform melody with stereo pan.
- Noise and sweep.
- One second of synthetic 12 kHz Voice PCM, submitted as one batch of 12,002
  writes including gate on/off before playback starts.

Web examples use the generic Worklet and centered speaker output. Node WAVs
deliberately retain raw chip DC and document the difference. All source audio
is synthetic. The catalog, runtime guide and deployment build include the new
examples and WonderSwan assets.

## Validation

- Focused source, real-WASM, processor and transport tests: 94 passed.
- Existing generic YM/OPL/AY processor regressions: 8 passed.
- Existing dedicated Playground, Native, Analyzer, timeline and speaker tests:
  73 passed. Counts above are separate suites, not a unique coverage total.
- Native/WASM raw core comparisons: 126 cases, 3,096,576 frames, 24 specified
  checks, maximum difference zero (`node scripts/check_wonderswan_core.mjs`;
  stdout only). Speaker, prepared short views and heap-growth checks are
  separate tests in the suites above.
- Package build: 293 modules, 27 generated engine pairs and 339 declarations.
- Installed package validation: 985 local references, 15 renderers, all 27 real
  WASM engines, API and NodeNext/Bundler/Browser type checks passed.
- The exact retained archive contains 841 files; every file matches both the
  final stage and its offline installation byte for byte.
- Chromium 153 and WebKit 26.6: actual 48 kHz host-rate metadata, Mixer volume,
  pan and mute, core mute, independent RAM, Stop/restart, queued 12 kHz Voice
  PCM and actual module Worker playback passed. Setting volume to `0.5`
  halved output exactly; mute and completed playback produced zero output.
  All 58 served package assets match the exact archive.
- Examples: all 30 offline Node examples and the static build passed. Both
  browsers passed all three new examples, including real output, edited A4
  pitch/pan, Stop during initialization/playback and restart. Physical browser
  output was muted; these are PCM measurements, not human listening tests.

The public type-union addition invalidated the strict PSG calibration source
receipt. All 18 captures were repeated and every measurement and calculated
gain matched the previous report. Only source provenance changed; the source
guard is still enabled. See
[soundchip_psg_calibration_refresh_02.md](soundchip_psg_calibration_refresh_02.md).

## Release artifact

Package: `tetorica-fm2612@0.2.30`.

Retained archive:
`/private/tmp/ws-worklet-release/tetorica-fm2612-0.2.30.tgz`

- Bytes: 1,637,849.
- SHA256: `37039bfec4786e09163e955a8830b7c32b3db12651c68b41bedd22e8aec298e4`.
- npm SHA1: `6893bb5bc2875a41e35c8733bfe28dbd0d318ab2`.

Published to npm as `latest`; the registry download matches the retained archive
byte for byte, including SHA1 and SHA512 integrity. Publication and final
examples registry dependency status are recorded in
[wonderswan_factory_worklet_01.json](wonderswan_factory_worklet_01.json).
The examples dependency and lock now use the public registry's exact `0.2.30`
URL and integrity. A fresh registry installation and generated `docs/vendor`
both match all 841 files of the browser-tested package. The final docs build
contains 59 examples and 1,069 files, with source and local-link checks passed.
After browser validation, only current-version labels changed in the public
index/runtime pages; example playback code remained unchanged.

The dedicated Playground route, C++ cores, SDK 0.1.4 snapshots and generated
WASM binaries were not replaced by this change.
Main and examples repository changes remain uncommitted. No push, tag, CI
dispatch, itch.io release or examples-site deployment was performed.

## Reproduction

```sh
node --test test/wonderswan-worklet-processor.test.mjs \
  test/wonderswan-worklet-transport.test.mjs test/wonderswan-factory.test.mjs
node scripts/check_fm2612_types.mjs dist/fm2612
node scripts/check_fm2612_package.mjs --skip-build
node scripts/check_wonderswan_worklet_browser.cjs dist/fm2612
```

In `w/tetorica-fm2612-examples`, run `npm run check:node`, `npm run build`,
`npm run check:wonderswan` and `npm run build:docs`.
