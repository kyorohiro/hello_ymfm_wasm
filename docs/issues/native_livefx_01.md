# QuickJS-NGを使うNative liveFx

2026-10-21。`liveFx`用のJSエンジンとしてQuickJS-NGを組み込み、
音声デバイスを使わない互換性・処理時間の検証を経て、Native Genesisの再生経路へ接続した。
Web Audioを既定とし、TauriでNative Genesisを選んだ場合に使用する。
Nativeで`liveFx`を使わない場合は、JS実行環境を作らず、JS関数も呼ばない。

## 今回の範囲

QuickJS-NGのC APIを小さなC++ホストで包み、TauriのRustから呼ぶ。
既存の`web/custom_fx.js`をハッシュ付きで取り込み、同じ`LiveFX`クラスを実行する。
独自のDSPへの書換えや、JSを最適化済みの機械語へ変換する実装ではない。
QuickJS-NGはインタープリターであり、音声処理に十分な速度かを実測する。

- 関数ソースを登録時に評価し、`process(input, output, state, context)`をブロック単位で呼ぶ。
- 名前付き最大8個、登録順、`state`の保持／`resetState`、contextの浅い部分更新を共有する。
- 入出力はCHごとのFloat32Array。長さ1〜128の分割ブロックも検証する。
- エラー・不正な出力は共有処理と同じbypassにする。エラーのstackにmessageを含めないエンジンでも理由を表示する。
- 最初の登録までVMを生成しない。最後の削除・clearでVMを解放し、未使用時のprocessはPCMをそのまま返す。
  空のrackを処理した履歴はC側で保持し、再追加時も共有の5ms fadeを維持する。
- VMは1スレッドが所有する。生成・破棄・コンパイル・GCをCPAL callbackで実行しない。
- メモリー上限とinterrupt callbackを設ける。これらは厳密な実時間の完了保証ではない。

比較対象は同期のprocessとstate／contextの契約であり、AudioWorklet固有のglobalや
ブラウザーの非同期実行環境を再現するものではない。音源の出力rateは読み取り専用の
`sampleRate`でも取得できる。DOM・タイマー・外側の変数への参照は使わない。

## Native再生への接続

音源と既存C FXのRendererは引き続きCPAL callbackが単独所有する。
`liveFx`だけをNative内の専用workerで処理する。最初の登録までworkerとVMを作らない。
最後の削除後はVMを解放し、workerは命令待ちになる。未使用時のcallbackはPCM queueを通らない。
固定queue・dry bufferの領域はセッション開始時に確保する。

```text
FM / PSG / DAC / sample / noise → C FX → [liveFx] → master → Stop/resume fade → clip → monitor / recording → device
```

- 使用中だけ2048フレームの遅延を加える。48kHzでは約42.7ms、44.1kHzでは約46.4ms。
  UIにも処理遅延を表示する。デバイス自体の遅延は別途ある。
- stereo 128フレームの固定ブロックを、入出力それぞれ最大32個のqueueで受け渡す。
  callback内でJS実行、ロック、メモリー確保・解放、処理完了の待機は行わない。
- 間に合わないブロックは同じ時刻のdry音へ戻す。欠落・復帰・最後の削除は5msで切り替え、
  別時刻の古いwet音を再生しない。追加時も先読みを満たすまでdry音を保つ。
- Main／Workerで同じ`liveFx`／`fx.updateContext`／`fx.removeLiveFx` APIを使う。
  Workerの命令には演奏session・loop owner・フレーム時刻を引き継ぐ。
  有効中の更新は128フレーム境界で適用する。最初の未来の登録はNative時計が指定時刻へ到達後に
  評価するため、デバイスcallbackの長さやOSの起床待ちも加わり、サンプル精度ではない。
- loop取消しでは未来の命令を取り消す。既に混ざったPCMをloop単位で分離しないため、
  note-off等は通常の2048フレームの処理遅延を経て聞こえる。他loopのbusを再初期化しない。
- Stopは未来の命令を無効にし、既に完成したwet音で既存の10ms fadeを終える。
  古いPCMを破棄し、worker側のVMクリアも確認してから停止を完了する。
