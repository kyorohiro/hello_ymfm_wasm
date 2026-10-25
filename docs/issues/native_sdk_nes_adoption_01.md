# Native SDK NES＋FDS取り込み

2026-10-25。選択中NES＋FDSと独立追加NESの共通Native接続を、同梱済みの固定SDKへ参照を切り替えた。
着手時は本体`62fc578ef346d7633f4f4f7b566e6beada8c4337`、Tauri`407a75b32f5e419fc060a569b26ced849914867b`、
SDK`affd1059599f3c7598191c14f5a864b44963d4aa`で、すべてcleanだった。Game Boy移行はこれらの基準コミットに保存済み。
今回はローカル実装・検証までで、NES差分のcommit／pushと新しいCIは未実施。
直前の全5構成成功run `40162092207`は、Game Boyも今回のNES移行も含まない。

## ビルド境界

| 用途 | SDK内のパス |
| --- | --- |
| 選択中／独立追加の共通接続と、その中のAPU／FDS移植実装 | `native/reference/tauri/native_genesis_nes.cpp` |
| 共通C ABIと公開状態 | `native/reference/tauri/native_genesis_nes.h` |

接続cpp／headerは旧コピーとbyte一致。cpp内に従来のJSNES／FDSからのC++移植実装が含まれる。
SDKの`vendor/tetorica-nes/nes_core.cpp`を追加でリンクする変更ではない。
既存の`tetorica_native_nes` archive内の1翻訳単位、C++17・O2・MSVC `/EHsc`・`-fwrapv`・`-fno-strict-aliasing`・`-ffp-contract=off`とリンク順序を保持する。
CargoはSDK接続cpp／headerを監視し、実消費元のない旧スナップショットのソース監視を外す。
旧接続、JS原典のスナップショット、`core.json`／`sources.json`等の固定記録、READMEと既存のライセンス同梱先は保持する。
旧コピーやsyncスクリプトの更新だけでは、実際にコンパイルするSDKは変わらない。

各Nativeインスタンスの64 KiB DMC RAMとFDS波形・変調表を維持し、アップロードをRAMへコピーする。
RustはDMC転送payloadの所有・予約、owner・寿命・台数・予算と回収を引き続き管理する。
既存のclock、Stop／reset・試奏、PCM、Mixer／FX、CPALとWebView／JS APIは変更しない。
SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルをそのまま使う。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK本体・取り込み記録、Browser／npmのWASMとTauriの`dist/`は変更しない。

## ローカル検証

macOS ARM64／Clang・Nodeで、音声デバイスを開かずに確認した。
旧／SDKを別々にコンパイルし、同じ入力のstdoutのbyte一致を確認してから、実配布WASMとJS参照を比較した。

| 対象 | Native入力数（suite内） | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| 選択中NES＋FDS | 72 | 710,784 | 72 | 710,784 |
| 追加NES | 81 | 784,512 | 243 | 2,353,536 |

選択中の72入力は追加側81入力の部分集合で、output rate・base clock・frame数・FDS設定・命令列SHAとPCMのSHAで重複を確認した。
延べ153入力・1,495,296フレームに対し、重複を除いた固有Native入力は81件・784,512フレーム。
追加側の各入力を3通りのWorklet block分割で比較し、実WASM比較は計315回・3,064,320フレームで差0だった。JS参照との差も0。
比較回数を固有Native入力へ加算しない。

- 接続cpp／headerは旧コピーとbyte一致し、SDK manifest・取り込み記録、旧15件のJS等の参照pinと2件のcore mirrorは変更していない。
- Tauriの既存fixtureとSDK既存の検証fixtureを旧／SDKへ実行し、rate／base clock／region境界、64 KiB入力コピーと不正RAM転送のrollback、DMCのwrap／IRQ、他声のgate操作による最終バイトのPCM・寿命保護、FDS波形／変調／I/O gate、6声のmute中の進行と声別gate分離を確認した。
- 公開state ABIは400バイト、Native本体の確保量は81,584バイト。StopのRAM／波形／clock保持、reset後の64 KiB全RAMの0読出しとclock／mute保持、観測readと独立インスタンスを確認し、render中のallocation／freeは0だった。これらは別の自己試験で、毎フレームのprivate全状態・全RAMやWASM内部状態を比較したものではない。
- 既定のSDKコンパイル経路2本と実行ファイルをinline指定する経路が成功。選択中の比較は`--wasm`を明示した。不正な`--fixture`の6形式をコンパイル前に拒否し、入力のパスとハッシュを記録した。再確認の入力は集計へ加算していない。
- 既存のメモリーコピー診断は旧／SDKの双方で転送条件とallocation／free 0を確認した。時間値の一致や速度同等は主張せず、PCM比較数へ加算していない。
- 実配布WASM SHA-256は`24d41bb34d313831ac39a24c6f07e795ee3599240686c7573feacec32f3a2c3e`。

`npm test`は31／31成功。Rust全試験は723成功・0失敗・明示実行用4件ignored。
MCPのローカルTCP bindを必要とするため、今回は初めから制限外で実行しており、sandbox内での失敗や製品修正はない。
ログは`/private/tmp/tetorica-sdk-nes-npm-test.log`と`/private/tmp/tetorica-sdk-nes-cargo-test-unrestricted.log`。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stopが成功し、runnerはexit code 0、`deviceOpened: false`。
追加音源混合試験も3混合構成・7単独音源、受入れ／16台制限で17台目の拒否が成功し、
受入れ・台数制限の双方でStop後の予約予算が0へ戻った。runnerはexit code 0、`deviceOpened: false`。
入力監査・比較集計は`/private/tmp/tetorica-sdk-nes-adoption/source-audit.json`と`parity-summary.json`、
再生レポートは`/private/tmp/tetorica-sdk-nes-stability.json`。
混合レポートは`/private/tmp/tetorica-sdk-nes-extra-stability.json`。

本体`hello_ymfm`のルートから比較する。

```sh
node scripts/check_native_nes.mjs --wasm
node scripts/check_native_extra_nes.mjs
```

同梱SDKと配布ソースの手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。
文書確定後の対応ソースZIPは全1,796ファイル、SHA-256は
`1fb6bf89c2a372abbad9190761b678ec611d944f12fabe7a0ac8f6ce8c7f0bec`。
`/private/tmp/tetorica-sdk-nes-sources.json`でSDK374ファイルを含む全22件の固定記録とZIPの照合が成功した。
着手時のマニフェストとの差分は`src-tauri/build.rs`、`README.md`、`NATIVE-SOURCES.md`、`docs/native-sdk-ym2612.md`の4ファイルのみ。
`/private/tmp/tetorica-sdk-nes-adoption/source-manifest-delta.json`に差分、同ディレクトリの`summary.json`に最終結果を集約した。
SDK取り込み記録とfrontend archiveは変更していない。ガイド自身へZIPの自己ハッシュは埋め込まない。
新しい各OSのCI、sanitizer、実機の音声出力やインストール後の起動は今回の確認に含めない。
