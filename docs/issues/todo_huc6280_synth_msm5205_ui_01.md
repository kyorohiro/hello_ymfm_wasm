# HuC6280 Synth: MSM5205の基本UI

開始: 2026-11-14。CD-ROM²の入口に続き、MSM5205の既存APIを画面から操作する。

- [x] 既存MSM5205のPCM/WAV変換・ADPCM再生・Code所有権を確認し、同じ実装を再利用する。
- [x] FilesのWAV／packed ADPCMを選択して読み込む。元ファイル、編集中のCode、
      HuC6280音色を保ち、失敗・取消・連続読込で以前のサンプルを壊さない。
- [x] 実際のADPCM復号波形、使用量／64KiB、サンプル数、再生時間を表示する。
      プレビューのためにAudioContextやスピーカー接続を増やさない。
- [x] Play／Stop、Loop、Rateを追加する。Rateは0–15と実効Hzを表示する。
      既存APIではRate／LoopはPlay時の引数なので、変更は次のPlayからと明示する。
      入力は他Synth同様のボタン／ドラッグ操作にし、演奏キーとのfocus競合を避ける。
- [x] Codeと画面操作で同じ編集用MSM5205を共有する。Code継続中の操作、Apply、Stop、
      再Run、遅延load、出力切替／破棄で古い処理が新しい音を上書きしないようにする。
      サンプルはCode Stop後も保持し、Code／UIは別々の音源を重ねない。
- [x] Mixer／Master／Waveform／Spectrumと同じ経路へ接続する。VGMのMSM5205は
      曲再生用として分離し、編集用サンプルと混同するLive表示にしない。
- [x] README・ヘルプ・配布ZIP・CIを更新し、Nodeと実配布ZIPのChromium／WebKitを
      スピーカー出力なしで検証する。再開用の検証記録を残す。

今回の範囲外: CD-DAの専用UI、VGMからのADPCM素材抽出、MSM5205鍵盤音程・波形お絵描き、
新プリセット形式、共有SDK／WASMの変更、Tauri反映／公開／npm publish／git commit。

## 実装・検証記録

- `msm5205_asset.js`で既存encoderと実WASM decoderを再利用し、最大512区間の復号波形を作成。
- `msm5205_source.js`が編集用RAMを所有し、画面とCodeは同じ音源を操作する。
  Code Stop後もサンプルを保持し、古いCode leaseは無効化する。CD-DAは引き続きCode所有。
- `msm5205_controls.js`でFiles選択、Load、Play／Replay／Stop、Loop、Rateのボタン／ドラッグ、
  実効Hz、64KiB使用量、復号波形を表示。WAV変換とtransportがソフト側であることを明示。
- Rate／Loopは次のPlayに適用。WAVの奇数末尾paddingは再生長・波形から分ける。
  原本ファイルはProjectに保存し、現在のMSM選択・RAM・再生設定はsession stateと明示。
- 起動中Stop、連続load、遅延native転送の取消、Code StopとUI loadの競合、接続切替、
  RPC応答停止と再試行、Stopが失敗した場合のdisposeまで確認。
- Node542件（0skip）、実配布ZIPのChromium／WebKitで12 suite／24 run／222項目が成功。
  全speaker出力をミュート。390px／1240px表示と配布source／WASMの一致も確認。
- [検証記録](verification_huc6280_synth_msm5205_ui_20261114.json)。README／CI／配布検証を更新済み。
- 実聴・実ゲーム比較・長時間試奏、Tauri反映・公開・commitは未実行。
