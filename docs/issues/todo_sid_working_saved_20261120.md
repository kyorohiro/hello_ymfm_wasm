# SID Synth working/saved files — 2026-11-20

Authorized after the DMG rollout. Start SID alignment with the existing shared
two-version Files model. Preserve SID behavior, hardware models, filters and
three independent voices. Expanded Code navigation and timed APIs remain later
slices; Looper / Event Rec are explicitly deferred.

- [x] Adopt the shared working/saved workspace, retaining SID v1 projects,
  portable voice v1/v2 and three-channel setup v1/v2 without rewriting original
  files or SID binaries. Keep accepted state separate from storage durability.
- [x] Add default-on Auto apply, file dots, Save / Save all / Discard /
  Discard all and Ctrl/Cmd+S. Save never executes JavaScript; explicit Run/Apply
  reads saved entry/modules/data while preserving normal Run context and FX.
- [x] Link active valid voice/setup JSON to deliberate author controls. Preserve
  distinct CH settings until a deliberate round-robin edit; selection alone
  never unifies them. Code/song Live channel edits retain their physical route.
- [x] Use the shared editor for text/JSON without forcing Keyboard → Code.
  Retain unfinished JSON; Auto apply Off delays sound changes until acceptance.
- [x] Preserve both versions across selection, rename/delete, history, New,
  import/export, reload and storage failure recovery. Cassette normal files
  contain saved bytes and carry working differences as recovery metadata.
- [x] Match the existing compact Files tools (+ Instrument / + JS, context
  menu basic operations). Add Menu → New → Cassette with reversible backup
  cancellation. Ordinary edits/saving must not stop Code or SID songs.
- [x] Verify both models, combined waveforms, Pulse width, Sync/Ring, shared
  LP/BP/HP and independent CHs, accepted/working failures, storage/import
  atomicity and keyboard focus. Test real native PCM/behavior with output muted
  in source and actual readable ZIP, Chromium/WebKit and Monaco/fallback.
- [x] Record validation and update alignment TODO. No npm publication, commit,
  push/tag, remote CI, Tauri import or release is requested.

Reference: [SID alignment](todo_sid_synth_fm2612_alignment_20261119.md),
[DMG implementation](todo_dmg_working_saved_20261120.md).

## Implemented behavior

The project uses shared Virtual Files working/saved layers and a SID v2 manifest.
Legacy v1 projects migrate without altering their original source files. Both
voice v1/v2 and three-channel setup v1/v2 remain readable. A deliberate edit
serializes the same document role and retains a legacy schema when representable;
8580 and Legato use the newer schemas as required. Unchanged SID binary data is
stored once in Cassette, with compact working recovery differences.

Files has Auto apply On by default, dots, Save / Save all / Discard / Discard all,
Ctrl/Cmd+S, + Instrument / + JS and a context menu for Duplicate / Rename /
Delete / folders and Undo. New Cassette and ZIP/file import/export are in Menu.
Text/JSON uses the shared editor without forcing Keyboard to Code. New Cassette
retains the original starter instead of using edited or empty Code.

The author document, accepted document baseline and physical SID bank are distinct.
Manual drafts do not reach initial core/model preparation, keyboard notes or CH
selection. Target changes do not rewrite voice documents or homogenize the bank.
Acceptance merges only changed document fields into the current bank, preserving
independent physical edits, packed waveform flags and the shared model/filter.
Code Live remains physical: Auto apply On records acknowledged manual changes;
manual saving keeps its pending author JSON intact. + Instrument can explicitly
snapshot the accepted Code bank. Code/song execution is still mutually exclusive.

Run/Apply uses saved entry/module/data bytes. Ordinary Save does not run source,
replace the Code lease, lose context/FX or stop SID preview. The old reset-intent,
new-key ownership and owner-change acknowledgement safeguards remain covered by
unchanged assertions. If native Auto apply fails, Files retains the previous
accepted source/settings, keeps the working draft, pauses Auto apply Off, and
provides Save retry / Discard guidance. Stale failures cannot roll back a newer
accepted edit or replacement workspace.

## Verification — 2026-11-20/21

- `npm run test:sid-synth`: **320/320** passed. Includes legacy migration,
  both-version ZIP recovery, pending moves, capacity/atomicity, storage recovery,
  source-role serialization, native acknowledgement failures, actual SID audio
  and readable packaging. The main editor/ownership suite is **61/61**;
  three new integration tests cover manual drafts, sparse physical-bank Save
  and rejection before author-source recording.
- `node --test test/sid_player_manual.test.mjs test/sid_player_voice_snapshot.test.mjs test/sid_player_models.test.mjs`:
  **31/31** passed, including real CPU/SID waveforms, both models and Sync/Ring.
- `node scripts/sid_artifacts.mjs --check` and `git diff --check` passed.
  Native cores, shared runtime and mixer gains were not changed.
- Readable ZIP builds and passes its dependency/provenance assertions:
  `build/sid-working-saved-20261120/package/tetorica_sid_synth_working-saved-20261120_itch.zip`,
  **345 files**, SHA-256
  `618a1d4929b530eb4f11b2d77a52b436cf1ec864c07d4491274902da15ee4c5f`.
  Source and actual extracted ZIP were checked in **8/8 browser cases and
  64 stage checks** (Chromium/WebKit × real Monaco/fallback), including **16
  model cases**. All physical output was muted before app startup; no external
  network requests, missing resources, unexpected console/page errors or
  unhandled rejections occurred. No human listening is claimed.
- Browser checks include manual pending settings across audio startup / first
  key / physical target selection, held Gate/frequency and independent CH
  preservation through Save, shared LP/BP values, Code Live Auto apply On
  recording into both JSON layers, and Auto apply Off retaining its pending
  document while accepting physical edits. Run/Apply reads saved source/modules/
  data and retains the Code lease, context/preparations and software FX.
- New / Undo / native backup cancellation, source-byte migration, invalid JSON,
  1360px/390px layouts, current Code + active sound quota recovery, paused
  nonzero SID position through selection/Save and playing-song continuity passed.
  The 19 SID application JavaScript modules served from source and ZIP were
  byte-identical. The persistent expanded-navigation redesign remains next work.
- Final browser evidence:
  `build/sid-working-saved-20261120/final/browser-matrix.json` and its four
  explicit `*-final.json` reports; provisional reports are not signoff evidence.
  Checker SHA-256:
  `b8cabe2782d7bef2b32e7f6f0f78fa24ab48ed2131763c3cdc811875bd78d596`.

## Separate follow-up and limits

- [ ] Persistent expanded Code/SID/Keyboard workspace and header Code/Synth
  layout controls remain the next alignment slice.
- [ ] Timed build / compile / schedule / captureState is separate SID API work;
  it is not part of this Files implementation.
- [ ] Shared output-only channel switches and Live highlighting remain planned.
  Looper / Event Rec remain explicitly deferred.
- [ ] The existing shared recovery journal protects the current text model and
  active sound. If IndexedDB and its full-project fallback both fail, opening a
  different text model can replace the first model's undurable journal. In-memory
  Cassette export retains both; the UI instructs the user to export. Workspace-wide
  failure journaling is a separate common-layer change, not a guarantee of this
  SID port. Verification of recovery is scoped to current Code + active sound.
- [ ] Human listening remains separate from muted numeric/behavior checks.

No npm publication, remote CI, Tauri import, commit, push, tag or release occurred.
