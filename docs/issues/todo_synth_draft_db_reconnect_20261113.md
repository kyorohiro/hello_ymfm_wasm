# Synth local draft: recover a closing IndexedDB connection

- [x] Find the FM draft-store connection lifecycle and reproduce the
      reported InvalidStateError without changing user storage.
- [x] Reopen a closed/closing connection and retry the complete failed storage
      operation safely, retaining the in-memory project and unsaved edits.
- [x] Verify concurrent saves, version changes, transaction failure handling
      and ordinary persistence with focused tests.
- [x] Update relevant frontend cache identities, record verification and keep
      the change reusable by the other Synth apps.

Reported in FM2612 Synth: local draft save and file operations fail because
`IDBDatabase.transaction()` is called on a connection which is closing.
Do not clear or recreate the user's stored project. No physical audio, commit,
push or publication during this work.

## Progress

FM previously kept a raw database connection indefinitely. The new
`docs/synth/synth_draft_store.js` retains the existing database/schema/key,
invalidates closed/version-changing connections, and retries closing
transaction-start failures or aborted rollbacks once. Whole transactions are
serialized, including retry. Reconnection never reloads app state.

Draft snapshots are detached before queueing, and the existing tone journal is
cleared only after the transaction commits and its workspace/generation still
matches. A failed initial read disables writes rather than replacing an unread
saved project with defaults. Quota, clone and version errors remain explicit.

Node: 671 tests pass, including 12 new storage-helper tests and four Files
integration tests. The standalone package includes the readable helper; all
293 files match its ZIP and CRC checks pass. Chromium and WebKit each pass six
real-IndexedDB fault-injection groups, reproducing the reported native
InvalidStateError twice per browser. FM, a 4096-frame PCM sample, UTF-8 Code/text
and raw binary survive closure, retry, version change and reload exactly.
The existing muted packaged startup/import/keyboard/release/reload smoke also
passes in both browsers. CI retains the new fault-injection check.

Current package: `release/hello_ymfm_wasm_draft-reconnect-20261113a_itch_synth.zip`.
Diagnostics: `build/verification/fm-draft-reconnect-20261113/`.

[Verification receipt](verification_synth_draft_db_reconnect_20261113.json).
No physical listening, commit, push, tag or publication was performed.

Follow-up: [SPU / SID / DMG rollout](todo_synth_draft_reconnect_rollout_20261113.md).
