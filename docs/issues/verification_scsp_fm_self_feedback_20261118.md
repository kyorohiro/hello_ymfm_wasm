# SCSP Synth bounded Custom2 self-feedback — 2026-11-18

Base: `412d1d28a8bb5409aa71136c0e49f6b7e7d9046a`.
This step adds one self-feedback operator inside a Custom2 voice. It preserves
the pinned SCSP core, shared JavaScript adapter and existing non-self sounds.

## Use it

Select **Auto → 2-operator FM → Custom**, select A or B in the diagram, then
choose **Self · A/B (2 taps)** for Input X. For example, B can feed itself and
also feed A. The diagram shows a loop at B and its separate edge to A. Output
remains independent of modulation. Selected Depth changes the receiving OP's
MDL live; the existing adapter treats Depth 0 as Off.

Code uses the existing `setConfig()` operation:

```javascript
await scsp.setConfig({
  mode: 'fm2',
  fm: {
    algorithm: 'custom',
    custom: { inputs: [[1], [1]], outputs: [0] },
    depths: [7, 4, 9, 9, 9, 9],
  },
});
```

Fresh / New projects include `examples/self-feedback.js`, with a beat-based
melody and the current PCM. Existing projects are not overwritten. Save sound,
instrument load, Cassette and local draft preserve the graph and depths as
**preset v8**. Non-self instruments retain v4–v7 exports; v1–v7 reject self
graphs. Type declarations describe the supported graphs and v8 format.

## What is being modeled

The [primary-source research](scsp_fm_self_feedback_research_20261118.md)
compares SEGA's slot pipeline with the pinned zero-slot-delay MAME core. The
manual recommends self X32/Y0. In this core, under continuous active writes,
those cells contain the preceding one and two native 44.1-kHz sample values;
the hardware modulation operation averages their integer values.

Independent history injection measured **312 cases** across six physical slots,
MDL 0–12 and four X/Y selections. Explicit one-generation, two-generation and
average references distinguish the two-tap behavior. Very low MDL settings may
quantize to identical waveforms. Raw native MDL0 with nonzero offsets still
modulates; the existing JavaScript adapter deliberately serializes Depth 0 as
register zero. Live Off/On retains the requested offsets and existing history.

Key On does not clear the core stack; inactive and stolen slots can hold old
values. The Synth therefore clears **only the new owned self slot's two cells**
before a new Auto / Code attack, after full validation. This is software voice
initialization, not a claim about hardware Key On. Live depth/pitch changes,
held/releasing groups, other owners, manual physical CH and DSP retain history.

Only one self OP with at most one source per target is accepted in Custom2.
The other OP may receive that self OP. Double self, self plus a second source,
multi-OP cycles and Custom4/6 self reject before changing the current sound.
Implicit growth to Custom4/6 removes only the unsupported self edge. Explicit
graphs must match their mode; dormant graphs are projected on Custom entry.

The physical six-slot pipeline is not six audio samples. This prototype does
not change slot timing or claim full hardware fidelity for external edges.
General feedback graphs and comparison against physical hardware remain later
work; DSP Delay Feedback is independent of this FM self-feedback.

## Verification and provenance

- **389/389** Synth/packaging tests pass, including **12** new actual-WASM
  backend tests, a Self view regression and a fresh-project example test.
  All 16 supported self/output combinations match explicit independent native
  slot fixtures at 44.1/48 kHz. Coverage includes MDL 0–12, live Off/On,
  release/retrigger/steal, physical and Code owners, invalid graph/PCM atomicity,
  dormant resizing, detached state and normalized v8 validation.
- **66** legacy cases retain exact PCM, RAM, state, stack, register words,
  native write order and exports. The predecessor is reconstructed from actual
  base source rather than simulated by forcing the new implementation into a
  legacy mode.
- **74/74** proof tests, **13** source/parity recorder checks and both Mixer
  generators pass. Historical native SSF passive parity still passes all 8
  predecessor/observed/unobserved cases.
- Independent audit uses its own reverse-hunk implementation and actual Git
  blobs: **18** source pairs / **68** hunks, **57** dependencies and **20**
  reports match, with zero mismatches. It also enumerates graph/output limits
  independently and reviews UI/API/v8/owned-history handling.
- All **890** historical issue JSON files, **1025** shared runtime/generated
  files, **86** native files, **1085** vendor files and **54** package/manifests
  retain their base bytes. No shared core/WASM/gain changes or rebuilds occur.
- Source and exact ZIP pass Chromium/WebKit at 48 kHz, **8 grouped cases per
  engine**. Physical output remains muted; local errors/missing assets and page
  overflow are zero, and Stop reaches exact silence. The browser also performs
  a device-free real-WASM register/history probe: MDL4 changes `0x4800 → 0 →
  0x4800`, and new attacks clear exactly their own two history cells.
- The unchanged multi-OP browser suite passes the exact ZIP in both engines,
  **6 grouped cases each**, preserving 4/6OP restrictions, legacy 2OP, Code,
  physical owners, presets, Cassette and local draft. Source/ZIP desktop and
  mobile Self-loop diagrams were visually inspected.

Final source receipt object SHA-256:
`b64fdce7df322bb76466c898f6dd7638c0cba8b4c177b5c2547c5bb2067570c5`.
Logs, native research and primary PDF/screenshots are under
`build/scsp-self-feedback-20261118/`.
[Machine evidence](verification_scsp_fm_self_feedback_20261118.json) includes
their hashes, browser results and the archive/source audit.

## Distribution

Tested candidate: `release/tetorica_scsp_synth_self-feedback-20261118_itch.zip`.
All **380** entries pass CRC, unique/safe paths and exact stage-byte comparison.
All **151** comparable served files and **352** embedded original source inputs
match current bytes. Readable modules, declarations and the authored Self
example are included. The archive is 4,352,107 bytes, SHA-256
`f58bb180d137fbbabda273f4de15a18f887e6a5e860ed6f01339813249466846`.

CI adds the new source/parity proof and the muted exact-ZIP browser checker.
The existing checks remain in place. GitHub-hosted execution awaits a user push;
the relevant commands were verified locally.

No npm/itch publication, package version bump, parent commit/push/tag, Tauri
update or physical listening was performed.
