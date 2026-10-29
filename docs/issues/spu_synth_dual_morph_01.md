# SPU Synth: Pitch横とPCM内のMorph操作 — 2026-10-29

ユーザー指定で、Morph操作を移動するのではなく**2か所**に置いた。
従来のPCMタブの横型つまみを残し、出力monitorのPitch右隣へ縦型Morphつまみを追加。
A／B／Resultの単一canvas編集とSoftware morphの説明は維持する。

- 2つのつまみは同じMorph設定へ書き込み、表示・音声・preset値を双方向に同期する。
- 上側のMorphはPCM／ADSR／FX／Audioのどのタブでも見える。
- Pitchは離すと中央へ戻るが、Morphは離しても値を保持する。
- PCMタブでMorphを有効にすると上側も操作可能になる。Morph OffとNoise使用中は無効。
  上側にはOff／Noise、またはBの比率を表示する。tooltipに有効化場所とA／B比率を示す。
- 保持音へ反映し、再発音・RAM追加確保・Pitchの変更は行わない。
- preset読込・Reset・Audio recoveryも既存state経由で両方へ反映する。
- Reverb量／PMON Depth／Noise clockの演奏用配置は提案のみ。今回追加していない。
  Morph用LFO・外部入力Reverbはユーザー指定で引き続き追加予定から除外。

実装は`index.html`、standalone panel adapter、`synth.js`、CSSに限定。
音声コア・保存形式・共有Playground panelは変更していない。

## 検証

- `npm run test:spu-synth`: **50 tests成功**。
- [ソース版Chromium／WebKit](spu_synth_dual_morph_browser_01.json)：両方成功。
- [ZIP新規展開版Chromium／WebKit](spu_synth_dual_morph_zip_browser_01.json)：両方成功。
- FXタブで保持音を鳴らしながら上側Morphをnative dragし、マウスを離す前の音声変化、
  PCM側への同期、所有権・RAM保持、再Note Onなし、離した後の値保持、Pitch不変を確認。
  PCMから上側への同期、preset復元、Off／Noiseでの無効化も確認する。
- 1440px／390pxでmonitorのPNGを目視確認。PitchとMorphは表示部の右隣に縦置き。
  Envelope／Waveform／Spectrumと4タブすべてで、ページの横overflowなし。
- 実音声PCMを測定。物理出力はmute、実聴なし。

試用ZIP：`release/tetorica_spu_synth_dual-morph-dev_itch.zip`。
45 files／3 bundles、5,482,874 bytes、SHA256:
`d4c3bb492bdbe2017f70e39c51c75a0ad5fd4ab3300c616004e5acbec4c4069f`。
公開済み版と以前の試用ZIPを上書きしていない。この追加は未公開。
commit／push／公開操作は行っていない。
