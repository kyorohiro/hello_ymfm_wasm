# CD-ROM² audio: CD-DA first milestone

Date: 2026-10-27

## Scope and result

`todo_cdromrom_01.md`の第1段階として、CD-DAを独立したPCM音声デバイスへ実装。
44.1kHz stereo PCM16 RIFF WAV／JSON track manifestを読み、Browser・Native・offlineで再生できる。
既存PC Engine modeのHuC6280と混合し、PlaygroundのMain／Workerから操作する。
MSM5205を含むCD-ROM²全体の完了ではない。既存MSM5205 JS／VGM経路は変更していない。

使用方法は[../cdda.md](../cdda.md)。PC Engine modeでNew Cassetteを作成すると
`examples/pc-engine/pce-cdda.js`が入る。元データを生成するため外部素材・BIOSは不要。
Tauriのfrontend取り込みまで済ませており、同リポジトリの`npm run dev`でも確認できる。

## Design

- `native/cdda/`にBSD-3-ClauseのC11共通PCM coreを追加。Native／WASMは同じコア。
- BrowserのWASMは2257bytes、固定128KiB memory、4KiB入力窓。描画中の確保・拡張・ファイル読込なし。
- 元PCM16の必要部分だけを変換し、全曲Float32化や既存sampleの64MiB枠へ依存しない。
- 選択トラック最大256MiB。Nativeでは再生中・準備中・保持中の合計を同枠へ含める。
- Browserは同じAudioContext、Nativeは同じcallback、offlineは同じoutput-frame clockへ接続。
- Play／Pause／Resume／Stop／Seek、source-frame位置、音量・Mute・pan、終了／再演奏を実装。
- Mixerは独立`cdda`入力。既存chip gainを再適用しない。UIの状態取得は音声を書き戻さない。
- 未来予約はadmissionでACKし、audio frameで適用する。即時Stopは古い予約発音を取消。
- 読込・upload・source切替とStopの競合、古いRun／session／generation、破棄後の再開を防止。
- NativeへのPCM16はRaw IPCの最大64KiB単位で送信。callbackはPCMの最後のownerを解放しない。

NativeのC原本snapshotは`src-tauri/native-cdda`。アプリ単独でビルドでき、
`sync_native_cdda.py --check`と`sources.json`で固定内容を検証する。
本体からの同期／照合は`node scripts/sync_cdda_native.mjs --write|--check`。
既存のsound-chip SDK pin／SDK source／chip WASMは変更していない。

## Validation

- 実C11／C++14／WASM core：8／44.1／48／384kHzでPCMと状態が独立基準に一致。
  全source方式と窓方式、任意block分割、phase、Pause／Seek／Mute／EOF／不正置換を確認。
- Web関連199件成功。新規CD-DA input／player／Native adapter／offlineを含む。
  既存VGMのHuC6280＋MSM5205、sample、Main／Worker lifecycleも回帰確認。
- 実Browser全8route成功：Chromium153.0.8010.12／WebKit26.6 ×
  単独44.1kHz／48kHzと、実PC Engine PlaygroundのMain／Worker。
  捕捉PCMの独立基準との差は最大`1.1920941123122475e-8`。
  stereo、正確な予約frame、Pause／Seek／終了／再演奏、Mixer、VFS、Stop後exact zeroを確認。
- 入力44100／実際の出力sample rate、fractional position、Mixer値の状態取得も確認。
- 全Cargoは共通callback／event queue変更の回帰確認に必要なため実行。
  771成功／0失敗／4既存ignore、新規CD-DA7件を含む。実音声deviceは開いていない。
- Playground全mode宣言＋CD-DAの正負型fixture成功。
- npm候補は312module／28chip pair＋CD-DA／360declaration、903files。
  隔離installでCD-DA実WASM、44.1→48kHz stereo、EOF、予約Pause、WAV出力まで成功。
- ZIP全975fileがstageとbyte一致。実Browserの全282served fileとcheckerが最終checkoutとhash一致。
  そのうち音声／runtimeの190assetは最終flat ZIPともhash一致。
- Tauriは同ZIPの974effective payloadを取り込み（既存規則でmetadata1fileを除外）。
  `release.lock.json`・展開内容・元ZIPをbyte照合。Native source ZIPと全23offline pinを検証。
  appのPython26件／Node31件も成功。

自動試験の物理出力はPCM捕捉後にmute。人による実聴・実機との比較・Tauri GUI操作は未実施。
BrowserのMixer検証は既存5ms rampをaudio-frame数で待ってから測定している。
既存のloop解放テストで固定20ms待機の揺らぎが出たため、実NoteOffの完了待ちへ変更。
assert内容とproductionのloop処理は変更していない。
サンドボックスによるnpm cache／既存Native loopback試験のEPERMは、同じ検証を許可された環境で再実行して解消。

## Artifacts and continuation

- `release/hello_ymfm_wasm_cdda-pcm-dev_itch_playground.zip`
- `dist/fm2612/`は未公開の開発配布物。公開npmはFM0.2.31／VGM0.2.16のまま。
- Browser／Native／Tauri取込の詳しいreceiptとsource hashは同名JSONへ記録。
- commit／push／tag／npm／GitHub Pages／itch.io公開操作なし。

次はMSM5205を共通core・Native／WASM・Playgroundへ接続する。
その後、PSG＋ADPCM＋CD-DAを混ぜるExampleとCD-ROM²全体の完了条件を検証する。
CD側のRAM／可変速度制御の範囲もここで確定する。
CUE／BIN・圧縮音声・ディスク全体の保持・物理CD・CPU／SCSI／BIOSは未対応。
大きいNative trackを置換する際に合計256MiBを超える場合は、Playground Stop後の新しいRunで読み直す。
