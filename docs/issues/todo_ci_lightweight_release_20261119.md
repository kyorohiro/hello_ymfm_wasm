# Lightweight release CI

The cancelled itch run `44542191953` spent about eleven minutes installing
browser dependencies and over six minutes in PS1/WonderSwan calibration before
continuing into more calibration. Routine local checks and tag release checks
must not implicitly run the complete calibration/browser/SDK suite.

- [x] Keep tag CI to ZIP packaging/integrity and bounded Chromium checks, plus
  the short VGM/SBI workflows. Preserve source-freshness and archive guards.
- [x] Move the existing complete itch validation into an explicitly manual
  workflow, without dropping commands, baseline checks or browser assertions.
- [x] Make per-app/SDK/deep workflows manual-only, retaining their test bodies.
- [x] Limit installation and verification time; install only Chromium headless
  shell in the release path. Retain diagnostics on failure.
- [x] Document local/remote commands and validate YAML, trigger isolation,
  retained command coverage and the bounded release path locally.

Do not start remote Actions, tag, commit or publish as part of this change.
Existing staged SCSP fixes belong to the preceding task and must be preserved.

## Result and evidence

- `itch-web.yml`: tag/manual release path, 10-minute job limit. npm ci is limited
  to three minutes, Chromium installation to four, each package/check step to
  three. npm download cache is enabled. No full calibration or WebKit install.
- `itch-web-full.yml`: manual-only copy of every original validation step,
  including all baseline/remeasurement and browser commands. Jobs match the
  previous workflow byte-for-byte except for distinct artifact names.
- Only itch release, VGM and SBI retain tag triggers. The latter two short jobs
  have five-minute limits. All other detailed workflows remain callable with
  `gh workflow run WORKFLOW.yml --ref main`; their test bodies are unchanged.
- Existing packaging/freshness/CRC/source/archive guards are unchanged.
- YAML parsing and trigger/command comparisons passed for all 21 workflows.
  `git diff --check` passes. 31 archive/baseline regression tests pass.
- The four actual ZIPs were generated and validated locally in 12.73 seconds:
  `/private/tmp/ci-light-release-local.json`, `/private/tmp/ci-light-archives.json`.
- Muted Chromium release checks passed in 18.75 seconds: Analyzer (4.49s),
  Synth (2.34s), Playground Genesis Main/Worker (11.92s).
  `/private/tmp/ci-light-browser-local.json`, `/private/tmp/ci-light-browser-0.log`,
  `/private/tmp/ci-light-synth-browser.json`,
  `/private/tmp/ci-light-playground-browser.json`.
- Total measured package/check path: 31.48 seconds on the local Mac, excluding
  dependency/browser installation. This is not a GitHub/Linux runtime promise.

No remote Actions, commit, push, tag or publication was performed. The manual
full suite was retained and inspected, not run as part of this lightweight check.
