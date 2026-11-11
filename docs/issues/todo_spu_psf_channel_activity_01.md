# SPU Synth：PSF 24CHの発音状態（2026-11-11）

- [x] 既存の再生位置に対応した24CH Live snapshotから、小さなCHボタンでactive／ENVを表示する。実際の音量計や正確なRelease段階とは呼ばない。
- [x] ボタンのクリックを既存CH選択と共通化し、Pause中の試奏・Capture、元の編集音色の保持につなげる。クリック後も鍵盤入力を使えるようにする。
- [x] Live Off／待機／エラー／Stop／曲変更で古い発音表示を消す。Pauseは同じframeを保持し、既存更新を使って余分なpollやSPU操作を増やさない。
- [x] 表示はデスクトップ1段・狭い画面では折り返し、選択CHと発音状態を区別する。説明は既存の「?」へ入れる。
- [x] Chromium／WebKitの無音headlessで実PSF fixtureの状態と選択・Pause試奏・Capture・CH切り替え・Off／Stop・レイアウトを確認する。
- [x] README・可読ソース付き配布ZIP・検証記録を更新する。commit／push／公開は行わない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。ENVが非ゼロでも左右voice volumeが0の変調源などは聞こえるとは限らない。Gateは最後のKON／KOFF要求で、ENV・activeとは別に扱う。

完了：関連Node 51件、最終配布検証2件（上記と重複）が成功。最終c ZIPでLive／Pause試奏の2系統がChromium／WebKitとも成功。1240pxは1段、800px＋Files／390pxは2段で重なりなし。ENV 0のnative activeを別に保持し、点灯とは区別した。同じCHのクリックでは保持中の試奏を止めない。

検証記録：[spu_psf_channel_activity_verification_01.json](spu_psf_channel_activity_verification_01.json)。配布ZIP：`release/tetorica_spu_synth_psf-channel-activity-20261111-c_itch.zip`（335 files）。音源DSP／WASMは変更せず、新しい可読JSもbyte一致で同梱した。
