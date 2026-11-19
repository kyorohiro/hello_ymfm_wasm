# SPU Files Undo

- [x] Add a Files Undo button for successful structural operations: create,
  duplicate/move/rename/delete, file/Cassette import, explicit preset/bank saves,
  New Cassette, Save/Discard and Auto apply acceptance.
- [x] Capture both workspace layers, pending moves, selection/editor mode,
  authored sound and Files visibility. Keep ordinary typing/knob strokes in
  their existing editing flow, not per-keystroke Files history.
- [x] Bound session-only history to 20 entries / 32 MiB estimated retained
  data. Evict old entries, explain operations too large to retain, and do not
  serialize history into Cassette or local draft storage.
- [x] Prevalidate before retiring performance; Undo stops Code/PSF/keyboard,
  restores accepted sound without opening cold audio, and restores documents
  without running Code or playing notes. External inspector sessions are not
  historical file data and are not reconstructed.
- [x] On restoration failure, retain the entry and roll back current files,
  editor and sound so it can be retried. Storage failure leaves restored data
  exportable in memory. Do not record rejected/uncommitted operations.
- [x] Verify native bytes, unsaved deltas/moves, New and import, failures,
  bounded memory, real muted browsers and a readable packaged ZIP locally.

No Redo, global Ctrl/Cmd+Z interception, transport time travel, npm/Tauri
publication or remote CI in this slice.

## Verification (2026-11-20)

- `npm run test:spu-synth`: 434 passed, including the source/package checks.
  New tests cover snapshot retention/eviction, duplicate/create/rename/delete,
  native bytes, pending moves, working/saved layers, Save/Discard/Auto apply,
  New/import, explicit instrument/VAB batch saves and cached native VAB Tones.
  Failed/no-op operations do not add entries. Sound/editor/retirement failures
  retain the entry and roll back current files/identity for retry. Local storage
  failure leaves restored data exportable. Oversized snapshot retention is
  rejected without undoing the completed file operation.
- `check_spu_working_saved_browser.cjs`: source and ZIP, muted Chromium/WebKit.
  Cold Undo creates no audio. Undo New restores the previous Code and sound
  draft/saved versions; the old loop stays stopped. A deleted binary is restored
  and the restored instrument plays only after a new keyboard press. Existing
  drafts, preset edits, reload and expanded navigation still pass.
- `check_spu_synth_psf_manual_browser.cjs --engines=chromium`: source and ZIP.
  Undoing file creation while PSF plays closes the core and does not run Code;
  explicit Play works afterwards. Undo New restores Files without rebuilding
  an external inspector session or restarting the song. Existing transport,
  Capture, ownership and Code handoff pass.
- `sh scripts/package_itch_spu_synth.sh files-undo-check`: readable source/native
  provenance checks passed; bounded history helper is included. Inspected the
  390 px Files controls. `git diff --check` passed.

Undo restores the full before-operation snapshot, including its drafts; edits
made later are replaced too. It is not a per-keystroke or per-register undo.
No Redo or Ctrl/Cmd+Z override was added. History is session-only and excluded
from project storage/Cassette export. Accepted instrument data is restored but
notes/Code/PSF are not automatically restarted. Physical outputs were muted
before application startup; no listening, publication, commit/push or remote CI.
