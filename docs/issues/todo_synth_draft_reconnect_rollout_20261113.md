# SPU / SID / DMG: recover local project storage connections

- [x] Adapt the FM draft-store connection lifecycle for the SPU project store,
      retaining its database name/version/key, saved files and fallback format.
- [x] Apply the same storage contract to SID and DMG without changing their
      project schemas or instrument/Code editing behavior.
- [x] Preserve save ordering and immutable snapshots across reopen/retry; never
      restore old project state during reconnection or overwrite an unread draft.
- [x] Test closed connections, aborted transactions, failed opens, concurrent
      edits and the existing localStorage fallback.
- [x] Include matching readable helper modules and cache identities in each
      standalone distribution; verify actual packages in muted browsers.
- [x] Record verification and remaining limitations. No commit/push/publication.

Continue the FM2612 fix in `todo_synth_draft_db_reconnect_20261113.md`.
Do not clear user storage, change database versions or migrate stored projects.
No physical audio. Browser checks must install destination gain zero before
application JavaScript, with Chromium mute enabled, one batch at a time.

## Progress

- The three adapters use `synth/synth_project_store.js`, which queues complete
  operations over the FM reconnect helper. Existing IndexedDB names, schema 1,
  `projects/current` and each localStorage byte encoding/key are unchanged.
- Files persistence starts only after the initial stored project is safely read
  and validated. Read failure retains the in-memory files and Export without
  replacing an unread project. Reconnect never reruns project restoration.
- Shared Code flush now captures the saved workspace/path/source before awaiting
  storage, so an older completion cannot delete a newer recovery journal. The
  same correction is included for FM2612.
- SID/DMG retain sound edits made during a slow successful initial read and
  schedule their save when restoration is ready.
- Combined Synth, project-store, Code-controls and package tests: 1,585 pass.
  All four ZIPs pass CRC/stage checks; the three target packages contain the
  exact readable common helpers and their own updated adapters.
- Browser fault-injection checks pass all three targets in Chromium and WebKit:
  six runs / 36 groups, all with the final checker hash. Real connection-close,
  rollback and queued-edit cases retain exact JSON, Code, text, binary, settings,
  selection and mode after reload. No AudioContext is initialized by these tests.
- Each target workflow now checks storage recovery on its actual extracted ZIP.

Diagnostics: `build/verification/synth-draft-rollout-20261113/`.

[Verification receipt](verification_synth_draft_reconnect_rollout_20261113.json).
SPU/SID use `draft-rollout-20261113a`; DMG uses the final
`draft-rollout-20261113b` ZIP. An FM ZIP containing the shared journal correction
is also built and checked. No physical listening, commit, push, tag or publication.
