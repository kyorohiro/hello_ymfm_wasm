# SCSP Synth multiple independent Self OPs — 2026-11-18

Base: `47d9a51e61db9deb27e18f6987e9b7d699bcfbee`.
Custom4/6 now allow multiple independent Self operators. The same X32/Y0
history operation and owned-cell initialization used by single Self are kept.

## Use it

Choose **Auto → 4/6-operator FM → Custom**, select each intended OP, then choose
its **Self (2 taps)** input. Each Self reserves both native history taps, so its
Input Y is disabled and says **Past history · Y0**. Self replaces that target's
external inputs; other targets retain their two external inputs and averaging.
The diagram shows every Self loop. The compact hint lists all Self targets and
identifies which are Off at Depth 0; the selected Depth edits that OP only.

For example, B and C can each feed themselves, then merge into A. Code uses the
existing graph API, without a new playback API:

```javascript
await scsp.setConfig({
  mode: 'fm4',
  fm: {
    algorithm: 'custom',
    custom: { inputs: [[1, 2], [1], [2], []], outputs: [0] },
    ratios: [1, 1.5, 2, 1, 1, 1],
    depths: [7, 4, 5, 9, 9, 9],
  },
});
```

Fresh / New projects include `examples/parallel-self-feedback.js`, with a
beat-based melody and `livePrepare()` so Apply preserves live edits. Existing
projects are not reseeded or executed. The prior 2OP, 6OP and IIR authored
examples remain byte-identical and are included in the editable distribution.

Custom2 retains its one-Self limit. Resizing keeps surviving edges and removes
removed OPs/references. If both A/B Self survive a shrink to 2OP, the whole
change rejects atomically and the UI returns to its accepted mode. Clear one
Self first. Self plus an external source at the same target, duplicate sources,
malformed graphs and cross-OP cycles also reject before changing the sound.

Multiple Self in Custom4/6 saves as **preset v10**, with its complete graph and
optional per-OP depths. Single Custom2 Self remains **v8**, single Custom4/6
Self remains **v9**, and non-self formats remain **v4–v7**. Types separate these
cases. Normalized mode/algorithm/Self count are checked before mutation, and
the version discriminator is captured once to prevent changing getters from
escaping the version boundary.

## Verification

- **411** Synth/packaging tests pass (409 Synth, 2 packaging), including **10**
  new actual-WASM backend tests, updated UI/type/legacy regressions, and a
  byte-exact fresh-project example check. Focused backend tests pass 115/115;
  scoped declaration tests pass 2/2 and view/example tests pass 9/9.
- All **78** nonempty Self subsets in Custom4/6, including **68** multiple-Self
  subsets, are covered by **924 paired native comparisons** (1848 instances,
  disposed per case). Predetermined physical fixtures write raw MDL/X/Y words
  independently of production routing/slot/command helpers. Disconnected/all-
  output and possible fan-out/merge configurations, MDL 0/1/12 and 44.1/48 kHz
  output match exact PCM, native frame counts and physical mappings.
- Ownership tests verify exactly two cells cleared per newly owned Self before
  any Key On, with other histories, groups, physical/Code voices, DSP and RAM
  preserved. Live Depth Off/On, releasing notes, pitch, source controls,
  retrigger/steal, old Code mappings, invalid PCM, resize/dormant graphs, v10
  roundtrips and getter boundaries are checked.
- **150** actual predecessor/current cases preserve PCM, RAM, full registers,
  raw 64-cell sound stack, state, write order and exports. These retain the
  prior 110 operations/cases and add all 10 prior Custom4/6 single-Self targets
  in isolated or fan-out/merge configurations at both output rates (40 cases),
  including mixed depths and formal Code-lane reattack. Single-Self v8/v9 and
  old non-self behavior remain exact.
- Source Chromium/WebKit pass the new suite's **8 grouped cases per engine**,
  the old 2OP Self **8**, single Custom4/6 Self **8**, and non-self multi-OP
  **6** per engine. The exact ZIP also passes the new **8** and single Custom4/6
  **8** per engine: **92 browser cases** in total. All run at 48 kHz with
  permanently muted physical output, zero page/asset errors, zero mobile
  horizontal overflow and exact silence after Stop. Device-free browser WASM
  probes verify every selected Self tap word and the complete owned-cell clear
  set. Source/ZIP desktop four-Self and mobile two-Self layouts were inspected.
- **88/88** proof tests, **17** source/parity recorder checks and both Mixer
  generators pass. The source receipt object SHA-256 is
  `81b4890696738eda52221af04b44fea955cd3e637947b2eeacfbbf521b3c036e`.
- Independent reverse-hunk code reconstructs **24** source pairs / **73**
  hunks to actual Git base bytes; **58** dependencies / **24** reports match
  with zero mismatches. A separate actual-Git rerender of all **150** cases
  matches every result field. The prior 110 case fields/digests also match the
  old committed report. All **896** historical JSON files, **1025** shared
  runtime/generated files, **86** native files, **1085** vendor files and **54**
  package/manifests are unchanged, including common/SSF WASM and gains.

## Distribution and records

Candidate: `release/tetorica_scsp_synth_multiple-self-20261118_itch.zip`.
All **382** entries pass CRC, safe/unique paths and exact stage-byte comparison.
All **153** comparable served files and **354** embedded original inputs match
current bytes. The authored examples, declarations and modules are readable
and unminified. The archive is 4,359,676 bytes, SHA-256
`24c2a96623b622a8fced4f17aed5b932480bdf34c79bfa25cf346773e6f14cc8`.

CI retains existing checks and adds the new proof/parity and muted exact-ZIP
checker. The relevant commands passed locally; GitHub-hosted execution awaits
a user push. Logs, independent rerender evidence and screenshots are under
`build/scsp-multiple-self-20261118/`. The
[machine record](verification_scsp_fm_multiple_self_20261118.json) records their
hashes and full browser/artifact summaries.

The native operation still follows the pinned zero-slot-delay core. As the
[primary-source research](scsp_fm_self_feedback_research_20261118.md) explains,
continuous active Self uses its own preceding one/two native samples. Depth 0
is the existing JavaScript adapter's bypass. Clearing a newly owned Self's two
cells is Synth software initialization; live edits and raw physical CH retain
history. This is not a claim of full physical SCSP pipeline fidelity. Arbitrary
cross-OP cycles, external input into a Self target and variable feedback delay
remain outside this editor.

No npm/itch publication, package version bump, commit/push/tag, common runtime
or core rebuild, other Synth or Tauri update, or physical listening occurred.
