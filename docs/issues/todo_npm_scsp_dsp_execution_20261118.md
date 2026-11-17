# npm SCSP DSP execution release — 2026-11-18

User approved validating and publishing the current SCSP DSP execution APIs,
types and installed Gain / IIR examples. Work in the normal main checkout from
941c0e78. Existing source / measured audio behavior is already committed.

- [x] Check public registry version, unused next patch, npm account and release scope.
- [x] Add readable installed-package Node / browser Gain and IIR examples, explicit
  audio start, accurate public documentation, strict types and dependency checks.
- [x] Build / pack the candidate; install that exact archive into an isolated
  offline consumer and verify DSP output, lifecycle, rejected inputs and types.
- [x] Validate the installed browser examples with permanently muted physical
  output in Chromium / WebKit and review changes from the previous public version.
- [x] Publish the exact validated archive, completing npm authentication if needed.
- [x] Verify registry metadata, downloaded bytes/integrity and an independent
  installation; record final version and results.

No native/WASM rebuild, calibration change, new DSP feature, git commit/push/tag,
Tauri/itch release or other-repository change is part of this task. Credentials,
OTP and authentication URLs must not be written into release records.

Registry check: latest 0.2.42, 0.2.43 unused; npm account kyorohiro. Candidate
version 0.2.43. No authentication details are recorded here.

Candidate: 1,292 files, 2,893,863 compressed bytes; SHA-256
`2ec7e7a481ee089873e9410ce154e8537fd7af22b88408a4940badb71b8df441`.
The exact installed archive passed Node DSP/reference PCM, lifecycle and atomic
rejection checks, all 28 WASM engine loads, existing package consumer checks and
strict NodeNext / Bundler / DOM-only / Node MessagePort types. All 37 WASM files
are byte-identical to npm 0.2.42; no previous payload file was removed.

Published: [tetorica-fm2612 0.2.43](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.43).
Registry `latest` is 0.2.43; the official archive matches the candidate byte for
byte and passes SHA1 / SHA512 checks. The downloaded archive was independently
installed and passed the DSP / examples / strict type checks again. Browser
validation passed Chromium / WebKit at 44.1 / 48 kHz with permanently muted
physical output. See [release evidence](npm_scsp_dsp_execution_release_20261118.md).