- FX例外はConsoleへ報告して該当FXをbypassする。Native出力全体を停止したりWeb Audioへ切り替えたりしない。
  VMの時間・メモリー制限で継続不能になった場合はdryを出し、Stop／Runで再試行する。
  workerの1回の実行時間制限は50msを目安にするsoft deadlineであり、OSによる待機も含む。
  先読みの音声時間より長いので、deadlineに達する前でも間に合わない音声はdryへ退避する。
- エラー等のstatusは使用中・未来の命令がある間だけ250ms間隔、同時1件で確認する。
  通常再生のPCMをWebViewへ転送するためのpollingではない。

AudioタブのEnvelope／Waveform／Spectrumと最終出力の録音には処理後の音が入る。
FX MonitorのFX単位の入力／出力表示はNativeでは未対応と表示する。
処理の負荷やOSの状態次第でdryへの退避があり、ノイズ解消や実時間処理の完了を保証するものではない。

## contextの受渡し

現行APIは`structuredClone`を使う。JSONへの単純変換はTypedArray、循環参照、
NaN、BigIntなどを失うため、JSONで表現したオブジェクトグラフを明示的にdecodeする。
このグラフは制御用データであり、通常再生のPCMをWebViewへ往復する経路ではない。

対応するのはobject／array（疎配列を含む）、Map／Set、Date／RegExp、ArrayBuffer、
DataView／TypedArray、BigInt、undefined／NaN／Infinity／−0、循環・共有参照。
同じbufferを参照する複数のviewとbyte offsetも保持する。callerのbufferはdetachしない。
ノード数・データ量・疎配列の長さに上限を設け、`__proto__`は通常のdata propertyとして復元する。

Error、Blob／File、SharedArrayBuffer等の未対応型は明示的に拒否する。
現時点で`structuredClone`の全対応型との完全互換を主張しない。
Nativeのcontext graphは128 KiB、関数ソースは192 KiB、命令全体は256 KiB、
名前は1〜128 UTF-8 bytesまで。保留命令は合計64件、VM heapは32 MiBに制限する。
Web Audio側の`structuredClone`より対応型・量が狭いため、送信前に理由を示して拒否する。

## エンジンの由来

QuickJS-NG v0.17.0、tag commit `6d46d07d04041b40f4f49eaa7fdebe44c314c699`。
公式のamalgamated archiveを取り込み、MITライセンスと由来・SHA-256を保存する。
archive SHA-256: `a0955463c74809173a253ff87365095e6972e8b171cfb6aa8a1e781adf35cfeb`。

