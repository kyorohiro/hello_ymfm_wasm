# HuC6280 Synth: imported presets and nested channel tabs

Started: 2026-11-14. The user requested this work while the pushed CI fixes run.

- [x] Inspect VGM extraction/Files persistence and FM2612 channel-tab behavior.
- [x] Save extracted VGM sounds to Files/presets/ on import, with Wave/PCM
      volume variants grouped and the loudest retained. Default the visible
      keep-loudest option to On so its initial list matches that policy.
      Keep the original VGM/VGZ in Files/vgm/ and preserve the current sound,
      running Code, source bytes and playback. Avoid overwriting existing files;
      cancellation, superseding imports and project replacement must be safe.
- [x] Move Auto/CH1–CH6 selection below the HuC6280 sound-source tab, using
      compact child tabs like FM2612. Preserve normal/Code/VGM and paused CH
      editing, keyboard allocation and Auto update. MSM5205 and CD-DA are each
      one source, so provide their relevant single-source child selection
      without implying nonexistent hardware polyphony. Mixer has no CH editor.
- [x] Add meaningful regression coverage and verify the actual standalone ZIP
      in Chromium/WebKit, including narrow layout and persisted preset files.
- [x] Recheck the pushed Actions, record results, and update the Tauri TODO.

Physical audio output stays muted during AI verification. No commit, push,
release/tag or Tauri import is part of this UI/import change.

Menu VGM import saves the source and one bank of grouped presets in a single
validated filesystem commit. The checkbox starts On and changes the visible
library list; it never rewrites saved presets when toggled. Ordinary Files
Add files continues to archive a VGM without extracting its instruments.
Durable-save errors keep the in-memory files and explicitly recommend export.

The standalone ZIP also reuses SPU's bounded preset-select layout, so long
generated preset paths fit a 390 px viewport. The first package check exposed
the old intrinsic-size overflow; the corrected label keeps the full option text
available without widening the page.

Two subsequent pushed-CI checker failures and a cooperative Seek test mismatch
are tracked in [the CI follow-up](todo_github_actions_20261114_followup.md).

## Verification

[Record](verification_huc6280_synth_import_presets_tabs_20261114.json): 558 Synth
Node tests plus 6 calibration-provenance guard tests pass. The final readable
ZIP passes all 13 Chromium/WebKit suites, 26 runs and 248 check groups.
The updated MSM upload precondition was separately rechecked in both browsers;
the DMG cancellation checker also passes all 14 groups with real Cancel input.
No timing/PCM bounds, native core or calibration gains were changed.

The pushed Actions still require a subsequent commit/push of these fixes.
RF5C164's newly reached RMS comparison is also locally corrected and passes
all 18 browser groups; [the CI follow-up](todo_github_actions_20261114_followup.md)
records the independent PCM/clock/gain checks. The Tauri import remains behind
the next remote CI gate.
