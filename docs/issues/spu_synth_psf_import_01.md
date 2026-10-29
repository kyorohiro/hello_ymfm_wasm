# SPU Synth: PSF1／MiniPSF音色インポート — 2026-10-30

Playgroundで確認済みのPSF静的抽出をStandalone SPU Synthにも接続した。
ユーザー指示の「Playgroundで先に必要な作業があればそちらを優先」に対し、
既存の共通パーサーで必要な処理が揃っていたため、SynthのUIと読み込み管理を追加した。
後続のユーザー確認でPSF / VAB専用タブへ移動。最終配布候補は [専用タブと公開準備](spu_synth_bank_tab_release_01.md) を参照。

## 操作

PSF / VAB → **Open PSF set…** で曲と関連PSFLibをまとめて選択、または
**Open PSF folder…** でサブフォルダーを含めて選択する。ZIPは先に展開する。
**PSF entry** → **Extract VAB banks** → **Sound bank**／**Tone** →
**Load selected Tone** → PC鍵盤／画面鍵盤で演奏する。
読み込んだToneは通常の **Save preset** で `.spu.json` に保存・復元できる。

ローカル試用URL：<http://127.0.0.1:5174/synth-spu/>。
合成デモは `release/spu-psf-demo.zip`。ゲーム由来データを含まない。

## 実装

- `playground_ps1_psf.js` のファイル検証・依存解決・展開・RAM重ね合わせ・VAB検出をそのまま共用。
  DSP、WASM、npmパッケージの変更はない。
- PSFを開く／抽出する／bankやToneを選ぶだけでは現在の音色や保持中の発音を変更しない。
  Load selected Toneで既存のVAB読み込み処理へ渡し、全24voiceの共通音色を切り替える。
- 元ADPCM・ADSR・ループ位置・基準音程を使い、PMON／Noise／Software morphをOffにする。
- 未割当・Noise専用・非対応packetなどのToneを一覧で無効化し、最初の対応Toneを自動選択。
  optionのtitleに拒否理由を設定する。VAB直接読み込みでも同じ扱い。
- 抽出bankごとのsample cacheを保持し、bankを往復して同じToneを再ロードしてもRAMを追加消費しない。
  ファイル再オープン・再抽出は新しいcache。残量不足ならpreset保存後に再読み込みする。
- ライブラリ不足や不正入力はエラー、標準VABが見つからない場合は別の結果として表示。
  どちらも既存bankと発音を保持する。
- asset世代とAbortControllerを統合。新しいファイル読み込み・reset・pagehideが旧PSF処理を取り消し、
  遅れて完了した読み込み／抽出がUIや音色を上書きすることを防ぐ。

## 対応範囲

PSF1／MiniPSF内の連続配置された標準Sony VAB v6／v7を静的抽出する。
PSF2、曲再生、PSF内で分離配置されたVH／VB、独自形式や実行時展開されるbankは対象外。
鍵域分割・重ね音・ドライバ固有の演奏処理は復元しない。すべての作品・Toneに対応するものではない。
入力上限は512 files、各4 MiB、合計64 MiB。展開量・依存深度・候補数も共通パーサーで制限する。

## 検証

検証JSON：[spu_synth_psf_import_01.json](spu_synth_psf_import_01.json)。
ブラウザ検証は実UIと実AudioWorkletのPCMを使う。物理出力をミュートし、実聴は行っていない。

- `npm run test:spu-synth`：67 tests成功。
- `node --test docs/playground/playground_ps1_psf.test.mjs`：9 tests成功。
- ソース版：Chromium／WebKitで既存の全Synth回帰チェックと新規PSFチェック。
- 新しくZIPを展開した版：Chromium／WebKitでVAB／PSFチェック。
  元ADPCM、fine tune、複数bank、MiniPSFフォルダーと `_lib2` overlay、RAM cache、preset往復、
  entry／bank／ToneにfocusしたままのPC鍵盤演奏、破損CRC・依存不足・検出なしでの発音保持を確認。
  ファイル読み込みとzlib展開を意図的に遅らせ、途中resetで取り消した後に再試行できることも確認。
  desktop 1440px／mobile 390pxで横はみ出しなし。スクリーンショットの目視も実施。
- Clock Tower - The First Fearの23 files／20 entriesのセットを使用し、先頭entry `01-BOBBY_A.psf` を
  各ブラウザ・各配布形態で抽出・演奏。85 Tonesのうち68を無効化し、最初の対応Tone（一覧index 31、
  Program 38 Tone 0、4,784 ADPCM bytes）を自動選択。有限・非ゼロ・非クリップのPCMとStopの無音を確認。
  全20 entriesの抽出は [前回のPlayground検証](playground_psf_real_clock_tower_01.json) を参照。
  ゲーム由来ファイルと抽出音色はprivate tmpのみで、リポジトリ・ZIP・検証JSONに含めない。
- 試用ZIP：`release/tetorica_spu_synth_psf-import-dev_itch.zip`、46 files、5,528,226 bytes。
  SHA-256：`3a3aae64a6114078c9d2ca04d50d7ce48ff4f31354302c6d3f4ff920db2da89e`。

未公開。npm公開、Web deploy、git commit／pushは行っていない。
Playground配布前の校正freshness gateは別の残作業として維持する。
