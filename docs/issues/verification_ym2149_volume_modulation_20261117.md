# YM2149 fixed-volume modulation example — 2026-11-17

Scope: `examples/volume-modulation.js`, using the existing browser AY recorder,
compiler and scheduler. Shared runtime, DSP, WASM, gains, calibration receipts
and the default starter `index.js` are unchanged.

## User workflow

Reload the Synth, open Files, select `examples/volume-modulation.js`, switch
to Code and Run. Existing projects gain only the missing example; edited files
are preserved. New Project includes the same current examples automatically.

The script has a continuous `setNote()` melody changing every half beat and an
independent `volume-motion` loop changing rate every two beats. Each rate
installs one compact 16-step fixed-volume pattern at 25 / 50 / 100 Hz, giving
400 / 800 / 1,600 nominal R8 writes per second. JavaScript does not send each
individual step; the Worklet applies the recorded operations at sample frames.

Console shows the 16 predicted R8 writes from `compile(..., {initialState:
"client"})` and each new nominal rate. Waveform / Spectrum show actual output.
Edit `levels`, `modulationHz` or `beat()` values and Apply. BPM changes musical
loop timing, not modulation frequencies in Hz. Replacing the reservation name
restarts its phase deliberately at each slow rate step.

Timing is software. Gain uses the chip's 16 nonlinear fixed-volume codes;
Envelope mode is explicitly cleared on every step. It is separate from the
shared 32-level hardware envelope used by the Sync-buzzer example. With CH1
selected, disabling Tone and leaving Noise off isolates volume-only output.

## Release and cleanup

Repeated `setVolume()` can turn output back on after `noteOff()` writes zero.
The melody therefore changes pitch with `setNote()` and has no per-note gates.
CH2 / CH3 remain available for independent manual notes.

Cancellation stops future writes but can leave the final volume. A
`liveCleanup(["volume-motion"], () => ym.keyOff(CH1))` hook silences it when
that loop is removed on Apply. Removing only melody leaves modulation running
at the last pitch. Keeping the motion loop while deleting only `schedule()`
preserves its old reservation; explicit `clearSchedule()` must execute within
that owner, followed by keyOff. Stop ends the Code performance.

## Verification

- `npm run test:ym2149-st-synth`: 167/167 pass, including readable deterministic
  packaging and three focused tests for the new example.
- The actual editable script is evaluated with production AY authoring /
  recording / compilation. Checks cover setup silence, pitch-only melody,
  independent beat durations, all 16 R8 writes with Envelope off, one schedule
  per rate step and motion-specific cleanup.
- Actual shipped WASM at 44.1 / 48 kHz renders an isolated 100 Hz volume pattern
  from the compiled writes. Tests verify nearest-sample step placement,
  441 / 480-frame cycles, multiple output levels and measurable differences
  from a fixed-volume control without assuming linear amplitude codes.
- [Source browser report](verification_ym2149_volume_browser_20261117.json)
  and [package browser report](verification_ym2149_volume_package_browser_20261117.json)
  pass Chromium / WebKit: real pre-mute PCM, at least five observed R8 levels,
  Envelope bit clear, advancing Worklet frames, all 16 Console rows, rate /
  level / BPM Apply, continuous pitch updates and reservation acknowledgements.
- Removing motion yields R8 = 0 and zero PCM through observation while melody
  keeps changing tone periods. A post-cancellation-ACK sentinel remains stable,
  restored motion and Stop clean up, and no future scheduling traffic remains.
  Each browser uses one AudioContext / Worklet; every physical output is muted.
- [Package cache regression](verification_ym2149_volume_cache_browser_20261117.json)
  passes both browsers with the old prefeature startup graph and the old
  two-example module retained in real HTTP cache. The versioned current module
  supplies the third example, retaining saved data and creating no audio.
- [New Project / export regression](verification_ym2149_volume_new_project_browser_20261117.json)
  passes both browsers with example counts derived from current exports. Fresh
  defaults, backup contents, Cancel, modal keys and existing data checks remain.
- Both mixer-default generators pass `--check`. No audio remeasurement is needed
  for this example-only change. No uncaught browser or local-resource errors.

Browser checks use the supported local text editor with external CDN loading
blocked. Human listening is not claimed. This is host-sample scheduling, not
Atari ST CPU / MFP timer emulation. Volume-register sample playback is not added.

## Distribution

Generated locally, not published:

- `release/tetorica_ym2149_st_synth_volume-modulation-20261117_itch.zip`.
- 202 files, 2,443,467 bytes.
- SHA-256: `b75c38f392462398ca575767f04cd7e413e1a0e7e3291bdd4abfbe7f96d49239`.

The entry / Synth / Code host / Files / example-module chain uses `ym-volume-1`
URLs. This includes the new example leaf, so an old cached module defining only
two example files cannot hide the addition. Source and package files stay
readable and authenticated by the existing source-copy receipts.

No automatic commit, tag, npm publication or release upload was performed.
