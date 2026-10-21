# Native GenesisのAudioモニター

2026-10-21。NativeでもAudioタブのEnvelope／Waveform／Spectrumを表示する。
Web Audioを既定とする方針は維持し、表示・操作は既存の共通UIを使う。

## 構成

- Nativeの最終出力（FX・音量・停止フェード・clip適用後）を観測する。
  CPALの形式変換・mono機器への合成・OSミキサーより前であり、機器のdropoutを直接観測するものではない。
- 音声callbackは固定長の観測bufferへ書き込むだけにする。確保・解放・mutex・FFT・IPCを入れない。
  読取側が間に合わなくても待たず、音声生成とデバイス出力を続ける。
- Nativeの制御側が選択CHのRMS／Peak、直近4096点の波形、4096点FFTの2048binを取り出す。
  FFTはSpectrum選択中だけ計算し、既存Analyserと同じBlackman窓・平滑化なしを使う。
- `NativeGenesisSynth.outputMonitor`を明示的な観測adapterとする。
  AudioContext／AudioNodeの代用品は作らず、演奏命令の直列キュー・音声clockとも分離する。
- 共通UIは表示中だけ最大15回／秒、同時に1件まで取得する。非表示・画面外・Pause・pagehide・破棄で停止する。
  Nativeの観測許可にも2秒の有効期限を設け、ページの応答停止時に音声側が観測を続けないようにする。
- mode／CH変更・Stop・セッション入替えの後に届いた古い応答は表示しない。
  Pauseは最後の表示を保持し、Yスケールの変更だけで新たな観測・演奏を始めない。
- 観測エラーはモニター内に表示する。演奏を停止したり、別の音声出力へ切り替えたりしない。

## 検証

- [x] NativeのRMS／Peak、左右、ringのwrap／有効frame数、FFTの周波数と振幅、無音。
- [x] 観測の有効／無効／期限切れ、再開時の古い波形除去、callback出力が観測の有無で変わらないこと。
- [x] adapterの1件制限、pauseと再開の順序、旧session応答の破棄、不正データの拒否、演奏への影響分離。
- [x] 共通UIの各mode、CH、Pause、表示状態、遅延応答、エラー時の再試行、既存Web Audioの回帰。
- [x] 実ブラウザーでのNative IPC接続と描画、追加AudioContext／AudioWorkletが作られないこと。
- [x] Tauriアセットへの取り込み・ハッシュ照合・offlineビルド。
- [ ] 実デバイスの試聴・長時間負荷。自動検証とは別に扱う。

この作業はAudioタブが対象。Operatorsの設定値から描くEnvelope曲線や、JavaScript `liveFx`の
FX Monitorは別の機能であり、Nativeの音声内部状態を取得したことにはしない。

## 自動検証の結果

| 検証 | 結果 |
| --- | --- |
| 共通UI・Native adapter・Runtime・media・Worker・Keyboard・診断UI・設定・実行ガード | Node 256件成功。モニター単体はUI 38件＋adapter 7件 |
| Tauri Rust | 56件成功、4件ignored。資格情報2件・物理音声デバイス1件・明示実行する計測1件 |
| 実Rust FFTと実OfflineAudioContext Analyserの比較 | 全2048bin成功。最大差はChromium 3.815×10⁻⁶ dB、WebKit 7.629×10⁻⁶ dB。RMS／peakの差も10⁻⁶未満 |
| Chromium／WebKitの共通ページ | Canvas上の信号、左右CH・各mode、Pause／非表示／画面外、古い応答の破棄、同時1件／15Hz制限を確認。Native IPCは模擬 |
| 生成音声への影響 | 実Native rendererの観測有効／無効でPCMがbit単位で一致。遅延した観測応答を待たずに演奏命令・音声Stopが完了 |
| Tauri取り込み | 786ファイル。archive SHA-256 `dd212bc9aa94552041e71606a65b8cab5102cb6c817d5449ab6f873a2d3145e3` |
| 配布アセットの最終確認 | WebKitでUI・実FFT比較が成功。取り込み後の `cargo build --offline --locked` が成功 |

デバイスを開かない明示的な計測では、debugビルドの観測writeを240,000回呼び、
無効時4.020ms、有効時9.891ms。制御側の4096点FFTを含む読取30回は36.813msだった。
これはこの環境での参考値であり、音声機器の安定性や実時間処理の保証ではない。

読取が混雑した場合や上書き中のringを安全にコピーできない場合は、描画1回をスキップする。
Nativeは音声を止めてコピーを待たない。ringは64 KiB固定、解析用bufferも先に確保し、
制御側へ渡す出力はEnvelopeの数値、波形4096点、またはFFT 2048binだけとする。

再実行例（上流リポジトリーから）:

```sh
node --test web/native_genesis_monitor.test.mjs docs/playground/playground_audio_monitor.test.mjs
node scripts/check_playground_native_backend_browser.cjs
```

FFTの実データ比較は、Tauriリポジトリーからfixtureを書き出した後、上流側のブラウザーテストで読み込む。

```sh
TETORICA_NATIVE_MONITOR_FIXTURE=/private/tmp/native-monitor-fft-fixture.json cargo test --offline --locked --manifest-path src-tauri/Cargo.toml native_genesis::monitor::tests::monitor_fft_fixture -- --exact
```

```sh
node scripts/check_playground_native_backend_browser.cjs --fft-fixture=/private/tmp/native-monitor-fft-fixture.json
```
