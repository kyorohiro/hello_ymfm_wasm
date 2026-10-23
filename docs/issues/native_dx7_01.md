# DX7のNative音声対応

2026-10-24追記：独立した追加生成は[Native追加DX7](native_dynamic_dx7_01.md)で対応。以下は2026-10-21時点の主音源対応の記録。

2026-10-21。TauriのNative音声経路にMSFA DX7を加える。
Web Audioを既定のままにし、DX7 modeでMenu → Audio engine… → Native (experimental)を選ぶ。
Native中に選べるmodeはGenesis／Mega CD／DX7。他のmodeではWeb Audioを使う。

## 音源と出力

- 既存のMSFA C++音源を直接ビルドする。WASMやAudioWorkletでPCMを生成・転送しない。
- 内部44,100 Hz、16音ポリフォニー。64フレームの内部処理と出力sample rateへの変換を既存実装に合わせる。
- DX7 modeではYM2612／Sega PSGを生成・レンダーしない。`fm`／`psg`／OPNの`play`も公開しない。
- DX7を共通ミキサー・組込みFX・JavaScript `liveFx`・master音量・停止fade・最終出力monitor／録音へ接続する。
- 音声callbackではメモリー確保・解放・IPC・JS実行・ロック待ちを行わない。音色データの準備は制御側、発音・適用は音声側で行う。
- 音色データはcallbackの適用・破棄が完了するまで制御側でも保持し、回収も制御側で行う。予約中のDX7命令データは8 MiBを上限にする。
- 由来・ハッシュ・Apache-2.0ライセンスをTauri側の`src-tauri/native-dx7/`へ保存し、アプリにもライセンスを同梱する。

## APIと画面

- Main／Workerで`dx7`と`await useSoundChip('dx7')`を使う。同じ主音源を借用する。
- 音色preset、SysExバンク、音色選択、オペレーター・feedbackの編集、noteOn／noteOff／allNotesOff／panicに対応する。
- Workerの演奏は既存lookahead・owner取消しを共有する。古いloopのnoteOffが新しい同音を止めないようにする。
- KeyboardのChip選択・Guitar／PCキー／マウス操作と、DX7 Operators上の試聴を接続する。
- Operatorsは適用済み音色と予約中の論理音色を区別する。エンベロープの内部レベル表示ではない。
- 手動の長押し中は同音のscript発音や音色全体の上書きを防ぎ、古い試聴の解放で新しい音を止めない。
- Stopは未来の命令と発音を止め、音色バンク・選択を保持する。再Run・試聴で使い直せる。

独立した`createSoundChip('dx7')`、追加チップ、streamはNativeでは対応しない。
音声ファイル読込み・圧縮音声のデコード・入力編集は従来どおりWebView側で行う。
`liveFx`の遅延・実行制限とFX単位monitorの制限は[既存Native実装](native_livefx_01.md)と同じ。

## 検証

実機の出力デバイスを開かない検証で、Native PCMと既存WASMの一致、発音・解放・音色編集、
Main／Worker、Keyboard／Operators、停止と再開、Genesis／Mega CDの回帰を確認する。
実Native C++と配布WASMの114ケース／792,576 stereo framesを44.1／48／96 kHzで比較し、
最大差分0だった。[PCM比較結果](native_dx7_validation_20261021.json)に記録している。
32アルゴリズム・feedback、16音の上限と解放後の再利用、長押し・release中の編集、
音色の世代・SysExバンク選択、panicと再開、周波数等の境界を含む。
Webの公開adapterは44.1／48 kHzに対応するため、96 kHzは同じ整数位相の変換を配布WASMへ適用して比較した。

Native出力先のIPCをmockしたChromium／WebKitの画面テストも、Tauriへ取り込んだ791ファイルで成功した。
Main／Worker、初期コード、32音色SysEx、編集、PCキー／Guitar／Operatorsの試聴、
FX／liveFx、Envelope／Waveform／Spectrum、最終出力録音、Stop後の保持・再開を確認した。
NativeのAudioContext／AudioWorklet生成とDX7 WASM取得は0件。Genesis／Mega CDの既存検証も通過した。

JSの対象テスト248件、Rust全体116件（実デバイス等の4件はignored）が成功した。
RustにはDX7の新規13件を含み、適用時刻・予約状態の整合性、キャンセル、同音の重なりと古い解放、
手動試聴、5 msのbalance変更、callback後のデータ回収、音色更新と状態取得の競合を検証する。
Tauriのofflineビルドも成功。取込みZIPのSHA-256は
`45130b83f18100dc67f5291397e9181f8ff4f06e4153408cda68bf257379b7f4`。

これはデバイスを開かない自動検証であり、実機での聴感確認は含まない。

ルートから:

```sh
node --test web/native_genesis*.test.mjs web/playground_runtime.test.mjs docs/playground/playground_keyboard_routing.test.mjs docs/playground/playground_mode_keyboard.test.mjs docs/playground/playground_execution.test.mjs
node scripts/check_native_dx7.mjs --out=/private/tmp/native-dx7-parity.json
node scripts/check_playground_native_backend_browser.cjs --root=w/tetorica-fm2612-playground-tauri/dist --out=/private/tmp/native-dx7-browser
```

Tauriリポジトリーから:

```sh
python3 scripts/sync_native_dx7.py --check --source ../..
python3 scripts/import_release.py --check
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml
cargo build --offline --locked --manifest-path src-tauri/Cargo.toml
```
