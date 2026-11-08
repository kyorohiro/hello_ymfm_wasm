# SID Synth: ソフトウェアLegatoと未使用値の表示（2026-11-08）

ユーザー承認: 固定CHの鍵盤にRetrigger／Legato選択を追加し、Liveで音に効いていないPulse幅・周波数比の表示も整理する。
SIDのハードウェア由来のADSR wrap／freezeを音源coreから消さず、鍵盤側の重ね押し方針を選べるようにした。

## 操作

CH 1／2／3を選び、隣の **Keyboard · software** で **Legato** を選ぶ。

- 既定の **Retrigger** は従来どおりGateを切り直し、ADSRを再スタートする。
- **Legato** で鍵を重ねると、Gateを維持して最後に押した鍵の音程へ移る。その鍵を離すと直近の保持鍵へ戻り、最後の離鍵だけがGateを下げる。ADSRは重ね押しでは再スタートしない。
- 音源は常に選択した物理1CH。保持鍵の個数と実際の発音voice数を区別して表示する。Sync／Ringのsilent sourceも同じ保持音へ追従する。
- Round robinではLegato選択を保持しつつ無効にし、従来のvoice割当を使う。mode変更・CH／model／topology変更・load・Stopは保持鍵とPitchを解除する。
- **Save channel setup…** は新しいv2形式で`keyboardMode`も保存する。旧v1 setupはRetriggerとして読み込む。voice Preset、SID Capture、Auto反映では演奏modeを保持する。

Legatoはソフトウェアの鍵盤制御であり、SID曲再生や低級register APIのGate／ADSRを変更していない。
鍵を全て離した後の新しい発音は通常のGate Onであり、あらゆる短いGate切り替えを回避する機能とは扱わない。
Copy JavaScriptは従来どおり単音の試奏コードを出し、固定CHのLegato選択時は、重ね押し方針がソフト側の機能であることをコメントする。

## 未使用値の表示

Pulseを含まない波形ではPulse幅を、Sync／Ringが両方Offなら比率を淡色表示する。
Liveでも実値の動きは残す。tooltipとARIAで、現在の音へ影響しない理由を説明する。
Liveの比率名は **Observed frequency ratio** とし、source／carrierの周波数から計算した値であってSIDの独立registerではないことを明記した。
入力イベントを擬似的に発行しても、観察中・未使用の項目から音色を変更しない。
同じcontrol node・折りたたみ・help状態と配置を維持する。

## 調査と検証

ユーザー指定の`ww/C64Music/GAMES/0-9/8Bit_Goblin_Preview.sid`はPAL／8580。
取り込んだTriangle・ADSR 2／0／15／3を固定CHで100ms保持して次のNote Onを送ると、Gate／所有権は更新されても無音になる条件を再現した。Off後100ms待つ比較では発音した。
8580 endpointはEnvelope値を公開しないため、その測定で255を直接読んだとは扱わない。採用coreの8bit wrap／zero freezeと、[reSIDの実機ENV3観測コメント](https://github.com/libsidplayfp/resid/blob/master/envelope.h)が同じ機構を示す。
scalar記録・再実行コードは`build/validation/sid-goblin-retrigger.json`／`sid-goblin-retrigger-probe.mjs`。元SID・PCM・ROMはコピー／保存／配布していない。

- unit **180件成功**。実6581／8580・全固定CHのSustain 15、重ね押し／戻り／非current鍵の離鍵にGate writeがないこと、最終離鍵、Pitch／source、無効なfallback音程の事前拒否、Reset、Retrigger互換、RR維持を含む。
- sourceのChromium／WebKitで、鍵盤各20項目・SID取り込み／Live／Pause各46項目が成功。
- 最終ZIPでも鍵盤各20項目、更新互換各5項目が成功。browser合計 **182項目**。新しいsetup保存／復元・旧v1 migration・voice読込時のmode保持・両モデルのSustain 15重ね押し・戻り・mode変更時の解除を確認した。
- Liveの未使用値、複合波形・生register、Auto反映、Pause／Resume、同じcontrol nodeの保持とdesktop／390pxの表示も検証した。
- 新規作成fixtureを使い、物理出力はgain 0。実聴の合格とは区別する。

ログ: `build/validation/sid-legato-unit.log`、`sid-legato-{keyboard-source,import-source,keyboard-zip,upgrade-zip}.json`。
README、再開TODO、cache用module revisionも更新した。Native DSP／WASM／build receiptの差分はない。

## 配布候補

`release/tetorica_sid_synth_20261108-legato_itch.zip`

265 files、2,972,224 bytes、SHA-256 `6ec37cbdceea65c09674f2fb6543a4be20cf4579425a3f448f3260e5df747a1a`。
ZIP／stage／内部source archiveの全bytesと、36可読module／198原入力の現行正本一致を確認した。
`release/itch_sid_synth_dev-wVDGAN`も全265ファイルが最終stageと一致する。Safariは操作していない。
commit／push／公開は未実行。
