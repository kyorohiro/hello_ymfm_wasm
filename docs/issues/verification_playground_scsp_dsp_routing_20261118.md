# SCSP DSP two-input / two-output routing — 2026-11-18

Implemented against main `be6f8faf28045093eeb9213ffa6a5735c2f0e0a9`.
This is an unpublished source extension; npm 0.2.44 remains unchanged.
The separately authorized examples update was committed and pushed as
`5b726813fddf7fc96bb11d8d61616bfbca75b677`, with HEAD / origin/main /
GitHub commit equality and a clean worktree confirmed.

## Try it

Open Playground in **SCSP** mode, then **Files → examples → scsp →
scsp-dsp-routing.js → Code → Run**. The same saw sample / melody feeds two
paths: MIXS0 → Gain → EFREG0 → left; MIXS1 → IIR → EFREG1 → right.
The filter coefficients move independently from the beat-based melody.

For an existing SCSP instance with PCM assigned to slots 0 and 1:

```js
saturn.setMix(0, {directLevel: 0, dspSend: 7, dspInput: 0});
saturn.setMix(1, {directLevel: 0, dspSend: 7, dspInput: 1});
await saturn.setDspReturn(0, {level: 7, pan: 31}); // Left.
await saturn.setDspReturn(1, {level: 7, pan: 15}); // Right.
```

The DSP program itself selects IRA 32 / 33 and EWA 0 / 1. Input buses,
effect outputs and physical voice slots are separate concepts. These calls
configure sends / returns; they do not automatically create a DSP program.
Local `ScspSynth` calls are synchronous. DSP RPCs on the Main / Worker client
acknowledge application. Existing void controls such as `setMix()` retain
Worker performance-queue timing; awaiting their void result does not acknowledge
rendering. Browser measurements allow the existing 0.5-second Worker lead.

The installed source package also includes readable `routing.mjs` and
`routing.html` under `examples/scsp-dsp/`. The Node example compares both
output channels with independent fixed-point reference calculations without
opening an audio device. The browser example exposes separate returns and live
coefficients. Build / install the local package before using these files;
published npm 0.2.44 does not contain them.

## Compatibility and boundaries

- `dspInput: 0 | 1` selects a slot's input bus. `setPreset()` applies it at the
  next keyOn; `setMix()` changes it live. Partial live patches preserve fields
  that were not specified, including another routing field awaiting keyOn.
- Legacy `setDspReturn(patch)` still selects output 0. Indexed calls add a
  detached optional `returns: [return0, return1]` tuple; `return` stays output
  0's alias. Legacy-only snapshots retain their previous shape.
- Held PCM, other return / direct-mix register fields and DSP history survive
  live routing edits. Stop clears voices / history and preserves configuration;
  reset clears configuration. Invalid requests leave the prior setup intact.
- The RAM-free executable profile accepts EFREG0 / EFREG1. The managed fixed
  Delay and the separate Synth Delay validator retain MIXS0 → EFREG0. No new
  DSP RAM layout, graph language or Synth UI was added.
- Native DSP routing remains explicitly unsupported. No WASM/core, Mixer gain,
  Tauri application or published package was changed.

## Verification

- Core / Synth / Main / Worker checks: **114 passed**. Declaration / Files /
  helper checks: **25 passed**. Existing Synth regression suite: **288 passed**.
  The exact new CI step passes **53 checks**; strict source and installed types
  pass.
- Default-path parity: **36** local / Main / Worker PCM cases at 44.1 / 48 kHz
  and **15** Worker packet cases match the exact pre-change sources. Mixer
  generators and three generations of parity recorder pass `--check`.
- Calibration revision suite: **127 passed**; new / prior guard and parity
  checks: **14 passed**. Independent review reconstructed all **29** predecessor
  sources from reverse hunks and matched actual Git blobs without importing the
  official restorer. All **870** historical JSON files retain their bytes.
- Source browsers pass Chromium / WebKit at 44.1 / 48 kHz in Main / Worker,
  including the actual Files example, individual wet-output mute, live
  coefficients / input changes, invalid-request preservation and exact Stop
  silence on both channels.
- The exact extracted Browser ZIP passes Chromium / WebKit at 48 kHz in
  Main / Worker with the Files example; 238 served assets retain their hashes.
  All source / installed / ZIP browser runs have zero page errors and missing
  assets.
- The installed npm candidate passes all **28** WASM engines, strict
  NodeNext / Bundler / DOM-only declarations, readable CLI examples and the
  standalone browser routing page in both browsers / rates. All **37** shipped
  WASM files match published 0.2.44. Mobile layout at 390px also passes.
- Preparation tests: **10 passed**. Both ZIPs pass independent CRC, path,
  stage-byte and source-preservation checks. The Browser ZIP has exactly
  **1,000 entries**. All **304** original corresponding-source files and **84**
  original page build inputs are preserved byte-for-byte in its source archives.
  One duplicate CD-DA notice joins the existing archive policy; its identical
  visible `licenses/` copy is retained and linked.

All browser physical outputs stayed permanently muted. No listening test was
performed. An IIR with disconnected input can retain one DAC LSB of DC due to
fixed-point arithmetic; tests separately measure AC and bound DC by the
actual Mixer gain times one LSB. Stop must produce exact zero on both channels.

## Distribution and restart

`sh scripts/package_itch_playground.sh scsp-dsp-routing-20261118` succeeds:

- `release/hello_ymfm_wasm_scsp-dsp-routing-20261118_itch_playground.zip`
- `release/hello_ymfm_wasm_scsp-dsp-routing-20261118_itch_playground_for_run.zip`

The npm source candidate is retained at
`build/scsp-routing-20261118/npm-source-candidate.tgz`; it deliberately retains
version 0.2.44 for local verification and has **not** been published.
[Machine evidence](verification_playground_scsp_dsp_routing_20261118.json)
records hashes and verification artifacts.

Next manual step: listen to the left Gain / right IIR example. A later user
instruction can authorize commit / push or a new npm / itch release. No parent
commit / push / tag, publication or version bump was performed in this task.
