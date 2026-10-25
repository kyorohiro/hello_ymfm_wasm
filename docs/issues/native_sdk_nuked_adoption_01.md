# Native SDK Nuked YM2612取り込み

2026-10-25。通常の22音源IDに続き、代替Nuked YM2612を固定SDKからビルドする。
対象はGenesis Nuked／32X Nukedと、追加生成YM2612の`engine: 'nuked'`。
着手時は本体`f22249959ce00c9893c6ee33983a399a4e3002db`、Tauri`baec0b9a6beebe8ba914607c90b13243eb6ef0c4`、
SDK`affd1059599f3c7598191c14f5a864b44963d4aa`で、すべてcleanだった。
直前の全5構成成功CI run `40171879716`はDX7／SNES／SPCまでを含み、今回のNuked移行は含まない。

## ビルド境界

SDK `0.1.1`に単体ターゲット`tetorica::nuked_ym2612`と公開ヘッダー`<tetorica/nuked_ym2612.hpp>`を追加し、Tauriへ明示的な配布物として取り込んだ。
元コミットは`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`、同梱数は379ファイル。
ソースZIP `tetorica-soundchip-native-0.1.1-sources.zip`のSHA-256は
`939fb035aef36c84cac3d1e058271ca3ddfc6ebd9ce5cfa4b3d04bc92876416b`、manifest SHA-256は
`f0ad25ed94c8e028891bcd4601483fcc6b1fc6801b0a19ebb52696cc75d686e2`。
SDKの`0.1.0`／374ファイルを使った先行検証は、当時の履歴として保持する。

| 用途 | SDK内のパス |
| --- | --- |
| 共通のNativeシンボル接続 | `native/reference/tauri/native_genesis_nuked.cpp` |
| 独立追加エンジンと共通state ABI | `native/reference/tauri/native_genesis_nuked_ym2612.inc`、`native_genesis_ym2612.h` |
| Browser共通C wrapper | `wasm/nuked_opn2_wasm.c` |
| Nuked OPN2コア | `vendor/nuked-opn2/ym3438.c`と対応ヘッダー |

接続cppはwrapperのinclude位置だけが旧コピーと異なる。残る`.inc`・state header・C wrapper・コアC／header・LICENSE・READMEの7組はbyte一致し、旧スナップショットの全9 pinを保持する。
コアCとheader／READMEのversion表記はそれぞれ1.0.12／1.0.9で、既存の固定ハッシュを由来の基準にする。

Tauriは既存のC++14／O2／MSVC `/EHsc`接続archiveとC11／O2／`-fwrapv`のコアarchiveを使う。
Genesis consumer → Nuked接続 → コアproviderの順を維持し、全8個の`OPN2_*`をprefixしてymfmと共存させる。
コアproviderは一度だけコンパイルし、SDK CMakeライブラリーを追加リンクしない。
SDKのcheckoutやsubmodule、ビルド中のソース取得、新しいPython／CMakeビルド依存は追加しない。

## 所有と再生制御

初回生成時の`std::call_once`がglobal chip typeを選択し、以後の生成は音声callbackと共有設定を書き換えない。
raw address／dataの各write後24内部clock、生成時24 clockの出力合計×11、clock／144のsource rateを保持する。
選択中Genesis／32X NukedはTauriの`native_genesis_core.cpp`を使い、自然なreset時のidle DC、
double精度の平均／保持、0.9 FM／0.35 PSG混合とsource別の約5 ms rampを引き継ぐ。
独立追加Nukedは個別の1コアと6CHを持ち、PSG・機種gain・DC除去を含まない。
周波数ラッチ、通常CH3とCSMの別取消し、DAC、mute、試奏、保持Stopとresetは既存の動作を維持する。

Rustの単一callback所有・制御側の準備／回収、予約・owner／group・寿命・16台／予算管理、
Mixer／FX・録音・CPALとWebView／JS APIはアプリ側に残る。Browser／npmのWASMとTauriの`dist/`は更新しない。
NukedコアとNative接続はLGPL-2.1-or-laterの宣言を保持する。改変・再リンクに使う実入力はTauriの
[NATIVE-SOURCES.md](../../w/tetorica-fm2612-playground-tauri/NATIVE-SOURCES.md)へ記載する。
旧`src-tauri/native-nuked/`と接続コピー・syncスクリプトは比較用の原典として残し、更新だけではSDKの実行ソースを変えない。

## ローカル比較

macOS ARM64／Clang・Nodeで旧／SDKを別々にコンパイルし、音声デバイスを開かずに実配布WASMと比較した。

| 対象 | 固有Native入力数 | Nativeフレーム／実WASM比較フレーム | 最大WASM差 |
| --- | ---: | ---: | ---: |
| 選択中Genesis Nuked | 222 | 1,363,968 | `2.9802322387695312e-8` |
| 独立追加Nuked YM2612 | 198 | 1,216,512 | 0 |
| 合計（API profileを区別） | 420 | 2,580,480 | `2.9802322387695312e-8` |

