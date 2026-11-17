# Publish managed SCSP DSP Delay and update examples — 2026-11-18

User approved publishing the managed Delay milestone and adding its usage to
`w/tetorica-fm2612-examples`. Work starts from clean main at af738181, with a
clean examples checkout. Runtime Delay implementation and verification are
already committed. No worktree or additional DSP feature is required.

- [x] Confirm registry latest, unused next patch, npm account and example-repo
  instructions / package / build / verification workflow.
- [x] Update package version, release notes and Delay examples / API docs from
  source-candidate wording to the chosen release. Add a readable examples-repo
  Delay sample consistent with existing Gain / IIR and page conventions.
- [x] Build and pack; verify the exact archive in an isolated installed Node
  consumer, strict types and permanently muted Chromium / WebKit examples.
  Compare with published 0.2.43 and retain unchanged WASM / source / licenses.
- [x] Update the examples dependency / lockfile and generated vendor / index from
  that candidate, then validate the new example and existing SCSP examples.
- [x] Publish the exact validated archive and complete npm authentication if
  required. Verify official metadata, integrity, downloaded bytes and independent
  installation. Never republish after npm accepts the first submission.
- [x] Rebuild examples against the published package, verify final dependency /
  lockfile / vendor consistency and record restart / release evidence.

No runtime/core/WASM/calibration changes, version changes in unrelated packages,
git commit / push / tag, itch upload or Tauri changes are part of this task.
Physical audio stays muted. Do not write authentication URLs, OTP or credentials
into release records. Publication and examples-repository edits are authorized.

Registry latest is 0.2.43; 0.2.44 is unused. npm account is kyorohiro. The next
package version is 0.2.44. The examples repo currently pins 0.2.41 and has PCM /
LFO / modulation SCSP examples; DSP assembly / Gain / IIR / Delay examples will
be added together, then the final dependency will point to published 0.2.44.

Completed: [npm 0.2.44](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.44)
is public and latest. The official archive exactly matches the checked candidate;
an independent installation passes DSP / examples / strict types again.
Examples now pin the official version with public registry resolution / integrity,
pass clean npm ci, and regenerate matching dist / docs. All 54 offline Node
examples, 16 new DSP browser cases and 12 existing SCSP browser cases pass.
All 1,299 vendored files match the official archive. No commit / push was made.

See [release evidence](npm_scsp_dsp_delay_release_20261118.md) and the examples
repo's `notes/scsp-dsp-verification-20261118.md` for restart details.
