# SID Synth: FM2612 interaction alignment

Audit date: 2026-11-19. Documentation and planning only; no runtime or release
work is started by this list. User order: **HuC6280 → SPU → DMG → SID**.
SID is fourth. Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Audited status

| Comparison item | SID status and evidence |
| --- | --- |
| working/saved and Save controls | Missing. [code_project.js](../synth-sid/code_project.js) stores one filesystem plus current three-CH settings in a v1 project. Existing text/Code persistence is not the new accepted-content Save; no Auto apply, dots, Save all/Discard or dual-version Cassette. |
| Active instrument file ↔ controls/JSON | Partial. Portable voice and three-channel JSON can be selected and edited. Knob edits update current settings, not the selected JSON; `saveSound()` writes `/presets/current.sid-channels.json` ([code_files.js](../synth-sid/code_files.js)). Non-JS text currently uses a separate Files textarea instead of the shared Code model. |
| Files Undo / New / import recovery | Partial. Validated import/export and local recovery exist. No FM2612 Files Undo/history or New Cassette workflow in `code_files.js` / [index.html](../synth-sid/index.html); Duplicate and right-click file actions are also absent from this older Files adapter. |
| Persistent expanded Code workspace | Partial. Code maximize already exists. [code_host.js](../synth-sid/code_host.js) does not install persistent expansion, unified Code/SID/Keyboard/Mixer navigation or header Code/Synth controls. |
| Live changed-value highlighting | Missing. Live/Auto update already follows the selected physical CH and uses the existing sound controls; short value-change flashes with On/Off are separate. |
| Shared channel output switches | Missing as a common output-only policy for keyboard, Code and SID playback. Hardware voice-3 exclusion and filter routing are sound settings, not equivalent independent listening mutes. |
| PCM drawing / Start / Loop range | Not applicable. This SID Synth is oscillator/register based, with no RF5C164-like PCM sample editor. Keep waveform combinations, Pulse width, Sync and Ring controls rather than inventing sample RAM. |
| Looper / Event Rec | **Explicitly deferred by the user.** Do not include them in the next implementation automatically ([existing decision](todo_sid_synth_code_files_01.md)). |
| Timed build/schedule/compile/snapshots | Missing the YM2612-style operation recorder/compiler/scheduler. Existing immediate SID APIs and liveLoop/liveFx are present; a timed SID API requires a separate proposal. |

## Proposed implementation phases

- [ ] Adopt the shared two-version workspace and migrate old projects, portable
      voice v1/v2 and channel-setup v1/v2 without rewriting original source files.
- [ ] Add Auto apply (default On), Files **●**, Save / Save all / Discard and
      Ctrl/Cmd+S. Preserve accepted content separately from local storage status.
- [ ] Link the active editable voice/channel document to control edits. Keep
      per-channel distinctions until a real edit deliberately applies to the
      round-robin group; selecting a target must not unify voices.
- [ ] Use shared Code text/JSON models without switching Keyboard to Code just
      to select a file. Preserve incomplete JSON and apply only valid sound
      changes; Auto apply Off defers those changes until Save.
- [ ] Save never runs source. Explicit Run/Apply reads saved entry/modules/data;
      preserve context, loops and FX during ordinary editing and saving.
- [ ] Preserve both layers across selection, rename/delete, Undo, New, imports
      and reload. Export normal saved files plus working recovery differences,
      keeping unchanged original SID binaries once and never auto-playing them.
- [ ] Add Files history and New Cassette rollback with explicit retirement of
      the old Code/song owner only when replacing the project. Include the
      existing FM2612-style Duplicate/right-click basic file actions.
- [ ] Add persistent expanded Code/SID/Keyboard navigation, header Code/Synth
      switching and visible Master; introduce Mixer only with an agreed policy.
- [ ] Add Live value-change highlighting, default On with an Off option, while
      retaining the same controls and distinct Live following state.

## Later decisions, not automatic implementation

- [ ] Decide on output-only CH1–3 switches shared by keyboard/Code/song. Muting
      must not change oscillator/Gate/filter registers or break Sync/Ring source
      oscillators. Document interaction with the one shared hardware filter.
- [ ] Keep Looper/Event Rec deferred until the user explicitly revisits them.
- [ ] Treat timed operations as separate API work: resolve packed control bits
      at execution, preserve meaningful repeated writes and existing immediate
      methods, and audit coherent state capture rather than implying a complete
      C64 song snapshot from a JS register shadow.

## Required verification when implementation starts

- [ ] Test 6581/8580 selection, shared LP/BP/HP/filter state, combined waveforms,
      Pulse width, Sync/Ring and three independent channel setups.
- [ ] Test valid/unfinished JSON, single-voice versus channel-setup selection,
      legacy migration and failed imports without modifying the current sound.
- [ ] Test Code/manual and song/manual coexistence, frozen/Live observation,
      paused audition, capture, later-write ownership and raw Gate behavior.
      Code/song execution remains mutually exclusive.
- [ ] Test both versions through shortcuts, Undo/New, export/import, local
      journal/quota failures and reload with no autorun or automatic song play.
- [ ] Verify source and readable ZIP in muted Chromium/WebKit, fallback and
      real Monaco, narrow/resized/expanded layouts and keyboard focus. Preserve
      measured gains; numeric tests do not constitute human listening.

Related history: [Code/Files and deferral](todo_sid_synth_code_files_01.md),
[Code Live](todo_sid_synth_code_live_01.md),
[manual song interaction](todo_sid_synth_song_manual_01.md).
