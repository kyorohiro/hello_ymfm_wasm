# SS／SCSP 再開用TODO — 2026-10-31

SSの追加開発はいったん区切り、先にGitHub Actionsの失敗確認・修正と他機能のリリース準備を行う。
再開時は本書を入口にする。下記未完了項目を今回すぐ実装する指示ではない。

## 現在の到達点

- PCM／2／4／6-op、Chain／Pairs／Branch、A〜F独立編集、単一canvasと接続図。
- 専用SynthのSCSP DSP mono Delay、Enable／Time／Feedback／Send／Return、独立DSP Lab。
- Delayの初期効果量は修正済み。Send 7／Return 6、短音の最初のechoは原音の約半分。
- v4 preset保存、旧v1〜v3はDSP Offで読込。先頭64KiBをDSPへ予約、PCM／guardは448KiB。
- 専用Synth：PCM26／2-op13／4-op6／6-op4 voices。共有Playgroundの32物理slotsとは別。
- Node20、Chromium／WebKitの最終destination出力検証成功。人の試聴・実機比較は別。
- 最新修正ZIP：`release/tetorica_scsp_synth_dsp-delay-level-fix-20261031_itch.zip`。
  SHA256 `7899ed2ec38934f07a626f73d2ba8951e5cd9a6b0ffe1537abcddfe9989544bf`。
- npmのローカル公開記録はtetorica-fm2612 0.2.36（LFOまで）。後続FM／専用Synth DSPが公開済みとは扱わない。

## 再開時の順序

- [ ] 初期SineでDelay Enable→短音離鍵の試聴確認。保存済みpresetはSend／Return値を保持するため、必要なら7／6へ調整。
- [ ] operator別FM Depth。共通つまみは全段変更として残し、旧presetを移行する。
- [ ] 自由配線の仕様を確定：Input X／Y、Depth、独立Output、ratio、DSP Sendの見せ方。
  接続図＋選択operator詳細＋単一canvasを維持。物理slot割当は音色モデルから分離する。
- [ ] 非循環graphを先に実装し、2入力平均・fan-out・複数Output・無効変更のatomic拒否を検証。
- [ ] 自己／相互Feedback。sound stackの世代と処理順、固定core zero-delayとの差を検証してから公開する。
- [ ] host側の音色テンプレートに移して編集元6スロット予約を減らし、同時発音数を増やす。
- [ ] Reverb：microprogram／係数／RAM配置／Decay・Size等を設計。現在のDelay対応と区別する。
- [ ] DSPを共通JS API・型・Playground Main／Worker・Nativeへ公開する。今は専用Synthと独立Labのみ。
- [ ] Native／WASM DSP比較、実audio deviceでの試聴・長時間運転・device interruption復旧。
- [ ] メモリpoolのpage返却／compaction、runtime障害注入、必要に応じて音色プリセット。
- [ ] npm／itch／Native／SDKの公開範囲と版数を揃え、最終配布物を再検証して公開する。

## 詳細へのリンク

- [SCSP全体](todo_scsp_01.md)
- [FM個別Depth・自由配線・Feedback・予約削減](scsp_fm_followup_01.md)
- [DSP初期実装と後続](scsp_dsp_01.md)
- [Delay初期効果量の修正](scsp_dsp_level_fix_01.md)
- [スレッド引継ぎ](thread_handoff_20261029.md)
