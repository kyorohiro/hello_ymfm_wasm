# SBI 音色Export

## 実装内容（2026-09-28）

VGM Analyzerの既存のVGMパーサー・OPLレジスタ処理を使い、OPL系のメロディ音色をSBIに書き出す機能を追加した。
既存のOPL JSONスナップショットだけでは曲全体の音色一覧を得られないため、OPM抽出と同じ方式の音色収集も追加した。

### 対象

| 音源 | 出力 |
| --- | --- |
| YM3526 / YM3812 / Y8950 FM | 通常SBI（2op） |
| YMF262 / YMF278B FM | 2opは通常SBI、4opはUNIX拡張SBI |

YM2413（OPLL）、複数FM音源の混在、dual/variant指定は対象外。YMF278BはFM部分のみ。

### 画面操作

対応音源のVGMを読み込むと、Export欄に以下を表示する。

- **SBI voices**：曲全体から抽出した音色を選択し、単体の `.sbi` を保存。
- **All SBI ZIP**：曲全体の音色を `all_sbi_patches.zip` にまとめて保存。
- **Snapshot SBI**：現在の再生処理位置の音色を再構築し、チャンネルを選択して単体保存。再生前はサンプル0の状態。

音色選択にはファイル名・2op/4op・最初に観測した時刻を表示する。
スナップショットはキーオフ中のチャンネルも含む。4opの従属チャンネルとリズム用チャンネルは選択肢から除外する。
処理位置は既存JSONスナップショットと同じ `processedWaitSamples` を使用するため、音声バッファ分だけ実際に聞こえる位置より先になる場合がある。

### 抽出方式

- 元のVGMを1回走査し、キーオン状態とキーオン中の音色変更を収集。
- 同じチャンネルの同じSBIパラメータは重複除去。音程・時刻・パンは同一音色の判定に含めない。
- TLはその時点の値を保持し、音量正規化は行わない。音量変更も別音色になり得る。
- OPM抽出と同じくレジスタ書き込みごとに観測するため、キーオン中に複数レジスタを変更した場合の途中状態も含む。
- OPL3の6組の4opペア、2つのバンク、互換モードでのアドレスの折り返しを扱う。
- 波形は実際に有効な値にマスクする。YM3526/Y8950は正弦波、YM3812は波形選択enableを考慮、OPL3はNEWモードを考慮。
- ROMや音声エンジンに依存せず、再生前でもExportできる。

### SBIバイナリとFurnace互換性

- 2op：`SBI\x1a` + 32バイト音色名 + 11バイト音色データ + 5バイトゼロ埋め（52バイト）。
- 4op：`4OP\x1a` + 32バイト音色名 + 11バイト×2 + 2バイトゼロ埋め（60バイト）。
- 各ペアはM/Cの順で、20h・40h・60h・80h・E0hの各レジスタと接続／フィードバックを格納。
- 名前はASCIIで最大30文字、末尾をゼロ埋め。
- 4opの接続ビットは両チャンネルの値を保持する。
- 4opの有効なフィードバックは先頭チャンネルの値。Furnaceの `loadSBI` は後半ペアからフィードバックを読むため、後半にも先頭の値を複写する。4op時に使われない従属チャンネル独自のフィードバック値は保存しない。

仕様の参照先：

