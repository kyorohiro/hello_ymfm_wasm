# SID Synth: 実SafariのPauseクリック修正（2026-11-08）

## 再現と原因

ユーザー指定のSafariタブ `http://localhost:8793/itch_sid_synth_dev-wVDGAN/` で確認した。
対象は `release/itch_sid_synth_dev-wVDGAN`。主要5モジュールは正本とbyte一致しており、
この再現は旧Workletの混在とは別の不具合だった。

`Rollin.sid`（PSID / CIA / PAL / 6581、subtune 1）をPlay songで再生し、Live CH表示をOnにした。
アクセシビリティのボタン操作ではPauseできたが、実座標への120ms／250msの押下では
Pauseも表示も変わらず、再生位置が進み続けた。静止中のResumeは同じ座標で成功した。

Live観察の約50msごとの更新で、同じ`Pause`という文字でも`textContent`を再設定し、
ボタン内のテキストノードを置換していた。マウスの押下から離すまでにこの更新が入ると、
Safariでclickが成立しなくなっていた。

## 修正

`docs/synth-sid/sid_import_panel.js` のラベル更新を、文字が変わる場合だけ行うようにした。
Pause、Play、Capture、取り込みVoiceのボタンと、同じpanel内の説明表示を対象とする。
クリック時の処理、Pause／Resumeの音声処理、DSP／WASMは変更していない。

## 実Safariでの再確認

同じURLへ修正を反映し、再読み込み後に元のDownloads内の`Rollin.sid`を開き直した。
Master 70%、Live CH 1 Onのまま確認した。

- 250msのマウスPauseで`Resume`となり、4.136秒 / frame 182400で停止した。
- マウスResumeで4.650秒 / frame 205056へ進み、停止位置から再開した。
- 120msのマウスPauseでも成功し、10.789秒 / frame 475776で停止した。
- 後の再確認でも10.789秒 / frame 475776を保持していた。タブはこのPause状態で残した。

これは実Safariでの操作と状態表示の確認であり、人による実聴・長時間の音質確認とは区別する。
従来の瞬間的な自動clickだけでは、この押下中の更新を十分に検証できていなかった。

## 配布候補

`release/tetorica_sid_synth_20261108-safari-click_itch.zip`

- 262 files、2,946,173 bytes
- SHA-256: `fa17dc7ccdfe96d8868b91fba56652e6b102392fb6923ae6e725d5689bc0a1da`
- 可読moduleとmatching source archive／receiptを維持した。
- 指定の`release/itch_sid_synth_dev-wVDGAN`も新stageと全262ファイルがbyte一致するよう更新した。

## 自動検証

`npm run test:sid-synth`: 135件成功。
`scripts/check_sid_synth_import_browser.cjs`: source／独立ZIPのChromium／WebKitで各39項目、計156項目成功。
追加caseは実マウスを250ms以上押し続け、複数のWorklet read完了とLive位置の変化を確認する。
押下中のボタン・テキストノードの同一性、離す前にはPauseしないこと、離した後のPause ACK・
固定したcore状態、同じengineでのResumeと進行を確認する。自動検証の物理出力はgain 0。

実行結果は `build/validation/sid-synth-safari-click-source.json` と
`build/validation/sid-synth-safari-click-zip.json` に保存した。
隔離したZIP展開コピーでpanelだけを修正前のHEADへ戻す対照検証では、WebKitが追加caseの
`A Live update replaced the pressed Pause text node` で期待どおり失敗した。
この対照結果は `build/validation/sid-synth-safari-click-before.json`。正本と配布候補は戻していない。
commit／push／公開は実行していない。
