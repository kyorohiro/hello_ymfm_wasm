# Playground TauriへのNative SDK取り込み — YM2203

作業日: 2026-10-25。
作業場所: `w/tetorica-fm2612-playground-tauri/`。

YM2612のSDK移行が5構成のCIを通過した後、PC-98のYM2203と
`createSoundChip('ym2203')`のコンパイル元も、同梱済みの固定SDKへ切り替えた。
基準となるTauriコミットは`9ef583e8e7fa9e75546b24dd89e119dab7d412c6`。
今回の変更はこのコミット後の未コミット差分で、commit／push／公開は行っていない。

後続作業時の追記: ユーザーがTauri側を`16610b0eb1acd99f8c002111b8cda1db777936e8`としてコミット済み。
本体側のcheckerと作業記録は別リポジトリのため、Tauri側のコミットだけで保存済みとは判断しない。

## 変更した範囲

- Tauriの`src-tauri/build.rs`で、YM2203の接続を
  `vendor/tetorica-soundchip-native/native/reference/tauri/native_genesis_ym2203.cpp`からビルドする。
- SDKのymfm／wasm includeと、SDK側YM2203のcpp／headerの再ビルド監視を使う。
- 共通OPN／SSG／ADPCM providerはYM2612移行時からSDK側を一度だけコンパイルしている。
  YM2203用に追加せず、既存のstatic archive順序、C++14／O2／MSVC EHscを保持する。
- 本体の`scripts/check_native_ym2203.mjs`も既定のコンパイル元をSDKへ切り替え、
  使用した5つのcppファイルのパス／SHA-256を記録する。
  `check_native_extra_ym2203.mjs`にも反映され、既存の`--fixture`指定は使える。
- TauriのREADME、Native SDK取り込みガイド、再ビルド手順とYM2203原典のREADMEを更新した。

SDK版は`0.1.0`、元コミットは`affd1059599f3c7598191c14f5a864b44963d4aa`、
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK全374ファイルと取り込み記録自体は更新していない。
通常のビルドに隣接SDK checkout、submodule、音源ソースのダウンロードは不要。

PC-98用と追加生成用は、同じ接続コードの`create`／`create_extra`で異なるreset／resampler境界を持つ。
FM 3声＋SSG 3声、モノラルの左右出力、Mute、保持音量、Stop／再試奏、CSM制御をそのまま使う。
Rustの予約・owner・追加生成の管理、出力、Mixer／FX、JS APIは今回の切替対象外。
従来のローカル接続コピーとBrowser比較用の原典記録は保持する。

## ローカル検証

macOS ARM64、Clangで実施。音声デバイスは開いていない。

| 対象 | 結果 |
| --- | --- |
| SDKの固定内容 | 374ファイルのオフライン照合成功 |
| ソース／ヘッダー | 接続と推移的なincludeの9組が同一 |
| PC-98用の移行前後と実WASM | 186ケース、1,142,784フレーム。旧／SDKの出力がbyte一致し、WASMとの差分0 |
| 追加生成用の移行前後と実WASM | 195ケース、1,198,080フレーム。同じくbyte一致し、WASMとの差分0 |
| 完全な状態取得 | 6ケース、49,152フレーム。280バイトの状態、PCM、status／IRQ／4 readが一致 |
| 更新したcheckerの既定ビルド | PC-98用／追加生成用ともSDKをコンパイルし、実WASMとの比較成功 |
| Cargo | 723成功、0失敗、明示実行用4件ignored |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源の混在 | 3混合構成、7単独音源、受入れ／台数制限の試験が成功 |
| 配布ソース | SDKを含む22件の固定記録と、対応ソースZIP全1,796ファイルをオフライン照合 |

音声比較の固有ケースは計381件、2,340,864フレーム。
既定ビルドでの再確認をこの合計へ二重加算していない。完全な状態取得の試験も別集計。
比較は44.1／48／96 kHzで、FM全アルゴリズム、SSGのtone／noise／envelope、
clock／prescaler、周波数ラッチ、CH3特殊／CSM、timer／status／IRQ／read、
Mute、Stop、reset、再試奏などを含む。

結果の詳細は`/private/tmp/tetorica-sdk-ym2203-adoption/summary.json`、
Rust試験は`/private/tmp/tetorica-sdk-ym2203-cargo-test.log`、
再生／混合のレポートは`/private/tmp/tetorica-sdk-ym2203-stability.json`と
`/private/tmp/tetorica-sdk-ym2203-extra-stability.json`に保存した。
一時ファイルが消えても、既定checkerとTauriの既存試験から再確認できる。

Tauriの最終文書を含めて対応ソースZIPを再生成し、マニフェストとcheckout／ZIP双方を照合した。
ZIPのSHA-256は`663040e559cec8eba1fd4d63acf9d8c078c72ce7da1ae5272e03bb12b3a6a5e0`。
結果は`/private/tmp/tetorica-sdk-ym2203-sources.json`に保存した。

再ビルド・更新手順はTauriの[Native SDKの取り込み](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。

## 残る確認

今回のYM2203変更を含むコミットでのWindows／Linux／各MacのCIと、インストール後の実機音声は未確認。
`v0.90.2+test`の5構成成功は、この変更より前のYM2612移行コミットに対する結果。
他音源の接続のSDK取り込みは別作業で、次の候補はYM2608、その後YM2610B。
