# SCSP Synth per-operator MDL — 2026-11-18

Base: `688a225f1ebbb480d1ad1b134aa823ebc65b8874`.
The selected receiving operator now has an independent FM depth in fixed and
Custom 2/4/6OP configurations. MDL is hardware; A–F allocation and the batch
control are Synth software. X/Y are averaged before sharing one destination
MDL. This does not add separate depth controls to individual edges.

## Use it

In **SCSP → Auto**, choose an FM mode and select A–F in the diagram. Adjust
**Selected depth (MDL)** beside Selected ratio with the existing buttons or
horizontal drag. **All FM depths** still sets all six operators together.
When values differ, the sound-source section shows a compact Per-OP summary.
An unused OP/PCM cannot be edited from this control. An active OP without an
input stores its depth for later routing; its effective modulation remains off.

The editor retains its supported **0–12** range and existing PCM guards.
This is an editor bound, not the complete hardware MDL range.

Code uses the existing configuration method:

```js
const scsp = await useSoundChip('scsp');
await scsp.setConfig({fm: {depths: [3, 6, 9, 9, 9, 9]}});
// A–F, including temporarily unused operators.
await scsp.setConfig({fm: {depth: 8}}); // Set every OP to 8 again.
```

`fm.depths` is an optional dense six-entry array. Without it, the existing
`fm.depth` supplies every OP. An explicit array takes precedence over a scalar
in the same request; a scalar-only edit clears differences. Uniform arrays
normalize to the old scalar representation. Mode changes retain all six
authored values. Invalid arrays reject atomically before any audio/state edit.

Depth edits keep held/releasing groups, their envelopes, Code session, physical
keyboard owners and DSP state. A group retained during Code preset loading
uses its own graph and physical mapping for later edits, including operators
that are no longer active in the new authored mode. Physical CH and SSF controls
keep their existing scope. The Auto control is disabled/hidden in SSF view.

## Persistence and verification

Mixed depths use preset **v7**. Scalar/uniform sounds keep **v4** fixed,
**v5** Custom2 or **v6** Custom4/6, with byte-exact old exports. Raw v1–v6 files
cannot silently carry the new array. V7 retains the complete active Custom
graph and six depths, including dormant PCM/smaller-mode values. Files,
Cassette/local drafts, Code declarations and implementation links are updated.
Main/Code/Worklet imports use the new cache stamp together.

- **358** Synth/packaging tests pass, including **11** new real-WASM backend
  tests and **3** view tests. Final declaration tests also pass with number
  tuples, accepting `Math.round()` expressions while validating range/integer
  constraints at runtime.
- Independent native references cover fixed/Custom 2/4/6OP, differing MDL,
  shared X/Y depth, mapped live/releasing edits, DSP/manual/Code ownership,
  old retained Code groups, scalar reset, v7/idle/PCM restore, invalid arrays
  and getter/alias handling. Uniform v4/v5/v6 exports and PCM remain exact.
- **66** real-WASM legacy cases at 44.1/48 kHz match the committed predecessor:
  exact PCM, RAM, full instrument state (bank identity normalized), registers,
  effective writes and serialized v4/v5 exports. The audio device is not opened.
- **62** proof/guard tests pass. New and previous source receipt checks, all
  **7** parity recorders and both Mixer generators pass. Historical reports,
  runtime, WASM, gains and package versions are unchanged.
- Source and exact ZIP pass Chromium/WebKit at 48 kHz, **8 grouped cases per
  engine**, with permanent physical mute, zero local errors/missing assets,
  zero 390px horizontal overflow and zero output after Stop. Tests include
  stepper/drag operation, live mapping/ownership, migration, SSF scope and
  Cassette plus page reload. Desktop/mobile controls were visually inspected.
- Independent reconstruction checks all 15 predecessor sources against actual
  Git blobs, with zero mismatches. All 884 historical issue JSON files, 1025
  shared runtime/generated files, 54 package/manifests and both SCSP WASM copies
  retain their original bytes. The 66 case objects also match the previous
  parity report completely.

Source receipt object:
`bef2792b6a49510bbbb60e49a7437b0ffbfb3bfc2fec86ac481ede6a4f46d577`.
The receipt covers 15 changed source pairs / 62 reverse hunks, 52 dependencies
and 16 reports. [Machine evidence](verification_scsp_fm_operator_depth_20261118.json)
records logs, independent audit, browser reports, screenshots and ZIP hashes.

## Distribution and remaining work

Tested candidate: `release/tetorica_scsp_synth_fm-depth-20261118_itch.zip`.
All **378** entries pass CRC and stage-byte comparison; **149** comparable
served files and every embedded source input match current source bytes.
Readable source modules include the new depth view. CI checks the depth proof
and exact ZIP alongside existing FM checks.

Listening remains a manual check. Self/cyclic feedback and real sound-stack
history semantics remain in [the FM follow-up](scsp_fm_followup_01.md).
No npm/itch publication, version bump, commit/push/tag, Tauri update, common
runtime change or core rebuild was performed.
