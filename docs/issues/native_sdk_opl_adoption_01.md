# Playground TauriへのNative SDK取り込み — OPL／Y8950接続

作業日: 2026-10-25。
作業場所: `w/tetorica-fm2612-playground-tauri/`。

DOS PCのYM3526／YM3812／YMF262、MSX AudioのY8950と、
これら4音源の`createSoundChip()`接続を、同梱済みの固定SDKからビルドする形へ切り替えた。
着手時点のTauriは`a8edd891c5568c1d9543ed8c0e7d9f4f87f7c202`でcleanだった。
本体は`6c0b57703ff3f68d24ac54d7126941624cac0f61`で、前回CIの記録2ファイルに未コミット差分があった。
その記録は保持して今回の記録を追加する。

前回の[5構成CI](native_sdk_ym2413_adoption_01.md)はTauriの`634e56f4...`を対象に成功し、
その後ガイドのCI結果だけを更新したコミットが`a8edd891...`。
今回のOPL接続切り替えは、そのCI結果とは区別する。

## ビルド境界

- 選択中音源の接続をSDKの`native/reference/tauri/native_genesis_opl.cpp`／`.h`から使用する。
- 追加生成4音源の接続をSDKの`native/reference/tauri/native_genesis_extra_opl.cpp`／`.h`から使用する。
- 両接続が引用する`native_genesis_y8950_memory.h`もSDK自身の同じディレクトリから解決する。
  比較fixtureが引用するローカルのC ABIヘッダーはSDK版とbyte一致し、変更せず保持する。
- 共有OPL provider、PCM、ADPCMは先行する移行で取り込んだSDK版を引き続き一度だけコンパイルする。
  archive順序、C++14／O2／MSVC EHscを保持する。
- 同じ`tetorica_native_opl` archiveにある追加生成RF5C164の接続はアプリ側に保持する。
  Rustのスケジューリング、owner／回収／予算、CPAL、Mixer／FX／liveFx、JS APIは変更しない。
- Cargoの監視はSDKの両接続cpp／headerとメモリーhelperへ移し、
  実行時素材・コンパイル入力を供給しなくなった旧`native-opl`ディレクトリの監視を外す。
  旧スナップショットと接続は由来・比較の記録として保持する。

SDK版は`0.1.0`、元コミットは`affd1059599f3c7598191c14f5a864b44963d4aa`、
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
同梱SDK全374ファイルと取り込み記録は変更していない。
通常のビルドに別SDK checkout、submodule、CMake実行、音源ソースのダウンロードは不要。
Browser／npmのWASM配布、Tauriの`dist/`とアプリ版も変更していない。
先行するOKIM6258の初期化対策と、固定SDKからのビルド時生成を保持する。

## Y8950のメモリー契約

`NativeY8950Memory`は4 KiBの可変RAMページを最大512枚、計2 MiBまで借用する。
Rustがページの所有・COW・予算・公開・回収を管理し、音声スレッドがコアのRAM読み書きを行う。
コアからの書き込みとアップロードにはそれぞれのrevisionがあり、
部分アップロードでCPUが記録した隣接バイトを失わない扱いも維持する。
SDKへの参照切り替えでページ本体の所有権を移したり、ROM方式へ変更したりしない。

## 確認範囲

選択中／追加生成のOPLとY8950、RAM付きY8950の既存4比較試験を使用した。
旧接続とSDK接続を別々にコンパイルし、共通providerは同じ固定SDKを使用して比較した。
RAM付き試験にはFMとの同時再生、2 MiB末尾、CPU外部RAM記録、部分アップロード、clear、
Stop／resetでの保持、KeyboardによるADPCM単独試奏と低clockでのholdが含まれる。
Native公開状態・RAM観測、Rust全試験、Run／Stopと混合、対応ソースZIPも別に検証した。

今回の差分を含む各OSのCI、インストール後の起動、実機の音声出力・ノイズ・Keyboard操作は別途確認する。

## ローカル検証

macOS ARM64／Apple Clang 17で実施。音声デバイスは開いていない。
選択中cpp／header、追加生成header、メモリーhelperの4ファイルはbyte一致し、
追加生成cppの差はSDKが加えた説明コメント1行だけだった。
旧接続とSDK接続を別々にコンパイルし、共通provider／PCM／ADPCMは同じ固定SDKを使用した。
同一入力での全出力のbyte一致を確認してから、実WASMと比較した。

