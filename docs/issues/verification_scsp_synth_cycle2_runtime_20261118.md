# SCSP Synth Cycle 2OP: instrument and Code - 2026-11-18

Base `b92ee48e146a011d10e383dcbc2954626cccec1c`; initially clean worktree.
Phase 1 of [the bounded integration design](scsp_synth_cycle2_design_20261118.md).

The Synth's borrowed Code client now accepts FM2 `algorithm: 'cycle2'`.
One group owns two ascending physical slots: A is first, B second. A reads
B's two-history average (X33/Y1); B reads current A (X63/Y63). The 13 existing
pairs remain available. This is the measured current-core recipe, not a
physical Saturn pipeline accuracy claim.

Only a new grouped attack initializes that pair's four stored history cells.
Live pitch, ratio and Depth changes keep the group/history; Depth 0 disconnects
that receiving edge. Releases, Click guard, Code Stop versus global Stop and
physical CH takeover keep their existing ownership rules. A partial native
commit failure is fatal for the new Cycle path; validation failures do no writes.
An outputs-only structural reset now also discards cached resampler output for
Cycle without changing legacy graph behavior.

## Try from Synth Code

This stage intentionally adds no selectable Cycle UI connection or portable
v11 preset. Paste into the Synth's Code editor and Run:

```javascript
const scsp = await useSoundChip('scsp');
setBpm(120);

await livePrepare('cycle2-source', async () => {
  const pcm = Int16Array.from({length: 64}, (_, i) =>
    Math.round(4096 * Math.sin(2 * Math.PI * i / 64)));
  const options = {baseFrequencyHz: 44100 / 64, loopStartSamples: 0};
  await scsp.applyPCM(0, pcm, options);
  await scsp.applyPCM(1, pcm, options);
  await scsp.setMix(0, {totalLevel: 12, directLevel: 0});
  await scsp.setMix(1, {totalLevel: 16, directLevel: 5});
  return true;
});
await scsp.setConfig({
  mode: 'fm2',
  fm: {algorithm: 'cycle2', cycle2: {outputs: [1]},
    depth: 8, ratios: [1, 1.5, 1, 1, 1, 1]},
});
liveLoop('cycle2-melody', async () => {
  await scsp.noteOn(CH1, choose(scale('E3', 'minorPentatonic', 1)));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});
```

Code CH1 is a logical grouped lane, not a physical-slot number. The existing
per-OP source controls and the disabled `Cycle 2OP · Code` display identify
the running connection; the dedicated return-path UI follows in Phase 2.
Changing sample setup inside `livePrepare` requires a fresh Run rather than
Apply; the top-level Depth/Ratio settings can be edited and Applied live.

**Save the JavaScript.** `exportPatch()`, Instrument JSON and Save sound reject
an active Cycle explicitly until v11 is implemented. They never save the old
base sound under the new sound's name. Code editing, local drafts and project
export still work: they retain source plus the last portable base instrument.
Restoring a project does not auto-run Code; Run reapplies its Cycle setup.
Audio-error recovery likewise uses that last portable base in this first stage.
Manual PCM/ADSR/mix/ratio edits made while Cycle is active are not added to
that base cache. Put settings you want to keep into JavaScript until Phase 2;
this stage does not promise that a local draft preserves those manual edits.

## Verification

- Full SCSP/package suite: **429/429** pass, including Code declaration checks.
  Shared runtime TypeScript checks pass.
- Independent real-WASM Cycle tests cover **260 exact PCM and 64-cell stack
  comparisons**: 13 pairs x five depths x two output rates x two output sets.
  The raw-register reference does not import the routing planner; a deliberately
  wrong return history differs. Twelve scoped tests also cover invalid requests,
  four-cell scope, live/release/steal/manual/Code ownership, PCM requirements,
  resampler cache boundaries and fatal partial writes.
- Actual pre-change Git modules versus current code: **166 legacy scenarios**
  preserve exact PCM, write traces, register/stack checkpoints, RAM, requested
  state and exported presets at 44.1/48 kHz, including DAG/Self/multiple Self.
- **14 browser checks** pass on the real Synth Code/editor/Worklet path in
  Chromium and WebKit at 48 kHz. They cover the actual borrowed client, live editing,
  ownership, save rejection and source/project persistence; see the local
  `browser-source.json` for final cases and screenshots.
- Exact source receipts reconstruct reviewed whole predecessor files; existing
  measured JSON and their original pins remain unchanged. Mixer generators,
  runtime artifact checks and existing guard checks remain required.

Evidence: `build/scsp-synth-cycle2-runtime-20261118/`. The
[machine record](verification_scsp_synth_cycle2_runtime_20261118.json) binds the
final source files, tests, browser report and parity/source receipts.

No shared low-level SCSP API, native core/WASM, gains, defaults or old preset
meaning changes. Physical output stays muted during verification; no listening
or hardware test, npm publication, version bump, commit/push/tag or Tauri update.
Phase 2 remains Cycle UI and portable v11 persistence, followed by listening.
