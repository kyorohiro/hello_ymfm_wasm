# Playground VAB／PSF対応後の再校正と配布候補

後続更新：2026-10-30、ユーザーからPlaygroundリリース済みの報告あり。以下の未公開表記は作業時点の履歴。公開URL・使用ZIP／hashは未記録。

2026-10-30。ユーザーが仕事中で試聴できない間の独立作業として、Playgroundの配布前校正を更新した。
VAB／PSF導入後に止まっていた正規freshnessチェックを、新しい実測結果で通過させた。
旧reportのhash付け替え、検証の迂回、共有音量targetの変更は行っていない。

## 再測定

既存runnerを使用し、現在のPlayground Main／Worker → AudioWorklet → 配布WASMの実PCMを取得。
Chromium／WebKit、44,100／48,000 Hz、220／440／880 Hz、主音源／追加音源を確認した。
POKEYはsingle／dual-first／dual-second／extraとdual組み合わせも含む。
すべて物理出力をミュート。AIによる実聴や実機との音質比較ではない。

| 新しい記録 | 測定 |
| --- | --- |
| [PS1](ps1_vab_chip_levels_01.json) | 48 PS1＋8 YM2612 anchor |
| [WonderSwan](wonderswan_vab_chip_levels_01.json) | 48 WonderSwan＋8 YM2612 anchor |
| [POKEY](pokey_vab_chip_levels_01.json) | 96 POKEY＋8 YM2612＋8 Sega PSG anchor、8 dual組み合わせ |
| [PS1設定適用後の検証](ps1_vab_chip_levels_verify_01.json) | 48 PS1＋8 YM2612 anchor |

PS1とPOKEYのunit測定には各1件のclock診断がある。診断を消さずreportへ保存し、独立PCM pilotの連続性は全記録で成功。
PS1の設定適用後検証ではclock診断なし。期待振幅に対する最大相対誤差は約`5.01e-7`。

PS1のgainはprimary／extraとも **0.129331**、WonderSwanは **1.172528** のまま。
POKEYは測定窓に伴う丸め差でprimaryが`0.413035 → 0.413034`、dual-firstが`0.413033 → 0.413034`。
dual-second／extraの`0.413033`は維持。共有target amplitude `0.12881777435541153`を維持する。

## ソースと生成設定

VAB対応のInspector、chip tabs、PS1 panel変更が旧測定と不一致になっていた。
共有UIを読み込むWonderSwan／POKEYにも同じ不一致があり、3系統を新規測定した。
各reportは実際に配信したソース・WASM・runnerのhashを保持する。

2つのgenerator、ローカルnpm buildの校正参照と、その生成物検証testsを新reportへ更新。
`playground_mixer_defaults.js`を正規generatorで生成。差分はPOKEYの上記2gainと測定metadataのみ。
`web/soundchip_mixer_presets.js`と`docs/js/soundchip_mixer_presets.js`は再生成してもbyte一致した。
SPU DSP／WASM、Standalone SynthのUI・音色処理、既存v0.1.0 ZIPは変更していない。

## 検証

機械検証の集約：[playground_spu_vab_release_01.json](playground_spu_vab_release_01.json)。

- 校正・生成関連 **385 tests成功**。現在の新reportは全served source／scriptのbyte一致まで確認する。
- 途中で3件、古いdeferred-release測定を現在のソースとして検証する既存testが失敗した。
  Gaussian等の後続変更より前の記録のため、他の歴史記録と同じ「元byteをpinして保持し、現行freshnessでは拒否」するtestへ更新。
  新しい `vab_mixer_calibration.test.mjs` で現行reportの完全測定・厳密source一致を別に確認する。
  旧measurement JSON自体は編集していない。
- 正規generatorの `--check` 2件成功。Playground package checkerの **1,173 local references** とstarters／WASM／licenses確認に成功。
- 新しいブラウザ用ZIPを検証のたびにprivate tmpへ展開し、repository fallbackなしで起動する。
  VABとPSFはそれぞれChromium／WebKit × Main／Workerの4経路成功。
  合成VAB／VH＋VB、元ADPCM・fine tune、MiniPSF依存・フォルダー・複数bank、実Clock Tower対応ToneのPCMを確認。
  実ゲームファイル・抽出音色は配布物／リポジトリへ同梱していない。
- SPU編集全体もChromium／WebKit × Main／Workerの4経路成功。計12ブラウザ経路。
  PCM描画、CH24隔離、ADSR／Reverb、Keyboard、追加SPU切断、復帰、public APIとlive／deferred envelopeを確認。

## 配布候補

生成コマンド：

```sh
sh scripts/package_itch_playground.sh psf-vab-dev-20261030
```

ブラウザ用：`release/hello_ymfm_wasm_psf-vab-dev-20261030_itch_playground_for_run.zip`

- 37,438,814 bytes、931 entries（全てfiles、directory entriesなし）。itch.ioの1,000 entry上限内。
- 展開後43,096,852 bytes。root `index.html` が入口。
- SHA-256：`845bbd1d2b8481d4bae6d7de6f54017446b7df9b8155f69686991ba0cf049fc7`。

完全ソース展開版：`release/hello_ymfm_wasm_psf-vab-dev-20261030_itch_playground.zip`

- 37,038,216 bytes、1,191 entries（1,070 files）。ブラウザ用上限を超えるためダウンロード用。
- SHA-256：`23e3e68ced1e687a142edc1d43020279fcea47a0f86056ad9d38e588fd888db9`。

両ZIPのCRC検証に成功。既存のStandalone Synth v0.1.0 ZIPは再作成していない。
新候補のitch.ioアップロード・Web deploy・npm公開・git commit／pushは行っていない。
ユーザーの試聴、別作品の互換性確認、公開URLの記録は [再開TODO](todo_spu_resume_20261030.md) に残す。