全420入力で旧／SDKのstdoutがbyte一致し、意図したDSP変更はない。
同じ符号化命令列39件は両APIに現れるが、選択中は機種混合・gain・再生制御を含み、独立追加はrawエンジンなので別入力とする。
実WASM比較も420回で、選択中のFloat32 gain rampによる既存の`1e-7`未満の差を保持し、独立追加は差0。
分割blockや既定経路・fixture指定の再実行、自己試験は合計へ加算しない。
各frameのPCM／status／IRQ／4種類のread結果と、Native公開ABI・制御の自己試験を区別し、private全状態のdump比較とは扱わない。

既存fixtureの自己試験でraw reset DC、Stop無音、FM／CSM／DAC／PSG再発音、独立性と6CH、
周波数ラッチの観測、deferred gate／reset／mute、callback中のC／C++ allocation／free 0を確認した。
4つの旧／SDK比較fixtureでprefix済みコア8 exportの各1回の定義と、非prefix `OPN2_*`の定義0も確認した。
SDKのソースZIPを独立した一時ディレクトリへ展開し、全24 CTest・18 WAV exampleとJavaScript参照10試験が成功した。
`npm test`もPython 22件・Node 31件成功。合成fixtureを使うツール試験はSDK最終取り込み前に実行し、実際のreceiptに依存しない。
2本の既定checkerも初回取り込み後のSDK入力からコンパイルして成功した。
選択中12入力／独立追加8入力のSHA-256を記録し、inline fixture指定と不正12形式の拒否、入力fixtureの保持も確認した。
実Cargoの2 archiveは各1 object。DWARFのcompile unitはSDK接続cppとSDKコアCを指し、
10個のraw C ABI・16個の独立追加C ABI・8個のprefix済みOPN2 exportは各1回だけ定義され、非prefix `OPN2_*`定義は0だった。
独立したdependency preprocessは6個の音源入力をすべてSDK内へ解決し、実入力の監視・旧ソース監視の除去と既存のリンク順序も確認した。

Rust全試験は723成功・0失敗・明示実行用4件ignored。MCPのローカルTCP bindのため初めから制限外で実行し、sandbox内の失敗はない。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stopが成功した。
既存の追加音源3混合構成・7単独音源、受入れ／16台制限と17台目拒否も成功し、両制限試験のStop後予約予算は0へ戻った。
再生／混合runnerはともにexit code 0、`deviceOpened: false`。
この既存混合表に独立追加Nukedは含まれず、Nukedは別のPCM比較・同時リンクfixture・Rust試験と選択中modeの再生試験で確認した。
これらのホスト試験はSDK `60f06e629395b65f1777e7e28c80be9eefca2381`／378ファイルの初回取り込み後に実行した。
初回取り込みから最終配布への差は`RELEASE-MANIFEST.json`、`docs/verification.md`、`native/CMakeLists.txt`と新しい試験用`native/tests/nuked_audit.cpp`の4ファイルだけだった。
実際にTauriが使うコア・接続入力の全バイト列が一致することを`final-import-audit.json`で確認したため、完了済みのホスト試験を再実行していない。
最終ソースZIPを独立展開した全24 CTest・18 WAV exampleとJavaScript参照10試験は改めて成功し、検証scriptのexit codeは0だった。

最終pinと同梱379ファイルのオフライン照合は成功。Tauriガイド確定後の対応ソースZIPは全1,801ファイル、
SHA-256 `1a56f72f99db7f09e71c6bbc588d5430823bd9ae408780f5965cdfc2b295420c`。
`sources.json`でSDKを含む22件の固定記録・対応ソースZIPをオフライン照合した。

本体ルートから比較する。

```sh
node scripts/check_native_nuked.mjs
node scripts/check_native_extra_ym2612_nuked.mjs
```

証拠は`/private/tmp/tetorica-sdk-nuked-adoption/`の`source-audit.json`、`parity-summary.json`、
`parity-source-audit.json`、`provider-symbol-audit.json`、`build-audit.json`、`host-summary.json`、`final-import-audit.json`。
最終SDKの独立検証ログは同ディレクトリの`sdk-extracted-fixed.log`。
ホストの実行ログとJSONは同ディレクトリの`cargo-test.log`、`npm-test.log`、`stability.json`、`extra-stability.json`。
今回のCI、各OSのWASM比較、OS間PCM一致、sanitizer、実機聴音・UI操作とインストール後の起動は、このローカル比較とは別の確認。
対応ソースZIPの自己ハッシュはTauriガイドへ埋め込まず、本体の記録へ残す。

## SDKのCIとTauriのCIの区別

SDKの[初回CI run 40174420834](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/40174420834)は、
Linuxの2構成でallocation監査用macroとlibstdc++の標準ヘッダーのinclude順により試験用のコンパイルが失敗した。
SDKの監査用shimで標準ヘッダーを先に読む形へ修正し、製品のNukedコア／接続は変更していない。
Tauriの既存allocation fixture・Cargo全試験は成功しており、この失敗をTauriの音声コアの失敗とは扱わない。
修正コミット`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`を対象に[SDK CI run 40175263453](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/40175263453)を開始した。
このローカル記録時点ではSDK CIの成否を確認していない。新しいTauriの5構成CIも後続で実行して結果を追記する。
このチェックポイントではcommit／pushとTauri CIは未実施。実機聴音や新しいタグ・アプリreleaseも行っていない。
