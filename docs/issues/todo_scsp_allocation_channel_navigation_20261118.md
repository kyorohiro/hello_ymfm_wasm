# Allocation diagram -> physical CH editor navigation - 2026-11-18

Base `18a9bc47`; initially clean worktree. Make the existing Synth / Code
allocation view a useful shortcut into the same physical CH editor.

- [x] Make the displayed member CH number a labelled native button. Route its
  activation through the existing CH selection callback, without programming
  a slot, choosing a source operator, acquiring audio or restarting Code.
- [x] Preserve the current group mapping, physical keyboard target, drafts,
  retained groups and SSF Live ownership. Guard hidden, unavailable, disposed
  and changed-during-gesture targets instead of navigating to a different CH.
- [x] Support mouse/touch and native keyboard activation, release pointer
  focus for musical keys, and keep polling/focus/help and narrow layouts stable.
- [x] Verify model/DOM navigation and real muted UI editing during Code,
  reordered Custom mappings, no-selection mutations, stale targets and SSF
  switching; verify the actual extracted ZIP and update exact source proofs.

No new channel picker, public API, allocation/audio/core/WASM/observer/gain/
preset behavior, npm/release/version/commit/push/tag or Tauri work.

Completed: 467 unit + 2 package tests, 28 source and 28 extracted-ZIP browser
checks, 14 prior allocation browser checks, 31 source-proof tests, seven source
recorders and both Mixer generators pass. Physical output remained muted.
See [verification](verification_scsp_allocation_channel_navigation_20261118.md)
and evidence under `build/scsp-allocation-channel-navigation-20261118/` /
`build/scsp-allocation-channel-navigation-browser-20261118/`.