| 対象 | ケース数 | フレーム数 | 結果 |
| --- | ---: | ---: | --- |
| DOS PCのYM3526／YM3812／YMF262 | 198 | 1,216,512 | 旧／SDKがbyte一致、実WASMとの差分0 |
| 追加生成OPL系4種類 | 552 | 3,391,488 | 同上 |
| MSX Audioの選択中Y8950 | 138 | 847,872 | PCM／status／IRQ／read等が一致、WASMとの差分0 |
| RAM付きY8950（選択中／追加生成） | 72 | 589,824 | RAMを使うPCM／status／IRQ／read・size／clockが一致、WASMとの差分0 |

固有の比較は計960件、6,045,696フレーム。更新した4つのcheckerの既定ビルドも成功し、
実際に使うSDKの接続・provider・PCM／ADPCMとfixtureのパス／SHA-256を記録した。
既定ビルドの再実行は固有ケースへ二重加算しない。

RAM付きcheckerも旧コピーから実SDKへ切り替え、`--fixture`による注入を追加した。
従来の`--sanitize`による自身のASan／UBSanビルドは保持し、外部fixtureとの併用は拒否する。
今回は通常のO2比較で、sanitizerを実行したという主張はしない。

| 対象 | 結果 |
| --- | --- |
| SDK固定内容 | 374ファイルのオフライン照合成功 |
| Native公開状態・RAM比較 | 6ケース、24,576フレーム。524／520バイトの公開状態全体とPCM／status／IRQ／read・RAM revision、各観測384バイトのRAMが一致 |
| バッファ寿命 | 終了時に呼び出し側の2 MiBバンクと4 KiB差し替えバッファ全体が一致。両コアの破棄後も内容不変 |
| fixture自己試験 | 旧／SDKの選択中OPL・追加OPL・強化Y8950メモリーfixtureが成功。callback中のallocation／freeゼロ |
| Cargo | 723成功、0失敗、明示実行用4件ignored |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源の混在 | 3混合構成、7単独音源、受入れ／16台制限とStop後の予算回収が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ソースZIP全1,796ファイルのオフライン照合成功 |

44.1／48／96 kHzで、FM、OPL3の4opと左右出力、リズム、clockのhold／平均化、
timer／CSM、mute、Stop／reset／試奏と取り消しを比較した。
RAM付き試験では2 MiB末尾や疎なページ、CPU外部記録、部分アップロードと隣接バイト、
clear／差し替え、FMとの同時再生、ADPCM単独のKeyboard試奏も実WASMと比較した。
Rust試験ではCOW・owner／予約／予算・回収、callbackの割り当て／解放も別に確認した。

Native公開状態比較はymfmの非公開オブジェクト全体やWASM内部状態のdumpではない。
RAMは4箇所・計384バイトを毎フレーム観測し、呼び出し側の全バッファ比較は終了時に行った。
全2 MiBを毎フレームdumpする試験ではない。

集計は`/private/tmp/tetorica-sdk-opl-adoption/summary.json`、
Rust試験は`/private/tmp/tetorica-sdk-opl-cargo-test.log`、
再生／混合試験は`/private/tmp/tetorica-sdk-opl-stability.json`と
`/private/tmp/tetorica-sdk-opl-extra-stability.json`に保存した。
両report runnerはexit code 0、`deviceOpened: false`だった。
一時ファイルが消えても、本体の既定checkerとTauriの既存試験から再確認できる。
ビルド境界と手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。

Tauriの最終文書を含めて対応ソースZIPを再生成し、checkout／マニフェスト／ZIPを照合した。
ZIP SHA-256は`c2d20e9b3e6eae720256571ffb2b2afefd03dad451ec5215b33acd570803e871`。
結果は`/private/tmp/tetorica-sdk-opl-sources.json`に保存した。
このハッシュはZIP内文書へ埋め込まず、利用側の外にある本記録で保持する。
前回CIのガイド更新のみを含むZIP `85850ce5...`とは異なり、今回のOPL接続参照切り替えを含む。
