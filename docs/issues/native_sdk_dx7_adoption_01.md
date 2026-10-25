# Native SDK DX7取り込み

2026-10-25。選択中DX7と独立追加DX7の共通Native接続とMSFAを、同梱済みの固定SDKへ切り替える。
着手時は本体`95bba16c8d5cc9ce4f3c3da3043c823cf7c47099`、Tauri`853d87f9aa28567eb05b89eec22e8c2348460d68`、
SDK`affd1059599f3c7598191c14f5a864b44963d4aa`で、すべてcleanだった。
Game Boy／NES＋FDSの移行と全5構成成功CI run `40168462256`の記録は、これらの基準コミットに保存済み。
同CIは今回のDX7移行を含まない。今回の作業はローカルの実装と検証で、commit／push、CI、公開は行わない。

## ビルド境界

| 用途 | SDK内のパス |
| --- | --- |
| 選択中／独立追加の共通Native接続とC ABI | `native/reference/tauri/native_genesis_dx7.cpp`と対応ヘッダー |
| MSFA共有入力24ファイル | `vendor/msfa/` |
| Native override 6ファイル | `native/reference/overrides/msfa/` |

接続cpp／headerとMSFA 30入力中29ファイルは旧コピーとbyte一致。差は下記のNative Panic修正だけ。
`src-tauri/build.rs`の`native_dx7_sources()`はSDKから
`OUT_DIR/tetorica_sdk_dx7_msfa/`へ30ファイルを編集せずにコピーし、13個のccと17個のheaderを組み立てる。
Native overrideは`dx7note.cc`、`env.cc`、`ringbuffer.cc`、`synth.h`、`synth_unit.cc`、`synth_unit.h`。
引用形式のincludeがソース隣のヘッダーを優先するため、SDK CMakeと同じprivateツリーを使う。
既存の`tetorica_native_dx7` archive内の14翻訳単位、C++17・O2・`MSFA_FORCE_SCALAR`・`_USE_MATH_DEFINES`・
MSVC `/EHsc`・`-fwrapv`・`-fno-strict-aliasing`・`-ffp-contract=off`とリンク順序を保持する。
新しいPython／CMakeのビルド依存は追加しない。

CargoはSDKのMSFA共有／overrideディレクトリと接続cpp／headerを監視し、実消費元のない旧スナップショットとローカル接続のソース監視を外す。
旧接続、`native-dx7/`の32ファイルのスナップショット、原本／修正版のハッシュ、syncスクリプトとApache-2.0のライセンス同梱先は保持する。
旧コピーや`sync_native_dx7.py`だけを更新しても、実際にコンパイルするSDKは変わらない。
SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルをそのまま使う。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK本体と取り込み記録、Browser／npmのWASM、Tauriの`dist/`は変更しない。

## 意図したNative Panicの差分

SDKのNative-only `synth_unit.cc`は、Panic時に16個の事前確保済み`Dx7Note`へ`Dx7Note{}`を値代入し、note状態とfeedback履歴を初期化する。
allocation／freeを行わず、slotオブジェクトのアドレスも保持する。placement newによるnote再構築ではない。
通常のnote-on／release／killは保持するが、Panic後の再発音には意図した差があるため、旧版との全面的なbyte一致は主張しない。
通常再生の一致と、Panic後に新規音源と同じ状態へ戻ることを別に確認する。

155バイト音色のコピー、16音のslot制御、内部44.1 kHzの生成とdevice rate変換は既存接続を使う。
Rustの音色所有・転送予約、Keyboard lease・owner、16 slotの受入れ制御と回収、PCM、Stop、Mixer／FXとWebView／JS APIはアプリ側に残る。
`native_dx7_kill_slot()`は将来のslot計算を止めるが、既に混合した最大64フレーム・prefetch・共有filterのtailは保持する従来の動作を維持する。

## ローカル検証

macOS ARM64／Clang・Nodeで、音声デバイスを開かずに確認した。
旧／SDKを別々にコンパイルし、通常再生とPanic修正の確認を分けて実配布WASMへ比較した。

| 対象 | 固有Native入力数 | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| 選択中DX7の既存再生比較 | 114 | 792,576 | 114 | 792,576 |
| 独立追加DX7の既存比較 | 21 | 239,616 | 63 | 718,848 |
| 32 algorithm × 3 rateのPanic／再発音 | 96 | 786,432 | 96 | 786,432 |
| 合計 | 231 | 1,818,624 | 273 | 2,297,856 |

既存の135入力・1,032,192 Nativeフレームは旧／SDKのstdoutがbyte一致し、双方とも実WASM最大差0。
追加側は同じNative入力を3通りのblock分割へ比較するため、Native入力数とWASM比較数を区別する。
追加checker内の選択中checker再実行、既定／fixture指定の再確認、自己試験と公開JS adapterの確認は集計へ加算していない。

