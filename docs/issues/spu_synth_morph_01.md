# SPU Synth: Software morph — 2026-10-29

ユーザーの依頼でPCM波形A／Bの手動モーフィングを実装した。
「ソフト側の機能」と分かるよう、PCMタブの見出し・有効化操作を **Software morph** とし、
TetoricaがPCMを混ぜてSPUメモリへ書き込み、SPUはそのADPCMを再生することをUI本文にも明記した。
PS1 SPU固有のeffectとして扱わない。SDKコア・WASM・共有Playground panelは変更していない。

## 操作と保存

- Wave A／BでSine／Triangle／Saw／Squareを選ぶ。
  Use current PCM as A／Bで、既存PCMエディターの手描き波形も取り込める。
  録音の任意範囲を切り出す機能ではなく、112sampleの短周期PCMが対象。
- OffのままA／Bを準備でき、現在の音色は変更しない。
  Enable software morphで選択したA／Bのblendを共通音色へ適用する。
  録音sampleを再生していた場合も、短周期PCMへ切り替える。
- Morph · A → Bは0でA、1でB。ドラッグ中の`input`で保持音へ反映する。
  ソフト側の線形補間なので、中間の音量・倍音はA／Bの位相や形に依存する。
  ADPCM量子化も通るため、音質・変化の完全な無段階性やクリック除去は保証しない。
- Morph操作ではApply editsの再発音設定に関係なく再KONしない。
  音の所有権・ADSR・Pitch bendを保ち、既存24個のprivate waveform slotを上書きする。
  操作回数によってsample数やRAM使用量は増えない。
- Offにすると最後のblendをそのまま保持する。手動のPCM編集やAudio取込はMorphをOffにする。
  PMONと併用できる。NoiseではMorph欄を隠し、設定・PCMを保持する。
- preset version 1のoptionalな `morph: {enabled, amount, a, b}` にA／BのPCMも保存。
  Morph有効時は保存されたPCMとblendの一致を読込前に検証する。
  旧presetはMorph Off。Resetでは初期のA=Sine／B=Saw、amount=0、Offへ戻る。

## 実装

`spu_synth_morph.js`：112sample端点・設定の検証、線形blend、形状生成。
`spu_synth_audio.js`：main threadでblendとADPCM encodeを各操作につき1回実行。
Workletへ1回のRPCで送り、既存waveform更新処理を24slotへ適用する。
設定とPCMは同じhandlerで更新し、worklet renderにencoder・polling・LFOは追加しない。

UIはstandalone `spu_synth_panel.js`に追加。preset schema・load/save/resetも接続した。
LFOによる自動モーフィングと、任意バイト・時刻指定のRAM書換えUIは今回含めていない。

## 検証・配布物

- `npm run test:spu-synth`：**50 tests成功**。
  端点の完全一致、中間blend、custom PCM、不正設定・PCM不一致の原子性、保存互換を確認。
  実WASMで保持音のPCM変化、再KONなし、所有権・RAM・sample数の保持、
  PMON／Noiseとの分離、Stop／Off、手動PCM更新での解除を検証。
- [最終ソース版Chromium／WebKit検証](spu_synth_morph_browser_02.json)：両方成功。
- [新規展開ZIPのChromium／WebKit検証](spu_synth_morph_zip_browser_01.json)：両方成功。
  公開UIでnative sliderをドラッグし、マウスを離す前の設定・実PCM変化を確認。
  A／B選択、現PCM取り込み、preset保存・復元・旧形式、PMON併用、Noise時の非表示、
  既存演奏／ADSR／Reverb／monitor／Audio recoveryも確認する。
- 1440px／390pxのPNGを目視確認。欄内・ページの横overflowなし。
- 物理出力はmute、実聴は行っていない。

初回のソース検証 [browser_01](spu_synth_morph_browser_01.json) も両ブラウザで成功。
その後、任意PCMの端点が小さい値でも完全一致するよう端点処理を明示し、最終版を再検証した。

試用ZIP：`release/tetorica_spu_synth_morph-dev_itch.zip`。
45 files／3 bundles、5,477,897 bytes、SHA256:
`9821eda7f3616b3617192c1daf09f03c0a38f88e58261d0d299084881b02e6bc`。
既存ZIPは上書きしていない。未commit・未公開。
