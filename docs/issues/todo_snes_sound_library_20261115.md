# SNES named sound library — 2026-11-15

Existing Files already supported portable sounds, collision-safe paths and preset selection, but the main Saved sounds selector was not mounted. Added that selector plus Save sound as in the instrument toolbar, and Save current sound as beside the SPC live-capture result. All use the existing Files adapter, .sdsp.json presets and local project store.

The name dialog freezes the current sound at opening. Save adds a named copy under /presets; unsafe filename characters are normalized and collisions receive numbered suffixes. Cancel adds nothing. Saving never applies or renames the current instrument. Later edits during a slow save remain current and are reconciled for persistence without changing the saved copy. Files quick-save behavior is retained.

Saved sounds explicitly applies a saved file without entering Code. BRR / PMON samples and Echo are embedded; later instrument edits do not overwrite the file. Local reload and Project / Cassette ZIP keep multiple sounds without requiring the original SPC. No preset version, store namespace, Tauri adapter, native menu or audio route is added. Event Rec remains excluded.

Validation: 164 Node tests passed, including collision handling, name validation, dialog snapshots and slow-save edit preservation. Chromium / WebKit passed Web and mocked Tauri UI cases for SPC / PMON / Echo saves, independent sound switching and real keyboard audio, cancellation, reload, ZIP restoration and mobile layout. Existing Code / Files and live-SPC regressions passed on the preceding preview. Mocked native PCM / Web routing passed with the same runtime modules; the final package additionally adjusts mobile CSS. The native harness fixes the event ordering of injected device failure and held-key input; the repository's Tauri checkout was not changed. Physical output stayed muted; no human listening or CPAL device test was performed.

See [verification receipt](verification_snes_sound_library_20261115.json). Review ZIP, reports, screenshots and local native harness are in ignored build/verification/snes-sound-library-20261115/. No commit, push, tag, release or Tauri dist import was performed.
