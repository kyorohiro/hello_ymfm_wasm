# Devlog下書き：VGM Analyzer — 巻き戻しを速く、PCMを調べやすく

VGM Analyzerにシークキャッシュと、Sega PCM／OKIM6258のSample Explorer対応を追加しました。

## 再生した場所へ、より速く戻る

対応音源では再生途中の状態を保存し、シーク時に近くの保存地点から再開します。
少し戻すたびに曲の先頭から演算し直す待ち時間を減らします。

対象はOPN系、Genesis構成、OPM（YM2151）です。
GenesisではSega PSG・RF5C164・32X PWM、YM2151ではSega PSG・Sega PCM・OKIM6258の併用にも対応しています。

キャッシュのない区間や未対応音源を含む構成では、従来の方式でシークします。
Sound chip supportページのPlayback欄にも「Seek cache」と対応条件を追記しました。

## Sega PCMの波形と使用履歴

Sample Explorerで、ROM内の波形、使用チャンネル、バンク、開始位置、ループ設定を確認できます。
raw PCMの保存、使用回ごとのステレオ試聴、WAV保存にも対応しました。
Sega PCM単体のほか、PSGやYM2151との併用曲でも利用できます。

試聴は発音時点の設定で1回再生します。ループや演奏中の設定変更を再現するものではありません。

## OKIM6258のADPCMを時刻付きで取り出す

CPUから送られるADPCMデータを、再生開始から停止までのキャプチャとして表示します。
直接書き込みとVGMストリームの両方に対応し、途中のパン・クロック・分周変更も記録します。

波形表示、ステレオ試聴、WAV保存に対応。native保存はデータ供給の時刻や設定を保持するJSONです。
試聴・WAVは先頭最大10秒で、キャプチャ開始前の分周位相は引き継ぎません。

---

公開準備メモ（投稿本文には含めない）：

- 対象コード：`b7112c3`（Sample Explorer・高速シークを含む）。
- 版番号・公開先・公開URL：確認待ち。
- 公開・devlog投稿：未実施。
- 通常環境の直近回帰：1150件中1149成功、失敗0、既存skip 1。
- Node.js 22確認：全体実行で1148成功・既存skip 1。配布テスト1件は`npm exec --package=node@22`の設定継承で失敗したが、取得済みNode.js 22をPATHに直接指定して同テストを再実行し成功。機能の修正は不要。
- skipは`MML2MDR_DIR`未設定時の外部MMLコンパイラー連携テスト。
- itch.io検証ZIP：`release/hello_ymfm_wasm_oki-samples-check-20260929_itch_vgm_analyzer.zip`。前の実装検証で352件の依存参照チェック成功。正式版番号のZIPは未作成。
- Sega PCM：ユーザーから「OK」の報告あり。ブラウザー／OS・試聴範囲の詳細は未記録。
- OKIM6258と高速シーク：実ブラウザーでの試聴確認は未記録。
- CLIも公開する場合は、以下を投稿本文へ追加する。

> CLIにもSega PCM／OKIM6258のサンプル一覧・native単体／ZIP抽出・WAV出力を追加しました。
> `samples FILE --json` で一覧を確認し、`--id` と `--output` で保存できます。
