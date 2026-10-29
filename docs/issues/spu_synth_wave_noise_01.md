# SPU Synth: PMON波形選択とNoise — 2026-10-29

ユーザー指示により、候補を [TODO](todo_spu_synth_features_01.md) に記録した後、
PMONの変調波形選択、続いてNoiseモードを追加した。
standalone Synthの変更であり、共有Playground panel／SDK原本／SPU WASMは変更していない。
commit／push／公開は行っていない。

## PMONの波形選択

FXタブのPitch ModulationにModulator選択を追加。
Sine／Triangle／Saw／Squareを選べる。SPU reverbを先頭で強調する既存配置は維持した。

- 波形・Ratio・Depthは保持音にも反映し、carrierのNote Onを再送しない。
- 112sampleの変調波形をmain threadでADPCM化し、既存の64byte予約領域を上書きする。
  波形を繰り返し変えてもsample数・RAM使用量は増えない。
- Decayは従来どおり次のNote Onから適用。12組のsource→carrier割当も維持。
- presetのoptionalな `pmon.waveform` に保存。未指定の旧presetはSine。

## Noiseモード

PCMタブ先頭のSound sourceでSampleとSPU Noiseを選択する。
NoiseではPCM編集欄を隠し、Noise clockと説明を表示する。

- 既存SPUコアのNoise経路を使い、全24声にNoise maskを設定。
- clockは0〜63の6bit共通設定。レジスター上のShift／Stepも表示する。
  鍵盤は各声のADSRを開始・終了し、NoteやPitch bendでNoise周波数は変わらない。
- Noise clockは保持音へ反映し、Note Onやsample uploadを発生させない。
- 元のPCM／録音sampleは保持する。再生アドレスには既存のprivate loopを使い、
  一度だけ再生する録音や極端なsample tuningでもNoiseを継続できる。
- NoiseとPMONは互いにOffへ切り替える。音源の切り替えは保持音を停止し、
  UIのkeyboard epochと音声側の割当を更新する。古い離鍵で次の音を止めない。
- Note OffはADSR release、Stopは残響を含め即座に停止。Noise設定はStop後も保持。
- optionalな `noise: {enabled, clock}` をpresetへ保存。旧形式はOff／clock48。
  同時にNoiseとPMONを有効にした不正ファイルは変更前に拒否する。Resetは双方Off。
- Sourceのselectにフォーカスが残っていてもPC keyboard演奏ができる。

現在のNoise波形・clock動作は既存MAME由来コアの近似実装をそのまま使用する。
実機Noise生成器の完全一致や理想的なホワイトノイズを保証する追加ではない。

## 検証

- `npm run test:spu-synth`: **46 tests成功**。
  実WASMで4波形のPCM差、保持音の所有権、RAM再利用、NoiseのNote／bend非依存、
  clock変更、release／Stop、one-shot sampleからの独立、モード相互切り替え、不正入力、保存互換を検証。
- [ソース版Chromium／WebKit検証](spu_synth_wave_noise_browser_01.json): 両方成功。
  公開UIから波形・clockを変え、実AudioWorklet出力を測定。保存・復元、focus後の演奏、
  既存PCM／ADSR／Reverb／24声／monitor／Audio recoveryも回帰確認。
- 1440px／390pxでNoiseとPMONのPNGを確認。横overflowなし。
- [ZIP新規展開のChromium／WebKit検証](spu_synth_wave_noise_zip_browser_01.json): 両方成功。
  物理出力をmuteしてPCMを測定。実聴は行っていない。

試用ZIP：`release/tetorica_spu_synth_wave-noise-dev_itch.zip`。
45 files／3 bundles、5,473,167 bytes。SHA256:
`e70839ad010c046610cf03246a8ab2673d677b93acb520525dfb6c7445bc840b`。
公開済みZIPと以前の試用ZIPは上書きしていない。

波形モーフィング・外部入力ReverbはTODOのまま。今回の追加範囲には含めない。
