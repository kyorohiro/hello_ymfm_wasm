# SID Synth: 複合波形の編集・取り込み（2026-11-08）

ユーザー承認: `Combined waveforms are not supported by this Synth snapshot import.` の制限を外し、Synthからも複数波形を選択したい。

## 操作と互換性

- **Waveforms · combine** のTriangle／Saw／Pulse／Noiseを個別にOn／Offできる。複数voiceの加算ではなく、同じSID oscillatorの波形flagへ設定する。
- 全15通りの非zero maskと、全Offを編集・保存できる。Pulseを含む組み合わせではPulse widthを操作でき、Triangleを含む組み合わせではRingの有効条件を満たす。
- SID曲のCapture／Voice選択・Auto反映と、通常SID PlayerのPreset出力も複合波形を受理する。raw-zeroの無波形snapshot、TEST、無音filter routing、未対応の3voice依存などは従来の理由表示を保持する。
- Round robinを選ぶだけではCHの個別設定を揃えない。波形ボタンを編集すると、そのbitのOn／Offだけを全CHへ反映する。他の波形bit・ADSRなどは維持する。明示的なPreset読み込みは音色全体を置換する。
- API／Presetの既存`waveform`文字列を拡張した。例: `triangle+saw`、`triangle+pulse`、`off`。旧v1／v2の単一波形Presetはそのまま読み込める。Copy JavaScript、型定義、Main／logic Workerにも同じ値を通す。
- 波形名とmaskの変換は依存のない可読module `sid_waveforms.js`へ分離した。通常Playerへ不要なStandalone Synth core／WASMを同梱しない。更新用のmodule URLも対応付けた。

選択した6581／8580 coreの複合波形近似を使用する。今回、Native DSP／WASMやそのbuild receiptは変更していない。実機のアナログ特性との一致を新たに保証する作業ではない。

## 固定CHの再発音

ユーザーは再確認で「今試したら大丈夫」と回答したため、挙動を維持した。
実WASMの両model・全CHで、別の鍵盤を押したときに既存のGate Off→frequency更新→Gate Onが発行され、発音所有権も新しい鍵盤へ移ることを確認した。
通常ADSRの再発音は成功する。同じ物理キーの押しっぱなし／OSのrepeatは意図的に再発音しない。

補助probeでは、envelopeが255のときの即時再attackで両coreにwrap／無音が生じる条件も確認した。
今回のユーザー症状の原因とは断定せず、根拠のないenvelope resetやcore変更は加えていない。
記録: `build/validation/sid-fixed-retrigger-probe.{mjs,json}`。

## 検証

- Synth unit **167件**、Player unit **139件**が成功。最終の説明文修正後もsnapshot17件／Player package2件を確認した。
- API／Main／logic Worker **30件**、既存SID core12件、型fixtureと全Playground mode型検証が成功。全16 mask・両model・44.1／48／96kHzを含む。
- Chromium／WebKitのsource検証: 鍵盤各17項目、Synth取り込み各45項目、通常Player capture各22項目が成功。
- Synth ZIPの取り込み各45項目が成功。その後、Round robinの接続説明に残っていた固定Voice 3→1表記だけを修正して最終`.1`を作成した。実行moduleの差分はこの警告文のみ。
- 最終`.1` ZIPで更新互換各5項目、独立Player→Preset保存→独立Synth読み込み各21項目が成功。desktop／mobileに横方向のはみ出しがなく、Waveformの既存配置を維持することも確認した。
- 自動検証は新規作成のPSID／RSID fixtureを使用し、物理出力をgain 0にした。実聴の合格とは区別する。
- 最初のsource取り込み検証では、Auto反映中に変化したCutoffを古い基準と比較して失敗した。検証helperの基準取得をAuto停止後へ直し、全項目を再実行した。最初のPlayer package検証で見つかった不要core依存もpure helperへの分離で修正した。

browser記録: `build/validation/sid-combined-waveforms-*.json`。
unitログ: `build/validation/sid-combined-waveforms-{synth,player}-unit-final.log`。
runtime mirror／SDK artifact検証、SID両modelのreceipt検証、差分checkも成功した。

## 配布候補

| 配布物 | ZIP | Files | Bytes | SHA-256 |
|---|---|---:|---:|---|
| Synth | `release/tetorica_sid_synth_20261108-combined.1_itch.zip` | 265 | 2,966,887 | `01e60edfae302aa993ab9152c346b7d225f73777d5acdaa95858df7a22888977` |
| Player | `release/tetorica_sid_player_20261108-combined.1_itch.zip` | 224 | 2,707,836 | `ec962380110aee680e65fd66f2583434f63e851e47d9ca8c89a18503d06d7b37` |

最終stage／ZIP／内部source archiveが一致し、Synthの198原入力／36可読moduleとPlayerの179原入力／21可読moduleが現在の正本と一致する。
`release/itch_sid_synth_dev-wVDGAN`も最終Synth stageから作成し、source／receiptを含む全265ファイルの一覧・bytesが一致することを確認した。Safariは操作していない。
確認時点でlocalhost:8793のserverは停止していた。起動し直す場合はrepository rootから `python3 -m http.server 8793 --directory release` を使う。
commit／push／公開は未実行。
