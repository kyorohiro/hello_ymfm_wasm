# PC Engine / PC-98 New Cassette menus — 2026-11-18

User requested the SCSP-style New → Cassette operation in PC Engine and PC-98,
with the PC Engine ZIP menu labels aligned to Cassette terminology.

- [x] Add a New section above Import in both menus and retain separate imports.
- [x] Reuse the final SCSP confirmation, optional backup and transactional
  replacement flow, using each app's default sound and original starter/examples.
- [x] Preserve old files/project identity on cancellation or failure. Use a fresh
  sound reader if the existing app provides one; never run Code automatically.
- [x] Align PC Engine import/export labels to Cassette · ZIP and invalidate
  the affected module cache graph without changing runtime behavior.
- [x] Verify defaults, backup, cancellation, failure rollback, persistence and
  cleanup with focused tests; coordinate actual browser/package checks.

No audio pipeline changes, general framework, other runtime features, commit,
push or publication are included in this menu task. Existing staged SCSP work
belongs to the user and remains untouched.

The existing sound getter is read once for the event's backup and rollback;
PC-98 already captures its current engine-backed preset through that getter.
An unavailable/invalid read reports a fallback to the project's cached sound.
PC Engine's new Cassette includes its three existing generated Code examples;
PC-98 includes the existing starter. Code never runs automatically.

PC Engine retains the external CD-DA session-WAV omission notice in the
confirmation and optional-backup success message. Project files/settings and
identity roll back after failure; the existing performance may already have
stopped. The existing workspace-replacement hooks also retire runtime media
and song state separately from portable Cassette data.

Focused tests and source/extracted-ZIP checks passed in Chromium / WebKit.
See [the combined verification](verification_pce_opna_refinements_20261118.md).
