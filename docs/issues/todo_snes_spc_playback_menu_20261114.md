# SNES SPC playback and shared Menu — 2026-11-14

Implemented SPC song playback with Play, Pause, Stop, seek and eight channel switches. Selecting a source is passive and preserves the edited instrument. The full SPC machine shares the existing AudioContext and Master with the keyboard and Code. Stop All also stops the song; Code Stop only stops Code.

Web owns one Menu for imports, exports and reload. The Tauri adapter reuses that Menu and adds native Audio and Pin controls without generating a second toolbar. Switching output pauses the song; Web and native speaker routes are mutually exclusive. Event Rec is intentionally excluded, as requested.

The parent checkout contains the Web changes. The separate `w/tetorica-sdsp-synth-tauri` checkout contains changes to `desktop/desktop-interface.js` and `scripts/check-desktop-browser.cjs`; its pre-existing edits were retained. No imported dist, version, release, commit or tag was changed.

Validation: 184 parent tests; 39 Python and 42 Node Tauri tests. Chromium and WebKit passed Web/shared Menu playback checks and mocked native PCM capture. Existing instrument, Code and actual Monaco regressions passed on the preceding preview. Output was muted; no human listening or physical CPAL device verification was performed. Exact reports and package hashes are in [the receipt](verification_snes_spc_playback_menu_20261114.json).

SPC sources remain session-only. Instrument candidates describe the loaded snapshot, not the live playback state. Seek is limited to one hour. Duration tags are informational; no automatic fade or end is applied.
