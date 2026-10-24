# Native SDK AY-3-8910取り込み

2026-10-25。Playground Tauriの共有AYコアと独立追加接続を、同梱済みの固定SDKからビルドするようにした。
MSX／MSX Audioの機種用接続、選択中AYのレート変換とRust側の制御・混合は維持する。
着手時は本体`4137e903...`、Tauri`4451195...`、SDK`affd1059...`ですべてcleanだった。
今回の差分は未コミットで、OPL接続移行と今回のAY移行を含む5構成CIは未実行。

## ビルド境界

Tauriの`src-tauri/build.rs`が参照するSDK内のパスは次のとおり。

| 用途 | SDK内のパス |
| --- | --- |
| MSX／MSX Audioと独立追加AYに共通のコア | `vendor/mame-ay8910/ay8910.cpp`／`.h` |
| `createSoundChip('ay8910')`の独立接続 | `native/reference/tauri/native_genesis_ay8910.cpp`／`.h` |

4ファイルすべて旧コピーとbyte一致。独立接続は引用includeでSDK側のC ABIヘッダーを解決する。
ローカルの`src/native_genesis_msx.cpp`はSDKのAYヘッダーを解決し、従来のAYレート変換と
`NativeOpllCore`を保持する。独立追加AYは別のtick／レート変換を持ち、両者を統合しない。
既存の`tetorica_native_msx` archive内でAYコアを一度だけコンパイルし、
C++14・O2・MSVC `/EHsc`とGNU ld向けの依存順序を維持する。
共有OPL／PCM／ADPCM providerを追加で複製しない。

SDKの`vendor/mame-ay8910/`と独立接続cpp／headerをCargoの監視対象にする。
ローカルの機種用接続とOPLL helperの監視は継続し、コンパイル入力のなくなった旧`native-msx/`のソース監視は外した。
旧コピー、Browser比較用固定記録、syncスクリプトと同梱AYライセンスの参照先は保持する。
旧syncスクリプトの実行だけでは、実際にコンパイルするSDKは更新されない。

SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルをそのまま使う。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
同梱SDK・取り込み記録、Browser／npmのWASM、Tauriの`dist/`は変更していない。
Rustの予約・owner・寿命・予算・回収、CPAL、Mixer、FX／liveFx、WebView／JS APIも変更していない。

## ローカル検証

macOS ARM64／Clangで実施。音声デバイスは開かず、実機での聴感確認や締切保証とは区別する。

| 対象 | ケース | フレーム | 結果 |
| --- | --- | --- | --- |
| 選択中MSXのAY／OPLL出力 | 93 | 571,392 | 旧／SDKがbyte一致、実WASM最大差0 |
| 独立追加AYのPCM／公開状態 | 114 | 466,944 | 同上 |
| Native公開状態の別比較 | 6 | 24,576 | 104／24バイトの状態全体とPCM、毎フレーム16個のAY readが一致 |
| 共通fixtureの追加YM2413回帰 | 558 | 2,285,568 | SDKの既定ビルドで実WASM最大差0 |

移行比較は計207ケース・1,038,336フレーム。旧／SDK両方のfixtureへ同じ命令を入力し、
stdoutの完全一致を確認してから実配布のWASM Workletと比較した。
44.1／48／96 kHzで、3音tone、全tone／noise混合、全16 envelope形状、period境界、
clockのhold／平均化、明示的な音量0、保持したレベルでのStop／reset／再試奏、
I/O readとOPLLの独立制御を確認した。
既定ビルドも成功し、実際にコンパイルしたcppのパスとSHA-256を記録した。その再確認分は二重加算しない。
追加YM2413回帰は共有checkerのコンパイル入力変更に対する確認で、AYの旧／SDK比較には数えない。

Native状態比較は公開snapshotとread・PCMの比較で、非公開コア全メモリーやWASM内部状態のdumpではない。
旧／SDKのfixture自己試験も成功し、callback操作中のallocation／freeは0だった。

- Rust全試験：723成功、0失敗、明示実行用4件ignored。
- 再生ライフサイクル：22 mode、604,032フレーム、88 Run／Stop遷移が成功。MSX／MSX Audioを含む。
- 追加音源の混在：3混合構成、7単独音源、受入れ／16台制限、Stop後の予算回収が成功。
- 両report runnerはexit code 0、`deviceOpened: false`。
- SDK374ファイルのオフライン照合が成功。

本体からの再確認は次のとおり。

```sh
node scripts/check_native_msx.mjs
node scripts/check_native_extra_ay8910.mjs
node scripts/check_native_extra_ym2413.mjs
```

選択中checkerと、追加AY／YM2413の共通checkerは今回からSDKのAY入力を使う。
既存の`--fixture`で旧／SDK比較用実行ファイルも注入できる。
Cargo、再生・混合、ソース配布の手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)にある。

集計・入力監査・旧／SDK fixture・公開状態比較は`/private/tmp/tetorica-sdk-ay8910-adoption/`、
Rustログは`/private/tmp/tetorica-sdk-ay8910-cargo-test.log`、
再生／混合reportは`/private/tmp/tetorica-sdk-ay8910-stability.json`と
`/private/tmp/tetorica-sdk-ay8910-extra-stability.json`。
一時ファイルが消えても、既定checkerと既存Rust試験でSDKの動作は再確認できる。

先行する5構成CI run `40137093552`は共有OPL providerまでの移行に対するもので、
後続のOPL接続／今回のAY移行を含まない。新しい各OSのCIと実機の音声出力は未確認。

最終文書を含む対応ソースZIPは全1,796ファイル、SHA-256は
`cf24143b1449028742ff4e8490d63e5b5d66dc272f29cf87509c90164b1fc54a`。
ソース照合結果は`/private/tmp/tetorica-sdk-ay8910-sources.json`。
ZIP内文書へ自身のハッシュを埋め込まず、本体側の本記録で保持する。
