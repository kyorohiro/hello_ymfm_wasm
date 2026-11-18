# SCSP Synth single Self in Custom4/6 — 2026-11-18

Base: `d76285ad9b0eb786ce77cdd77272d5398047d185`.
Custom4/6 now support one self-feedback OP, using the same native two-history
operation and Synth-owned attack initialization as Custom2.

## Use it

Choose **Auto → 4-operator FM / 6-operator FM → Custom**, select A–F, then
choose **Self · A–F (2 taps)** for Input X. Choosing Self replaces that target's
external inputs. Input Y is disabled and explicitly reads **Past history · Y0**,
instead of the ordinary single-source **Same as X**. Both native taps belong to
Self: X32/Y0. The diagram draws a loop at the correct OP, and its Depth remains
live, including Depth 0 = Off through the existing JavaScript adapter.

Other targets still accept up to two external sources, averaged by the native
modulation operation. The Self OP may feed multiple targets and participate in
merges or direct output. Double Self, Self plus an external source at that
target, and multi-OP cycles reject before changing the current sound.

Changing OP count preserves surviving Self and external edges; shrinking drops
removed OPs and references to them. The same projection applies to a dormant
Custom graph when returning from a fixed template. Unrelated physical voices,
Code sessions, DSP routing/history and owner-specific key-up behavior remain.

## Code and persistence

The existing `setConfig()` graph API accepts the new configuration:

```javascript
await scsp.setConfig({
  mode: 'fm6',
  fm: {
    algorithm: 'custom',
    custom: { inputs: [[1, 2], [3], [4], [5], [5], [5]], outputs: [0] },
    depths: [7, 5, 5, 4, 4, 3],
  },
});
```

F feeds itself, branches through D/B and E/C, and A averages B/C for the output.
Fresh / New projects include the readable `examples/self-feedback-6op.js`,
with `livePrepare()` and a beat-based melody. Existing projects and the original
2OP/IIR examples are preserved. Source ZIPs include the authored file directly.

Custom4/6 Self saves as **preset v9**, including its complete graph and optional
individual depths. Custom2 Self remains **v8**. Non-self formats stay **v4–v7**;
older versions reject newly unsupported Self formats. Normalized mode/graph
validation also rejects inconsistent direct JavaScript getters before mutation.
Types distinguish v6/v7 non-self, v8 Custom2 Self and v9 Custom4/6 Self.

## Verification

The new backend suite includes **120** paired actual-WASM comparisons: all
10 Self targets in Custom4/6, merge/fan-out or disconnected topology, MDL
0/1/12 and output at 44.1/48 kHz. Predetermined explicit physical-slot fixtures
do not use the production graph/order/command helpers. PCM, native frame counts
and mapping match exactly; output is finite. Further tests cover exclusive
two-cell initialization, live Off/On, release/retrigger/steal, physical/Code/DSP
owners, invalid graph/PCM atomicity, resize, v9 scalar/mixed/idle roundtrips,
getters and older live Code mappings.

All **398** Synth tests pass. After visual inspection caught the misleading
Self Input-Y label, the focused view/example suite was rerun: **8/8** pass.
The **2** packaging tests also pass, for **400** Synth/packaging tests overall.
Source Chromium/WebKit then pass the new suite's **8 grouped cases per engine**,
including a real-WASM register/history probe. The existing 2OP Self suite
passes **8 per engine**, and the non-self multi-OP suite passes **6 per engine**.
All run at 48 kHz with physical output permanently muted, no local page/asset
errors, no horizontal overflow, and exact silence after Stop.

The exact ZIP passes the new **8 cases per engine** and unchanged non-self
multi-OP **6 cases per engine**. Together with the source checks this is
**72 browser cases**. Desktop 6OP and narrow 4OP layouts were visually inspected
after the Y0 correction.

**110** actual predecessor/current cases preserve exact PCM, RAM, full register
map, raw 64-cell sound stack, active/released/stopped state, effective write
order and serialized exports. Coverage is the prior 66 PCM/fixed/Custom2 cases,
all 16 old Custom2 Self graph/output combinations at both rates (32 cases),
and 12 non-self Custom4/6 merge/fan-out/disconnected cases, including v6/v7.
The Self cases use a formal Code session for repeated attack on the same lane.

**81/81** proof tests, **15** source/parity recorder checks and both Mixer
generators pass. Older source receipts and their native/calibration evidence
remain valid. The new source receipt object SHA-256 is
`cda0b7cb5530bf18ade132858323c44a344802e4ec5ec39191af3b4748ef835c`.

An independent audit, without the official reverse-hunk helper, reconstructs
**24** source pairs / **78** hunks to actual Git base bytes and checks **55**
dependencies / **22** reports, with zero mismatches. A separate 110-case rerender
using the actual Git backend blobs also matches every result field. All **893**
historical issue JSON files, **1025** shared runtime/generated files, **86**
native files, **1085** vendor files and **54** package/manifests are unchanged.

## Distribution and records

Candidate: `release/tetorica_scsp_synth_multi-self-feedback-20261118_itch.zip`.
All **381** entries pass CRC, safe/unique paths and exact stage-byte comparison.
All **152** comparable served files and **353** embedded original inputs match
current bytes. Both Self examples are included as readable authored files;
JavaScript remains editable and unminified. The archive is 4,355,346 bytes,
SHA-256 `a5ad9c96830c99603234b2a62966e531218e3f6e4543494694de6de64571e715`.

CI adds the new proof/parity checks and muted exact-ZIP checker, retaining all
older checks. Relevant commands passed locally; GitHub-hosted execution awaits
a user push. Logs and screenshots are under
`build/scsp-multi-self-feedback-20261118/`. The
[machine record](verification_scsp_fm_multi_self_feedback_20261118.json) contains
evidence hashes, browser results and archive/audit details.

The pinned core still uses zero slot-write delay. As documented in the
[original research](scsp_fm_self_feedback_research_20261118.md), continuous
active Self taps contain the preceding one and two native samples. Clearing
only a newly owned Self OP's two history cells is Synth software initialization.
Raw physical CH and live edits retain their history. This does not claim full
physical SCSP pipeline fidelity; general cycles and multiple Self OPs remain
outside this editor.

No npm/itch publication, package version bump, parent commit/push/tag, common
runtime/core rebuild, Tauri update or physical listening was performed.
