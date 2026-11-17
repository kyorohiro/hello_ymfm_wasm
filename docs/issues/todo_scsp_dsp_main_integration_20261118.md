# Integrate published SCSP DSP assembler into main — 2026-11-18

User explicitly requested reflecting the already published tetorica-fm2612
0.2.42 source changes into main and GitHub. This supersedes the earlier
preparation / publication task's instruction to leave main unchanged.

- [x] Confirm main is clean, inspect the dedicated worktree changes and obtain
  the remote branch state without overwriting other work.
- [x] Verify source / declaration copies, unchanged Synth runtime assets,
  whitespace and the 17 focused codec / CLI tests. Preserve the earlier full
  npm / type / browser / published-tarball verification.
- [ ] Commit the reviewed source, package 0.2.42 metadata, examples, checks and
  verification / release records from work/scsp-dsp-npm-20261117.
- [ ] Integrate the commit into main without resetting or rewriting history.
- [ ] Push main to origin and verify local / remote commit equality and clean
  working trees. Record completion below.

No npm republish, new version, git tag, Tauri / itch release or Synth behavior
change is needed. Earlier records describing an unchanged main / uncommitted
worktree remain historical snapshots of those completed phases.
