# Playground TauriへのNative SDK取り込み — OKIM6258

作業日: 2026-10-25。
作業場所: `w/tetorica-fm2612-playground-tauri/`。

X68000と`createSoundChip('okim6258')`の共通デコーダー、追加生成用の接続を、
同梱済みの固定SDKからビルドする形へ切り替えた。
着手時点はTauriの`e4d68b27671ac39a64046a2b11c51709c41ff5be`、
本体の`f0e00dda601941bb9df85096ab2c3462d6aca36a`で、両作業ツリーはcleanだった。
先行するYM2151の移行は、この基準コミットに保存済み。

## ビルド境界

追加生成OKIの接続とヘッダーはSDKの
`native/reference/tauri/native_genesis_extra_okim6258.cpp`／`.h`、
デコーダーとヘッダーの原本はSDKの`vendor/mame-okim6258/`を使う。
X68000の機種用接続`src/native_genesis_x68000.cpp`はアプリ側に保持する。
YM2151と共有OPM providerは先行する移行で取り込んだSDK版を引き続き使う。

選択中X68000のサンプルは機種用接続が持つ2つの16 MiBバンクへアップロードする。
追加生成OKIは最大16 MiBの不変なサンプルを借用し、Rustが所有・寿命・公開・回収と予算を管理する。
この違い、スケジューリング、FM／OKIの混合、CPAL、Mixer／FX／liveFx、JS APIは変更していない。
デコーダーは既存の`tetorica_native_x68000` archive内で一度だけコンパイルし、
archive順序、C++14／O2／MSVC EHscを保持する。

SDK版は`0.1.0`、元コミットは`affd1059599f3c7598191c14f5a864b44963d4aa`、
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
同梱SDK全374ファイルと取り込み記録は変更していない。
通常のビルドに別SDK checkout、submodule、CMake実行、音源ソースのダウンロードは不要。
Browser／npmのWASM配布、Tauriの`dist/`とアプリ版も変更していない。

## 初期化の差を保持する

固定SDKのデコーダー原本は、コンストラクターで共有差分テーブルの`compute_tables()`を直接呼ぶ。
従来のTauri版はC++の関数内staticを使い、複数のインスタンスを生成しても初期化を一度だけ行う。
原本へ単純に参照を切り替えると、この既存の対策が外れる。

SDK原本は編集せず、Cargoの`OUT_DIR`へデコーダーを生成する際に、
従来と同じコンストラクター1箇所の置換を適用する。
期待する置換元がちょうど1箇所でなければビルドを止め、SDK更新時の想定外の差を隠さない。
新しいPythonやCMakeのビルド依存は増やさない。
復号処理・計算式・FIFO・クロック等には変更を加えない。

本体のX68000用／追加生成OKI用checkerも同じ置換を適用し、
SDK原本と生成したC++のパス／SHA-256を区別して記録する。
旧ローカル生成物やBrowserスナップショットは由来の記録として残す。

生成したデコーダーは旧Tauri生成物とソース全体がbyte一致した。
SDK原本のSHA-256は`6ae2d4ff48e7d8a985436ba48e53cd92aa9b3edb8f1003a97bf16616506020a0`、
生成物は`fdc46a4e971abccbbf0ee7441c0cffe1fdc08445018b3f006d659a3cb430ed86`。
実際のCargo出力とJS比較用の生成物の両方で確認した。
置換元が欠落／重複する入力を拒否する確認も成功した。

CargoはSDKのmame-okim6258ディレクトリと追加生成接続cpp／headerを監視する。
実行時の素材やコンパイル入力を供給しなくなった旧`native-x68000`ディレクトリの監視は外し、
機種用接続のcpp／headerの監視は残した。
SDK原本・生成手順・ライセンスとNOTICEは対応ソースZIPにも収録される。

## ローカル検証

macOS ARM64／Clangで実施。音声デバイスは開いていない。

