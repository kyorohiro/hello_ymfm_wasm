# GitHub Actions follow-up for 15da4ac3

Started: 2026-11-14.

- [x] Inspect the latest workflow results for the pushed commit.
- [x] Retrieve HuC6280 Synth and itch web release ZIP failure logs; identify
      each failing assertion and whether the failures share a cause.
- [x] Reproduce the failures and make focused corrections without weakening
      audio comparisons, dropping assertions or overwriting staged user work.
- [x] Validate the affected checks with physical audio output muted.
- [x] Record results and remaining remote verification requirements.

Known failed runs:
- HuC6280 Synth: https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/43581439023
- itch web release ZIPs: https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/43581438992

Existing tempo/Code-keyboard changes are staged by the user. Do not alter the
index, commit, push, tag or publish as part of this follow-up.

Findings:
- HuC6280 CD-DA failed at its first Code source preparation. A pending Files
  selection reached openFile(show:false) after the initial Code-tab request;
  the shared workspace fence invalidated the older request, leaving the editor
  hidden. Initialize Code first, then open the file and await editor readiness.
  Avoid reopening an already selected index.js, whose unnecessary async flush
  could otherwise invalidate a following Apply preparation.
  Retain the existing regression that newer file selections fence stale views.
- RF5C164's former RMS comparison passed. The next failure was manual Step
  editing after a Seek to 9 seconds. In WebKit, the VGM's high-byte write at
  frame 532670 (10 seconds) ran before the hand edit at frame 553387, which then
  legitimately changed Step back to 0x0835. Observe the Seek transition before
  starting it and perform actual Live/Step UI clicks in the first resumed
  browser task. Assert hand writes occur before 10 seconds and that the later
  VGM high byte still produces exactly 0x1335. Keep all PCM/gain/Pan comparisons.

Both changes are confined to their browser checkers; product code, fixtures,
audio gain, timeout values and acceptance bounds remain unchanged by this
follow-up. Diagnostic artifacts are under build/ci-15da4ac3-20261114/.

Completed locally: 2026-11-14.
- Shared Code controls: 30 Node tests passed, 0 failed, 0 skipped.
- Final CD-DA checker: Chromium/WebKit, 14 check groups passed.
- Final RF5C164 checker: Chromium/WebKit, 18 check groups passed. Both engines
  perform the hand edit at frame 483792, followed by VGM high byte at 532670;
  Step is 0x0834 -> 0x0835 -> 0x1335 as intended.
- All physical output muted; all browser/server processes closed. No listening
  or long-duration test. Before/final snapshots of the original staged patch
  matched byte-for-byte. The user subsequently committed the feature as
  5ab74a3d during this task; the agent did not change the index or commit/push.
- Commit/push the new checker changes, then confirm both workflows on the new
  commit. The remote failures were on 15da4ac3, before these corrections.

Verification: [verification_github_actions_15da4ac3_20261114.json](verification_github_actions_15da4ac3_20261114.json).
