# Playground TauriへのNative SDK取り込み — YM2413／共有OPL provider

作業日: 2026-10-25。
作業場所: `w/tetorica-fm2612-playground-tauri/`。

YM2413の追加生成接続と、Master System／MSX／DOS PC／MSX Audioで共有する
OPL provider・PCM依存を、同梱済みの固定SDKからビルドする形へ切り替えた。
着手時点はTauriの`250489fd0b6bc5ba2b97bd182834a41aaba60269`、
本体の`fed03f7a414898c511e67478bf7d43aa6a03f273`で、両作業ツリーはcleanだった。
先行するYM2151／OKIM6258の移行は、この基準コミットに保存済み。

## ビルド境界

- `createSoundChip('ym2413')`の接続とヘッダーを、SDKの
  `native/reference/tauri/native_genesis_ym2413.cpp`／`.h`から使用する。
- 共有OPL providerをSDKの`native/src/ymfm_opl_provider.cpp`、
  PCM依存を`vendor/ymfm/ymfm_pcm.cpp`からコンパイルする。
  共有ADPCMは先行するOPN移行で取り込んだSDK版を引き続き使う。
- provider／PCMは従来の`tetorica_native_master_system` archiveで一度だけコンパイルする。
  archive順序、C++14／O2／MSVC EHscを保持し、SDKのymfm／wasm includeを先に指定する。
- Master System／MSXの機種用接続と、そのアプリ側の`NativeOpllCore` helperは保持する。
  選択中音源はSDKの共有コアを使用し、追加生成はSDKの独立接続を使用する。
  独立接続は`NativeOpllCore`を流用せず、別の内部クラスを持つ。
- Sega PSG、AY-3-8910、DOS PC／Y8950の接続全体とメモリー管理はアプリ側に残す。
  共有providerの参照が変わるため、これらのOPL系も回帰確認する。
- 本体のMaster System／MSX／追加生成YM2413／DOS OPL／追加生成OPL／MSX Audioの
  6つの比較checkerも、実際のSDK provider／PCM／ADPCMとSDKの追加YM2413接続を使用する。
  その他の接続はアプリ側のままにし、実際にコンパイルするcppのパスとSHA-256を記録する。
  既存の`--fixture`による比較対象の注入は保持する。
- CargoはSDKのymfmディレクトリ、OPL provider、追加YM2413接続を監視する。
  実行時の素材・コンパイル入力を供給しなくなった旧`native-master-system`の監視は外す。
  機種用接続と`NativeOpllCore`の監視、AY実装を供給する`native-msx`の監視は保持する。
  旧スナップショット・コア・接続は由来と比較の記録として残す。

SDK版は`0.1.0`、元コミットは`affd1059599f3c7598191c14f5a864b44963d4aa`、
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
同梱SDK全374ファイルと取り込み記録は変更していない。
通常のビルドに別SDK checkout、submodule、CMake実行、音源ソースのダウンロードは不要。

Rustのスケジューリング、owner／回収／予算、CPAL、Mixer／FX／liveFx、JS APIは変更していない。
Browser／npmのWASM配布、Tauriの`dist/`とアプリ版も変更していない。
先行するOKIM6258の初期化対策と、固定SDKからのビルド時生成を保持する。

接続・NativeOpllCore・コア・ヘッダー等の15入力が旧コピーとbyte一致し、
OPL providerの差はincludeの相対パスだけだった。
Master System／MSXが使うローカルの`NativeOpllCore`と、独立YM2413の内部クラスは別で、
今回の切り替えで同じクラスに異なる定義を混在させる変更はない。
SDK優先のincludeで解決する`segapsg.h`も既存のものとbyte一致した。
PSGのcpp自体は従来のアプリ側を使う。保持する機種用接続やhelper等の13ファイルにも変更はない。

## ローカル検証

macOS ARM64／Apple Clang 17で実施。音声デバイスは開いていない。

旧接続／旧provider／旧PCMとSDK接続／SDK provider／SDK PCMを別々にコンパイルし、
同じ入力に対する全出力がbyte一致することを強制した後、実WASMと比較した。

