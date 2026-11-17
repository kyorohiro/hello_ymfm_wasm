# Actions check after ST desktop release — 2026-11-17

User asked to check Actions and fix failures. ST desktop main / v0.0.1 runs
already pass browser and all five platform builds at `6cd1aeee`. The parent
repository's latest `c33bfde2` has four failed checks requiring investigation.

- [x] Check ST desktop main and tag jobs and verify downloadable installers.
  Main run: https://github.com/kyorohiro/tetorica-st-ym2149-synth-tauri/actions/runs/43940597446
  Tag run: https://github.com/kyorohiro/tetorica-st-ym2149-synth-tauri/actions/runs/43940644828
- [x] Fix invalid generated npm declarations for AY timed state / reservation
  owner options, retaining strict checks and runtime behavior.
- [x] Investigate and fix the YM2608 fixed-SDK parity failure from its actual
  artifact log; do not suppress waveform differences or rebaseline blindly.
- [x] Update SDK export-inventory expectations for the existing SPC voice-write
  and YM2608 output-gain exports.
- [x] Use the current AY Single Output SCSP calibration report in the Mixer
  preset test, matching the generator rather than its older measurement.
- [x] Run relevant reproduction / regression checks and record results.
- [x] Update ST desktop hosted-build TODO / verification with observed results.

Parent failures:
- https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/43938848772
- https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/43938848607
- https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/43938848547
- https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/43938848525

Do not change signing credentials, publish draft releases or perform unrelated
feature work as part of this check.

## Result

ST main and tag runs both pass all six jobs: browser, macOS ARM / Intel,
Windows x64 and Linux x64 / ARM64. Seven nonempty installers from main were
downloaded and checked. The v0.0.1 release is already public and also lists
two `_signed.dmg` assets and a Web ZIP. The signatures were not independently
verified. ST desktop TODO / verification now record the hosted results.

Four parent failures were corrected without changing chip execution, WASM,
generated gains or measured calibration evidence:

1. **npm declarations:** add missing destructured-option JSDoc only during the
   existing type-only inference stage. Restore exact authored JavaScript even
   when emission fails. This fixes snapshot fields and inherited queue owner /
   session types across the processor and Worklets while retaining strict checks.
2. **YM2608 SDK parity:** the old wrapper-memory checks assumed RAM ended the
   native state. Current output gains add eight bytes. A current-layout entry
   reuses the reviewed adaptation, asserts both gain values are unity, and
   compares complete current export lists and exact PCM. The historical checker
   and its calibration proof remain byte-identical.
3. **SDK build fixtures:** expected exports now include the existing SPC voice
   writer and YM2608 output-gain setter. Export checks remain exact.
4. **Mixer test:** SCSP expected gain now comes from the current AY Single Output
   measurement used by the generator, rather than an older report. No actual
   gain values changed.

## Local validation

- Full package build generates and strictly checks **417 declarations**.
- **2** declaration regressions cover valid / invalid snapshot and reservation
  options, processor inference, and exact JS restoration on success / failure.
- **8** targeted Python SDK build tests and **21** SDK-runner / historical
  calibration guard tests pass.
- The exact failed Mixer test group passes **359/359**; both generated-default
  `--check` commands pass after restoring the unchanged runtime sources.
- Complete fixed-SDK parity replay passes **29 cores + 2 application audio
  modules + 2 instruments**, **40,474 exact comparisons**, maximum difference
  **0**, with repository inputs unchanged. It reuses the Emscripten outputs from
  the original CI artifact and verifies their receipts; it does not claim to
  recompile those 33 outputs locally. Native PS1 / SCSP parity and application
  audio checks are included.
- The installed npm tarball passes Node / strict consumer declarations and
  muted Chromium / WebKit checks for SID, DX7 and HuC6280 Main / Worker paths.
  Tarball: 1,265 files, 2,852,094 bytes compressed. Full package build was run
  first; the installed check uses `--skip-build --browser` to test that artifact.
- `git diff --check` passes. No SDK source, runtime mirror, WASM, calibration
  report or generated mixer gain was modified.

[Compact evidence and source hashes](fix_actions_st_followup_20261117.json)
record these results. The full SDK report remains in the temporary path recorded
there. Actual installer launches, listening and signature verification are not
part of this CI check.

Parent fixes are local and **not committed or pushed**. Its remote failed runs
still refer to `c33bfde2`; a new push is required for hosted revalidation.

## Hosted recheck — e566f833

User committed and pushed the preceding fixes as `e566f833`. Hosted npm,
WASM SDK, VGM and SBI checks now pass. itch web progressed past those tests
but failed packaging Synth because `playground/wonderswan_vgm_import.js`
imports `../js/wonderswan_timeline.js`, which the standalone file list omits.

- [x] Include the missing runtime dependency in the Synth ZIP.
- [x] Verify fresh standalone packages and their local import closure.
- [x] Prepare the additional fix for the requested commit / push and hosted recheck.

Remaining run: https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/43995519048

The newly reached Analyzer packaging step also rejected report 08 because its
AY wrapper / WASM source hashes predate the current build. A fresh no-device
measurement, `analyzer_psg_levels_09.json`, has identical defaults, reference
values and all 12 measurement rows; only those two source hashes change.
The generator now selects 09, and the generated module changes only its report
reference comment. Report 08 and all actual gain values remain intact. Strict
regressions reject the older report and altered current JS / WASM.

Local preflight passes: 15 Analyzer generator tests, actual Synth / Analyzer /
Playground download / Run ZIP generation, four archive / staged-byte / source
closure checks, and muted Chromium / WebKit tests of the Synth and Analyzer
packages. The additional code change is one Synth runtime-file-list entry;
there is no sound-chip execution or WASM modification.
