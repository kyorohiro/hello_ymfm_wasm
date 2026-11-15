# SCSP Synth SSF Live view

Requested 2026-11-15. Show the 32 physical SSF playback slots and inspect the
selected slot through the existing PCM / Envelope / LFO / mix interface.

- [x] Add passive native SSF snapshots without changing sound generation.
- [x] Retain bounded snapshots aligned with the audible transport position.
- [x] Add 32-slot activity and a slot selector with Live enabled by default.
- [x] Project the selected slot into the existing editor controls and canvas.
- [x] Keep Pause snapshots frozen while switching inspected slots.
- [x] Restore the authored instrument view when Live ends.
- [x] Replace the SCSP icon with `docs/tetorica-scsp-synth.webp` in the page,
      packaging and relevant automated checks.
- [x] Verify actual WASM, mute physical browser output and test the ZIP.
- [x] Update guide, source kit and CI with the implemented scope.

Capture, paused keyboard audition of the selected song slot and manual
song-register editing are follow-up tasks.

## Implemented behavior

Play an SSF / MiniSSF and select a physical slot from the 32 activity buttons
or selector. The existing single canvas shows up to 256 raw samples from its
programmed start address. Existing Envelope, LFO and mix controls show the
same snapshot, with a read-only sound-stack modulation section. The displayed
rate is the hardware sample playback rate, since the original root note is
unknown. Noise / zero sources and programmed loop boundaries are identified.
This is raw sample data before interpolation, source-bit operations and EG.

The native ABI 2 observer copies all slot fields and 512 KiB RAM at one native
boundary without register reads, writes or advancing the CPU. The transport
chooses the latest snapshot at or before the audible frame, including native
588-frame output buffering and Web Audio lookahead. Retention is bounded to
16 snapshots (about 8 MiB of RAM copies); typical playback uses a few MiB.
Live Off stops snapshot acquisition. Pause retains the same snapshot while
switching slots or toggling Live Off / On.

Live Off, Stop and natural end restore the authored instrument, including
unapplied PCM drawings and tuning. The first audio startup also preserves a
draft when the editor migrates to its audio sample bank. Shared-panel passive
draft checkpoint methods have focused tests and an exact source revision
receipt; historical mixer measurements and DSP code remain unchanged.
Selecting an authored preset exits Live while retaining the song transport.
The keyboard continues to play the authored Synth independently.

The checked build overlay leaves pinned upstream sources unchanged. Its
`ssf_observer.inc`, wrapper, build recipe and licenses are included in the
standalone source kit. The user-supplied icon is copied without alteration.

## Verification

- 120 SCSP unit / actual-WASM / packaging tests passed.
- 110 mixer-calibration tests and the existing source-navigation receipt check
  passed. New draft receipt tests reject changed DSP, extra source edits,
  detached records and modified historical measurements.
- Observed and unobserved native rendering produces byte-identical PCM and
  state. ABI 2 also matches the previous ABI 1 player for original fixtures.
- The actual review ZIP was independently extracted. Chromium and WebKit
  passed 10 Live scenario groups each: native CPU / parameter / RAM updates,
  audible-frame alignment, Pause / Resume, slot changes, read-only controls,
  draft restoration through Apply PCM, natural end, VGM / Code switching,
  one AudioContext and 1240 px / 390 px layouts.
- Existing basic Synth, Code / Files, VGM Song and SSF folder browser
  regressions also passed both engines against the extracted review ZIP.
- All 12 local Can Can Bunny songs rendered 132,300 frames (three seconds)
  each using the ZIP's modules and WASM. PCM was finite and nonzero; 33
  snapshots per song had 32 slots, 512 KiB RAM and monotonic native frames.
  All 12,672 slot-preview reads were safe. No audio device was created and
  no game data was copied into the source or distribution.
- Building only from the ZIP's `sources/ssf-player/` with fresh build, cache
  and output directories recreated byte-identical JavaScript and WASM.
  Shipped / rebuilt PCM and observer On / Off PCM plus final slot / RAM
  state matched for an original 44,100-frame 68000 sine fixture.
  ABI 2 WASM SHA-256:
  `08b59f72d811dc51275f5958b7283cc875ee2812c1cc7f65e734d440a92444e5`.
- Physical browser output was muted throughout; these checks measure PCM
  and UI state. Human listening and long-duration reference comparisons
  remain pending.

```sh
npm run test:scsp-synth
npm run test:scsp-synth:live-browser
node --test scripts/mixer_calibration_scsp_draft_revision.test.mjs
```
