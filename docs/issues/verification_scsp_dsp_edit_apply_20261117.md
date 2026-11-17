# SCSP DSP draft / Check / Apply — 2026-11-17

The Synth **DSP** tab now edits a `.scspasm` draft and applies a checked program
explicitly to the Synth audio owner. The built-in six-step role table remains
under **Built-in Delay reference**; it does not describe arbitrary edited code
or the separate SSF player's program.

## Try / restart

1. Reload SCSP Synth and open **DSP**. Editing and **Check** do not change sound.
2. Enable the existing Delay under **Experimental · Delay parameters**.
3. Change `EWT=1` to `EWT=0` in step 003, Check, then **Apply to Synth**.
   The wet output disappears while direct voice output remains available.
4. **Reset draft → Check → Apply to Synth** restores the built-in program.

Check reports source line / physical step errors and shows canonical instructions.
Editing invalidates the previous Check. The applied-program label changes only
after acknowledgement. Editing / checking another draft while Apply is pending
does not lose that newer text or its Check result.

**Copy .scspasm** / **Save .scspasm** export current text verbatim, including
invalid / unapplied edits. Local storage key `tetorica-scsp-dsp-draft-v1` stores
draft text only. Reload restores that text, without Check, Apply or audio startup.
The running program starts with built-in Delay after a page reload. Voice presets
and Cassette exports keep their existing formats and exclude this DSP source.

Cold Apply sets this session's program without creating an AudioContext.
Asynchronous audio startup transfers the acknowledged image independently of
the unchanged six-key idle-state schema. Stop, mode changes and voice-preset
loads retain the applied program within the Synth session. Apply targets the
primary Synth, leaving SSF playback / audition DSP separate.

## Replacement semantics

- Source Check and the audio owner share the pure execution-profile validator;
  the broad lossless assembler is unchanged. All 512 integer words are copied.
- The first profile retains the existing packed 64 KiB ring, COEF0–2,
  MADRS0–1 and EFREG0 return. Nonzero opaque bits, IRA above 49, even-step RAM
  I/O, TABLE / NOFL RAM modes, unsupported coefficient / address indices and
  other effect-output targets are rejected. The real ring base / length are
  checked before a changed upload. RAM access remains masked inside the ring.
- The Worklet transaction is synchronous: mute EFREG0 return, upload all words,
  preserve word 504 at the Start address, clear the packed ring, restore return,
  then acknowledge. It does not reset voices, Code ownership or PCM allocations.
- Changed Apply clears the wet tail. Identical words are a no-op without any
  program / RAM writes, revision change or tail clear.
- Invalid requests perform no writes. A recoverable transfer failure restores
  the previous image, ring and return before another render. If restoration
  itself fails, the owner stops and reports a fatal error; it does not resume
  with a partially restored program. Restart uses the last acknowledged image.

## Validation

Machine evidence: [verification_scsp_dsp_edit_apply_20261117.json](verification_scsp_dsp_edit_apply_20261117.json).

- `npm run test:scsp-synth`: 221 tests pass. New pure-validator and shipped-WASM
  transaction tests cover semantic / line errors, held keyboard and Code,
  unchanged outside-ring PCM, default legacy write / PCM equality, exact
  no-op behavior, Start word 504, Stop / mode / preset retention, primary-only
  dispatch, and fatal rollback handling.
- One-shot write / RAM-transfer exceptions are injected **after mutation**.
  Rollback reproduces the old MPRO / RAM / return and the reference engine's
  subsequent stereo PCM at the same phase, sample for sample.
- `npm run test:scsp-dsp-assembler`: 12 tests pass. Existing field vectors,
  lossless round trips, CLI failures and real-WASM Delay parity remain valid.
- Both mixer generators pass `--check`; no calibration measurements, gain
  values, provenance adapters, SDK or WASM files change.
- Source and isolated packaged-root checks run real Chromium / WebKit and the
  shipped SCSP Worklet. They cover cold Check / Apply, draft-only reload,
  invalid text / profile errors, real Copy / Save downloads with stubbed
  clipboard, pending Apply rejection and success with newer checked edits,
  owner-side rejection, held keyboard / Code continuity, reset and no-op.
  EWT=0 produces actual zero wet PCM; Reset restores upstream signal.
- At 390 px, document overflow is zero and the reference table scrolls using
  Left / Right keys. Editor letter keys do not play the Synth. Desktop / mobile
  screenshots are inspected. The earlier reference / export browser regression
  also passes in Chromium / WebKit.

Physical destinations stay behind permanent zero gains installed before page
modules. PCM is measured upstream; human listening is not performed. OS
clipboard calls are stubbed. No ordinary browser tab or native app is touched.
The optional Monaco CDN is blocked; these tests use the supported local editor
fallback and make no external requests.

## Distribution

Entry CSS / JavaScript and the affected audio import graph use
`scsp-dsp-edit-1`. Readable packaging includes the new validator plus existing
assembler, declaration, guide and fixture, byte-for-byte with authenticated
source receipts. The package test verifies deterministic ZIPs and local imports.

- Final ZIP: `release/tetorica_scsp_synth_dsp-edit-apply-20261117-r2_itch.zip`.
- Files: 361; compressed size: 4,201,849 bytes.
- SHA-256: `89fccfe1e89112b29069241dc6fd40676af98c2201f5df608f871d86b35eeee5`.
- Isolated stage: `release/itch_scsp_synth_dsp-edit-apply-20261117-r2-yHwpt4`.

No commit, push, npm publication, SDK / WASM rebuild, Tauri import or release
upload. No public Synth Code DSP API, custom coefficient / RAM-layout editor,
macros, optimizer or general effect compiler is added. The profile establishes
explicit, reviewable edits to the existing Delay foundation.
