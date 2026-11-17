# Reusable SCSP DSP assembler for npm — 2026-11-17

User approved preparing reusable assembler APIs, declarations, Node / browser
examples, external-consumer checks and documentation while manually reviewing
the existing Synth. Work is isolated in branch work/scsp-dsp-npm-20261117 and
worktree w/_codex-scsp-dsp-npm-20261117 from main c0b9a24e. The initial
/private/tmp worktree was moved here to retain work across restarts.

- [x] Expose the existing pure `assembleScspDsp()` / `disassembleScspDsp()`
  implementation as `tetorica-fm2612/scsp_dsp_assembler.js` (and extensionless
  subpath), using the normal reusable runtime / served-mirror layout. Preserve
  the existing Synth assembler bytes and behavior; prevent copy drift.
- [x] Retain accurate hand-authored declarations through npm type generation;
  verify NodeNext, Bundler and browser-only consumers, including negative cases.
- [x] Include readable Node / browser examples and documentation distinguishing
  syntax assembly from the narrower Synth execution profile. Compilation alone
  neither applies a program nor initializes WASM / audio. Keep provisional
  field syntax, word layout, undefined-bit policy and licenses explicit.
- [x] Build and pack locally, install the exact tarball into an isolated
  offline consumer, and run Node + browser verification through npm subpaths.
  Check standalone imports, no fetch / AudioContext side effects, real field
  vectors, round trips, owned arrays, validation and payload / declaration bytes.
- [x] Run existing package / types and SCSP assembler regressions, verify that
  the main checkout / reviewed Synth stay unchanged, and record evidence.

No npm publication, login, release tag, version bump, commit, push, native / WASM
rebuild, new DSP language / runtime application API or Synth UI changes.

Follow-up: `tetorica-fm2612@0.2.42` was published and registry-verified on
2026-11-17. See [the npm release record](npm_scsp_dsp_release_20261117.md).
The original preparation details below remain historical.

## Completed / resume

The development tarball exposes both scsp_dsp_assembler.js and extensionless
subpaths with exact source / manual declarations and local Node / browser
examples. Package / strict type checks, 17 codec/CLI tests, 288 existing Synth
tests and Chromium/WebKit external-consumer checks (12 total) passed.
No audio device or network initialization occurs during pure-codec use.

Changes remain uncommitted in branch work/scsp-dsp-npm-20261117, at
w/_codex-scsp-dsp-npm-20261117 relative to the untouched main checkout.
Main remains clean at c0b9a24e. The original Synth codec and all Synth runtime
assets retain their bytes; only its format guide explains the new npm subpath.

Candidate: dist/candidate/tetorica-fm2612-0.2.41.tgz in this worktree. Metadata
version stays 0.2.41, and no publication was attempted. Choose a new package
version and rebuild / revalidate when an actual release is requested.

See [verification](verification_scsp_dsp_npm_20261117.md) and
[machine evidence](verification_scsp_dsp_npm_20261117.json) for commands/hashes.

## Main integration follow-up — 2026-11-18

The user requested committing and reflecting the published 0.2.42 source into
main / GitHub. Earlier statements that main was unchanged or changes were
uncommitted describe the preparation / publication phases only. Current
integration status is tracked in
[todo_scsp_dsp_main_integration_20261118.md](todo_scsp_dsp_main_integration_20261118.md).
