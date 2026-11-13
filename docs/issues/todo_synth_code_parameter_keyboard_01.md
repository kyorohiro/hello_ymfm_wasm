# Synth：Code演奏とつまみ・Keyboardを併用する（2026-11-13）

Codeはメロディだけでなく、Filterや変調などを補助する演奏にも使う。Code／Keyboardは表示・入力方法の切り替えとし、タブ変更でRunを停止しない。DMGでCode演奏中も音色を編集でき、SPUの通常パラメータ操作もRunを維持する。

- [x] 共通Code controlsと各Synthのタブ・鍵盤・Live表示・停止条件を調査する。
- [x] Code→KeyboardでRun・context・liveLoop・livePrepare・FXを維持し、Keyboard側からも明示Stopへ到達できるようにする。project置換・曲再生・明示Stop・pagehideの停止は維持する。
- [x] DMGのCode演奏中の編集を使いやすくする。Live観測値と作者の編集値を混同せず、つまみ変更を同じAPUへ反映し、周波数・Gate・他CHを意図せず書き換えない。
- [x] SPUのADSR・Reverb・PMON・Noise・Morph等の通常編集をCode停止から分離する。scalar変更は保持音を可能な範囲で維持し、sample/topology変更は必要な音だけ停止してRunを維持する。Stop後も最新の作者設定を残す。
- [x] DMG／SPU／SID／FM2612のKeyboard併用時に、鍵盤の離鍵やblurがCodeの発音を止めないようにする。同じphysical CHを使う場合の優先・復帰を明確にし、勝手なAPU複製・仮想voice増設をしない。
- [x] Node／実WASM、出力をアプリ起動前からgain0へ遮断したheadless Chromium／WebKitで、Codeメロディ＋UI調整、Codeパラメータ操作＋Keyboard、タブ往復、明示Stop、競合／失敗を確認する。
- [x] README／CI／可読配布ZIP／検証記録を更新する。実聴・通常browser／native操作・commit／push／公開は行わない。

既存のユーザーCodeは書き換えない。chip APIのphysical CHの意味を維持し、Code自身が繰り返し書く値と手動操作が競合する場合は最後の操作が反映されることを説明する。

ユーザー確認：CodeのLive表示中は、作者の編集表示へ切り替える方式ではなく、**表示しているCHの値を直接編集する**。触ったfieldだけを適用し、他CH・周波数・Gateを維持する。曲のLive観測は読み取り専用のままとする。


完了：DMG 206件・FM2612 526件・SID 237件・SPU 341件、計1,310件Node成功。各可読配布ZIPを出力gain0のheadless Chromium／WebKitで検証し、Codeメロディ＋選択CHのLive編集、パラメータ専用Code＋Keyboard、タブ往復、古い離鍵／blur、明示Stop後の通常Keyboard再発音を確認。FM／SPUの既存Code／Files／FX／project回帰も両engine成功、SIDは既存全回帰B＋最終Ctargetで確認。Code実状態と作者表示を分け、失敗／取消時の鍵盤IDを維持した。

検証記録：[verification_synth_code_parameter_keyboard_20261113.json](verification_synth_code_parameter_keyboard_20261113.json)。詳細receipt／ログは `build/verification/synth-code-parameters-keyboard-20261113/`。4種の可読配布ZIPを生成し、変更した実行module25件の最終source対応も照合済み（FMのみ既存packagerのimportパス付替えを考慮）。公開chip API／WASM／nativeは変更せず、commit／push／公開もしていない。
