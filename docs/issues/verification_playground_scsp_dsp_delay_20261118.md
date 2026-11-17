# Managed SCSP DSP Delay — 2026-11-18

Implemented against main `54f0290587811904a8a9ab43c81c369b42c72ac8`.
The common `ScspSynth` / Playground client can now run the existing Synth's
fixed six-step hardware DSP Delay. This is an unpublished source milestone;
the public npm 0.2.43 archive remains unchanged.

## Try it

Open Playground in **SCSP** mode, then **Files → examples → scsp →
scsp-dsp-delay.js → Code → Run**. Main and Worker Web Audio are supported.
The example plays beat-based notes and moves Feedback independently through
COEF1 small updates; changing BPM changes the melody tempo.

For an existing SCSP client and assigned PCM:

```js
await saturn.setDspDelay({enabled: true, timeMs: 240, feedback: 0.35});
await saturn.setMix(0, {directLevel: 5, dspSend: 7});
await saturn.setDspReturn({level: 7, pan: 0});
const setup = await saturn.getDspProgram();
log({delay: setup.delay, ram: setup.ram});
```

The local `ScspSynth` methods are synchronous. The Main / Worker facade resolves
after its audio owner applies the operation. Native transport explicitly returns
`NotSupportedError`. As before, arbitrary RAM-access programs are rejected by
`applyDspProgram()`; `setDspDelay()` installs only the managed fixed Delay.

## State and RAM

The first successful configuration appends a 65,536-byte ring at the next
8,192-byte boundary. Alignment gaps count toward used bank space. Loaded PCM,
editor pages, held voices and native sample position are retained. Validation,
insufficient space and failed installation consume no reservation. The setting
object is materialized once before selecting RAM so reentrant JavaScript getters
cannot allocate PCM into a previously selected ring.

Time is integer 20..700 ms. Feedback is -1..4095/4096, quantized with floor to
signed Q12. COEF1 edits update `delay.feedback`. The program snapshot's
`delay-ring` variant adds detached `delay` and `ram` fields. The state field
`dspRam` retains the allocation independently of the current program profile.
Return is initially muted and remains separate from per-slot sends.

Time / Enable changes clear only the packed ring. Feedback / coefficients /
Return preserve its history. NoteOff leaves echoes; Stop silences voices and
clears the ring while retaining setup. Reset clears DSP setup, retaining samples
and reservation; `reset({clearRam:true})` clears the bank and reservation.
Switching to a RAM-free program retains but does not use that reservation.
Transactions restore registers, program, coefficients, return and ring on failure;
a failed rollback retires the audio owner.

## Verification

- Core / public Synth / transport checks: 96 passed. Includes real WASM Delay
  parity with the existing Synth at zero / nonzero ring bases, feedback signs,
  partitioned render, history, editor protection, ownership, rollback and reset.
- Existing Synth reference suite: 288 passed. Existing declaration / helper /
  example checks: 21 passed; new complete Delay example checks: 2 passed.
- Unchanged default path: 36 local / Main / Worker PCM cases at 44.1 / 48 kHz,
  plus 15 existing Worker packet cases. PCM, effective writes, uploads and state
  match the exact pre-change sources. Both Mixer generators pass unchanged.
- Calibration revision regressions: 120 passed. An independent reviewer
  reconstructed all 25 predecessor sources from reverse hunks without the
  official restorer and matched Git objects; 16 historical reports and existing
  receipts retain their original bytes. Unknown edits remain rejected.
- Source browsers: Chromium / WebKit at 44.1 / 48 kHz, Main / Worker probes and
  actual Files examples. Held PCM, Feedback history, release tail, invalid
  atomicity, instance isolation and Stop silence pass.
- Exact installed npm candidate: 1,299 files, all 28 WASM engines, strict
  NodeNext / Bundler / DOM-only types, original Gain / IIR and new Delay Node
  examples pass. All 37 WASM files match the published 0.2.43 archive.
- Installed standalone Delay browser example passes both browsers / rates,
  including explicit Start, Play / Release, live Feedback, Time clear, Stop and
  390px layout. Extracted browser ZIP also passes both browsers at 48 kHz in
  Main / Worker with the actual Files example. Missing files / page errors are 0.

Every browser physical output route was permanently muted. Node checks opened
no output device. Listening verification on a real device remains a manual task.

## Distribution

`sh scripts/package_itch_playground.sh scsp-dsp-delay-20261118` succeeds.
The package list now includes the new helper and public client declarations.
Packaging tests: 11 passed.

- Complete ZIP: `release/hello_ymfm_wasm_scsp-dsp-delay-20261118_itch_playground.zip`
  — 1,336 files / 1,519 entries; SHA-256
  `552f7ca1b8cd771ff045f4a31558174341f985081ab4a6224a545b7d8fda6edf`.
- Browser ZIP: `release/hello_ymfm_wasm_scsp-dsp-delay-20261118_itch_playground_for_run.zip`
  — 1,000 files / entries; SHA-256
  `abf8854d3f03ef2b0ebc7473ef2b922d214366ce250942a091fad23cfac06526`.

Both archives pass CRC and byte checks. All 304 original corresponding-source
files are preserved inside the browser source archive. Three duplicate NES
author / upstream guides join the existing source archive policy, with identical
copies still individually readable under `licenses/` and linked from the browser
source guide. Browser runtime modules, declarations and examples stay readable.

[Machine evidence](verification_playground_scsp_dsp_delay_20261118.json) records
hashes, tests and browser artifacts. No version bump, npm / itch publication,
commit / push / tag, Tauri change or core/WASM rebuild was performed.
