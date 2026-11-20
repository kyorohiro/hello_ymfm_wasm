# SID Synth: FM2612 interaction alignment

Audit date: 2026-11-19; Files implementation updated 2026-11-20; expanded workspace 2026-11-21.
Completed work is recorded below; remaining items are planning, not release approval. User order: **HuC6280 → SPU → DMG → SID**.
SID is fourth. Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Audited status

| Comparison item | SID status and evidence |
| --- | --- |
| working/saved and Save controls | Implemented: shared two-version workspace, default-on Auto apply, dots, Save / Save all / Discard / Discard all, Ctrl/Cmd+S and v2 Cassette recovery with v1 migration. See [verification](todo_sid_working_saved_20261120.md). |
| Active instrument file ↔ controls/JSON | Implemented: linked portable voice / three-channel setup documents, role-preserving serialization, shared Code text/JSON editor without a forced view switch, accepted versus working controls and sparse physical-bank acceptance. |
| Files Undo / New / import recovery | Implemented: compact Files controls, right-click basic actions and Undo, New Cassette, validated replacement with native backup cancellation, both-version journal/quota recovery and saved-source execution. |
| Persistent expanded Code workspace | Implemented: Files-adjacent Code/Synth layout buttons, persistent Code / SID / Keyboard tabs, shared transport and one original Master. No new Mixer policy. See [verification](todo_sid_code_workspace_20261121.md). |
| Live changed-value highlighting | Missing. Live/Auto update already follows the selected physical CH and uses the existing sound controls; short value-change flashes with On/Off are separate. |
| Shared channel output switches | Missing as a common output-only policy for keyboard, Code and SID playback. Hardware voice-3 exclusion and filter routing are sound settings, not equivalent independent listening mutes. |
| PCM drawing / Start / Loop range | Not applicable. This SID Synth is oscillator/register based, with no RF5C164-like PCM sample editor. Keep waveform combinations, Pulse width, Sync and Ring controls rather than inventing sample RAM. |
| Looper / Event Rec | **Explicitly deferred by the user.** Do not include them in the next implementation automatically ([existing decision](todo_sid_synth_code_files_01.md)). |
| Timed build/schedule/compile/snapshots | Implemented for existing SID register operations, 6581/8580, borrowed Synth and shared Web Audio Main/Worker; no Native timing. See [verification](todo_sid_timed_register_api_20261121.md). |

## Proposed implementation phases

- [x] Adopt the shared two-version workspace and migrate old projects, portable
      voice v1/v2 and channel-setup v1/v2 without rewriting original source files.
- [x] Add Auto apply (default On), Files **●**, Save / Save all / Discard and
      Ctrl/Cmd+S. Preserve accepted content separately from local storage status.
- [x] Link the active editable voice/channel document to control edits. Keep
      per-channel distinctions until a real edit deliberately applies to the
      round-robin group; selecting a target must not unify voices.
- [x] Use shared Code text/JSON models without switching Keyboard to Code just
      to select a file. Preserve incomplete JSON and apply only valid sound
      changes; Auto apply Off defers those changes until Save.
- [x] Save never runs source. Explicit Run/Apply reads saved entry/modules/data;
      preserve context, loops and FX during ordinary editing and saving.
- [x] Preserve both layers across selection, rename/delete, Undo, New, imports
      and reload. Export normal saved files plus working recovery differences,
      keeping unchanged original SID binaries once and never auto-playing them.
- [x] Add Files history and New Cassette rollback with explicit retirement of
      the old Code/song owner only when replacing the project. Include the
      existing FM2612-style Duplicate/right-click basic file actions.
- [x] Add persistent expanded Code/SID/Keyboard navigation, header Code/Synth
      switching and visible Master; introduce Mixer only with an agreed policy.
- [ ] Add Live value-change highlighting, default On with an Off option, while
      retaining the same controls and distinct Live following state.

## Later decisions, not automatic implementation

- [ ] Decide on output-only CH1–3 switches shared by keyboard/Code/song. Muting
      must not change oscillator/Gate/filter registers or break Sync/Ring source
      oscillators. Document interaction with the one shared hardware filter.
- [ ] Keep Looper/Event Rec deferred until the user explicitly revisits them.
- [x] Treat timed operations as separate API work: resolve packed control bits
      at execution, preserve meaningful repeated writes and existing immediate
      methods, and audit coherent state capture rather than implying a complete
      C64 song snapshot from a JS register shadow.

## Required verification when implementation starts

- [x] Test 6581/8580 selection, shared LP/BP/HP/filter state, combined waveforms,
      Pulse width, Sync/Ring and three independent channel setups.
- [x] Test valid/unfinished JSON, single-voice versus channel-setup selection,
      legacy migration and failed imports without modifying the current sound.
- [x] Test Code/manual and song/manual coexistence, frozen/Live observation,
      paused audition, capture, later-write ownership and raw Gate behavior.
      Code/song execution remains mutually exclusive.
- [x] Test both versions through shortcuts, Undo/New, export/import, local
      journal/quota failures and reload with no autorun or automatic song play.
- [x] Verify source and readable ZIP in muted Chromium/WebKit, fallback and
      real Monaco, narrow/resized layouts and keyboard focus. Preserve measured
      gains; numeric tests do not constitute human listening. Persistent expanded
      navigation is verified in its [separate record](todo_sid_code_workspace_20261121.md).

Related history: [Code/Files and deferral](todo_sid_synth_code_files_01.md),
[Code Live](todo_sid_synth_code_live_01.md),
[manual song interaction](todo_sid_synth_song_manual_01.md).

## Timed register API follow-up

Implemented on 2026-11-21; [implementation and verification](todo_sid_timed_register_api_20261121.md). Separate chip-level API work from Files/UI alignment.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [x] Resolve packed waveform/Gate/Sync/Ring/Test fields and shared filter/volume/routing state using the selected 6581/8580 configuration.
- [x] Preserve repeated control writes and ordering; capture resolver state without claiming a full C64 song/emulator snapshot.
- [x] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.

Working/saved implementation and verification: [2026-11-20 record](todo_sid_working_saved_20261120.md).
Expanded navigation: [2026-11-21 implementation record](todo_sid_code_workspace_20261121.md).
Live highlighting and output switches remain separate work. Timed API publication and Native execution require separate authorization. Looper / Event Rec remain deferred.
