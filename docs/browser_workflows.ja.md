# ブラウザー操作とExportの詳細

[開発者向けREADME](../README.ja.md) | [English](browser_workflows.md)

ルートREADMEから分けた、操作と変換仕様の詳細です。チップ別の現在の範囲は
[Analyzer対応表](vgm_analyzer/support.html)と
[パッケージAPIリファレンス](../packages/fm2612/README.md)を確認してください。

## ブラウザーで試す

ビルド環境を用意せずに、公開ページでWASMコアとJavaScriptラッパーを試せます。

- [ホーム](https://kyorohiro.github.io/hello_ymfm_wasm/index-ja.html)
- [JavaScriptで学ぶメガドライブYM2612 FM音源](https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index-ja.html)
- [Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)
- [Runtime組み込みデモ](https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html)
- [FM2612 Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html)
- [SPU Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-spu/index.html)
- [SCSP Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-scsp/index.html)
- [VGM Analyzer](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html)

### PlaygroundのDX7とSNES

`await useSoundChip('dx7')`で独立したMSFA DX7を使えます。16音、DX7 SysExバンク、
PlaygroundのMixer／FXルーティングに対応します。FILESの
`examples/dx7/dx7-init-sine.js`は外部バンクなしで鳴ります。

実験的な`await useSoundChip('snes')`は、BRR、明示的なサンプル調律、raw ADSR／GAINを持つ
独立した8声S-DSPです。`examples/snes/snes-brr-melody.js`には自作BRRがあり、ゲームデータは不要です。

### SPCの取込モード

`Menu → Import → SPC…`には次の入口があります。

| モード | 結果 |
| --- | --- |
| Song playback | `useSoundChip('spc')`でSPC700／S-DSPの曲再生。Stopまで再生します。 |
| Instruments | BRRとキャプチャした設定、編集して試奏できるSNESスクリプト。 |
| Song JavaScript | BRR／音色／音符操作へ変換した、読みやすい実験的コード。 |
| Event trace | DSP／RAMの操作を有限時間だけ記録した編集可能なタイムライン。 |

すべてのモードで元のSPCを新しいFILESフォルダーに残します。
Instrumentsの基準音は利用者が指定するもので、BRR自体から決まる値ではありません。

### Song JavaScript：基準音と演奏時刻

0.1〜600秒を、`loadBRR`、`setPreset`、`setPitch`、`keyOn`、`timeline.waitUntil`、
`keyOff`の呼出しへ変換します。タイムラインの原点はサンプルとプリセットの読込完了後です。
各時刻はそこからの経過秒で、タイマーが遅れても後続の全イベントを一律に遅らせません。
PITCHはチップ単位を維持します。元の音名や曲のループ構造は推測しません。

指定区間で使うBRRの各版を解析し、基準音を一覧にします。周期が十分安定した音には、
32,000 Hz／PITCH4096で推定した基音・音名・centをコメントします。不確かな音は仮のC4です。
変換前に各基準音とcentを修正するか、既定値で進められます。オクターブ誤りの可能性があり、
元の音符を復元した値ではありません。

確定した基準値は`loadBRR`の`basePitch: 4096`に対する`baseFrequencyHz`と、音名コメントの両方へ
反映します。小数centも保持し、基準不明のサンプルは仮の`rootNote: "C4"`を使います。
後から`setNote`／`setFrequency`で編集するときの調律です。生成した曲自体はraw `setPitch`、
BRRバイト列、音色、タイミングを保つため、基準音修正で再生ピッチを変えません。
音名ベースの再生呼出しには置き換えません。

基準音だけの修正は既存キャプチャを再利用し、区間またはcontrol stepの変更時には再解析します。
Noiseには音名を付けず、ピッチ変調中の声は変調前の基準ピッチを示します。

control stepは既定20 ms、最大1000 msです。0は異なる変化をすべて残します。
PITCH、音量、同一SRCNのADSR／GAIN更新を間引きますが、key操作とSRCN変更の境界時刻は保ちます。
初期エンベロープ状態、BRRスナップショット時刻、JavaScriptの実行タイミングに差が出る近似です。
Noiseとpitch modulationのraw制御は残します。移動したBRRの領域を保護するため、echoは省略します。
注意点はソースと一緒に保存します。

20,000件を超える音楽イベント、256個を超えるBRR、BRR合計64,512バイト超は、部分保存せず拒否します。
現在のタイミングと基準音処理を使うには、元のSPCからSong JavaScriptを再生成してください。
すでに編集した既存コードを自動で書き換えることはありません。

### Event trace：DSP／RAMを記録する

0.1〜600秒、最大1,000,000書込みを記録します。注釈付き`events`配列を編集すると、チップのraw値と
時刻を変えられます。初期BRR／RAMとDSPレジスターバイトもコードと保存します。
サンプル変更、echo、Noise、pitch modulationを保持し、音名・ループ・タグのfadeは推測しません。

変換時にDSPが読むRAMを先に調べ、未使用のCPU作業RAMへの書込みだけを省きます。
DSP書込みはすべて残します。生成する行には経過秒とレジスター名があり、取込結果とソース情報に
保持したDSP／RAM件数を示します。記録した再生区間を保持する方式です。編集で別のRAM領域を参照する
場合、その区間で未使用だった元ドライバーの追加データが必要になることがあります。

### SPC再生中のイベント観察

Song playbackはMain／Workerで、任意の`spc.onEvent(callback, {voices, types, intervalMs})`を提供します。
重複を除いたPITCH、符号付き左右音量、音色、key要求、rawグローバルDSP書込みを受け取れます。
`clock`は1秒あたり1,024,000 tickです。配信はバッチ処理で、音声スケジューリングAPIではありません。

開始時の音は状態から推定します。繰り返すKONは再トリガー、持続したKOFFは`keyOffHeld`として通知します。
戻り値の関数で購読を解除します。観察が途切れた場合は`overflow`を通知し、再生を続けながら状態へ再同期します。
欠けた履歴を生成して補うことはありません。

### FM2612 Synthのエンベロープ

`Envelope`でOP1〜OP4を選び、点をドラッグしてAR／TL、D1R／SL、D2R、RRを編集できます。
シアンの線はチップ出力の実測RMSです。数値操作とCassetteの音色も同期します。
編集グラフはレジスター値の相対関係で、実際の時間にはピッチ、RS、SSG-EGも影響します。

### AnalyzerのSPC解析と楽譜

**Note-ish**を開くと、指定区間をバックグラウンドWorkerで解析します。SNESの8声でLive History、
Pitch、Song Timeline、鍵盤、フレットボードを共有します。BRRの基準音／centはSPCの再生を変えずに修正できます。
推定にオクターブ誤りの可能性があり、不確かなサンプルは仮のC4です。Noiseには音名を付けず、
pitch modulation中は基準ピッチを示します。key要求を表示しますが、実際に聞こえるエンベロープ、
release、echo、発音を保持した後のサンプルRAM書換えは採譜しません。

既定の解析区間は先頭120秒、タグの長さが短ければその長さです。上限は600秒、解釈した20,000イベント、
256 BRR／64,512バイトです。control stepは既定20 msで0まで下げられます。

**Sheet Music**は同じ解析操作を共有します。解析後にMIDI、楽譜プレビュー、MusicXML、LilyPondを出力できます。
修正したBRR基準音をすべての音符出力に反映し、SPC再生は変更しません。出力するのは解析済み区間だけで、
仮の基準値や近似の説明も出力に残します。MIDIは8声のトラックに時刻とpitch bendを保ち、program／velocityは固定です。
楽譜は半音単位、16分音符グリッド、仮定の4/4拍子、変更可能なBPMで作る編集用の参考採譜です。
元のBRR音色はMIDI／楽譜で再現しません。

## CLIで音色と楽譜を出力する

[`tetorica-vgm`](https://www.npmjs.com/package/tetorica-vgm)は、解析、Export、WAV生成を
Node.js 22以降で使えるnpmパッケージです。

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
npx tetorica-vgm render song.vgz --output song.wav
```

[CLIクイックスタート](../packages/vgm/README.md)、[CLI／Node APIの全仕様](../CLI.md)、
開発者向けの[リリース手順](../README_RELEASE.md)を参照してください。

OPL系のmelodic voiceは、2op／OPL3 4opのSBI単独ファイルまたはZIPとして出力できます。
ブラウザーの**SBI Info**タブでは抽出したパラメーターを表示し、鍵盤で試奏できます。

1.5秒時点のチャンネル1（`--channel`は1始まり）を出力する例です。

```sh
npx tetorica-vgm export song.vgz --format sbi --at 1.5 --channel 1 --output voice.sbi
```

曲全体のmelodic voiceをZIPへ出力します。

```sh
npx tetorica-vgm export song.vgz --format sbi-zip --output voices.zip
```
