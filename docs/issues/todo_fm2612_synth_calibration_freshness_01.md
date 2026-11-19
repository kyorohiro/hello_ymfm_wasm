# FM2612 Synth：非DSP変更と校正履歴（2026-11-10）

- [x] YMFM／Nuked workletのクラスへの`export `追加だけを除去し、元の全バイト数・SHA-256へ一致する場合だけ過去の校正を利用する。
- [x] Codeタブの読み取り専用Monaco定義ビューアーを、現行全文SHAへ固定した逆差分で復元し、既存SID receiptを経由して元の測定全文SHAへ照合する。
- [x] `playground_monaco.js`の型定義読み込み／定義ジャンプUIと、`playground_virtual_files.js`のimport／export分割も、現行全文SHAと元の測定全文SHAへ固定した既知revisionだけを復元する。
- [x] 別path、別export、音声ロジック／import／次のUI変更を許可しないテストを追加する。測定レポート・補正gainは変更しない。
- [x] 両Mixer generatorの`--check`とPlayground artifact profileの`--check`を通す。SCSP validator／直接テストも中央freshness helperへ揃える。
- [x] 共通Mixerの配布検証結果を[共通Mixerの検証記録](todo_fm2612_synth_common_mixer_01.md)へ転記する。

検証：関連source guard／PS1／WonderSwan／POKEY／SCSPテスト368件成功。ログ：`/private/tmp/tetorica-mixer-source-guard-tests.log`。両generatorと`node scripts/runtime_artifact_profiles.mjs playground --check`成功。測定レポート・生成済みgainは変更していない。

## 2026-11-19: existing SCSP provenance dependency mismatch

- [ ] Reconcile the historical SCSP output-level/New Cassette source-revision
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
