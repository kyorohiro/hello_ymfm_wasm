# HuC6280 Synth: VGM reference playback

開始: 2026-11-13。[仕上げTODO](todo_huc6280_synth_finish_01.md)の最初の工程。
今回は曲の保持とPlay／Pause／Resume／Stopを実装する。
CH Live表示、Pause中の選択CH試奏・Capture、Seek、再生中のCH直接編集は後続。

- [x] VGM／VGZを音色抽出とは別の模範演奏として検証する。単一HuC6280、
      Wave／Noise／LFO／DDAの対応範囲を明示し、未対応チップ・commandを黙って省略しない。
- [x] Filesの`vgm/`へ元のbytesを衝突しない名前で保持する。音色0件でも有効な曲を保存できる。
      既存の64MiB解析と16MiB Cassette容量は混同せず、保存できない場合も抽出結果を保つ。
- [x] モニター上に曲一覧とPlay／Pause／Resume／Stopを追加する。
      選択・解析・保存・復元だけでは音声deviceやCodeを開始しない。
- [x] 既存AudioContext／Master／desktop出力を利用するreference経路を追加する。
      音源は既存HuC6280 core。編集用音色は保持し、native DSPと音量補正は変更しない。
- [x] Pauseは消費済み位置で止め、未消費PCMとそのoffsetを保持してResumeする。
      Stop・曲切替・終了・失敗・破棄・遅い非同期結果を処理する。
- [x] VGMとCodeは排他的にする。Play／ResumeでCodeと手動保持音を止め、
      Code Runとworkspace置換では曲を止める。Stop all soundは両方を停止する。
- [x] 実WASM／mock timingテスト、自作VGMによる無音Chromium／WebKit、
      既存Code・音色抽出・PCM・独立ZIPの回帰を確認する。
- [x] README・CI・仕上げTODO・検証記録を更新する。commit／push／公開はしない。

物理出力はミュートし、実聴・実ゲーム比較を完了扱いにしない。
1回再生を基本にしてVGMのloopは自動反復しない。

完了: 2026-11-13。Node 278件、Chromium／WebKitで新規・Code・既存機能の計90項目が成功。
[検証記録](verification_huc6280_synth_vgm_playback_20261113.json)。
物理出力はミュートし、commit／push／公開はしていない。
