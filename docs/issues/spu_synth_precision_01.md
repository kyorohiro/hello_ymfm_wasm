# SPU Synth: headroom確保による単音の精度低下を修正 — 2026-10-30

公開状況：2026-10-30、ユーザーより修正版を「リリース済み」と報告。公開済みとして扱う。
公開先・バージョン番号・公開物のhashは未指定。下記ZIPとの同一性は未確認。

ユーザー報告：前回の和音飽和対策後、Sineの全鍵盤で、押しっぱなしでも虫の羽のような音が混じる。「出力4倍補償で音色が変わった」。

前回は整数のvoice音量を1/4にしてから4倍補償していたため、量子化誤差も拡大していた。
旧WASMの単音とのPCM最大差は0.000152587890625。実聴は行っておらず、聴感の原因との対応は推定。

## 今回の変更

voice音量レジスターを元の値に戻し、ソフト側の広い加算器で合計してから1/4にする。
dry出力の小数部分をfloat出力まで保持するため、後段の4倍補償で単音の元のPCMを復元できる。
発音数に応じた音量変更は追加しない。PMON・Noise・Morphの既存設定も維持する。

SDK原本のPS1コアへ任意API `ps1_spu_set_mix_headroom` を追加し、standalone Synthだけで有効化。
既定値1の経路は従来のまま。共有JavaScript API、Tauri、他アプリでは有効化していない。
Reverbの整数処理は維持し、dry成分の精度を保持する。固定headroomを超える極端な24声入力は引き続き飽和し得る。
ADPCM・ガウシアン補間由来の音色を理想的な正弦波に変える修正ではない。

## 検証

- [旧WASMとの直接PCM比較](spu_synth_precision_pcm_01.json)：MIDI24〜84、44100／48000 Hzの122条件で、補償後Sine単音の差はすべて0。
- Sineドミソの線形加算と単音レベルを確認。和音の飽和対策は維持。
- 関連Nodeテスト211件成功（standalone Synth54件を含む）、音量policy関連34件成功。
- native fixtureとAddressSanitizer／UndefinedBehaviorSanitizer成功。
- source-only再buildのJS／WASMが同一。SDK import整合性、npm pack／install／型検査成功。
- [通常ページ](spu_synth_precision_browser_02.json) と[最終ZIP](spu_synth_precision_zip_browser_01.json) のChromium／WebKit確認成功。物理出力はミュートし、実聴していない。
- [最終音量校正](ps1_precision_chip_levels_02.json)：PS1 48条件＋YM2612 8条件成功。既存のgain 0.129331を維持。他チップの校正入力は変更なし。

`ps1_precision_chip_levels_01.json` と `spu_synth_precision_browser_01.json` は途中段階の記録。最終結果は上記02を参照。

## SDKと試用ZIP

SDK 0.1.7の未公開ローカル候補を正規importした。base commitは `9693c0b50f6d9f0321af7a0d1625a4d1ccd169e3`。
455ファイルのsource archive SHA256：`7be4da615468e3f678b868d3a6e411e78d1f9fb79a1f42f5151ebb545dd7dacb`。

試用ZIP：`release/tetorica_spu_synth_precision-fix-dev_itch.zip`（45ファイル、5,485,918 bytes）。
SHA256：`d368036b5120e1bb7bff3f83bdaabbe9c7c08997e386f7325596cca5f88cdc9e`。

作業時点ではエージェントによるcommit／push／公開は行っておらず、既存の公開版ZIPも上書きしていない。
その後、上記のとおりユーザーからリリース済みとの報告を受けた。
