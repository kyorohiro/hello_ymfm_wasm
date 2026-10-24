# Playground TauriへのNative SDK取り込み — YM2608

作業日: 2026-10-25。
作業場所: `w/tetorica-fm2612-playground-tauri/`。

YM2612、YM2203に続き、PC-98のYM2608と`createSoundChip('ym2608')`の
コンパイル元を同梱済みの固定SDKへ切り替えた。
基準となるTauriコミットは`16610b0eb1acd99f8c002111b8cda1db777936e8`（YM2203移行）。
今回の変更はこのコミット後の未コミット差分で、commit／push／公開／Actions実行は行っていない。

## 変更した範囲

- Tauriの`src-tauri/build.rs`で、YM2608接続を
  `vendor/tetorica-soundchip-native/native/reference/tauri/native_genesis_ym2608.cpp`からビルドする。
  SDKのymfm／wasm includeと、SDK側cpp／headerの再ビルド監視を使う。
- 共有OPN／SSG／ADPCM providerは既にSDK側を一度だけコンパイルしているため、
  YM2608用に重複追加しない。static archive順序とC++14／O2／MSVC EHscを保持する。
- Rustが読み込むRhythm ROMは
  `src-tauri/native-ym2608/snapshot/web/tetorica_ym2608_adpcm_rom.bin`のまま。
  実際の消費元があるため、`native-ym2608`ディレクトリの再ビルド監視も残す。
- 本体の`scripts/check_native_ym2608.mjs`も既定のコンパイル元をSDKへ切り替え、
  使用した5つのcppのパス／SHA-256を記録する。
  追加生成用checkerにも反映され、`--fixture`の明示指定は使える。
- TauriのREADME、SDKガイド、再ビルド手順、YM2608原典のREADMEを更新した。

SDK版は`0.1.0`、元コミットは`affd1059599f3c7598191c14f5a864b44963d4aa`、
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK全374ファイルと取り込み記録は変更していない。
別SDK checkout、submodule、ビルド時の音源ソース取得は不要。

接続はインスタンスごとに8 KiBのRhythm ROM領域と2 MiBのADPCM-B RAMを確保する。
FM 6声、SSG 3声、Rhythm 6声、ADPCM-B、音量・pan・レート変換、
PC-98用／追加生成用それぞれのresetとStop後の保持動作は既存の接続を引き継ぐ。
Rustの転送予約、owner、メモリー予算・寿命、出力・Mixer／FX、JS APIは今回の切替対象外。
従来のローカル接続コピーとBrowser比較用の原典・ハッシュは保持する。

## ローカル検証

macOS ARM64、Clangで実施。音声デバイスは開いていない。

| 対象 | 結果 |
| --- | --- |
| SDKの固定内容 | 374ファイルのオフライン照合成功 |
| 接続／ヘッダー | 推移的なincludeを含む9組が同一 |
| PC-98用の移行前後と実WASM | 30ケース、184,320フレーム。旧／SDKのPCMがbyte一致し、WASMとの差分0 |
| 追加生成用の移行前後と実WASM | 252ケース、1,585,152フレーム。PCM／status／statusHi／IRQ／4 readがbyte一致し、WASMとの差分0 |
| Nativeの状態・RAM比較 | 6ケース、49,152フレーム。524／536バイトの両状態形式、PCM／read、3つのRAM範囲が一致 |
| 更新したcheckerの既定ビルド | PC-98用／追加生成用とも実際のSDKをコンパイルし、WASM比較成功 |
| Cargo | 723成功、0失敗、明示実行用4件ignored |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源の混在 | 3混合構成、7単独音源、受入れ／台数制限の試験が成功 |
| 配布ソース | SDKを含む22件の固定記録と、最終ソースZIP全1,796ファイルをオフライン照合 |

音声比較の固有ケースは計282件、1,769,472フレーム。
既定ビルドでの再確認を二重加算せず、Native状態比較も別集計とした。
RAM比較は1観測あたり96バイトの3範囲で、2 MiB全域の毎フレーム比較ではない。
完全な状態形式の比較もNative同士のもので、WASM内部状態の比較とは区別する。

44.1／48／96 kHzで、FM全6声と全アルゴリズム、SSG tone／noise／envelope、
全Rhythm声とROM再読込、ADPCM-BのRAM終端・差し替え・clear、
clock／prescaler、timer／status／IRQ／CPU data read、Stop／reset、追加生成のtimelineを確認した。
既存のSDK fixtureでも、ROM／RAMの所有・境界、再試奏、他声の継続、
callback内のallocation／freeがゼロであることを確認した。

結果は`/private/tmp/tetorica-sdk-ym2608-adoption/summary.json`、
Rust試験は`/private/tmp/tetorica-sdk-ym2608-cargo-test.log`、
再生／混合は`/private/tmp/tetorica-sdk-ym2608-stability.json`と
`/private/tmp/tetorica-sdk-ym2608-extra-stability.json`に保存した。
一時ファイルが消えても、既定checkerとTauriの既存試験から再確認できる。

Tauriの最終文書を含めて対応ソースZIPを再生成し、checkout／マニフェスト／ZIPを照合した。
ZIP SHA-256は`30219d51d724f886e9643499772f7adf46336e2c0421faaedcd7d2f7df5a212e`。
結果は`/private/tmp/tetorica-sdk-ym2608-sources.json`に保存した。

再ビルド・更新手順はTauriの[Native SDKの取り込み](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。

## 残る確認

今回のYM2608変更を含むコミットでの各OSのCIと、インストール後の実機音声は未確認。
`v0.90.2+test`の5構成成功は、先のYM2612移行コミットに対する結果。
次のSDK取り込み候補はYM2610B。複数音源の広域benchmarkは今回の一致確認には用いていない。
