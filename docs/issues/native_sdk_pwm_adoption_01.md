# Native SDK 32X PWM取り込み

2026-10-25。32X／32X Nukedの選択中PWMと独立追加生成が使うNative接続を、同梱済みの固定SDKへ切り替えた。
着手時は本体`88049cad60d243853a6e739116d01d15c0a50152`、
Tauri`66004f00e66e7dba2394777cd281f7feeec46da0`、SDK`affd1059599f3c7598191c14f5a864b44963d4aa`で、すべてcleanだった。
今回はローカル検証まで。今回の差分のcommit／push、PWM移行を含むCIは未実施。
直前の全5構成成功run `40148943609`はPSG／RF移行の確認であり、このPWM参照切替を含まない。

## ビルド境界

| 用途 | SDK内のパス |
| --- | --- |
| 選択中／独立追加PWMに共通のNative接続 | `native/reference/tauri/native_genesis_pwm.cpp`／`.h` |
| FIFO・routing・timer・PCM生成のヘッダー実装 | `wasm/pwm32x_core.h` |

3入力は従来のTauriコピーとbyte一致する。
既存の`tetorica_native_pwm` archive内で接続をコンパイルし、C++17・O2・MSVC `/EHsc`と`-ffp-contract=off`、リンク順序を維持する。
SDK接続は自身のC ABIヘッダーと、SDKのwasm include先にあるコアヘッダーを使う。
SDK接続cpp／headerと既存のSDK wasmディレクトリを監視し、旧ローカル接続・スナップショットは原典・比較用として保持する。

SDKの接続は既存のFIFOと保持出力のsource tagを引き継ぎ、選択中／追加生成の両方で使う。
Rust側の書込み予約、owner・寿命・台数・予算管理、Stop／resetと試奏の呼出し、Mixer／FX、CPAL、WebView／JS APIは維持する。
新しい機種APIやサンプル転送方式を追加する作業ではない。
旧コピーやsyncスクリプトの更新だけでは、実際にコンパイルするSDKは変わらない。
旧スナップショットと、`sources.json`が固定する`snapshot/third_party/mame-32x-pwm/README.md`等の原典・ハッシュ記録を保持する。
今回は`src-tauri/native-pwm/README.md`自体も変更しない。

SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルをそのまま使う。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK本体・取り込み記録、Browser／npmのWASM、Tauriの`dist/`は変更しない。

## ローカル検証

macOS ARM64／Clang・Nodeで音声デバイスを開かずに実施した。
旧／SDKを別にコンパイルし、同じ命令列のstdoutがbyte一致することを確認してから実配布WASMとJS参照を比較した。

| 対象 | 固有Native命令列 | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| 選択中PWM | 57 | 466,944 | 57 | 466,944 |
| 追加PWMとコア単体 | 75 | 444,672 | 225 | 1,334,016 |
| 合計 | 132 | 911,616 | 282 | 1,800,960 |

追加側の同じ75命令列を3通りのWorklet block分割で比較したため、282件を固有命令列の数とは扱わない。
固有132件のうち129件が公開C ABI、3件・18,432フレームは従来コア単体のDAC／mute設定の確認。
公開Native接続の設定を増やす変更ではない。旧／SDKは完全一致し、実WASM／JS参照との差はすべて0だった。
2つの既定SDKコンパイル経路も成功したが、この再確認分は集計に加えない。

Tauriの既存fixtureと、境界・tag試験を含むSDK既存の検証fixtureを旧／SDKの両方に実行した。
constructor境界・初期値、不正なFIFO状態のrollback、64ビットsource tagの寿命と取り消し、独立インスタンス、
観測read、Stopでのrouting／cycle／clock保持とresetを確認した。
追加側の公開state ABIは96バイト、coreの確保量は168バイト。render中のallocation／freeは0だった。
状態・tagの自己試験はPCM命令列比較と別であり、毎フレームのprivate全状態dumpやWASM内部状態の比較ではない。

- ソース3入力のbyte一致を確認済み。`source-audit.json`でSDKマニフェスト・取り込み記録・従来の固定記録が不変。
- `npm test`は31／31成功。
- 制限外のRust全試験は723成功・0失敗・4件ignored。初回sandbox内は721成功・2失敗・4件ignoredで、2件はMCPのローカルTCP bindの`Operation not permitted`だった。製品を修正せず制限外で再実行した。
- 再生ライフサイクルは22 mode、604,032フレーム、88 Run／Stopが成功。
- 既存の追加音源混合試験は3混合構成・7単独音源、受入れ／16台制限で17台目の拒否が成功。受入れ・台数制限の両試験でStop後の予約予算は0へ戻った。
- 再生／混合の両runnerはexit code 0、`deviceOpened: false`。sanitizer、各OSのCIと実機の音声確認は実施していない。

入力監査と集計は`/private/tmp/tetorica-sdk-pwm-adoption/source-audit.json`、`parity-summary.json`。
ホストのログとreportは`/private/tmp/tetorica-sdk-pwm-npm-test.log`、
`/private/tmp/tetorica-sdk-pwm-cargo-test-unrestricted.log`、`/private/tmp/tetorica-sdk-pwm-stability.json`、
`/private/tmp/tetorica-sdk-pwm-extra-stability.json`。

比較コマンドはそれぞれのリポジトリから実行する。

```sh
# Playground Tauriのルート
node scripts/check_native_pwm.mjs --source /path/to/hello_ymfm

# 本体hello_ymfmのルート
node scripts/check_native_extra_pwm.mjs
```

同梱SDKと対応ソースZIPの手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。
文書・checker確定後の対応ソースZIPは全1,796ファイル、SHA-256は
`519b7c8853903f5bb34e33f3be201baa7cdf8e7bcddf1c831b4f0ff795fe07f3`。
`/private/tmp/tetorica-sdk-pwm-sources.json`で、全22件の固定記録・SDK374ファイル・ZIPの照合が成功した。
着手時の対応ソースマニフェストとの差は、Tauriの`src-tauri/build.rs`、`scripts/check_native_pwm.mjs`、
README、NATIVE-SOURCES、取り込みガイドの5ファイルだけ。`source-manifest-delta.json`に記録した。
ガイド自身へZIPの自己ハッシュは埋め込んでいない。

選択中checkerの`--fixture`は、空・欠落・次が別フラグの場合に自己コンパイル前に拒否する。
通常の2つのSDKビルド経路と有効なfixture指定も再確認し、比較数へ重複加算していない。
各checkerは、製品のSDK入力に加えてfixtureが読むローカルC ABIヘッダーのハッシュも記録する。
引数検証の根拠は`invalid-fixture-options.json`、全体の集計は同ディレクトリの`summary.json`。
今回の各OSのCI、インストール後の起動、実機の音声・ノイズ確認は未実施。
