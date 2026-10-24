# Playground TauriへのNative SDK取り込み — YM2151／X68000

作業日: 2026-10-25。
作業場所: `w/tetorica-fm2612-playground-tauri/`。

X68000のFMと`createSoundChip('ym2151')`を、同梱済みの固定SDKからビルドする形へ切り替えた。
基準コミットはTauriの`6f4d4db0fcc05a0ce38d20b23e1d654b5836dc87`、
本体の`ce4dc4de1537944928feff0c9595b6a33d9cec2a`。
今回の実装・checker・文書更新は、この基準コミット後の未コミット差分。

## 変更した範囲

- Tauriの`src-tauri/build.rs`で、追加生成YM2151の接続を
  `vendor/tetorica-soundchip-native/native/reference/tauri/native_genesis_ym2151.cpp`からビルドする。
- X68000と追加生成YM2151で共有するOPM providerを、
  `vendor/tetorica-soundchip-native/native/src/ymfm_opm_provider.cpp`へ切り替える。
  SDK側のymfm／wasm includeを先に指定し、SDK側cpp／headerを再ビルド監視する。
- X68000の機種用接続`src/native_genesis_x68000.cpp`、OKIM6258と追加生成OKIはアプリ側に残す。
  選択中X68000は機種用接続が独立したYM2151を所有し、追加生成YM2151の接続を流用しない。
  FM／OKIの別clock、リサンプリング、4系統出力、サンプル所有・保持・混合も従来どおり。
- OPM providerは既存の`tetorica_native_x68000` archive内で一度だけコンパイルする。
  共通ADPCMは先行するOPN移行で取り込んだSDK版を引き続き使う。
  archive順序、C++14／O2／MSVC EHscは保持する。
- 本体の`scripts/check_native_x68000.mjs`と`scripts/check_native_extra_ym2151.mjs`の
  既定ビルドも実SDKへ切り替え、実際に使用したcppのパスとSHA-256を記録する。
  既存の`--fixture`による比較対象注入は保持する。

SDK版は`0.1.0`、元コミットは`affd1059599f3c7598191c14f5a864b44963d4aa`、
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
同梱SDK全374ファイルと取り込み記録は変更していない。
通常のビルドに別SDK checkout、submodule、CMake実行、音源ソースのダウンロードは不要。

Rustのスケジューリング、owner／回収／予算、CPAL、Mixer／FX／liveFx、JS APIは変更していない。
Browser／npmのWASM配布、Tauriの`dist/`とアプリ版も変更していない。
旧コピーや比較用スナップショットは由来の記録として保持する。

## ローカル検証

macOS ARM64／Clangで実施。音声デバイスは開いていない。

| 対象 | 結果 |
| --- | --- |
| SDKの固定内容 | 374ファイルのオフライン照合成功 |
| ソースの差分 | 接続・機種用混合・コア・ヘッダー11組がbyte一致。OPM providerの差はinclude相対パスのみ |
| X68000の移行前後と実WASM | 42ケース、258,048フレーム。独立したFM左右・OKI左右の4出力がbyte一致し、WASMとの差分0 |
| 追加生成YM2151の移行前後と実WASM | 252ケース、1,548,288フレーム。PCM／status／IRQ／read等がbyte一致し、WASMとの差分0 |
| Native状態の比較 | 6ケース、49,152フレーム。272／292バイトの状態形式全体とPCM／status／IRQ／readが一致 |
| 更新したcheckerの既定ビルド | X68000／追加生成の両方でSDKをコンパイルしてWASM比較成功。使用ソースのハッシュも記録 |
| Cargo | 723成功、0失敗、明示実行用4件ignored |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源の混在 | 3混合構成、7単独音源、受入れ／16台制限の試験が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ソースZIP全1,796ファイルのオフライン照合成功 |

固有の音声比較は計294ケース、1,806,336フレーム。
旧接続と旧OPM provider、SDK接続とSDK OPM providerを別々にコンパイルし、
同じ入力に対する出力がbyte一致することを強制してから実WASMと比較した。
既定checkerの再実行を固有ケースへ二重加算せず、Native状態比較も別集計とする。

44.1／48／96 kHzで、FM 8CH、全8アルゴリズム、LFOの4波形、AM／PM、
CH7ノイズ、timer／CSM／status／IRQ／read、mute、clock変更、Stop／reset／試奏取消しを比較した。
X68000ではOKIの3divider、raw FIFO、サンプル差し替え・保持とFM同時再生も含む。
既存fixtureでStop／再発音、サンプルのatomic upload／寿命、callback中のallocation／freeゼロを確認した。

別のNative状態比較では、選択中X68000のFMとOKIの両方が非ゼロであることも確認した。
この状態比較はNative同士の比較で、WASM内部状態の一致や全サンプルRAMの毎フレームdumpではない。
選択中X68000の4出力を直接比較し、最終的なホスト混合はRustの再生・混合試験で別に検証する。

音声・状態比較の集計は`/private/tmp/tetorica-sdk-ym2151-adoption/summary.json`、
Rust試験は`/private/tmp/tetorica-sdk-ym2151-cargo-test.log`、
再生／混合は`/private/tmp/tetorica-sdk-ym2151-stability.json`と
`/private/tmp/tetorica-sdk-ym2151-extra-stability.json`に保存した。
両report runnerはexit code 0、`deviceOpened: false`だった。
一時ファイルが消えても、既定checkerとTauriの既存試験から再確認できる。
手順とビルド境界はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。

Tauriの最終文書を含めて対応ソースZIPを再生成し、checkout／マニフェスト／ZIPを照合した。
ZIP SHA-256は`b3c56199e1be251cbc6c1bdcf46627f3be3843cd960d2568894524a1548a3188`。
結果は`/private/tmp/tetorica-sdk-ym2151-sources.json`に保存した。
ZIP自身を含むTauri文書へこのハッシュを埋め込まず、利用側の外にある本記録で保持する。

## 残る確認

今回のYM2151差分を含むWindows／Linux等のCIは未実行。
先行する[全OPN移行の5構成CI](native_sdk_ym2610_adoption_01.md)は
`5280f83adebc542fdba1f49c5ff9bc8b51860734`に対する成功で、今回の差分とは区別する。
各OS間のPCM bit一致、インストール後の起動、実機の音声出力・ノイズ・Keyboard操作は別に確認する。
OKIM6258自体のSDK取り込み、広域benchmark、OPL等の別接続の移行は今回の範囲に含めない。
