# SCSP Synth DSP routing controls — 2026-11-18

Base: `176eb363ef9533f9d226b4e0eed6800ac1b03d6c`.
User requested the Synth UI follow-up and deferred npm publication.

## Use the controls

Open **SCSP Synth → DSP**. The shared **Auto / CH1–CH32** selector stays
visible in either chip tab. The routing cards show the selected voice's
**MIXS0 / MIXS1**, **Send**, and two shared **Return level / Pan** controls.
Numbers use the existing increment buttons and horizontal dragging. Selects
release focus after editing so keyboard performance can continue. Help stays
behind **?**, and cards stack without horizontal overflow on narrow screens.

**Auto** edits source A–F and the matching allocated voices. A physical CH
selection edits only that slot. Auto allocation may replace a physical edit
when it reuses the slot. **Default** restores inherited routing. Explicit sends
also work on an owned silent FM modulator; they are disconnected when its voice
owner is retired, preventing Code Stop or stolen groups from leaking wet sound.
Normal release retains its existing behavior.

Choose **Example → Gain left / IIR right → Check → Apply**. The staged example
sets the program / coefficients while preserving sends, returns and held notes.
Route one sound to MIXS0 and another to MIXS1. Return 0 level 7 / Pan 31 gives
left; Return 1 level 7 / Pan 15 gives right. Direct level 0 gives wet-only sound.
**Enable DSP returns** gates both outputs without discarding requested settings.

New routing / Returns are DSP session settings. **Save setup to Code** captures
both outputs and the exact explicit / inherited routing, and restores them only
when that Code is run. Voice preset versions stay unchanged; loading a voice
preset restores legacy routing defaults. PCM, notes, live DSP history and the
separate SSF engine remain outside the saved DSP setup.

## Implementation boundaries

The Synth retains its own existing DSP owner and fixed 64 KiB reservation.
Its bounded executable profile accepts the existing ring-based Delay and the
shared RAM-free two-output instruction validator. The common runtime / npm
API, WASM and Mixer gains did not change. New Synth controls never start the
common `ScspSynth` DSP owner or overwrite the Synth program through that path.

Send / Return edits retain held samples and DSP history. Failed route / Return
updates roll back raw registers and authoring metadata; failed rollback retires
the audio owner. Primary Worklet replies include optional atomic routing
metadata after opt-in, allowing Auto allocation / source fanout changes to reach
the recovery memo before an acknowledged call resolves. Legacy replies retain
their shape, and SSF audition replies do not alter the primary memo.

## Verification

- **310** Synth / packaging tests pass, including physical / Auto routing,
  independent Gain/IIR PCM, Stop ownership, masked direct mix, rollback, idle
  migration, Code export / restore, strict types and UI target-capture checks.
- **24** real-WASM cases match the exact pre-change Synth at 44.1 / 48 kHz,
  PCM8 / PCM16, 220 / 440 / 880 Hz and DSP Off / On: stereo PCM, full sample
  RAM, readable registers, legacy state and effective write sequence match.
- **132** calibration revision tests pass. New / previous guard and parity
  checks pass **14** tests; the exact added CI proof step passes **7**.
  Both Mixer generators and four parity recorders pass `--check`.
- Independent review reconstructs all **3** predecessor sources from reverse
  hunks and matches actual Git blobs without importing the official restorer.
  All **49** dependency and **9** report records match. Historical JSON
  **873** files and both SCSP WASM copies retain their original bytes.
- Source and exact extracted ZIP pass Chromium / WebKit at 44.1 / 48 kHz.
  Tests cover cold controls, shared CH selection, live sends, independent
  Return mute, pan, keyboard-friendly buttons / drag, inheritance reset, held
  PCM retention, setup export, simultaneous Code / UI edits and exact Stop
  silence. All runs have zero page errors / missing assets.
- The existing standalone browser suite also passes both engines against the
  ZIP, including default Delay echoes, wet-only / bypass / Return, grouped FM,
  waveform edits, v1–v4 presets, invalid-load preservation and recovery.
- Desktop and 390px routing screenshots were visually inspected; narrow-screen
  horizontal overflow is zero. All browser physical outputs stayed muted.
  No listening test was performed.

## Distribution / restart

`sh scripts/package_itch_scsp_synth.sh dsp-routing-ui-20261118` succeeds.
Candidate:
`release/tetorica_scsp_synth_dsp-routing-ui-20261118_itch.zip`

The ZIP has **375 entries**, passes CRC and complete stage-byte checks, and
contains readable source, the new view module and editable assembler example.
Its live runtime/source files match the served files byte-for-byte. The CI
workflow now runs the new proof and browser check on its extracted ZIP.

See [machine evidence](verification_scsp_dsp_routing_ui_20261118.json) and
`build/scsp-routing-ui-20261118/` for logs, browser results and screenshots.
Remaining manual check: listen and assess the placement. No npm publication,
version bump, commit / push / tag, Tauri work or core rebuild was performed.
