# Playground: PSF1／MiniPSFから標準VABを抽出 — 2026-10-30

ユーザーの「次に進もうか」により、VAB読み込みの次段階としてPSFの静的抽出を追加。
最初の入口はPlaygroundのSPUタブ。Standalone SynthへのPSF用UI追加は行っていない。

## 操作

1. PS1モード → SPU → Prepare audio → 対象Voiceを選択。
2. **Open PSF set…** でPSF／MiniPSFと参照先PSFLibをまとめて選ぶ。
   サブフォルダーを使うセットは **Open PSF folder…** で展開済みフォルダーを選ぶ。
3. **PSF entry** を選び、**Extract VAB banks**。
4. **Sound bank** と **VAB Tone** を選び、**Load Tone into Voice N**。
5. Hold／Sustain／Use Keyboardで試奏する。

PSFセット読み込み・抽出・bank／Tone選択だけではライブSPU RAMを変更しない。
Tone読み込みの既存Inspector操作は共用し、選択Voiceだけへ適用する。
読み込めないToneはunavailableと表示して選択不可にし、最初の対応Toneを選ぶ。

ローカル試用URL：`http://127.0.0.1:5174/playground/?mode=ps1&no-sw=1`。
キャッシュが残っている場合は再読み込みする。

## 実装範囲

`playground_ps1_psf.js` はゲームコードを実行せず、PSF1をデータとして読む。

- PSFヘッダー、reserved／compressed範囲、圧縮済みプログラムのCRC-32を検証。
- DecompressionStreamのdeflateでzlibを展開し、zlibチェックサムも検証する。
- PS-X EXEの識別子、text size、ロードアドレスとRAM範囲を確認。
- `_lib` → 本体 → `_lib2`以降の順に、2 MiBのRAMイメージへ重ね合わせる。
  番号付きライブラリは最初の欠番で停止する。
- 参照は各ファイルのディレクトリーから相対解決し、slash／backslash、`..`、一意な大文字小文字違いを扱う。
  実際のアクセス先は選択済みファイルだけ。ファイル名からネットワーク取得やホストFS読み取りを行わない。
- データが実際にロードされた連続範囲からVABを検出する。
  pBAVだけで採用せず、既存VABパーサーで各表・サイズ・参照を検証し、少なくとも1つの対応Toneを確認する。
- 複数bankをSound bank選択へ渡す。不足ライブラリ・破損と、正常展開後の「VABなし」を区別する。
- 接続／Voice／タブ変更によるキャンセルでは読み込みを破棄し、展開中ならreaderもキャンセルする。

上限：512 files、各4 MiB、選択合計64 MiB、EXE展開2,033,664 bytes／file、依存展開合計32 MiB、
深度10／参照訪問256、VAB候補256／抽出32 banks・8 MiB。循環・曖昧なパスはエラーとする。

## 検証

[ブラウザ・テスト結果](playground_spu_psf_01.json)。

- PSF／UI／chip tabs：80 tests成功。
  CRC、zlibチェックサム、サイズ上限、EXE範囲、依存順、相対パス、欠番、循環、曖昧パス、
  不足library、キャンセル、偽候補と未ロード領域、複数bank、音声を変えない抽出を確認。
- Standalone回帰・ZIP構造：67 tests成功。
- Chromium／WebKit × Main／Workerの4経路で成功。
  合成PSF、複数ファイルMiniPSF、実フォルダー入力、bank切り替え、fine tune付きToneの実SPU PCMを確認。
- 実データ：[Clock Tower - The First FearのPSFセット](https://www.zophar.net/music/playstation-psf/clock-tower-the-first-fear)をローカル検証。
  23 files・20 entriesすべてで依存解決とVAB検出に成功。
  [全entryの検出・対応Tone数](playground_psf_real_clock_tower_01.json) を参照。
  01-BOBBY_A.psfのProgram 38／Tone 0（一覧index 31）を上記4経路で読み込み、有限・非ゼロのPCMを確認。
  元プレイヤーの曲再生との一致や、全Toneの忠実度を保証する試験ではない。
- ブラウザの物理出力は常時ミュートし、実聴は行っていない。
  途中の撮影手順がfloating Keyboardに遮られた実行は、撮影手順を修正して全経路を再実行した。

実ゲーム由来のPSFや抽出音色はリポジトリー／配布物に同梱していない。
検証用ダウンロード・展開ファイルは `/private/tmp/psf-clock-tower-validation*` にのみ置いた。

## 合成デモ

`release/spu-psf-demo.zip`（1,218 bytes）。ゲーム由来データ・実行コードを含まない合成MiniPSFセット。
展開後のDemoフォルダーをOpen PSF folderで選択する。2 banks・3 Tones／bankを試せる。
fixtureは `test/helpers/spu_psf_fixture.mjs` から生成し、製品コードとは独立したCRC実装とNode zlibで圧縮している。

## 未対応・配布状態

- 検出対象は連続配置された標準Sony VAB v6／v7。分離配置VH／VBの自動対応付け、独自形式、
  実行時圧縮・生成、PSF2、曲再生は未対応。ZIP入力も未対応で、先に展開して選択する。
- Clock Towerセットでも一部ToneはENDなし／未割当などでunavailableになる。
  20 entriesでVABが見つかったことは、全音色の復元成功を意味しない。
- 日本語などlegacy code pageの参照名は未検証。タグはUTF-8で読む。
- 複数タイトルでの互換性検証は後続TODO。
- 前回からのPlayground配布前校正freshness gateは保留のまま。校正gain／reportの書き換えは行っていない。
  アプリの新規配布ZIP、Web deploy、npm公開、git commit／pushは行っていない。

形式の参照：[Neill CorlettによるPSF仕様v1.4のミラー](https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e)。
