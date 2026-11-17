# YM2612 timed operations — 2026-11-17

The YM2149 operation API now also covers YM2612. This is software scheduling of
chip operations, with the existing immediate register conversion reused by a
detached resolver. Existing immediate APIs and legacy `scheduleWrites()` remain
available.

Follow-up: `tetorica-fm2612@0.2.41` was published and registry-verified on
2026-11-17. See [the npm release record](npm_ym2612_timed_release_20261117.md).
The original implementation results below describe the pre-publication build.

## Try it

Open FM2612 Synth, choose Files → examples → `timed-operators.js`, then Code →
Run. The melody and Operator TL / MULT motion have independent periods. Edit
the source and Apply; Stop cancels its reservations. Existing source files and
the selected file are kept when the missing example is added on startup.

```js
const fm = await useSoundChip("ym2612");
const operations = fm.build(b => {
  b.atSample(0).setOperator(CH1, OP1, {multi: 2});
  b.atSeconds(0.1).noteOn(CH1, "C4");
  b.atSeconds(0.2).noteOff(CH1);
});
console.table(await fm.compile(operations));
await fm.schedule(operations, {name: "phrase", repeatSeconds: 1});
await fm.clearSchedule("phrase");
```

`build()` executes its callback once and records serializable data without
reading or changing the live chip. Seconds and reference samples are absolute
offsets; the default reference rate is 44100 Hz and does not follow the device.
Partial fields resolve against actual renderer state when applied. Port, pitch
latch state, operation order and repeated key writes are retained.

`compile()` defaults to an authoritative, asynchronous renderer capture. It
does not stop audio. `initialState: "client"` uses the optimistic local shadow
without requesting renderer state; `"reset"` uses reset registers. A detached
`captureState()` snapshot can be reused for comparisons. Client state excludes
renderer-only changes and rejects an incomplete baseline. Snapshots describe
operation-resolution state rather than oscillator/envelope phases. A compiled
trace predicts its chosen baseline; it is not a log of interleaved playback.

## Integration and limits

- Main / Worker and both ymfm / Nuked engines use the same operation resolver.
- The dedicated MegaSynth Worklets, additional OPN Worklet and generic chip
  output Worklet accept the same serialized protocol.
- Code Run / Apply / Stop reuse existing named-loop and reservation ownership.
  A failed Apply keeps the preceding reservation. Removing a loop cancels its
  future operations; removing only its `schedule()` call does not.
- Timed pitch / parameters still apply during manual CH audition. A new timed
  Key On takes over that voice and invalidates its old manual Key Up. An old
  scheduled Key Off cannot silence a newer manual owner. Compilation describes
  register operations; these interleaved ownership decisions are not a replay
  log or part of the compilation snapshot.
- Up to 4096 operations per pattern and 128 names are allowed. Aggregate
  expanded write cost is bounded at 65,536 and 48,000 writes/second for repeating
  patterns. These admission limits are not a device throughput guarantee.
- Native authoritative capture / scheduled execution explicitly reject.
  Native client / reset compilation remains local.
- Bare `YM2612Synth` construction retains its previous API. Custom Worklet
  integrations can attach `attachYm2612TimedClient` explicitly. MegaSynth and
  Playground / Synth clients attach it at creation.
- No Looper / Event Rec, PCM transfer scheduling, DSP scheduling or new musical
  `play()` API was added. No npm publication, commit or push was performed.

## Verification commands

Final results: 4033 runtime tests, 699 Synth tests, 45 source-evidence tests,
9 source-archive policy tests and 56 served-Worklet checks passed. Installed
npm payload and strict NodeNext / Bundler / browser declarations passed. Real
muted Chromium / WebKit checks covered 16 endpoint combinations, four Synth
cases (packaged ymfm and Nuked) and eight packaged Playground cases (Genesis /
Game Boy, Main / Worker). Detailed results and ZIP hashes are retained in
`verification_ym2612_timed_api_20261117.json`.

Synth, Analyzer and both downloadable / browser Playground ZIPs were generated
with version label `ym-timed-20261117`. The browser Playground reaches itch.io's
1000-file limit. Five upstream revision/hash metadata files join the existing
complete `corresponding-source.zip`; every original byte is verified there.
Runtime JavaScript remains individual, readable files; the downloadable ZIP
keeps the fully expanded source tree. New optional capability checks also keep
non-FM Worker modes, including Game Boy, operational.

Old Native AY fixtures now understand the already-supported batch envelope.
The malformed native YM2608-state fixture locates memory lengths before the
existing eight-byte gain trailer. These fixture updates retain the original
byte-order / rejection assertions; no C++ behavior or gain was changed.

```sh
npm run test:ym2612-timed
npm run test:runtime
node --test --test-concurrency=2 docs/synth/*.test.mjs
node scripts/check_ym2612_timed_browser.cjs
node scripts/check_ym2612_timed_browser.cjs '--entry=/synth/index.html?engine=nuked'
node scripts/check_ym2612_timed_endpoints_browser.cjs
npm run build:fm2612
node scripts/check_fm2612_types.mjs dist/fm2612
node scripts/check_fm2612_package.mjs --skip-build
```

All browser checks put a permanent zero-gain node before physical output.
The differential evidence in `verification_ym2612_timed_core_20261117.json` and
`ym2612_timed_default_parity_01.json` authenticates the old immediate trace and
byte-identical default PCM from both engines at 44100 / 48000 Hz. The exact
source revision receipt preserves historical calibration hashes and gains,
including nested source-dependency validation; future source mutations remain
stale. These checks do not replace listening tests or long-running performance
measurements on the user's device.
