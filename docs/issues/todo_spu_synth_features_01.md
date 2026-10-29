# SPU Synth: 音作り機能の追加候補 — 2026-10-29

ユーザー依頼で候補をTODO化。PMON→Noise→手動Morphの順で実装。公開は別途。

- [x] **PMON変調波形の選択**：既存SineにTriangle／Saw／Squareを追加。
  Ratio／Depth／Decayと組み合わせ、保持音にも反映。preset保存・旧形式互換、RAM再利用を維持。
- [x] **Noiseモード**：SPU内蔵Noiseを音源として選び、共通Noise clockとADSRで打楽器・効果音を作る。
  Noise周波数は全voice共通で、Note／PMONによる音階追従とは別。UIに明記する。
- [x] **手動波形モーフィング**：PCM波形A／BとMorphつまみ。
  Software morphと明記し、4形状・現PCM取り込み・保持音への反映・preset保存に対応。
  [作業記録](spu_synth_morph_01.md)。任意バイトの時刻指定RAM編集や実機バス精度とは区別する。
- [ ] **Morph用LFO**：手動Morphを周期的に自動変化させる後続候補。
- [ ] **外部入力Reverb**：マイク／音声再生等のPCMを24声とは別経路でSPU Reverbへ送る。
  コアの入力APIとホスト音声ルーティングの追加が必要。

任意voice間の自由なPMON配線は実機の隣接voice構造とは異なる機能。
今回のPMON波形選択は既存の12組のsource→carrier構成を使う。

実装・検証結果：[PMON波形選択／Noise](spu_synth_wave_noise_01.md)。
46 testsと、ソース版／新規展開ZIPそれぞれChromium・WebKitで成功。未commit・未公開。

手動Morph追加後のNode検証は50 tests成功。最終ブラウザ・ZIP検証は上記作業記録を参照。
