# Monaco definition source freshness and Mixer calibration

- [x] Reproduce the global Mixer freshness failure and identify the exact
      definition-file changes since the recorded source.
- [x] Establish whether the changes affect types/editor presentation or audio
      behavior; preserve original measured reports and existing source checks.
- [x] Implement a narrowly validated source revision if justified, with exact
      source/dependency evidence and mutation tests. Remeasure if audio changed.
- [x] Run the global freshness/generation check and relevant declaration,
      calibration and packaging tests; record any further concrete blockers.
- [x] Update verification and handoff documentation.

No blind hash replacement, historical measurement rewrites, commit, push, tag
or publication. Keep unrelated working changes and existing calibration gains.

## Completed behavior and verification

- The drift was exactly three passive ASWAN navigation lines (335 bytes),
  introduced in commit `38ab6bd082e157a9e2a8d438d7d5c8a8f34ae25b`. They only
  select read-only implementation links; the definition viewer and audio source
  files were not edited during this task.
- The new independently pinned receipt reconstructs the complete SCSP
  predecessor, then the existing strict navigation/source revision chain.
  Source, receipt, predecessor and all eight measurement reports remain checked;
  unreviewed future byte changes are still rejected.
- `node scripts/generate_soundchip_mixer_presets.mjs --check` succeeds. All
  1,248 source checks in four measured reports pass. Eight measured/verify
  reports and both generated preset modules retain their original hashes.
- 404 calibration / declaration / packaging tests and 30 targeted navigation /
  definition-viewer tests pass. New regression tests run in ASWAN and itch web
  CI. SCSP CI retains the commit history required by its original-source recorder
  tests, and its old recorder still reproduces the same historical receipt.
- Actual Playground downloadable and browser-playable ZIP builds succeeded
  under a unique verification version, preserving existing release outputs.
- Actual Analyzer packaging exposed one independent missing dependency:
  `js/spc.js` imports `spc_voice_edit.js`. Added that module to its copied JS list,
  tested an isolated manifest import, and confirmed the complete Analyzer ZIP
  now builds and passes its dependency check.
- No measurement values, gains, audio renderers or shipped application source
  behavior were changed. No publication was performed.

See [verification](verification_monaco_definition_calibration_20261116.json).
