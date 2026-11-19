# SPU working/saved rollout

Authorized slice: reuse the FM2612/HuC6280 two-version Files behavior in SPU.
Keep native VAB/VH/VB/PSF sources intact and preserve existing Code/audio routes.

- [x] Migrate existing v1 SPU projects to the shared working/saved workspace.
  Export ordinary saved files plus working recovery differences; retain binary
  samples once when unchanged, preserve metadata and validate both versions.
- [x] Add default-on Auto apply, Files dots, Save / Save all / Discard /
  Discard all and Ctrl/Cmd+S; Save accepts in memory even if storage fails.
- [x] Link editable SPU JSON, controls and PCM edits to a clear document target.
  Native banks remain source data; never overwrite their bytes with JSON.
- [x] With Auto apply off, keep drafts from the sounding instrument until Save.
  Invalid JSON remains editable and never replaces the last valid sound.
- [x] Explicit Run/Apply reads saved Code/modules/data; saving never starts Code.
  Keep Code playing on sound edits and preserve PSF transport observation.
- [x] Retain both versions across selection/moves/import/reload and recovery.
  Preserve pending drafts and original VAB/PSF dependencies on failures.
- [x] Verify meaningful project/Files/audio cases locally, then readable ZIP
  and source in muted browsers. Record actual evidence and remaining limits.

Expanded navigation, Live highlighting, new Mixer/recording/timed APIs and DSP
are outside this slice. No remote CI, commit, push, npm or Tauri release.

## Verification (2026-11-20)

- `npm run test:spu-synth`: 397 checks passed (project migration,
  saved-only Code/data reads, Cassette deltas/native binary preservation,
  control/JSON drafts, storage failure, document edits and existing SPU tests).
- `npm run test:spu-synth:working-saved-browser`: muted Chromium and WebKit;
  unsaved controls do not alter native state; Save/Discard, Code continuity,
  note pitch/Gate, reload, Auto apply and full ADPCM drawing acceptance passed.
- Existing `check_spu_synth_parameters_keyboard_browser.cjs` and
  `check_spu_synth_live_presets_browser.cjs`: Chromium/WebKit passed.
- `check_spu_synth_psf_manual_browser.cjs --engines=chromium`: passed;
  selected physical CH edits, independent Synth edits, Pause/Resume, Capture,
  ownership and Code/PSF handoff remain available.
- `sh scripts/package_itch_spu_synth.sh working-saved-check`: readable ZIP and
  source/provenance checks passed. The final staged ZIP also passed the new
  working/saved checker in Chromium and WebKit (`SPU_TEST_ROOT=<stage>
  SPU_TEST_ENTRY=/index.html`). Browser output is intercepted through gain
  zero before application startup; no listening or real-game listening test.

The new file-workspace manifest is version 2; v1 is accepted and migrates with
identical working/saved files and Auto apply On. Startup restoration is passive;
audio is created only by an explicit user performance/audio action. The
accepted sound is then restored while the working draft remains visible.
Binary VAB/VH/VB/PSF inputs remain source data. Only an authored edit creates a
JSON target. Large standalone instruments outside the 16 MiB project bound
stay exportable through the existing standalone instrument export; the limit
has not been increased. Local recovery failure does not undo an in-memory
Save, and Cassette keeps both versions.
