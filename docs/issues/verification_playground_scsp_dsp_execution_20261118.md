# Playground SCSP DSP execution — 2026-11-18

Implemented in the normal main checkout from c2ba69cb. No npm publication,
version bump, native build, release tag, commit or push is part of this work.

## Public workflow

In SCSP mode, select **Files → examples → scsp → scsp-dsp-gain.js** or
**scsp-dsp-iir-motion.js**, then Code / Run. Both examples use zero-based slot0,
beat-based notes and an independent four-second software tween that changes
actual hardware DSP coefficient codes. Setup uses livePrepare once per Run;
Apply retains setup and updates the named loops.

```
const saturn = await useSoundChip('scsp');
const words = assembleScspDsp(source);
await saturn.applyDspProgram(words, {coefficients: {0: 0, 1: 3840, 2: 256}});
await saturn.setMix(0, {directLevel: 0, dspSend: 7});
await saturn.setDspReturn({level: 7, pan: 0});
await saturn.setDspCoefficients({1: 3072, 2: 1024});
```

Playground's five asynchronous methods are applyDspProgram, getDspProgram,
getDspCoefficients, setDspCoefficients and setDspReturn. The underlying ScspSynth
methods are synchronous. Partial coefficient codes are signed Q12 (-4096..4095);
Apply optionally accepts a complete three-code table. A detached program snapshot
contains profile, configured, words, revision, coefficients and return. setMix
and setPreset accept an optional dspSend hardware code0..7 (omitted means0).
Sending uses MIXS0 and the shared return is EFREG0. Direct output remains separate.

## Execution boundaries

The first profile is RAM-free. It reuses the existing Synth validation and rejects
RAM I/O / address controls, opaque RAW bits and unsupported coefficient/output
indices. Pure assembly continues to accept the wider inspection format. Applying
instructions does not allocate or overwrite PCM or re-key a held slot. TEMP history
is retained; live coefficient updates only write the changed coefficient words.
No arbitrary JavaScript runs on the audio processing thread.

DSP setup is per instance and remains inactive until an explicit configuration.
The first configuration starts an empty image before enabling sends. Program Apply
copies and validates all data before writing, preserves the complete word504 Start
instruction and restores the previous program/coefficient/return registers on a
write failure. A failed rollback or post-reset restore retires the audio owner.

Main and Worker use the same audio owner. Worker DSP requests retain performance
session/loop ownership, apply as preparation barriers, and acknowledge the actual
result without adding note lookahead to each tween step. Coefficient / Return
notifications send small deltas; program Apply sends a complete resource snapshot.
Reset clears DSP setup; Code Stop clears voices/history and retains authored setup.
Retrigger and direct-mix edits preserve DSP sends and the shared return bits.

Native's current JS transport has no DSP transaction/readback protocol. New DSP
methods and nonzero DSP sends reject with NotSupportedError before Native dispatch
or fallback. This does not claim the native SCSP core lacks DSP. Web Audio supports
Main / Worker and primary / additional SCSP instances.

## Verification

- Real WASM Gain / IIR tests compare output with independent fixed-point results,
  including signed coefficient limits, held voices, live history, per-instance
  isolation, invalid atomic requests, rollback and restored setup.
- Public ScspSynth integration: 6 passed. Existing PCM/LFO/modulation checks: 23 passed.
- DSP core / extracted Synth behavior: 41 passed; existing SCSP Synth suite: 288 passed.
- Transport and Native capability tests: 49 passed.
- Shared scheduling/runtime regressions: 383 passed.
- Playground suite and dependency graph: 1,353 passed.
- Default-path parity compares previous source with current code using unchanged
  real WASM: 36 local/Main/Worker, 44.1/48 kHz, PCM8/16, 220/440/880 Hz cases,
  plus15 existing Worker packet cases. Effective register writes, PCM uploads,
  normalized state and output PCM match. No sound device is opened.
- Isolated real browser checks keep every physical destination behind a gain fixed
  at zero. Chromium/WebKit at44.1/48 kHz run real Main/Worker Code, measure full,
  zero and half-gain output, preserve a held voice, reject invalid commands, verify
  independent instances and silence after Stop. No listening is performed.

## Final distribution / source evidence

- All source and default-path proofs pass. The exact revision reconstructs all
  25 complete predecessor files at c2ba69cb and pins38 dependencies /16 evidence
  files. An independent reviewer reconstructed all25 files without using the
  official restoration helper and compared them with the actual Git objects.
  Unknown source edits / changed dependencies remain rejected. Proof snapshots
  are local to one synchronous validation; later checks read and validate again.
- Both mixer generators pass `--check`; old calibration measurements, Mixer
  values, pure codec and WASM remain unchanged. Calibration revision tests:
  115 passed. New focused source/parity/type checks:11 passed; SCSP mixer:10 passed.
- In addition to8 custom Main/Worker browser combinations, Source Chromium /
  WebKit at44.1/48 kHz run both actual Files examples16 times. Normal standalone
  ZIP content passes both browsers at48 kHz (8 example runs); the independently
  extracted `_for_run` ZIP passes both browsers at both rates (16 example runs).
  Every case verifies nonzero upstream audio, exact silence after Stop, permanent
  physical mute and unchanged authored example text. Errors/missing assets are0.
  Served byte audits: source316, standalone313, browser ZIP237 files match.
- One initial concurrent WebKit package run reported a disposed client. A lone
  retry with the old checker wait also passed. The checker had awaited only the
  Run button, which can return before Stop completes; it now waits for both
  buttons and `Audio ready`. All final parallel runs pass without changing the
  application or packaged runtime. The precise cause of the first run was not
  isolated; retain this observation if rapid Run/Stop is investigated later.
- `sh scripts/package_itch_playground.sh scsp-dsp-execution-20261118` succeeds.
  Complete download:1,333 files /1,516 entries. Browser ZIP:1,000 files /entries.
  CRC, every ZIP/stage byte and all304 original corresponding-source files pass.
  Runtime modules, hand declarations and editable examples retain original bytes.
- To accommodate the new files,7 source documentation copies already present
  byte-for-byte under `licenses/` move only into the existing complete source
  archive in the browser layout. Every outer counterpart is checked before
  packaging and independently during release validation. All originals remain
  expanded in the full download; source guides link to the outer documentation
  and the complete archive. Package/source/archive tests:37 passed.
- Source generation, runtime artifact profiles, canonical/served path transforms,
  JavaScript/shell syntax and `git diff --check` pass.

Machine evidence:
[browser verification](verification_playground_scsp_dsp_execution_browser_20261118.json),
[ZIP hashes/counts](verification_playground_scsp_dsp_execution_packages_20261118.json),
[exact source revision](playground_scsp_dsp_execution_source_revision_01.json),
[default PCM/packet parity](playground_scsp_dsp_default_parity_01.json).

Generated archives remain under `release/` with label
`scsp-dsp-execution-20261118`. No upload was performed. Auditory listening remains
a human check; all browser sound was physically muted throughout verification.
