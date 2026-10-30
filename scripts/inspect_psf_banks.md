# PSFフォルダーの静的互換性レポート

展開済みの1作品分のPSFセットを調べ、Playground／SPU Synthと同じパーサーで検出できる標準VABと対応ToneをJSONにまとめる。
複数作品を検証するときは作品ごとに実行し、レポートを分ける。
Node.js 22以降。ブラウザ・音声デバイス・ネットワークは使用しない。

```sh
node scripts/inspect_psf_banks.mjs /path/to/extracted-game-set --out /private/tmp/game-psf-report.json
```

曲を限定する場合は、選択フォルダーからの相対パスを指定する。

```sh
node scripts/inspect_psf_banks.mjs /path/to/extracted-game-set --entry tracks/song.minipsf --out /private/tmp/song-psf-report.json
```

出力は標準出力と、指定した `--out`。出力先フォルダーは事前に作成する。
ZIPは先に展開する。PSF／MiniPSFと、その曲が参照する全PSFLibを同じセットに含める。

## 結果の読み方

- `summary.withBanks`：少なくとも1つの対応Toneを含む標準VABが見つかった曲数。
- `summary.withoutBanks`：正常に展開できたが、対応する連続VABが見つからなかった曲数。
  音色が存在しないという意味ではない。分離VH／VB、独自形式、実行時展開などはこの検出の対象外。
- `summary.errors`：不足ライブラリ、zlib／EXE形式などの理由で検査に失敗した曲数。
  他の曲の検査は継続する。入力セット全体のCRC・サイズ不正は検査開始前にエラー終了する。
- 各bankの `playableTones`／`unavailableTones` と `unavailableReasons`：ブラウザのTone読み込み前検証と同じ判定。
- `firstPlayableTone`：ブラウザで自動選択されるTone。`listIndex`／`program`／`tone` は0始まり。
- `files`：入力ファイルの相対パス・サイズ・SHA-256。後日の再検証で入力の同一性を確認できる。

終了コードは成功／検出なしが0、入力不正または1曲以上の検査エラーが1。
コマンドはフォルダー内のPSF関連拡張子だけを読み、symlinkは追わない。
入力はブラウザと同じ512 files・各4 MiB・合計64 MiBまで。ディレクトリー走査も深さ64・16,384 entriesまでに制限する。

JSONにADPCM・PCM・元ファイル本文は含めず、音色の抽出ファイルも作らない。
Toneが読み込めるという判定であり、音の忠実度や元ゲームでの演奏を保証するものではない。
対応したToneの実際の発音・音程・ループ・離鍵・preset復元はブラウザで別に確認する。

## 開発時の検証

```sh
node --test scripts/inspect_psf_banks.test.mjs docs/playground/playground_ps1_psf.test.mjs
```

CLI 7 tests＋共通パーサー9 tests。
合成MiniPSFと相対依存、複数bank、対応不能Tone、失敗後の継続、検出なし、symlink、入力上限、入力上書き防止を検証する。
実データの再検証記録は [Clock TowerのCLI検証](../docs/issues/spu_psf_compatibility_clock_tower_02.json)。
