# SCSP Synth Custom 4/6OP and two-input routing — 2026-11-18

Base: `81f5e7e591e4fdbf6f375ea97061eb6c514f3e97`.
This extends the existing Custom 2OP Synth editor without changing the common
runtime, SCSP core, WASM, calibration gains or published npm package.

## Use it

In **SCSP → Auto**, choose **4-operator FM** or **6-operator FM**, then
**Connection: Custom**. Select A–F in the diagram. **Input X / Input Y** select
up to two distinct modulation sources; **Direct output** is independent.
The arrows, roles and output summary follow the graph.

One source feeds both hardware inputs. With two sources, the SCSP core uses
their average, not their sum. The Y option **Same as X** retains the single-
source behavior; Y becomes available after choosing X. Clearing X removes
both sources. In 2OP the Y control stays hidden.

This graph editor and its grouped voice allocation are Synth software over
hardware sound-stack modulation. The current zero-delay core requires source
slots to run before their targets. A deterministic dependency order preserves
operator identities separately from physical slots. Independent sources prefer
higher operator IDs, retaining the old fixed-template and Custom2 placement.
Self modulation and cyclic feedback remain outside this editor milestone.

Entering Custom for the first time copies the current Chain / Pairs / Branch
template. Changing operator count preserves surviving routes and outputs.
Additional operators start disconnected with direct output off. Shrinking
drops removed operators and references to them; it may leave all outputs off.
An explicitly supplied graph with the wrong count is rejected instead of
silently resized. Returning from a fixed template restores/resizes a dormant
Custom graph if one exists. PCM keeps using a fixed connection.

Code uses the existing API:

```js
const scsp = await useSoundChip('scsp');
await scsp.setConfig({
  mode: 'fm4',
  fm: {
    algorithm: 'custom',
    custom: {
      inputs: [[1, 2], [3], [3], []],
      outputs: [0, 2],
    },
  },
});
// D feeds B/C; their hardware average modulates A. A and C output directly.
await scsp.noteOn(CH1, 'A3'); // CH1 remains a logical performance lane.
```

Graph changes validate before retiring Auto notes. Code continues, and later
notes use the new graph. Independent physical keyboard owners retain their
key-up. Old groups retained during Code preset replacement keep their own
graph, samples and slot mapping. Invalid edits preserve the playing sound.

Custom2 remains preset **v5**; Custom4/6 uses **v6**. Fixed presets remain
**v4**, omitting dormant Custom data. Legacy v1–v4 readers and existing PCM
behavior are preserved. Files, Cassette/local drafts and Code declarations
support the extended graph.

## Verification

- **344** Synth/packaging tests pass, including **12** new real-WASM backend
  tests and **5** view tests. Independent manually mapped native references
  verify 4/6OP merges, branches, reverse-ID dependencies and multiple outputs.
  Equal-source and silent-second-source comparisons verify X/Y averaging.
- Native tests cover all nine fixed-template conversions, implicit resizing,
  explicit count rejection, source mapping, live mix/LFO/ratio/depth, bends,
  DSP sends, release, stealing, getters/aliasing, PCM loop guards, Code/manual
  coexistence, v5/v6/idle restore and retained old groups.
- **66** baseline cases at 44.1/48 kHz preserve exact PCM, RAM, full instrument
  state (bank identity normalized), registers, effective writes and serialized
  v4/v5 exports: previous 42 PCM/fixed-FM cases plus all 12 Custom2 graph/output
  combinations at both rates. The audio device is never opened.
- **55** proof/guard tests, all six parity recorders, both Mixer generators and
  the new source receipt recorder pass. Historical JSON evidence is retained;
  the added receipt pins 17 changed source pairs, 45 dependencies and 14 reports.
- Source and exact ZIP pass Chromium/WebKit at 48 kHz, **6 grouped cases per
  engine**, with zero page errors, missing assets or mobile horizontal overflow.
  Each run records 110 served assets, permanently mutes physical output and
  verifies Code Stop silence. Project round trips and page reload restore v6
  without starting Code or audio. The previous Custom2 browser suite also
  passes both engines (7 grouped cases each).
- Desktop 4OP and narrow 6OP diagrams and controls were visually inspected.
  Listening remains a manual check.
- Independent byte-level reconstruction verifies all 17 predecessor sources
  through 74 reverse hunks against actual Git blobs. All 45 dependencies and
  14 reports match their hashes; 881 historical JSON files and both SCSP WASM
  copies remain unchanged.

The new source receipt object is pinned at
`b3da5826658c53f6b503aa6f03002b8bbab51f4a07cbeded78f2ff58c0d12450`.
[Machine evidence](verification_scsp_fm_custom_multiop_20261118.json) records
logs, independent audit, browser reports, screenshots and artifact hashes.

## Distribution and follow-up

Tested candidate:
`release/tetorica_scsp_synth_custom-multi-20261118_itch.zip`.
All **377** entries pass CRC and match the staging files; **148** comparable
served files and every embedded original source input match current source
bytes. Modules remain readable. CI now checks the new proof and extracted ZIP.

Per-operator MDL and feedback/history behavior remain follow-up work in
[the FM TODO](scsp_fm_followup_01.md). No publication, version bump, commit,
push, tag, Tauri update or core rebuild was performed.
