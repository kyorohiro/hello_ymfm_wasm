# HuC6280 working/saved implementation — 2026-11-19

Active implementation slice from the user-approved
[HuC6280 alignment TODO](todo_huc6280_synth_fm2612_alignment_20261119.md).
Retain the user's following order: SPU → DMG → SID.

- [x] Reuse the shared Virtual Files two-version workspace and migrate v1
  HuC6280 projects. Keep original VGM/audio, metadata and the existing byte limits.
- [x] Add default-on Auto apply, Files dots, Save / Save all / Discard and
  Ctrl/Cmd+S. Link the selected sound document to controls, drawn waves and JSON.
- [x] Keep working text editable when JSON is incomplete. Apply only valid
  sound data; retain the last playable sound and report errors without losing text.
- [x] With Auto apply off, author edits remain working until Save; physical CH
  edits remain direct. Apply accepted edits without stopping Code or replacing
  unrelated Code-owned register fields. Raw keyOff and calibration stay unchanged.
- [x] Explicit Run/Apply uses saved source/modules/data. Save never executes Code.
- [x] Preserve both versions and sound selection through reload, rename,
  Undo/New/import and local storage recovery. Export ordinary saved files plus
  working differences; unchanged binary audio must not be duplicated.
- [x] Align sound selection with Auto while preserving VGM Play/Pause position.
  Code and VGM execution remain mutually exclusive.
- [x] Verify existing PCM/LFO/Noise/media paths, Code/live ownership, import
  extraction and Seek/cache with unit tests and muted real source/ZIP browser checks.
- [x] Record actual results and update the alignment TODO.

Runtime implementation is authorized for this slice. The later expanded-Code
layout, Live highlighting, common CH mixer, extra PCM editing, recording and
timed-register API remain outside it. No npm publish, commit, push, tag,
release or Tauri import is requested.

Save is acceptance in memory, distinct from IndexedDB durability. Storage
failure must leave both versions available for recovery/export. JSON that is
not a valid playable preset remains source data; do not silently erase it or
replace the last playable preset merely to satisfy the editor view.

## Implementation notes

- The selected sound has independent working and accepted last-valid caches.
  An invalid JSON can be saved as source without changing the sounding preset.
  A later invalid edit does not cancel an already accepted valid sound update.
- During Code, Save sends only fields changed in the accepted sound document;
  live frequency, pan, gate, loop state and software FX remain independent.
  Stop restores the accepted author sound, never a pending manual draft.
- Explicit standalone Load preset accepts an external sound and detaches the
  previous linked JSON. Oversized Auto-apply instruments can remain external;
  use Save preset to export them separately. Manual edits must fit the project.
  Direct audio imports may also retain an oversized external sound with Auto
  apply On. Ordinary edits never silently discard a linked file on overflow.
- Nested moves out of a folder whose rename is still unsaved are rejected before
  mutation. Save or Discard that parent rename first; this avoids ambiguous
  accepted-path identities. Other rename/delete/Undo paths retain both versions.
- The main source tests plus the shared Code controls tests pass **717/717**.
  A focused shared-controls/FM2612/SPU/DMG/SID compatibility batch also passes
  **168/168** (it overlaps the shared-controls cases; do not add the counts).
  Existing Wave/Noise/LFO/DDA, media, VGM import/Capture, Seek/cache and ownership
  tests are included. The generated WASM and mixer calibration were not changed.
- A readable verification ZIP was built as
  `release/tetorica_huc6280_synth_working_saved_check_20261119_itch.zip`:
  203 files, 2,161,540 bytes, SHA-256
  `b8b9a07ef8041a9d0165958aa0bd38707c28c4ac8f9f49a772f4f439bfa91f72`.
  Its builder records `minify: false`, `bundle: false`; the changed runtime
  modules match the source files byte-for-byte. No game data is bundled.

## Final browser verification

[Verification receipt](verification_huc6280_working_saved_20261119.json).
Source and the exact extracted ZIP pass Chromium/WebKit with fallback and actual
Monaco: **8 cases, 72 scenario groups, 48 settled screenshots**. Files/Code,
maximized/restored layouts fit at 390px and 1360px; Auto apply and Save controls
release focus for the performance keyboard.

Actual Worklet PCM is sampled through a physically zero-gain output. Pending
volume and drawn-wave changes retain the sounding result; Save changes their
PCM while retaining the held gate, pitch, pan, loops and context. Run/Apply uses
saved entry/modules/data. Play/Pause positions survive preset selection. Quota
failure restores Code/sound journals and both versions without starting audio.

There are no page errors, rejected promises, unexpected console errors, missing
assets or unexpected external requests. Every raw console error is retained:
fallback Chromium reports only the three deliberately aborted pinned Monaco
loader requests; real Monaco has zero raw console errors or failed requests.
The checker and served assets are hashed in the receipt. All browser processes
were closed after verification. Human listening, long-duration tests, Tauri
import and publication were not performed.