- [公式リリース](https://github.com/quickjs-ng/quickjs/releases/tag/v0.17.0)
- [組込み用ビルド](https://quickjs-ng.github.io/quickjs/building/)
- [C API・メモリー上限・interrupt](https://quickjs-ng.github.io/quickjs/developer-guide/intro/)
- [対応OS](https://quickjs-ng.github.io/quickjs/supported_platforms/)

## Native接続後の検証（2026-10-21）

| 検証 | 結果 |
| --- | --- |
| 実QuickJS-NGと既存JSのPCM比較 | 44.1／48／96kHz、stereo計480ブロックで最大差0。同梱singing-keyboardのformantProcessもソースをそのまま比較し、非ゼロ出力・context変更・state継続を確認。[結果JSON](native_livefx_validation_20261021.json) |
| JS関連テスト | 435件成功。Main／Worker、codec、Native adapter、診断polling、モニター、実行・取消しを含む |
| Tauri Rust全体 | 95件成功、4件ignored（資格情報2件・物理デバイス1件・任意の計測1件）。実QuickJSホスト14件と追加pipeline 14件を含む |
| 実Native Renderer | C FX → JS → masterの数値結果、同じ最終PCMの録音・monitor、入力音なしのJS生成、Stop fadeとVMクリア、owner取消し、dry退避・復帰、clear直後の再登録を確認 |
| 制約・ライフサイクル | 未使用時のVM未生成・JS呼出し0、最後の削除・再追加、read-only sampleRate、型・サイズ制限、64件の保留上限、無限loop・heap上限等9項目を確認 |
| 実ブラウザー | source上のChromium／WebKit、最終取り込み済み配布物のWebKitでMain／Worker、エラー表示、Stop、既存FM／DAC／sample／noise／FX／monitor／録音・設定を確認。Native IPCは模擬 |
| 配布物 | 789アセットを取り込み、全hash照合成功。archive SHA-256 `3dcd16893109d2008c1dde29e3cfb795f57e0b0edb18bf4d2b65709078c2f117` |
| Tauriビルド | 最終配布物取り込み後の`cargo build --offline --locked`成功。QuickJS／共有JS／codecのsnapshot照合も成功 |

物理音声デバイスは開いていない。実際の試聴・長時間安定性・元のノイズの再発確認は未実施。
PCM生成と実DSPはRust／C++で、UIからの接続は模擬IPCを使う実ブラウザーで検証している。

## オフライン試作時の検証結果

| 検証 | 結果 |
| --- | --- |
| 実QuickJS-NGと既存JSのPCM比較 | 44.1／48／96kHz、1／37／128フレームのstereo計411ブロック。最大差0 |
| ライフサイクルと互換性 | state、context、再登録、resetState、浅い部分更新、配列の差替え・復元、5ms fade、エラー時bypassを確認 |
| 未使用時 | VM未生成、JS process呼出し0、PCM不変。最後の削除後もJS呼出しを増やさず、再追加時だけVMを生成 |
| 境界検証 | 無限loop、例外の文字列変換、heap上限、Atomics.wait禁止、getter／setter、PCM buffer detach、clearと再試行の9項目成功 |
| 共有JS・Native adapter等 | Node 387件成功。新規context codecの8件と、既存liveFxの実WASMテストを含む |
| Tauri Rust | 76件成功、4件ignored。QuickJS実エンジンの9件を含む。音声デバイスは開いていない |
| 由来・取り込み | QuickJS／共有JS／codecのhash照合成功。Webアセット787件、archive SHA-256 `294c5a03fca271a8dccd55bb7d62b6b527f5101a10bd7f4f8a083a4ee647459f` |
| 配布WebKit・ビルド | 既存Main／Worker／FM／DAC／sample／FX／noise／monitor／録音／Stop・Runが成功。Native IPCは模擬。取り込み後のofflineビルド成功 |

### 処理時間

Apple M2・macOS arm64・Apple clang 17、C／C++とも`-O2`。
48kHz／stereo／128フレーム、warmup 100回の後に各4000回計測。
1ブロック分の音声時間は2.667ms。
コンパイルやJSON転送は含めず、C++内でPCMコピー・共有rack・JS実行・検証を含む経過時間を測った。
完全な測定条件・由来・値は[測定JSON](native_livefx_benchmark_20261021.json)に保存した。

| 処理 | 平均µs | P99 µs | 最大ms | 2.667ms超過／4000回 |
| --- | ---: | ---: | ---: | ---: |
| 未使用 | 0.018 | 0.042 | 0.000125 | 0 |
| gain ×1 | 85.05 | 111.63 | 0.208 | 0 |
| distortion ×1 | 91.55 | 116.71 | 0.223 | 0 |
| gain ×8 | 689.09 | 828.79 | 16.36 | 3 |
| distortion ×8 | 758.42 | 962.25 | 25.27 | 2 |

平均だけなら軽いFXは実用候補だが、この測定でも複数FXにブロック時間超過があった。
これはOSの待機等も含む経過時間であり、超過原因をGCだけに限定できない。
他の処理と並行した計測ではさらに大きい外れ値も出た。
CPAL callbackへ直接入れられる根拠や、特定長のbufferで必ず防げるという根拠にはしない。
この結果を踏まえ、実時間接続は上記の専用worker・先読み・dry退避を使う構成にした。

再実行（上流リポジトリーから、音声デバイス不要）:

```sh
node --test web/native_livefx_context.test.mjs web/custom_fx.test.mjs
node scripts/check_native_livefx.mjs --benchmark --out /private/tmp/native-livefx-result.json
```

Tauri側の照合と実エンジン検証:

```sh
python3 scripts/sync_native_genesis_livefx.py --check --source ../..
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml native_live_fx_probe
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml native_genesis
```
