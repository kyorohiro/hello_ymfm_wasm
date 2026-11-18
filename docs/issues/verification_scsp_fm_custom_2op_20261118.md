# SCSP Synth custom two-operator FM — 2026-11-18

Base: `62da69d00511f66e2db7aca69b258f96b6726438`.
User approved starting free routing with 2OP. This is a bounded Synth editor
extension over the existing SCSP sound-stack modulation hardware.

## Use it

In **SCSP → Auto**, choose **2-operator FM → Connection: Custom**. Select A
or B in the operator diagram, choose **Modulation from: None / other OP**, and
choose that operator's **Direct output** independently. A source may both
modulate the other operator and produce direct sound. Both outputs may be Off
when an explicit DSP Send is intended. The diagram, role labels and summary
follow the settings. Selects and checkboxes release focus for keyboard playing.

Entering Custom without a saved graph starts with the familiar B → A pair and
output A. To reverse it, clear A's input, select B, choose A as B's source, then
enable B's output. There is no automatic graph change merely from selecting an
operator. In other voice modes, the Custom option is disabled; changing away
from active Custom chooses Chain atomically and keeps the dormant custom graph
in the live session.

Code uses the existing API:

```js
const scsp = await useSoundChip('scsp');
await scsp.setConfig({
  mode: 'fm2',
  fm: {algorithm: 'custom', custom: {inputs: [[], [0]], outputs: [1]}},
});
// Operator A (0) modulates B (1); B is the direct output.
await scsp.noteOn(CH1, 'A3'); // CH1 is a logical performance lane.
```

Custom source IDs remain A/B even when physical order changes. For A → B,
the first allocated pair maps A/B to slots 6/7; B → A uses 7/6. Frequency,
ratio, waveform, envelope, mix, LFO, DSP Send, bend and release use that mapping.
Custom groups expose detached `operatorSlots` metadata for inspection. Existing
fixed-group snapshot shapes remain unchanged.

## Limits and preservation

The initial custom graph accepts two dense input lists (empty or one other
operator) and an independent unique output set. Self/cyclic connections,
unknown fields, sparse arrays and invalid references are rejected before
changing the sound. This is the current software editor scope, not a hardware
feedback restriction. Existing raw physical-CH controls remain available.

A changed graph retires current Auto groups after complete validation; Code
continues and its next notes use the new graph. Physical keyboard owners stay
independent, including their eventual key-up. Repeating an unchanged graph
does not discard held UI identities. Invalid edits retain existing owners,
samples, RAM and sound. PCM loop requirements apply to the operator receiving
modulation. Existing groups retained during a running-Code preset replacement
keep their own graph / slot mapping and playing samples.

Active custom instruments use **preset v5** with complete routing. Legacy
v1–v4 files retain their behavior; noncustom export remains **v4** and omits
dormant custom state. A v4 file cannot silently carry custom-only fields. The
Code declarations, Files/project reader and save/load path support this format.
Common runtime / npm APIs and WASM were not changed.

## Verification

- **330** Synth / packaging tests pass. New backend tests include all **12**
  valid acyclic graph/output combinations compared against independent
  manually mapped physical-slot real-WASM references. Custom B → A also
  produces exactly the legacy Chain PCM. Three new view tests cover queued
  operator identities, blocked contexts and disposal.
- Invalid graphs produce no writes / state changes. Tests cover loop-
  incompatible PCM, getter materialization, canonical output sets, source
  controls / DSP sends, bends, release, voice stealing, manual/Code coexistence,
  idle migration, v5 round trips and old groups during Code preset replacement.
- **42** real-WASM cases match exact pre-change sources: 24 PCM cases and 18
  legacy fm2/fm4/fm6 × Chain/Pairs/Branch cases at 44.1 / 48 kHz. PCM, full RAM,
  readable registers, state, effective writes and legacy v4 exports match.
- New/prior guard and parity suites pass **31/31**; the exact added CI command
  passes **7**. Both Mixer generators and all five parity recorders pass
  `--check`. The original report/receipt JSON bytes were not rewritten.
- Independent review manually reconstructs all **14** predecessor sources
  using 65 reverse hunks and matches actual Git blobs without the official
  helper. All **43** dependencies / **12** report hashes match; **878** prior
  JSON files and both SCSP WASM copies remain unchanged.
- Source and exact ZIP pass Chromium / WebKit at 48 kHz, **7 grouped cases per
  engine**. Tests cover cold edits, actual forward/reverse modulation, cycle
  rejection without losing held sound, mapped source controls, independent
  outputs, physical-key release across graph changes, v5/v4 save/load, mode
  fallback, continuing Code, Stop silence and 390px layout. Each run keeps 110
  served assets immutable; page errors, missing assets and horizontal overflow
  are zero. Physical output stays permanently muted.
- Forward/reverse diagram screenshots were inspected in desktop/mobile views.
  Supplemental cold screenshots opened zero AudioContexts. Listening remains
  a manual check.

## Distribution / next work

Tested candidate:
`release/tetorica_scsp_synth_custom2-final-20261118_itch.zip`.
It has **377 entries**, passes CRC and complete stage-byte comparison; **96**
comparable live source/runtime files match served bytes, including the new view.
The modules remain readable. CI now checks Custom proof and the extracted ZIP.

[Machine evidence](verification_scsp_fm_custom_2op_20261118.json) records logs,
hashes, browser reports and screenshot paths under `build/scsp-custom2-20261118/`.
Custom 4/6OP, individual depth / dual inputs and feedback are separate follow-up
work. No npm/itch publication, package version bump, parent commit/push/tag,
Tauri change or core/WASM rebuild was performed.
