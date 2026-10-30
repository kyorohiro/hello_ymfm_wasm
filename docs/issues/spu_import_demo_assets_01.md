# release削除前のSPUデモ保存

2026-10-30。ユーザーが `release` を削除してPlaygroundを作り直す前に、
そこにしかなかった合成VAB／MiniPSFデモをソース側へ保存した。release自体は削除していない。

保存先：[docs/playground/samples/spu-import](../playground/samples/spu-import/README.md)。
VAB、分離VH＋VB、standalone PSF、MiniPSFのDemoフォルダーとZIP、README、LICENSEを含む。
ゲーム由来のデータを含まない。旧releaseのVABとMiniPSFの3データファイルは新保存先とbyte一致。
共通パーサーでVH＋VBの同一性、MiniPSFの3 overlays／2 banks／各3 Tonesを確認した。

`scripts/build_spu_import_demos.mjs` を追加し、元のfixtureからbinary 9 filesを再生成できるようにした。
Playgroundのpackageスクリプトからも呼ぶ。samplesは従来から全コピーされるため、
両ZIPの `samples/spu-import/` にREADMEを含め10 filesが同梱される。

```sh
node scripts/build_spu_import_demos.mjs
node scripts/build_spu_import_demos.mjs --check
```

新しい試用buildは `sh scripts/package_itch_playground.sh spu-import-demos-20261030` で成功。
[検証記録](spu_import_demo_assets_01.json)。ブラウザ用941 files、全デモbyte一致、CRC成功。
前回12ブラウザ経路で確認したZIPとの比較で、完全版626／ブラウザ版550 runtime files
（JS／WASM／HTML／CSS）が全てbyte一致。製品UIや音声処理は変更していない。
今回は追加のブラウザ試験を繰り返していない。

`release` は `.gitignore` 対象の生成物で、packageスクリプトがディレクトリーから作り直す。
削除すると過去版ZIPと以前の検証artifactも失う。残したい公開版ZIPは別の場所へ退避する。
Standalone SynthのZIPはPlaygroundのpackageコマンドでは再生成されない。
必要なら別途 `sh scripts/package_itch_spu_synth.sh dev` を使う。

今回の新候補も未公開。git操作は行っていない。
