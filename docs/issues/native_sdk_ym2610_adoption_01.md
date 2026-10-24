# Playground TauriへのNative SDK取り込み — YM2610／YM2610B

作業日: 2026-10-25。
作業場所: `w/tetorica-fm2612-playground-tauri/`。

Neo GeoのYM2610（FM 4CH）／YM2610B（FM 6CH）と、それぞれの
`createSoundChip()`追加音源の共通接続を、同梱済みの固定SDKへ切り替えた。
基準となるTauriコミットは`53ab3d2719b22ff01acc97ff3477e97dfd16ba39`（YM2608移行）。
今回の変更はこのコミット後の未コミット差分で、commit／push／公開／Actions実行は行っていない。

## 変更した範囲

- Tauriの`src-tauri/build.rs`で、共通接続を
  `vendor/tetorica-soundchip-native/native/reference/tauri/native_genesis_ym2610b.cpp`からビルドする。
  SDKのymfm／wasm includeとSDK側cpp／headerの再ビルド監視を使う。
- 従来の`native-ym2610b`には実行時の素材消費元がなく、旧コピーの監視をSDK側へ置き換えた。
  旧ソースとBrowser比較用スナップショット・ハッシュは由来の記録として保持する。
- 共通OPN／SSG／ADPCM providerはSDK側のものを一度だけコンパイルする。
  既存のarchive順序、C++14／O2／MSVC EHscを保持する。
- 本体の`scripts/check_native_ym2610b.mjs`も既定ビルドをSDKへ切り替え、
  使用した5つのcppのパス／SHA-256を記録する。
  追加音源用checkerへの委譲、`--fixture`とFM 4CH／6CHの指定は保持する。
- TauriのREADME、SDKガイド、再ビルド手順、YM2610B原典のREADMEを更新した。

SDK版は`0.1.0`、元コミットは`affd1059599f3c7598191c14f5a864b44963d4aa`、
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK全374ファイルと取り込み記録は変更していない。
通常のビルドに別SDK checkout、submodule、音源ソースのダウンロードは不要。

選択中音源はADPCM-A／B各16 MiBの連続したROMバンクを所有する。
追加音源は同じ論理アドレス空間へ64 KiBの不変ページを公開する構成で、
Rustが変更ページの複製、所有・寿命、予算、公開予約と回収を担当する。
SDKはページを借用し、指定フレームでのポインター適用を既存のホストから受ける。
このROM管理、変種の選択、Rustのowner制御、Mixer／FX、JS APIは変更していない。

## ローカル検証

macOS ARM64、Clangで実施。音声デバイスは開いていない。

| 対象 | 結果 |
| --- | --- |
| SDKの固定内容 | 374ファイルのオフライン照合成功 |
| ソースの差分 | ヘッダー／interface 8組がbyte一致。cppの差は説明コメント1行のみ |
| 選択中音源の移行前後と実WASM | 72ケース、442,368フレーム。旧／SDKのPCMがbyte一致し、WASMとの差分0 |
| 追加音源の移行前後と実WASM | 504ケース、3,096,576フレーム。PCM／status／statusHi／IRQ／4 readがbyte一致し、WASMとの差分0 |
| Native状態・ROM比較 | 12ケース、98,304フレーム。524／536バイトの状態形式、PCM／read、256バイトのROM観測が一致 |
| 更新したcheckerの既定ビルド | 選択中／追加音源の両方で実際のSDKをコンパイルし、WASM比較成功 |
| Cargo | 723成功、0失敗、明示実行用4件ignored |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源の混在 | 3混合構成、7単独音源、受入れ／台数制限の試験が成功 |
| 配布ソース | SDKを含む22件の固定記録と、最終ソースZIP全1,796ファイルをオフライン照合 |

両変種を含む固有PCM比較は計576件、3,538,944フレーム。
既定ビルドでの再確認を二重加算せず、Native状態比較も別集計としている。
ROM観測は1フレームあたり256バイトで、32 MiB全域の毎フレーム比較ではない。
Native状態の一致を、WASM内部状態の一致と解釈しない。

44.1／48／96 kHzで、FMの物理4CH／6CH、全アルゴリズム、SSG tone／noise／envelope、
ADPCM-A 6声とADPCM-B、A/Bの独立した重複アドレス・ROM終端・部分差し替え・clear、
疎なページ境界、clock、timer／status／IRQ／read、Stop／resetを比較した。
既存のSDK fixtureは、両変種のROM所有・分離、Stop／再試奏、CSM／キャンセルと
callback中のallocation／freeがゼロであることも確認する。
Native probeでは保持した旧ページ内容が音源インスタンスの破棄後まで変更されないことも確認した。

結果は`/private/tmp/tetorica-sdk-ym2610-adoption/summary.json`、
Rust試験は`/private/tmp/tetorica-sdk-ym2610-cargo-test.log`、
再生／混合は`/private/tmp/tetorica-sdk-ym2610-stability.json`と
`/private/tmp/tetorica-sdk-ym2610-extra-stability.json`に保存した。
一時ファイルが消えても、既定checkerとTauriの既存試験から再確認できる。
更新手順はTauriの[Native SDKの取り込み](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。

Tauriの最終文書を含めて対応ソースZIPを再生成し、checkout／マニフェスト／ZIPを照合した。
ZIP SHA-256は`d8930453ce6121b6ba63276c38a5b955c05360abe8a4a1b9eb140db3f4a1b502`。
結果は`/private/tmp/tetorica-sdk-ym2610-sources.json`に保存した。

## 残る確認

今回のYM2610／YM2610B変更を含むコミットでの各OSのCIと、インストール後の実機音声は未確認。
`v0.90.2+test`の5構成成功は、先行するYM2612移行コミットに対する結果。
広域benchmarkの参照切替や、OPM／OPL等の別の接続のSDK取り込みは別作業。
