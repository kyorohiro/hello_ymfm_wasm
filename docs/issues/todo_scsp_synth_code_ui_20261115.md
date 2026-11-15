# SCSP Synth UI and Code integration

Requested 2026-11-15. Match the FM2612 / SPU Synth input workflow and add
JavaScript performance over the existing SCSP. Start from a clean parent tree.

## Basic Synth

- [x] Use the shared Keyboard / Code input, fretboard, Octave and Pitch controls.
- [x] Add Files, local recovery, Cassette import / export, Monaco completion,
      implementation navigation and expanded Code.
- [x] Run Code on the same SCSP, authored operator settings and Master output.
      Keep Code running through Keyboard view, manual keys and parameter edits.
- [x] Preserve PCM / EG / LFO, fixed 2 / 4 / 6-op routes, source sample ownership,
      preset compatibility and safe replacement / release behavior.
- [x] Match numeric and choice input behavior to FM2612 / SPU. Keep waveform
      editing on the existing single canvas with operator selection.
- [x] Mark DSP programming as under construction. Keep the current fixed Delay
      available as an experimental, collapsed section with its saved settings.

## Recorded playback

- [x] Verify SCSP VGM specification, existing parser support and test fixtures.
- [x] Select SCSP VGM / VGZ as the initial playable input and record commands.
      SSF / MiniSSF playback needs a sound-CPU player and dependency handling.
- [x] Keep original recordings in `vgm/` and authored JSON sounds in `presets/`.
- [ ] Add song-slot Live display and capture after this first playback path.
- [ ] Investigate SSF / MiniSSF with a 68000 execution environment, bus,
      timing, interrupts and library resolution.

## Verification and distribution

- [x] Exercise the real WASM with muted physical outputs in Chromium / WebKit.
- [x] Verify Code / manual coexistence, file persistence, editor visibility,
      old presets and an independently served readable ZIP.
- [x] Update the guide, package assets and CI for the new entry points.
- [ ] Listen to the actual instrument and an available real SCSP VGM on a user
      machine. Automated browser checks mute physical output and measure PCM.
- [ ] Verify the new SCSP workflow on GitHub after committing and pushing.

## Implemented scope

`useSoundChip("scsp")` borrows the current authored patch and the same editor
AudioWorklet. Musical methods address logical performance lanes 0–31 and
allocate full PCM / FM groups. Source edits address A–F through indices 0–5.
Preset selection keeps Code and held keyboard identities alive. Held groups
retain PCM and remain releasable on keyup. Keyboard / Code view changes keep
the runtime running. The smooth ±2-semitone wheel uses transient pitch bend,
while portable transpose remains an integer. Master accepts 0–380 percent.

The VGM transport supports a single 22,579,200 Hz SCSP, VGM 1.71–1.72,
C5 register byte writes, E0 RAM uploads and raw 06 / 68 bank copies. It
plays the timeline once, validates before replacement and includes an
original 2.4-second sine demo. CPU timer / IRQ / MIDI bookkeeping and inactive
DMA setup are omitted with a message. DMA execution, 256 KiB memory mode,
extra-header overrides, other chips and unsupported core registers fail
explicitly. Files has the existing 12 MiB aggregate project budget and the
parser separately bounds compressed / expanded / prepared data to 64 MiB.

Song playback owns separate SCSP state and RAM through the existing Master.
Manual keyboard continues to play the authored instrument. Code and song
playback are mutually exclusive in this phase. Song state import and Live
editing remain pending above. The guide records this scope.

The initial format choice follows the original recording specifications.
[VGM specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt)
and [PSF / SSF specification](https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e).

## Verification recorded 2026-11-15

- 80 SCSP unit / actual native core / packaging tests passed.
- 107 calibration tests and SCSP / NES / FM2608 source-navigation recorder
  checks passed. All eight original calibration measurements retain their
  original bytes. Shared source navigation has an exact-byte SCSP receipt.
- An independently extracted ZIP passed the legacy Synth, Code and song
  browser runners in Chromium and WebKit. The package has 136 files and
  preserves authored JavaScript / CSS and source kits.
- Code checks cover PCM / FM2 / FM4 / FM6, one AudioContext / editor Worklet /
  final output edge, Apply context, keyboard in both views, live numeric edits,
  manual keyup after preset loading, Cassette / storage recovery and layouts.
- Specific regressions cover passive PCM across mode / Stop, Master zero
  during delayed WASM startup, fractional 0.37-semitone bend / center return,
  portable transpose preservation and preset loading while Code runs.
- Actual Monaco passed both browsers with zero positive-source diagnostics,
  ten invalid API probes, scoped completion and implementation navigation.
  Forced CDN failure retained a usable textarea. Expanded and 390 px layouts
  preserved the editor instance and cursor.
- Song checks cover finite generated PCM, Master zero / restore, Pause /
  Resume, seek / Stop / natural end, byte-exact VGM / VGZ Files exports,
  silent reload, rejected-source retention and Code / song switching.
- The new `.github/workflows/scsp-synth.yml` runs unit / package checks and
  all three muted browser runners against the extracted standalone ZIP.
- `git diff --check` passed. Publication and real-hardware listening are
  pending user-side steps.

Rerun the focused checks with these commands.

```sh
npm run test:scsp-synth
npm run test:scsp-synth:browser -- --out /private/tmp/scsp-synth-browser.json
npm run test:scsp-synth:code-browser
npm run test:scsp-synth:code-monaco-browser
npm run test:scsp-synth:song-browser
node scripts/record_scsp_shared_client_navigation_ui_revision.mjs --check
```

Future work includes free FM wiring / feedback and the SCSP DSP assembler.