- [Furnace loadSBI](https://github.com/tildearrow/furnace/blob/master/src/engine/fileOpsIns.cpp)
- [OPL3 Bank Editor SBI入出力](https://github.com/Wohlstand/OPL3BankEditor/blob/master/src/FileFormats/format_sb_ibk.cpp)
- チップ動作はリポジトリ内 `src/ymfm_opl.h` / `src/ymfm_opl.cpp` と既存モニター処理を参照。

### 保存しない情報

リズム専用音色、CSM区間、ADPCM/PCM、パン、チップ全体のビブラート／トレモロ深度、クロック、音程、演奏中の変化の時系列、エンベロープの進行状態。
オペレータごとのAM/VIBフラグなど、SBIに入る音色パラメータは保存する。
SBIの読み込み先でも同じ演奏音を完全再現する保証はない。特に全体設定とクロックは読み込み先で調整が必要。

## 変更ファイル

- `docs/vgm_analyzer/sbi_export.js`：SBIエンコード、曲全体の抽出、時刻指定スナップショット、一括ZIP。
- `docs/vgm_analyzer/sbi_ui.js`：音色選択ダイアログ、単体／ZIPダウンロード。
- `docs/vgm_analyzer/index.html` / `vgm_analyzer.js`：Export欄への組み込み、音源・読込状態による有効化。
- `docs/vgm_analyzer/sbi_export.test.mjs` / `sbi_ui.test.mjs`：バイナリ・抽出・UI操作の自動テスト。

ブラウザー版とCLIに対応。OPLI/WOPL出力は含まない。

## 検証

- SBIバイナリ配置、ゼロ埋め、波形制限。
- OPL3の全6ペア×全4接続のオペレータ順・Furnace方式の接続／フィードバック復号。
- 対象5音源での音色抽出、重複除去、キーオン中の変更、スナップショット境界と範囲外エラー、ZIP内容。
- リズム／CSM除外、4op従属チャンネル除外、互換モードのバンク折り返し、OPL4 PCM除外、混在／dual拒否。
- DOMモックで単体選択・ダウンロード、スナップショット、ZIP、空トラック、ボタン有効化を検証。
- `npm run test:analyzer`：892件中891件成功、失敗0件、既存の1件スキップ。
- `node --check docs/vgm_analyzer/vgm_analyzer.js`、`git diff --check`：成功。
- 実ブラウザーの接続先がなく、実画面での目視確認は未実施。Furnaceアプリでの実インポート・試聴も未実施。互換性の確認は公式読み込み実装との照合とバイナリテストによる。

## autotest追加

SBI専用の実行入口とCIを追加した。外部パッケージ・WASM・音声デバイスは不要。

```sh
npm run test:sbi
```

- `.github/workflows/sbi.yml`：push／pull request時にNode.js 22で実行。
- 2op → 4op → 2opの切り替え：従属チャンネルの除外・復帰、ペア後半の音色変更、時刻指定スナップショット。
- 再キーオン・音程・パン・全体変調深度の変更で重複が増えず、TL変更と別チャンネルの音色は保持されること。
- キーオン中の波形選択enable切り替えと、無効ビットだけを変更した場合の重複除去。
- 2op／4op混在ZIP：全エントリーの名前、ヘッダー、サイズ、音色データ、中央ディレクトリ、CRCを検証。

従来の11テストと追加の4テストを同じコマンドで実行し、ローカルで15件すべて成功。`git diff --check`も成功。GitHub上のCI実行結果とFurnaceアプリでの実インポート確認は未確認。

## CLI対応

共通API `exportSource` の形式一覧に `sbi` / `sbi-zip` を追加した。ブラウザーと同じ抽出・エンコード処理を使用する。

```sh
node cli/main.js export song.vgz --format sbi --at 1.5 --channel 1 --output voice.sbi
node cli/main.js export song.vgz --format sbi-zip --output voices.zip
node cli/main.js support song.vgz --json
```

- `sbi`：`--at`（秒）と `--channel`（1始まり）が必須。4opは先頭チャンネルを指定する。
- `sbi-zip`：曲全体から抽出。時刻／チャンネル指定は受け付けない。
- 範囲外の時刻・チャンネル、リズム／4op従属チャンネル、CSMなどはエラーとし、出力を書き込まない。
- `--force`なしでは既存ファイルを上書きしない。引数や抽出がエラーの場合は、`--force`があっても既存ファイルを保持する。
- `support`は両形式を検査する。単体の判定は既存スナップショット形式と同様、時刻0・CH1で行う。
- API：`exportSource(source, {format:'sbi', atSeconds:1.5, channel:1})` → `{bytes, sample, channel, warnings}`。
- API：`exportSource(source, {format:'sbi-zip'})` → `{bytes, count, warnings}`。
- CLIヘルプと `CLI.md` に形式・使用例・制限を追記。

`test/sbi.test.mjs`を追加し、`npm run test:sbi`とSBI CIの実行対象に含めた。5音源のVGM/VGZ入力から実CLIプロセスで単体／ZIPを書き出し、ブラウザー出力と一致すること、上書き保護、対応判定、異常時のファイル保全を確認。

- `npm run test:sbi`：22件すべて成功。
- `npm run build`：成功。生成された `dist/cli/main.js` からYMF262のSBI／ZIPを書き出す確認も成功。
- `npm test`：160件すべて成功（既存CLI・パッケージ検証を含む）。
- `npm run test:analyzer`：896件中895件成功、失敗0件、既存1件スキップ。

## SBI Info

OPM Infoと同じ位置の音色タブを、YM3526 / YM3812 / Y8950 / YMF262 / YMF278Bでは **SBI Info** として表示する。

- 初めてタブを開いたときに既存のSBI抽出処理で音色一覧を作成。名前・2op/4op・最初の観測時刻から選択する。
- 音色のチャンネル・接続・フィードバックと、各オペレータのMUL/TL/AR/DR/SL/RR/KSL/KSR/AM/VIB/EG/WAVEを表示。
- 選択音色の `Download SBI` と、共通の鍵盤UIによる単音試聴。試聴音量・停止ボタンを用意。
- 試聴はExportするSBIのパラメータを独立したYMF262コアへ設定。標準14.31818 MHz、左右中央、全体変調深度は初期値を使用する。元VGMのクロック・パン・全体設定を再現するプレビューではない。
- キーを離すとキーオフし、最大2秒のリリース。VGM本体の再生は継続する。
- 音色・ファイル・タブの切り替えで試聴を停止。ファイル読み込み開始時に前曲の一覧も消去。
- 再生中のUI更新でもSBI Infoを選択したまま保ち、dual/variantではタブを無効化する。

実装は `sbi_info.js`。OPM Info・TFI Infoの音源別切り替えに追加した。
`sbi_info.test.mjs` を `npm run test:sbi` と既存CIの対象へ追加。SBI Info試聴テストではリポジトリ同梱のYMF262 WASMを使用するため、WASMビルドや音声デバイスは不要。

検証：MIDI音程の量子化誤差、4opのレジスタ設定、実YMF262による2op/4opの有限・非無音ステレオ出力、キーオフと停止、音色選択とダウンロード内容、抽出エラー、初期化中の破棄、全5音源のタブ維持を自動テストした。

- `npm run test:analyzer`：908件中907件成功、失敗0件、既存1件スキップ。
- `npm run test:sbi`：29件すべて成功（CLIと実YMF262試聴を含む）。
- 実ブラウザー上の目視・鍵盤操作・聴感確認は未実施。

## 0.1.9 リリース準備（2026-09-28）

公開先：CLIはnpm、VGM AnalyzerはGitHub Pagesとitch.io。
公開済みnpmの最新バージョン0.1.8を確認し、`package.json`を0.1.9へ更新した。

公開前に発見・修正した点：

- itch.io梱包リストに `sbi_export.js` / `sbi_ui.js` / `sbi_info.js` が不足していた。追加し、単独配置に合わせたimportパスの書き換えも追加。
- npm配布用 `cli/README.md` にSBIの説明とコマンド例を追加。
- GitHub用README、Analyzerの音源対応表を更新。`support.html`を生成し直した。

検証結果：

| 環境・対象 | 結果 |
| --- | --- |
| Node.js 25.2.1 / CLI | 160件成功 |
| Node.js 25.2.1 / Analyzer | 907件成功、失敗0、既存1件スキップ |
| Node.js 22.23.3 / CLI | 160件成功 |
| Node.js 22.23.3 / Analyzer | 907件成功、失敗0、既存1件スキップ |
| npm pack dry-run / pack / publish dry-run | 成功 |
| itch.io依存検査 | 341件成功 |
| itch.io ZIP展開整合性 | 成功 |
| 配布tarballのCLI / API | 2op・4opのSBI／ZIPがAnalyzer版と一致 |
| itch.io同梱コードの試聴 | 同梱YMF262 WASMで2op・4opの有限・非無音PCM出力を確認 |
| 対応表同期 / git diffチェック | 成功 |

スキップは外部 `mml2mdr` コンパイラ未配置による既存の任意検証。SBI関連テストにスキップはない。
Node.js 22の初回CLI検証では、`npm exec --package=node@22`の環境設定が子プロセスのoffline npm実行へ引き継がれ1件失敗した。取得したNode.js 22実行ファイルを直接使って再検証し、160件すべて成功した。

作成済み配布物：

- `tetorica-vgm-0.1.9.tgz`（149ファイル、約608 kB）
  - SHA-256: `2f1bfc746c7413c30850fabae998c242326e8c9357b9bd728587255c3f1881dc`
- `release/hello_ymfm_wasm_0.1.9_itch_vgm_analyzer.zip`（約1.3 MB）
  - SHA-256: `9f5da0b649f18587ca7a785f03f127bdefa1b8e3c17acd0c01d4c881ea715c56`

0.1.9準備時点の公開状態：未公開。以下は当時の記録であり、CLIの現在の状態は末尾のv0.2.1公開記録を参照。

- npm：`npm whoami`が401 Unauthorized。再ログインが必要。
- GitHub：`gh`未ログイン。リリース変更のcommit/push、Pagesの反映確認は未実施。
- itch.io：butler未導入、操作可能なブラウザー接続なし。アップロード未実施。
- 実ブラウザーでの目視・鍵盤操作・聴感、およびFurnaceアプリへのインポートは未実施。

認証・接続復旧後、検証済みtarballを指定してnpm公開し、GitHub Pagesへソースを反映、itch.ioへ上記ZIPをアップロードする。ROMや手元の楽曲ファイル、`w/`などは配布物に含めない。

## CLI v0.2.1 公開済み

ユーザーがCLI v0.2.1をnpmへ公開。`npm view tetorica-vgm@0.2.1 version dist.integrity`で公開を確認した。ローカルの`package.json`も0.2.1。

- 公開パッケージ：`tetorica-vgm@0.2.1`
- npm integrity：`sha512-5IsAFv9FUKGNKjIoxt4lYdQE1qEog6AoTX4SjeaqUyV9ZPnUp00FFbA2A5+VEZkI+jXEN71mL0WIHds4puCXjA==`
- 先の0.1.9配布物・検証結果は準備時点の記録。今回の確認はnpm公開メタデータであり、公開版0.2.1の実行テストは再実施していない。
- VGM AnalyzerのGitHub Pages／itch.io公開完了は未確認。
