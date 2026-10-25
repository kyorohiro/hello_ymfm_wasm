# Native SDK Sega PSG取り込み

ローカル移行は本体`1da2fb00...`、Tauri`51dca52...`へコミット済み。
RF5C164移行と合わせた5構成CIの確認は[RF5C164取り込み記録](native_sdk_rf5c164_adoption_01.md)で追跡する。
以下の未コミット・CI未実行の記述はローカル検証終了時点の履歴。

2026-10-25。Playground TauriのSega PSG共通コアとraw C APIを、同梱済み固定SDKからビルドするようにした。
Genesis／Mega CD／32X系、Game Gear／Master Systemと追加生成PSGが同じコアを共有する。
機種用接続・レート変換・音量・混合をSDKへ移す変更ではない。

着手時の本体は`29b9b885...`、Tauriは`842245ddf060fedaeb42e6b01d30175b488816b7`。
本体とSDKはcleanで、Tauriには前回の5構成CI成功を記録したガイドのステージ済み差分だけがあった。
この内容とGit indexを保持し、今回の変更は作業ツリーへ追加している。
今回の移行は未コミットで、このPSG参照切替を含む新しい5構成CIは未実行。

## ビルド境界

| 用途 | SDK内のパス |
| --- | --- |
| Genesis等が使うraw C API | `wasm/segapsg_wasm.cpp` |
| 全接続が共有するPSGコア | `vendor/ymfm/segapsg.cpp`／`.h` |
| 同一ビルド内の状態直列化 | `vendor/ymfm/chip_state.h` |

4ファイルすべて旧コピーとbyte一致。SDKのC APIとコアを既存の`tetorica_native_genesis` archive内で一度だけコンパイルする。
Game GearのincludeもSDKを優先し、Master Systemは既存のSDK優先順を維持する。
C++14・O2・MSVC `/EHsc`とGNU ld向けのarchive順序は変更しない。

`src/native_genesis_core.cpp`のGenesis／Nuked側のレート変換・DC・gain・混合、
ローカル`NativePsgCore`とGame Gear／Master Systemの機種用接続は維持する。
追加PSGは既存の独立したGame Gear用経路を使い、Rustのowner・予約・予算・回収も維持する。
SDKのGame Gear機種用ターゲット全体を取り込む変更ではない。

既存のSDK ymfm／wasmディレクトリ監視が実入力を覆う。
旧`native-genesis/`にはFX／noise等の共通ヘッダーも残るため監視を維持する。
原典、ライセンス、旧ソースとsyncスクリプトは保持する。旧コピーの更新だけでは実際のSDKビルドは更新されない。

SDKは引き続き`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイル。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK本体・取り込み記録、Browser／npmのWASM、Tauriの`dist/`は変更していない。

## ローカル検証

macOS ARM64／Clangで音声デバイスを開かずに実施した。
まず旧／SDK fixtureに同じ命令を入力し、stdoutの完全一致を確認してから実配布WASMと比較した。

| 対象 | ケース | フレーム | 実WASMとの最大差 |
| --- | --- | --- | --- |
| Game Gear／追加PSGの共通接続 | 69 | 454,656 | 0 |
| Master System | 63 | 387,072 | 0 |
| Nuked＋PSG | 222 | 1,363,968 | `2.9802322387695312e-8` |
| Genesis＋PSG | 6 | 49,152 | `3.725290298461914e-9` |
| 合計 | 360 | 2,254,848 | |

旧実装とSDKのバイナリー出力は全ケースで完全一致した。
混合FMのWASMとの差は旧実装でも同じ丸め誤差で、今回増えた差分ではない。
44.1／48／96 kHz、tone／noise、stereo、clockのhold／平均化、Stop／reset／再試奏を確認した。
Game GearとMaster Systemには、明示的なattenuation `0`（最大音量）をStop／key-off後も保持する比較を追加した。
attenuation `15`の消音と区別する。
Genesisは既存の短い6比較で、連続60秒の比較を今回追加実行したものではない。

4つの既定コンパイル経路もSDK入力から成功し、実際のcppパスとSHA-256を記録した。
その再確認分は上表へ二重加算しない。
Game Gear／Master System／Nukedのfixture自己試験では、公開状態・独立インスタンス・callback中のallocation／freeゼロも確認した。
Genesis専用fixtureについて新しいallocation監査を追加したという主張はしない。

raw C APIの別比較では、6ケース・36,864フレームでPCMと全40バイトの直列化フィールドが一致した。
save／load、入力サイズ拒否、reset、mute／stereoと複数の初期clockを含む。
同一ビルド内のNative同士の比較であり、非公開オブジェクト全体やWASM内部状態のdumpではない。
状態APIは一時vectorを確保するため、この操作をcallbackで割当てゼロとするものではない。

Rust全試験は723成功、0失敗、明示実行用4件ignored。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stop遷移が成功し、runnerはexit code 0、`deviceOpened: false`。
追加音源の混合試験も3混合構成・7単独音源、受入れ／16台制限と17台目拒否、Stop後の予約予算0への回収が成功した。
混合runnerもexit code 0、`deviceOpened: false`。

本体からの再確認は次のとおり。

```sh
node scripts/check_native_game_gear.mjs
node scripts/check_native_master_system.mjs
node scripts/check_native_nuked.mjs
node w/tetorica-fm2612-playground-tauri/scripts/check_native_genesis_core.mjs .
```

Genesis checkerにも`--fixture`注入を追加した。今回sanitizerは実行していない。
移行比較の集計は`/private/tmp/tetorica-sdk-segapsg-adoption/parity-summary.json`、
状態比較は同ディレクトリの`raw-state-migration.json`、ソース監査は`source-audit.json`。
Rust／再生／混合は`/private/tmp/tetorica-sdk-segapsg-{cargo-test.log,stability.json,extra-stability.json}`。
一時ファイルが消えても、既定checkerとTauriの既存Rust試験でSDKの動作は再確認できる。

ビルド境界・通常の検証・固定SDK更新はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。
先行する5構成CI run `40143851548`は今回のPSG移行を含まない。実機の音声出力・聴感確認も別の確認。

最終文書とchecker／ビルド入力を含む対応ソースZIPを再生成し、全1,796ファイルとSDK374ファイルを含む22件の固定記録を照合した。
ZIP SHA-256は`c718713666283b34c8aa79ecdbf03d4f3760810877ad92cb44c43d21397cf875`。
結果は`/private/tmp/tetorica-sdk-segapsg-sources.json`。ZIP内文書には自身のハッシュを埋め込まない。
先行CIのガイド更新だけを含む旧ZIP `ff6d69a7...`とは異なり、今回のビルド参照切替も含む。
