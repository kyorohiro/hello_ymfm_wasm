# SPU Synth：分離VH／VBとone-shot loop marker（2026-11-11）

ユーザーのArc the Lad `30 - Alatos.minipsf`で、10 Tone中9件がunavailableになる報告をローカル実ファイルで確認した。現状の連続VAB前提による本文位置の誤認と、one-shot上のLOOP STARTを拒否する制限の2点。音色データやゲームファイルはリポジトリへ複製しない。

- [x] 実データを静的CLIと同じparserで再現し、失敗理由・配置・候補の一意性を確認する。音声出力なし。
- [ ] PSF内の分離VH／VBに対応する。全域coverage、サイズ表、全sampleのpacket／END境界、一意な本文候補を条件にし、曖昧な候補や連続レイアウトとの競合を推測で選ばない。
- [ ] one-shotのLOOP STARTを保持したまま受理できるようにする。明示loop metadataの不整合は拒否し、既存loop／release／presetの動作を実WASMで検証する。ADPCMを再エンコードしたり、都合の悪いflagsを書き換えたりしない。
- [ ] 合成分離bank fixture、曖昧候補・欠損coverage・誤検出の回帰を追加し、実データの10 Toneを再検証する。現在選択できる1 Toneも再抽出が必要。
- [ ] unavailableの理由をUIから確認しやすくし、README・可読配布・検証記録を更新する。

## 原因調査の記録

- 入力：ローカルのArc the Lad (EMU).zophar、entry `30 - Alatos.minipsf`。依存は`Arc_The_Lad_psf_driver.psflib`。
- 検出VH：PS1 RAM `0x80080000`、VAB v6、8 Programs／10 Tones／8 samples、宣言size 79,456 bytes。
- VH長は6,688 bytes、sample-size表のVB合計は72,768 bytes。現在のparserはVBをVH直後の`0x80081a20`と仮定するが、実VBは`0x80090000`に配置されている。
- 誤った範囲ではsamples 1–6が全ゼロ、sample 7も途中までゼロ。samples 1–7にENDが見つからず、9 Toneを無効扱いする。現在のsample 8として読み込む1,168 bytesは、実sample 1の末尾に一致し、意図したsample 8ではない。
- 実VB候補では全8 sampleの最初のENDがサイズ表どおりの末尾にあり、predictor／shift／flagsが既存の範囲内。全2 MiB RAMの8-byte aligned scanで全8 sample・全coverageを満たす候補は`0x80090000`の1つだけだった。
- 本文を正しく対応させても、samples 3／4／5／7（計6 Tone）はone-shot上のLOOP STARTを理由に現在のprepareVabTone／preparePs1ADPCMが拒否する。全8 sampleのmarkerは各1つなので、複数marker対応はこの報告の解決には不要。
- 現native coreはLOOP STARTによるrepeat address更新と、END packetのRepeatによるループ有無を独立に扱う。validatorで同じ範囲を受理する方針を検証する。

参照：`docs/playground/playground_ps1_vab.js`、`tetorica_src/runtime/ps1synth.js`、固定Native SDKのPS1 SPU実装。PSF2・独自圧縮形式・実行時展開は別途。今回の作業は原因調査とTODO記録までで、抽出処理はまだ変更していない。