| 対象 | 結果 |
| --- | --- |
| SDK固定内容 | 374ファイルのオフライン照合成功 |
| ソース一致 | 接続・機種用混合・ヘッダー6組がbyte一致。SDK原本からの生成デコーダーも旧Nativeとbyte一致 |
| X68000の移行前後と実WASM | 42入力、258,048フレーム。独立したFM左右・OKI左右の4出力がbyte一致し、WASMとの差分0 |
| 追加生成OKIの移行前後 | 45入力、264,192フレーム。PCMとclock／divider／pan／サンプル再生状態等がbyte一致 |
| 追加生成OKIと実WASM | 3種類のブロック分割で135比較、792,576フレーム。差分0 |
| Native状態の比較 | 6ケース、49,152フレーム。292／28バイトの状態全体とPCMが一致。借用バッファは破棄後も不変 |
| 並行した初回生成 | 旧／生成SDK版の各別プロセスで16スレッド・513インスタンス。テーブル初期化が各1回のみ |
| checker既定ビルド | X68000／追加生成の両方で実SDKから生成・ビルドし、実WASMとの比較成功。原本と生成物のハッシュを記録 |
| Cargo | 723成功、0失敗、明示実行用4件ignored |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源の混在 | 3混合構成、7単独音源、受入れ／16台制限の試験が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ソースZIP全1,796ファイルのオフライン照合成功 |

Native間で比較した固有の入力は計87件、522,240フレーム。
実WASMとの比較は計177件、1,050,624フレームで、追加生成の同じ45入力を
1フレーム／128フレーム／不規則なブロックの3方式で再生する比較を含む。
177件をすべて異なるNative入力として数えず、checker既定ビルドの再確認も二重加算しない。

44.1／48／96 kHzで、3divider、raw FIFOの順序・overflow／underflow、
異なるclockと小数位相、有限／repeat再生、pan、サンプル差し替え・保持、Stop／resetを比較した。
X68000ではFMとOKIの同時再生や独立したclock／resetも含む。
既存fixtureでatomicな16 MiBアップロード、独立インスタンス、借用サンプルの寿命と差し替え、
不正なclock／rateの拒否、callback中のallocation／freeゼロを確認した。

Native状態比較はWASM内部状態の比較や全16 MiBバッファの毎フレームdumpではない。
並行生成の観測では`std::pow`を計数し、49段のテーブル計算が1回分だけ行われたこととPCMを確認した。
ThreadSanitizerや未加工SDKの競合再現を行ったという意味ではない。

集計は`/private/tmp/tetorica-sdk-okim6258-adoption/summary.json`、
Rust試験は`/private/tmp/tetorica-sdk-okim6258-cargo-test.log`、
再生／混合試験は`/private/tmp/tetorica-sdk-okim6258-stability.json`と
`/private/tmp/tetorica-sdk-okim6258-extra-stability.json`に保存した。
両report runnerはexit code 0、`deviceOpened: false`だった。
一時ファイルが消えても、本体の既定checkerとTauriの既存試験から再確認できる。
ビルド境界と手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。

Tauriの最終文書を含めて対応ソースZIPを再生成し、checkout／マニフェスト／ZIPを照合した。
ZIP SHA-256は`7123fc45e6fde1333b6286885d0576f7a0cc9aa1137c32bbcf3bf28f882a71f3`。
結果は`/private/tmp/tetorica-sdk-okim6258-sources.json`に保存した。
生成デコーダー自体はCargoビルド時に再生成する。ZIPにはSDK原本と生成処理の`build.rs`を収録する。
このハッシュはZIP内文書へ埋め込まず、利用側の外にある本記録で保持する。

## 残る確認

先行する全OPN移行の5構成CIは今回の差分を含まない。
新しい各OSのCI、インストール後の起動、実機の音声出力・ノイズ・Keyboard操作は別途確認する。
将来SDKのNative配布へ同じ初期化対策を収録した場合は、固定版を明示更新して利用側の置換を整理できる。
今回はSDK自体の公開版更新やBrowser原本の変更までは行っていない。