| 対象 | ケース数 | フレーム数 | 結果 |
| --- | ---: | ---: | --- |
| Master System | 60 | 368,640 | 旧／SDKがbyte一致、実WASMとの差分0 |
| MSX | 93 | 571,392 | 同上 |
| 追加生成YM2413 | 558 | 2,285,568 | PCM／register／clock／status／IRQ／read等が一致、WASMとの差分0 |
| DOS PCのYM3526／YM3812／YMF262 | 198 | 1,216,512 | 旧／SDKがbyte一致、実WASMとの差分0 |
| 追加生成OPL／Y8950 | 552 | 3,391,488 | PCMと状態観測が一致、WASMとの差分0 |
| MSX AudioのY8950 | 138 | 847,872 | PCM／status／IRQ／read等が一致、WASMとの差分0 |

固有の比較は計1,599件、8,681,472フレーム。
YM2413主体の3経路は711件・3,225,600フレーム、共有providerのOPL／Y8950回帰確認は888件・5,455,872フレーム。
更新した6つのcheckerの既定ビルドも実際のSDKをコンパイルして比較成功し、
各cppのパス／SHA-256を記録した。この再確認分を固有ケースへ二重加算しない。

| 対象 | 結果 |
| --- | --- |
| SDK固定内容 | 374ファイルのオフライン照合成功 |
| Native状態比較 | 9ケース、36,864フレーム。独立YM2413 72バイト／Master System 100バイト／MSX 104バイトの公開状態全体とPCM／status／IRQ／readが一致 |
| fixture自己試験 | 旧／SDKの5構成で成功。callback中のallocation／freeゼロ |
| Cargo | 723成功、0失敗、明示実行用4件ignored |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源の混在 | 3混合構成、7単独音源、受入れ／16台制限の試験が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ソースZIP全1,796ファイルのオフライン照合成功 |

44.1／48／96 kHzで、YM2413の9メロディCH、ROM音色／共有ユーザー音色、5リズム音、
レイアウト切り替え、clock／hold／平均化、mute、Stop／reset／再試奏と取り消しを比較した。
機種用比較にはPSGやAYの独立出力・同時再生も含むが、それらのSDK取り込みを行ったという意味ではない。
追加生成用の共通fixtureにはAYも従来の依存として含まれるが、追加AY専用のWASM試験を増やしたり件数へ加算したりしていない。
OPL／Y8950のtimer、CSM、status／IRQ／read、既存のADPCM／CPUデータ動作も回帰確認した。

Native状態比較は公開C ABI snapshotの比較で、ymfmの非公開オブジェクト全体のdumpや
Native／WASM間の全内部状態の比較ではない。
Y8950のADPCM比較は既存の空／ゼロメモリー条件を含む試験で、新しいサンプルアップロードAPIやROM全域の検証を追加していない。

集計は`/private/tmp/tetorica-sdk-ym2413-adoption/summary.json`、
Rust試験は`/private/tmp/tetorica-sdk-ym2413-cargo-test.log`、
再生／混合試験は`/private/tmp/tetorica-sdk-ym2413-stability.json`と
`/private/tmp/tetorica-sdk-ym2413-extra-stability.json`に保存した。
両report runnerはexit code 0、`deviceOpened: false`だった。
一時ファイルが消えても、本体の既定checkerとTauriの既存試験から再確認できる。
ビルド境界と手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。

Tauriの最終文書を含めて対応ソースZIPを再生成し、checkout／マニフェスト／ZIPを照合した。
ZIP SHA-256は`2829e9f948e257535bf71aac86a702ffe75701ba878cc01cb5c8900787c5a2ee`。
結果は`/private/tmp/tetorica-sdk-ym2413-sources.json`に保存した。
このハッシュはZIP内文書へ埋め込まず、利用側の外にある本記録で保持する。

## 残る確認

先行する全OPN移行の5構成CIは今回の差分を含まない。
新しい各OSのCI、インストール後の起動、実機の音声出力・ノイズ・Keyboard操作は別途確認する。
次のSDK取り込みは、アプリ側に残したDOS PC／Y8950の選択中／追加生成接続が候補。
