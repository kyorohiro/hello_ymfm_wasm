# QuickJS-NGを使うNative liveFxの試作

2026-10-21。`liveFx`用のJSエンジンとしてQuickJS-NGを組み込み、
まず音声デバイスに接続しない実行・互換性・処理時間の検証を行う。
Nativeで`liveFx`を使わない場合は、JS実行環境を作らず、JS関数も呼ばない方針。

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

この段階ではPlaygroundのNative音声経路へ接続せず、Nativeの`liveFx`未対応表示も維持する。
現在のNative音源・FX・clock・録音・モニター・Stopは変更しない。
試作の成功と、演奏中に安全に使えることは分けて扱う。
比較対象は同期のprocessとstate／contextの契約であり、AudioWorklet固有のglobalや
ブラウザーの非同期実行環境を再現するものではない。

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
これはオフラインprobeの形式であり、公開APIの新たな制限として導入したものではない。

## エンジンの由来

QuickJS-NG v0.17.0、tag commit `6d46d07d04041b40f4f49eaa7fdebe44c314c699`。
公式のamalgamated archiveを取り込み、MITライセンスと由来・SHA-256を保存する。
archive SHA-256: `a0955463c74809173a253ff87365095e6972e8b171cfb6aa8a1e781adf35cfeb`。

- [公式リリース](https://github.com/quickjs-ng/quickjs/releases/tag/v0.17.0)
- [組込み用ビルド](https://quickjs-ng.github.io/quickjs/building/)
- [C API・メモリー上限・interrupt](https://quickjs-ng.github.io/quickjs/developer-guide/intro/)
- [対応OS](https://quickjs-ng.github.io/quickjs/supported_platforms/)

## 音声接続の次段階

CPAL callbackは現在Rendererを単独所有し、最終PCMの生成・録音・モニターまで行う。
`liveFx`がある間だけRendererを別スレッドへ移す方法では、切替時の音源状態と時刻の引継ぎが難しい。
Native内の専用処理スレッド・先読みbufferを使う設計では、次を決める必要がある。

- 全体をNative生成スレッド＋出力ringに統一するか、JS部分だけを任意の後段workerにするか。
- 前者は未使用時もringとスレッドを使う。後者はJS有効時の遅延と、追加・削除時の切替が必要。
- 音声callbackはJSの完了を待たず、未処理・古いsessionのPCMを出力しない。
- Stopのfade完了と古いwet PCMの破棄、最終出力の録音／モニターを同じ時刻で扱う。

まず今回の実測から、対応できるFXの重さと必要な先読み量を判断する。

## 検証結果

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
Nativeへの実時間接続は専用処理スレッド・先読み・期限超過時の出力を設計する次段階とする。

再実行（上流リポジトリーから、音声デバイス不要）:

```sh
node --test web/native_livefx_context.test.mjs web/custom_fx.test.mjs
node scripts/check_native_livefx.mjs --benchmark --out /private/tmp/native-livefx-result.json
```

Tauri側の照合と実エンジン検証:

```sh
python3 scripts/sync_native_genesis_livefx.py --check --source ../..
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml native_live_fx_probe
```
