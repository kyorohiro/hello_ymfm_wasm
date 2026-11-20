# Historical calibration test repair — 2026-11-20

## Cause and scope

The calibration-history suite reproduced 157 failures (302 tests, 145 passed).
Historical guards were reading current files for dependencies that were unchanged
at the archive cut but subsequently edited. Once the first missing dependencies
were repaired, later missing dependencies became visible; they were not separate
failures in the audio output or calibration gains.

After those failures were unblocked, the same missing historical-input issue
was found in PS1 timed-API dependencies and the new YM2413 JS/WASM checkpoint
API. Their old complete bodies are archived too, so the historical test graph
does not combine older Mixer policy inputs with newer state-proof requirements.

The test-only `pre-huc-timed-calibration-inputs.json` archive now includes the
following 27 complete dependency bodies from its existing fixed Git revision
`492f9088eb3c46d877c66f20a8d3d117c56d1adf`:

- `tetorica_src/runtime/playground_performance_queue.js`
- `docs/js/playground_performance_queue.js`
- `docs/synth-spu/synth.css`
- `tetorica_src/runtime/playground_wonderswan_worklet.js`
- `docs/js/playground_wonderswan_worklet.js`
- `tetorica_src/runtime/playground_wonderswan.js`
- `docs/js/playground_wonderswan.js`
- `tetorica_src/runtime/native_genesis_wonderswan.js`
- `docs/js/native_genesis_wonderswan.js`
- `test/runtime/playground_wonderswan_timeline.test.mjs`
- `packages/fm2612/examples/scsp-dsp/routing.mjs`
- `packages/fm2612/examples/scsp-dsp/routing-browser.js`
- `packages/fm2612/examples/scsp-dsp/routing.html`
- `docs/js/playground_ps1.js`
- `docs/js/playground_ps1_worklet.js`
- `docs/js/ps1synth.js`
- `tetorica_src/runtime/playground_ps1.js`
- `tetorica_src/runtime/playground_ps1_worklet.js`
- `tetorica_src/runtime/ps1synth.js`
- `docs/js/ym2413.js`
- `docs/js/ym2413audioengine.js`
- `docs/generated/ym2413_wasm.js`
- `docs/generated/ym2413_wasm.wasm`
- `tetorica_src/runtime/ym2413.js`
- `tetorica_src/runtime/ym2413audioengine.js`
- `tetorica_src/runtime/generated/ym2413_wasm.js`
- `tetorica_src/runtime/generated/ym2413_wasm.wasm`

The archive's independent object hash was updated in its test reader. Existing
archive entries are byte-for-byte unchanged. The existing integrity test compares
every decompressed entry to its recorded Git revision, verifies length/hash, and
checks that returned buffers are owned copies. Original calibration reports,
receipt pins, production guard implementations, native cores, output gains and
generated Mixer policies are unchanged.

The isolated historical module graph reads these archived bytes only in tests.
The integrity suite also checks that exercising this graph does not change the
production freshness reader or grant it permission for newer source bodies.

## Validation

- Full suite: **310 passed, 0 failed, 0 skipped**, approximately 260 seconds locally:

  ```sh
  node --test scripts/mixer_calibration*.test.mjs scripts/generate_playground_mixer_defaults.test.mjs scripts/generate_soundchip_mixer_presets.test.mjs test/historical_huc_timed_calibration_inputs.test.mjs
  ```

  The original 302-test count included file-level failures during module loading;
  those files now execute their individual tests. The final command also includes
  the two archive integrity/isolation tests. No failed tests were removed or skipped.

- Production Playground defaults: `node scripts/generate_playground_mixer_defaults.mjs --report=docs/issues/playground_chip_levels_01.json --check` — passed.
- Production reusable Mixer presets: `node scripts/generate_soundchip_mixer_presets.mjs --check` — passed.
- All original 95 archive entries are unchanged; 27 complete Git bodies were added,
  producing 122 independently hashed entries. Existing fixture tests verify all
  122 against their Git revisions, including the archived WASM files.
- `git diff --check` — passed.

The full tests include future source edits, altered receipts/reports, detached
hashes and unchanged raw PCM assertions. The repair restores their intended
historical inputs rather than bypassing any rejection or relaxing expectations.
The generated policies reproduce exactly; no gain values were rewritten.
No audio device, browser listening test, CI dispatch or publication is required
for this fixture-only repair.
