# SPU Synth: Sine和音の内部飽和を修正 — 2026-10-30

**後続修正あり：** 下記のvoice音量1/4方式は単音の量子化誤差を増やすため置き換えた。
現在の実装と試用ZIPは [単音の精度維持](spu_synth_precision_01.md) を参照。本書は当時の測定・方式の履歴。

ユーザー報告：全effect Off、Sineでドミ／ミソは自然だが、ドミソだけ別の響きが混じる。
Triangleでは気にならず、Waveformの表示は0.3以下。PMONの影響を疑われた。

## 原因の確認

実配布WASMとstandalone AudioWorklet処理でC4／E4／G4を再現した。
PMON・Noiseのレジスターmaskは0、Morph・ReverbもOff。
voiceの初期音量0.75、Sine振幅0.65では、2音の合計ピークは約0.97。
3音の本来のピーク約1.45は、SPUコア内の16bit accumulatorで約1.0に切られる。
`sources/native/ps1/spu.cpp`のvoice加算は左右それぞれclampしている。

Masterと校正gainはSPU処理の後段なので、Waveform表示が小さくても既に歪みが含まれる。
Masterを下げるだけでは、この歪みを解消できない。
Triangleも同じ測定条件では飽和するが、Sineより歪みが小さかった。
実聴は行っていないため、報告された「工事現場」の聴感との一致は測定からの推定。

[修正前後の実WASM PCM測定](spu_synth_headroom_pcm_01.json)。
44100 Hz、4096frameウォームアップ後の65536frameについて、上限近傍のサンプル数：

| 波形・和音 | 修正前 | 修正後 |
| --- | ---: | ---: |
| Sine C4/E4 | 0 | 0 |
| Sine E4/G4 | 0 | 0 |
| Sine C4/E4/G4 | 6719 | 0 |
| Triangle C4/E4/G4 | 2270 | 0 |

## 修正

standalone Synthの**物理voice左右音量だけを1/4**にし、SPUより後のWeb Audio gainを4倍で補償。
固定12.04 dBのheadroomを確保し、初期Sineなら同位相8音の最大ピークも内部上限に収まる。
発音数によるgain自動変更はせず、音の出入りで他の音が上下する動作を追加しない。

- 元のvoice音量・ADSR・PCM／ADPCM・tuning・reverb設定をauthoring stateに保持。
  preset保存では1/4の値を書かず、旧presetも同じ処理で安全側の音量にする。
- 初期化、Note On、preset／waveform／ADSR更新、Stop後の再演奏の完了前に物理音量を同期。
  render block内にUI通知・encode・gain判定を追加しない。
- PMONのsourceは引き続き左右音量0。OUTXは左右音量より前に計算されるため、
  PMONのRatio／Depth／Decayを減衰させない。carrierだけを通常voiceと同じ比率で下げる。
- NoiseとReverbへの入力にもvoice側の余裕を適用し、共通出力で補償。
- Masterのrampにも補償倍率を適用する。単音の聴感レベルをほぼ維持する。
  最大Masterで校正gain×4は約0.517で、元のSPU飽和出力を過大に増幅しない。
- `spu_synth_levels.js`で入力と出力の共通倍率を定義。
  SDK原本・WASM・共有SPU API・Playground・音量校正policyは変更していない。

これは通常の和音向けのheadroom確保。原コアの飽和処理自体は維持する。
24声すべてを最大振幅・最大音量で重ねる等、固定headroomを超える入力の無歪を保証する変更ではない。
SPUの音量量子化による微小差は残る。

## 検証と配布物

- `npm run test:spu-synth`: **52 tests成功**。
  Sineのドミ／ミソ／ドミソと、別々に鳴らした単音の和を比較し、非線形な差がないことを確認。
  同位相8音、最大振幅sampleの3和音、負の左右音量、保存payload、Stop再演奏、
  main threadの補償gain・Master更新、既存PMON／Noise／Morph／Reverbも確認。
- [ソース版Chromium／WebKit](spu_synth_headroom_browser_01.json)：両方成功。
  全effect OffのSineでC3/E3/G3を実keyboard操作し、出力PCMを測定。
  単音ピーク約0.044、ドミソ約0.131。Master等による後段の縮小を考慮しても、
  旧版の飽和時の上限（約0.091）で潰れなくなったことを確認。
- [新規展開ZIPのChromium／WebKit](spu_synth_headroom_zip_browser_01.json)：両方成功。
  公開UIのみでkeyboard／24声割当／ADSR／Reverb／PMON／Noise／Morph2か所同期／
  単一canvas編集／保存復元／Audio recoveryも回帰確認する。物理出力mute、実聴なし。

試用ZIP：`release/tetorica_spu_synth_headroom-fix-dev_itch.zip`。
45 files／3 bundles、5,483,837 bytes、SHA256:
`c6f1d562667c34a8bc7a6edc82b93568f34abf2b2c8e9d303249bc13e3ef071d`。
公開済み版・以前の試用ZIPは上書きしていない。未commit・未公開。
