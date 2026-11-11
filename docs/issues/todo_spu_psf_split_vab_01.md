# SPU Synth：分離VH／VBとone-shot loop marker（2026-11-11）

ユーザーのArc the Lad `30 - Alatos.minipsf`で、10 Tone中9件がunavailableになる報告をローカル実ファイルで確認した。現状の連続VAB前提による本文位置の誤認と、one-shot上のLOOP STARTを拒否する制限の2点。音色データやゲームファイルはリポジトリへ複製しない。

- [x] 実データを静的CLIと同じparserで再現し、失敗理由・配置・候補の一意性を確認する。音声出力なし。
- [x] PSF内の分離VH／VBに対応する。全域coverage、サイズ表、全sampleのpacket／END境界、一意な本文候補を条件にし、曖昧な候補や連続レイアウトとの競合を推測で選ばない。
- [x] one-shotのLOOP STARTを保持したまま受理できるようにする。明示loop metadataの不整合は拒否し、既存loop／release／presetの動作を実WASMで検証する。ADPCMを再エンコードしたり、都合の悪いflagsを書き換えたりしない。
- [x] 合成分離bank fixture、曖昧候補・欠損coverage・誤検出の回帰を追加し、実データの10 Toneを再検証する。現在選択できる1 Toneも再抽出が必要。
- [x] unavailableの理由をUIから確認しやすくし、README・可読配布・検証記録を更新する。
- [x] 共有JS変更後のMixer校正ソース検証を通し、Playground／共通mixerの配布チェックを維持する。元の測定ハッシュは変更せず、今回の入力検証・import変更だけを厳密なrevisionで記録する。

## 原因調査の記録

- 入力：ローカルのArc the Lad (EMU).zophar、entry `30 - Alatos.minipsf`。依存は`Arc_The_Lad_psf_driver.psflib`。
- 検出VH：PS1 RAM `0x80080000`、VAB v6、8 Programs／10 Tones／8 samples、宣言size 79,456 bytes。
- VH長は6,688 bytes、sample-size表のVB合計は72,768 bytes。現在のparserはVBをVH直後の`0x80081a20`と仮定するが、実VBは`0x80090000`に配置されている。
- 誤った範囲ではsamples 1–6が全ゼロ、sample 7も途中までゼロ。samples 1–7にENDが見つからず、9 Toneを無効扱いする。現在のsample 8として読み込む1,168 bytesは、実sample 1の末尾に一致し、意図したsample 8ではない。
- 実VB候補では全8 sampleの最初のENDがサイズ表どおりの末尾にあり、predictor／shift／flagsが既存の範囲内。全2 MiB RAMの8-byte aligned scanで全8 sample・全coverageを満たす候補は`0x80090000`の1つだけだった。
- 本文を正しく対応させても、samples 3／4／5／7（計6 Tone）はone-shot上のLOOP STARTを理由に現在のprepareVabTone／preparePs1ADPCMが拒否する。全8 sampleのmarkerは各1つなので、複数marker対応はこの報告の解決には不要。
- 現native coreはLOOP STARTによるrepeat address更新と、END packetのRepeatによるループ有無を独立に扱う。validatorで同じ範囲を受理する方針を検証する。

参照：`docs/playground/playground_ps1_vab.js`、`tetorica_src/runtime/ps1synth.js`、固定Native SDKのPS1 SPU実装。PSF2・独自圧縮形式・実行時展開は別途。

## 実装方針

ユーザーの「進めて」により実装開始。分離VBは全sampleの厳密な境界・coverage・有効packet・一意性を確認する。未対応のpadding等まで推測で緩めない。one-shot markerは既存native coreの動作範囲にvalidatorを合わせる変更で、WASM／DSPや音源APIの新機能は追加しない。ブラウザ・npm用のcanonical JSとserved mirrorを整合させるが、npm公開・commit／pushは行わない。

分離対応はsample構造からの推定であり、元ドライバーの転送pointerを証明するものではない。`bodyMatch: unique-structural`とmatched VB表示で区別する。明示的なToneロードは引き続き必要。

## 完了記録

- Node／実WASM／CLI／SPU／PS1 runtime 384件成功。分離候補の一意性、重複／共有／coverage欠損、旧連続VABのpaddingと部分未対応Tone、one-shot markerの元bytes・END停止・preset復元を検証。
- 最終ZIPでChromium／WebKitとも、新分離読み込み各7項目（実Arc 10 Toneを含む）・Code／Files／Live各7項目・従来SPU full回帰が成功。1240px／390pxの画像に重なりやはみ出しなし。全出力gain0、実聴なし。
- 実ArcはVH `0x80080000`／matched VB `0x80090000`として10／10 Tone対応、unavailable 0。全音色の元ADPCMハッシュと一致し、finite／非ゼロPCMを確認。one-shot 6 ToneはEND後のtailが0、loop音色は継続。旧誤抽出の1,168 bytesではなく、Program 7は正しい8,352 bytesを読む。
- 連続VABの参照sampleはENDが自身の範囲にあることを確認し、入力検証に未対応のpacketは従来どおりTone単位で理由表示する。分離VBは厳密な全sample境界で照合し、候補は最大256・探索work 1,000,000・metadata解析32 MiBに制限。
- Mixer校正の配布guardは、今回の7つの入力検証／import変更と、既存PSF起動metadata・Monaco参照表示2ファイルを別groupとして完全SHAで固定したrevisionを追加。元の測定4レポート・gain・WASMは変更せず、未知の追加変更は引き続き再計測を要求する。
- 校正関連90テスト、2つのgenerator `--check`成功。実WASM12条件で旧／新validatorのPCM・KeyOff・RAM・register traceが完全一致し、別agentの独立再実行でもreceiptと一致。詳細は`docs/issues/ps1_import_source_revision_01.json`。
- ZIP：`release/tetorica_spu_synth_split-vab-20261111-a_itch.zip`（314 files、6,769,535 bytes、SHA-256 `bbcc31653f3c83c1f5d5132d05f3e275d2daf9a671e9bc0fa2c47bfa3a58c81b`）。可読JS／CSS・既存sourcekitを保持し、276元入力と配信assetを照合。固定Native SDKは0.1.7のまま。
- 詳細：[検証記録](spu_psf_split_vab_verification_01.json)。commit／push／tag／公開なし。以前の誤った抽出結果は再抽出が必要で、既存保存presetを自動修復する処理は行わない。
