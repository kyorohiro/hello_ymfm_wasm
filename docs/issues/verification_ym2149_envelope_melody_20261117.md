# YM2149 envelope-pitched melody — 2026-11-17

Adds the original, editable `/examples/envelope-melody.js` to ST Synth Files.
Existing examples and starter `index.js` are unchanged. Missing files are added
on startup after stored projects are restored; saved source, selection, input
mode and instrument settings are preserved. New Project supplies the new file
as well. Merely discovering / selecting it never starts Code or audio.

## Try

Reload ST Synth, open **Files → examples/envelope-melody.js → Code → Run**.
CH1 Tone and Noise are off. The shared hardware Envelope supplies the waveform;
one compact R13 repeat sets each note's frequency. Console shows the compiled
R13 write and target note / Hz. Waveform / Spectrum show the result.

Select **CH1** and change **Envelope period** to 30, 100 or 200 while it runs.
This changes timbre while notes continue. Change `notes` to change melody;
`setBpm()` changes note / rest duration without transposing notes. The ordinary
Tone pitch control does not set this example's envelope-derived pitch.

## Design

Shape 9 descends once and holds zero. Unlike Shape 8, it cannot start extra
ramps by itself if the descent finishes before the next software retrigger.
At 2 MHz, the nominal 32-step envelope span is 12.8 ms at Period 100 and
3.84 ms at Period 30. Exact level timing also includes retained divider phase
and rounding to output samples; R13 does not reset every internal divider.
Very large periods can produce little amplitude variation per note cycle.

`parseNoteName()` supplies the MIDI note for `440 * 2 ** ((midi - 69) / 12)`.
The Tone-frequency registers are not used to play this melody. `keyOn()`
restores Envelope selection while preserving the disabled Tone / Noise gates.
Fixed-volume bits do not scale the envelope-selected voice.

Setup writes Period 100 and Shape 9 once, with CH1 muted until the first note.
The immediate Shape write keeps the controls consistent with the scheduled
value. Thereafter each note repeats one R13 = 9 operation at `1 / noteHz`, so
it does not overwrite manual Period edits to R11/R12. Apply reruns setup.
Manual Shape edits compete with scheduled R13 writes in application order.

The named reservation belongs to `envelope-melody`. Each note waits for
`clearSchedule()` acceptance before Key Off and its rest; loop removal / Stop
also cancel future operations and run the Key Off cleanup. Only host-level
note changes use `beat()`; individual R13 writes use the existing sample-clock
queue. Scheduling is software, while the envelope / nonlinear DAC are chip
functions. This is not a complete ST CPU / MFP emulator or a historical
cycle-exact reconstruction. The Envelope remains shared by all enabled voices.

## Verification

Full evidence: [verification_ym2149_envelope_melody_20261117.json](verification_ym2149_envelope_melody_20261117.json).

- `npm run test:ym2149-st-synth`: 176/176 pass, including six new tests using
  the actual embedded source, production AY authoring / compiler / pattern
  queue and shipped WASM. The queue runs compact one-entry repeats with
  128-frame render partitions; independent arithmetic checks their rounding.
- Measured raw-PCM pitch at 44.1 / 48 kHz: E3 = 164.81282 / 164.81406 Hz
  (target 164.81378), A3 = 219.99555 / 219.99708 Hz (target 220).
  Fractional periods exercise alternating adjacent output-frame intervals.
- Period 30 / 100 / 200 measurably changes amplitude / waveform while retaining
  the E3 repetition pitch. Without repeated R13 writes, Shape 9 decays to zero
  and does not hide a sustained Tone or naturally repeating envelope.
  After cancellation and Key Off, raw PCM reaches its exact zero-code
  electrical baseline; the existing browser output performs its usual
  centering / silence handling.
- Source and packaged Files / Code UI pass Chromium / WebKit (four cases):
  real displayed and authoritative Shape 9, Tone / Noise off, Envelope enabled,
  E3 / G3 / A3 schedules, editable source preservation, actual manual Period
  knob edits maintained across notes, BPM 120 → 240 halving note spacing with
  unchanged pitch-repeat periods, Apply loop removal, Stop, and sentinel
  stability after cancellation. One AudioContext / one AY endpoint per run,
  zero stopped-output RMS, no uncaught errors or missing local resources.
- Persistent HTTP-cache checks pass eight cases across both browsers and
  source / package. They retain the original pre-Examples negative control
  and add a pinned immediately previous `ym-sample-1` release with four
  definitions. The old startup graph remains cached while the new graph adds
  only the missing melody file. Edited index / existing examples, Code mode,
  selection, settings and unrelated storage remain intact; no audio starts.
- New Project checks pass both browsers on source and package (four cases),
  including current default files, export, cancel, running-Code stop, modal
  keyboard handling, reload, stored data and no automatic execution.
- Both mixer-default generators pass `--check`. Existing measured evidence,
  gains, runtime / DSP / WASM and calibration adapters are unchanged.
  `git diff --check` passes.

All browser output is routed through a permanent zero gain before destination;
real PCM is observed upstream. No physical listening was performed. Browser
checks use the supported local textarea fallback with external Monaco loading
blocked. CPU checks separately verify both output rates.

## Distribution / restart

UI cache token chain: `ym-envelope-melody-1` from entry → Synth → Code host →
Files → example definitions. Readable JavaScript is copied verbatim into the
package, with matching source material, rebuild tools and license notices.
No new runtime API or npm update is required.

- ZIP: `release/tetorica_ym2149_st_synth_envelope-melody-20261117_itch.zip`
- Files: 202; compressed bytes: 2,457,377.
- SHA-256: `c1c0fa8abdccb1e5bc4df755fe5ba9c89c3e753045500716716e84e249913d05`.
- Verified stage: `release/itch_ym2149_st_synth_envelope-melody-20261117-3bWxTU`.

No commit, push, Tauri import, npm publication or release upload performed.
The two pre-existing staged examples-verification files were left untouched.
Next optional human check: listen while changing Period, then review / commit
or publish the Web ZIP when requested.
