# Publish SCSP DSP assembler in tetorica-fm2612 — 2026-11-17

User requested publication after the isolated preparation milestone.

- [x] Check the npm registry for the current version and choose the next patch.
- [x] Update package metadata and documentation from development wording to the
  selected release. Preserve the reviewed main checkout / Synth runtime assets.
- [x] Rebuild, pack the exact publication candidate, and verify package contents,
  types, isolated Node consumer and Chromium / WebKit examples.
- [x] Authenticate if needed and publish the tested tarball with the latest tag.
- [x] Verify registry metadata / integrity and install the published version in
  an isolated consumer. Record the outcome, artifact hashes and resume steps.

Work remains in work/scsp-dsp-npm-20261117 at w/_codex-scsp-dsp-npm-20261117.
This task does not merge, reset, commit or push the main checkout, create release
tags, change Synth UI / DSP behavior, or rebuild native / WASM binaries.

## Complete

Published tetorica-fm2612@0.2.42; registry latest is 0.2.42. The official
download is byte-identical to the tested candidate, and the downloaded package
passes isolated Node imports / examples and all strict type-resolution modes.
See [release record](npm_scsp_dsp_release_20261117.md) and
[machine evidence](npm_scsp_dsp_release_20261117.json).
Changes remain uncommitted in the dedicated worktree; main is unchanged.

## Main integration follow-up — 2026-11-18

The user requested committing and reflecting the published 0.2.42 source into
main / GitHub. Earlier statements that main was unchanged or changes were
uncommitted describe the preparation / publication phases only. Current
integration status is tracked in
[todo_scsp_dsp_main_integration_20261118.md](todo_scsp_dsp_main_integration_20261118.md).