新しいPanic確認はSDKと実WASMで全96入力の差0、新規インスタンスへ戻る自己試験も96／96成功。
旧版は79／96入力でSDKとの差があり、17入力は一致した。Panic前から再発音直前までは全入力が一致し、差はframe 1,403での再発音後だけに現れた。
最大差は`0.0002746583195403218`。これはSDKのfeedback履歴初期化による意図した修正で、回帰比較の失敗として扱わない。
実WASMとの全273比較・2,297,856フレームの最大差は0。
公開JS adapterは44.1／48 kHzで確認し、96 kHzは実配布WASM exportsへ同じ整数位相の出力変換を適用した比較。公開adapterが96 kHzを受け付けるという意味ではない。
実配布WASM SHA-256は`f5de761e82ea303420fb3aac79a0a59dd053773b81453b955254dd13aac77d6f`で、`web/`と`docs/`が一致した。

- Tauri既存fixtureの自己試験は旧／SDKとも成功。SDKの強化fixtureはrate境界、不正slotの無作用、保護slotとrelease tail、16音の確保、held／released音へのlive edit、voice identity分離、即時Panic無音と96回のfeedback再発音が成功した。同fixtureの新規音源一致判定は旧版で意図どおり失敗し、その判定を分けた旧版の制御試験は成功した。
- Native本体と16個の事前確保noteの合計は35,320バイト。17通りの部分生成失敗の回収、LFO／filter／resamplerの独立性、保護slot割当て、単一slot killを確認し、render／制御中のallocation／freeは0。これは自己試験であり、毎フレームのprivate全状態やWASM内部状態のdump比較ではない。
- 2本の既定checkerも固定SDKからコンパイルして成功。1 fixtureにつきSDK32ファイルとfixture側2ファイルの計34入力をディスク上のSHA-256と照合し、30個の組立入力をコンパイラーが読むことと、引用include先の両ABI headerを確認した。`--fixture`／`--out`のinline指定は成功し、不正な12形式をコンパイル前に拒否した。入力fixtureは保持した。
- 実Cargo生成物の30入力は固定SDKとbyte一致し、全32ソース入力の監視を確認した。実archiveは既存の14 objectを保持し、10個のC ABI exportは各1回だけ定義され、旧ヘッダーの混入や新しい動的ライブラリー指示はなかった。記録は`build-assembly-audit.json`。
- SDKの版・取り込み記録と、旧32件のスナップショットpin・原本／修正版のハッシュ・ライセンスは変更していない。

`npm test`はPython 22件・Node 31件が成功。Rust全試験は723成功・0失敗・明示実行用4件ignored。
MCPのローカルTCP bindを必要とするため、今回は初めから制限外で実行し、sandbox内での失敗や製品修正はない。
ログは`/private/tmp/tetorica-sdk-dx7-npm-test.log`と`/private/tmp/tetorica-sdk-dx7-cargo-test-unrestricted.log`。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stopが成功し、runnerはexit code 0、`deviceOpened: false`。
追加音源の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否も成功し、受入れ・台数制限の両方でStop後の予約予算が0へ戻った。
混合runnerもexit code 0、`deviceOpened: false`。レポートは`/private/tmp/tetorica-sdk-dx7-stability.json`と`/private/tmp/tetorica-sdk-dx7-extra-stability.json`。
ソース監査・比較集計・自己試験は`/private/tmp/tetorica-sdk-dx7-adoption/`の`source-audit.json`、`parity-summary.json`、`self-tests.json`へ保存した。

本体`hello_ymfm`のルートから比較する。

```sh
node scripts/check_native_dx7.mjs
node scripts/check_native_extra_dx7.mjs
```

同梱SDKと配布ソースの手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。
文書確定後の対応ソースZIPは全1,796ファイル、SHA-256は
`a0869853f65bce864ab7dec114a85e4ac4f58d4064054b14159028efb9d755a8`。
`/private/tmp/tetorica-sdk-dx7-sources.json`でSDK374ファイルを含む全22件の固定記録とZIPの照合が成功した。
着手時のマニフェストとの差分は`src-tauri/build.rs`、`README.md`、`NATIVE-SOURCES.md`、`docs/native-sdk-ym2612.md`の4ファイルのみ。
`/private/tmp/tetorica-sdk-dx7-adoption/source-manifest-delta.json`に差分、同ディレクトリの`summary.json`に最終結果を集約した。
SDK取り込み記録とfrontend archiveは変更していない。ガイド自身へZIPの自己ハッシュは埋め込まない。
今回の各OSのCI、sanitizer、実機の音声出力・ノイズ・UI操作やインストール後の起動は未確認。リアルタイム期限や処理速度の保証もこの比較範囲に含まない。
