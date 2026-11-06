# SID core選定 — 2026-11-06

[SID TODO](todo_sid_01.md)の初回milestoneでは、**floooh/chipsの`m6581.h`を採用する**。
6581単体のNative／単一thread WASMと、ブラウザーの検証ラボから始める。
Tetoricaの「可読ソースを改造・再利用できる」目的と、配布・組込みの容易さを優先した選択。

固定revision: [`9e88298ce56319953ac7a43213a1120359f7a3a6`](https://github.com/floooh/chips/tree/9e88298ce56319953ac7a43213a1120359f7a3a6)。
原本・license・source hash・変更点・再ビルド手順を保持する。既存の固定SDK snapshotは変更しない。

## 候補比較

| 候補 | License／model | FilterとNative／WASM組込み | 今回の扱い |
| --- | --- | --- | --- |
| [chips/m6581](https://github.com/floooh/chips/blob/9e88298ce56319953ac7a43213a1120359f7a3a6/chips/m6581.h) | zlib/libpng。6581専用、8580切替なし。 | C／C++単一header、標準libraryのみ。LP／BP／HP、routing、cutoff、resonanceを持つ。実装は固定cutoff近似とdigital filterで、個体差・model別analog回路の再現とは区別する。 | 採用。軽いregister／clock wrapperを作り、自作fixtureで移植を検証する。 |
| [daglem/reSID](https://github.com/daglem/reSID) | GPL-2.0-or-later。6581／8580。 | C++のregister／clock／sampling API。DAC・VCR・opamp等のanalog回路をmodel化。内部stateの取得・復元も可能。Nativeから使いやすいが、WASM buildは今回未検証。 | 比較候補。READMEは当面VICE版の取得を推奨しているため、使用時は出所・revisionを選び直す。 |
| [libresidfp](https://github.com/libsidplayfp/libresidfp) | GPL-2.0-or-later。6581／8580。 | reSIDfpの独立core。6581 filterの歪みやDAC非線形等を扱い、model別curveを調整可能。NativeはC++。現sourceのfilter table初期化はthreadを使うため、単一thread WASMへの移植には追加作業がある。 | 後続の比較基準・高精度backend候補。GPLの配布・再利用条件を明示した別段階で検討する。 |

根拠: chipsのlicense・model・API・filterは上記固定source、reSIDのlicenseとAPIは
[`sid.h`](https://github.com/daglem/reSID/blob/master/src/sid.h)、回路modelと取得元の方針は
[README](https://github.com/daglem/reSID/blob/master/README.md)で確認した。
libresidfpの機能・licenseは[README](https://github.com/libsidplayfp/libresidfp/blob/main/README.md)、
初期化のthread使用は[6581](https://github.com/libsidplayfp/libresidfp/blob/main/src/FilterModelConfig6581.cpp)／
[8580](https://github.com/libsidplayfp/libresidfp/blob/main/src/FilterModelConfig8580.cpp)で確認した。
比較はsource調査によるもので、今回3候補をbuildして実測比較した結果ではない。

## 初回に約束する範囲

- 3声、Triangle／Saw／Pulse／Noise、ADSR／Gate、Sync／Ring、shared filterを検証する。
- **8580、実機との波形一致、実機filterの非線形・個体差の再現は未対応**と表示する。
- Native／WASMの同一fixture比較は移植の確認とし、実機精度の根拠にはしない。
- 元のzlib通知を保持し、移植・修正部分を原本と区別する。tedplay由来のUnlicense表記も保持する。
- 将来のcore差し替えに備え、UIはregister／clock／render wrapperに接続する。

## `.sid`再生への接続

SID単体coreにPSID／RSIDを渡しても曲再生にはならない。C64のprogram実行・CPU／CIA等の環境が別途必要。
この部分は[C64 player libraryのlibsidplayfp](https://github.com/libsidplayfp/libsidplayfp)を後続候補とする。
同libraryもGPL-2.0-or-laterで、[3.0.0](https://github.com/libsidplayfp/libsidplayfp/releases/tag/v3.0.0)から
reSIDfp coreをlibresidfpへ分離している。`m6581.h`を選んだだけで同playerへ自動接続できるわけではない。
まず外部再生／WAVを比較に使い、PSID／RSIDの実行、ROM依存、timed register traceの取得を別途検討する。

初回の検証ラボに`.sid`曲再生や標準VGMへの独自SID command追加は含めない。
