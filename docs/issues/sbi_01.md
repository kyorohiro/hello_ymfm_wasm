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
