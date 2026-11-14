# HuC6280 Synth: shared CH selection and VGM Live view

開始: 2026-11-13。[仕上げTODO](todo_huc6280_synth_finish_01.md)の次の工程。

- [x] 通常／Code／VGMで`Synth · edit and play / CH1–CH6`と自動更新On／Offを共通化する。
      初期値はSynth、自動更新On。選択の変更だけでCHの値を統一しない。
- [x] 通常時の物理CHは、そのCHの設定表示・編集・鍵盤に揃える。
      Code時の既存所有権・sparse編集を保つ。通常の音色プリセットは単一音色のままとする。
- [x] VGMの実際に消費した位置までのレジスター／設定波形を追跡し、既存の音色UIへ表示する。
      音声の先読み位置を表示しない。20Hz以下、bulk PCMなし、有界のイベント履歴で観測する。
- [x] Wave・Noise・LFO・DDA、volume・pan・period・Gateを正しく区別する。
      不明Wave RAM／未取得のDAC sampleを、編集用音色や初期Sineで補わない。
      DDAは記録されたDAC値・状態とし、元の音階／連続PCM音色を推測しない。
- [x] VGMのCH表示はこの工程では読み取り専用。Pauseでは聞こえた位置を凍結し、
      再開・Stop・曲切替・失敗・Code切替で古い表示を残さない。
      選択CHの試奏／CaptureとVGM再生中の直接編集は次工程。
- [x] 自動更新Offは周期表示更新・再描画を止めて最後の観測を保つ。CHを切り替えた時の
      凍結データも同じ観測時刻を使い、Onへ戻すと消費位置へ追従する。
- [x] 実WASMの観測前後PCM一致、Wave RAM規則、DAC streamのselector復元、
      通常／Code編集・発音、Pause／Resume・Auto Off・遅い結果・bounded履歴を検証する。
- [x] 読めるソースの独立ZIPでChromium／WebKitを無音検証し、従来の曲／Code／
      鍵盤・音色抽出を回帰確認する。README・CI・検証記録を更新する。

共有WASM／音量補正は変更しない。観測は送信レジスターと設定波形であり、
現在の発振位相やアナログ出力の内部値を読めるとは表示しない。
物理出力・既存ユーザー保存は触らず、自作データで検証する。
commit／push／tag／公開／Tauri更新は行わない。

完了: 2026-11-13。Node 302件、無音Chromium／WebKit計106項目が成功。
[検証記録](verification_huc6280_synth_live_channels_20261113.json)。
Pause／EOFでは自動更新Offでも消費位置を一度公開する。VGMの有界な受動追跡は継続する。
通常CHの個別設定は一時状態で、Code開始・終了では共通音色へ戻す。
