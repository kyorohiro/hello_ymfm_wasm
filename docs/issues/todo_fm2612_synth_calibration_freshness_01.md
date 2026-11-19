# FM2612 Synth：非DSP変更と校正履歴（2026-11-10）

- [x] YMFM／Nuked workletのクラスへの`export `追加だけを除去し、元の全バイト数・SHA-256へ一致する場合だけ過去の校正を利用する。
- [x] Codeタブの読み取り専用Monaco定義ビューアーを、現行全文SHAへ固定した逆差分で復元し、既存SID receiptを経由して元の測定全文SHAへ照合する。
- [x] `playground_monaco.js`の型定義読み込み／定義ジャンプUIと、`playground_virtual_files.js`のimport／export分割も、現行全文SHAと元の測定全文SHAへ固定した既知revisionだけを復元する。
- [x] 別path、別export、音声ロジック／import／次のUI変更を許可しないテストを追加する。測定レポート・補正gainは変更しない。
- [x] 両Mixer generatorの`--check`とPlayground artifact profileの`--check`を通す。SCSP validator／直接テストも中央freshness helperへ揃える。
- [x] 共通Mixerの配布検証結果を[共通Mixerの検証記録](todo_fm2612_synth_common_mixer_01.md)へ転記する。

検証：関連source guard／PS1／WonderSwan／POKEY／SCSPテスト368件成功。ログ：`/private/tmp/tetorica-mixer-source-guard-tests.log`。両generatorと`node scripts/runtime_artifact_profiles.mjs playground --check`成功。測定レポート・生成済みgainは変更していない。

## 2026-11-19: existing SCSP provenance dependency mismatch

- [x] Reconcile the historical SCSP output-level/New Cassette source-revision
  chain with the subsequent FM2612 `docs/synth/synth.js` changes, preserving the
  measured reports and gains. `mixer_calibration_huc6280_ui_revision.test.mjs`
  and `mixer_calibration_code_note_revision.test.mjs` currently have four
  failures through that dependency. This was reproduced with every dependency
  read from HEAD, independently of the
  [HuC6280 shared Mixer change](todo_huc6280_shared_channel_mixer_20261119.md).
  HEAD/current FM source is 162398 bytes,
  SHA-256 `08930d99d48d6dfaee9a876b645c1a4bfc2f80efbd18cced094dea78bb9da28a`;
  the historical receipt expects 150646 bytes,
  `1b7d9c389fa3ebdbaf495a011b0b5f0cf9344e1030f03a47316d7bd00bcff282`.

### Authorized repair — 2026-11-19

- [x] Reproduce the two failing suites against the current clean checkout and
  identify the missing reviewed source-revision connection.
- [x] Audit the FM2612 changes and existing source receipts. Reuse an exact
  reviewed predecessor where available; retain rejection of unknown/future
  source changes and distinguish historical test fixtures from production
  freshness validation.
- [x] Repair the smallest affected reader/chain without changing synthesizer
  behavior, measured reports or generated mixer gains.
- [x] Run the repaired suites and relevant source-guard/chain/package checks;
  record the results and remaining limits before marking this task complete.

### Repair completed

The historical AY reader now supplies a test-only, independently pinned FM
application predecessor reader before entering the existing YM2608/AY/SCSP
chain. It covers the two launcher files and the later CD-DA declaration changes.
Two self-pinned SCSP test files also retain their exact original bodies inside
that fixture after their reader injection is updated. The policy tests use the
same explicit historical reader. Production calibration readers do not import
this fixture and continue rejecting an unapproved current or future graph.

The fixture checks both complete source identities, historical receipt links,
reverse reconstruction, changed companion files, forged evidence, and immutable
owned reads. Negative freshness tests accept the relevant exact dependency
rejection when it precedes the old binary check; they still require rejection.
No live Synth, runtime, WASM, historical measurement or generated gain changed.

[Verification](verification_fm2612_calibration_history_repair_20261119.json):
the original two suites now pass all 6 collected tests (the original Code test
file previously failed during module loading, counting as one of the 4 failures).
Related history/policy/source-guard tests pass 56/56; the HuC6280 package tests
pass 2/2; Playground artifact-profile checking passes. CI includes the new
fixture tests and fetches the history needed for actual-Git comparisons.
No audio device, browser, publish, commit or push was used for this repair.

### Separate remaining calibration-generation check

Authorized follow-up: audit changed Virtual Files modules and their use during
measurement; add only an exact reviewed non-audio source transition if justified,
otherwise remeasure. Validate both generators and rejection of future edits.

- [x] Review/remeasure the public Virtual Files source dependency after the
  working/saved changes. Both current mixer generators' `--check`, using the
  latest YM2608 source-mix reports, reject
  `docs/js/tetorica_virtual_files/filesystem.js`. Its 20639-byte body has SHA-256
  `c74e0072c09884917896bd7af4b487799e34f83ffb5cda40896b22acf510434b`,
  while the report records 20206 bytes and
  `25f821472b25bc58cf4b840a44111b2639013861ef14191de8bd684e973c9b41`.
  The current file is byte-identical to HEAD before this repair. This separate
  freshness rejection was retained, and no measurement or gain was rewritten
  to suppress it.

### Virtual Files follow-up completed

Reviewed commit `41ee0e1bdbdd069a5cd359c5f5dcd006da0d70d9`: the filesystem
adds a private WeakMap store registration and retains the existing publish
notification default; the index adds the optional working/saved workspace
export. The imported internal/workspace modules contain file-management code,
without audio processing, scheduling, gain or chip changes. Existing filesystem
operations match the actual predecessor's snapshots, revisions and notifications
through 160 sequential write operations with checkpoints both enabled and disabled.

The separately pinned
[source receipt](virtual_files_workspace_calibration_revision_20261119.json)
allows only the two exact measured/current source pairs. It authenticates all
served Virtual Files JavaScript dependencies and all four existing measurement
reports, including the newly imported modules. Future source edits, changed
companion modules, forged records and DSP/WASM paths receive no exemption.
Historical Git/Shell negative tests also recognize an earlier strict dependency
rejection while continuing to require rejection of their unsupported SCSP graph.

[Verification](verification_virtual_files_workspace_calibration_20261119.json):
153 file/source-guard tests and 29 historical regression tests pass. Both mixer
generators pass `--check` with the YM2608 source-mix reports, and Playground's
artifact profile passes. All existing measurement reports and generated gains
remain byte-identical to HEAD; this audit did not require new audio measurements.
CI runs the new guard tests with the history needed for predecessor comparison.
No Synth/runtime source, audio device, browser, commit, push or release was used.
