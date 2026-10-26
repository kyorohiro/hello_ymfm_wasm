# Nuked OPN2 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_nuked_opn2_wasm.sh`を同梱SDK `0.1.1`の`nuked_opn2`ターゲットへ切り替えた。
revisionは先行25 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。379ファイルをoffline検証し、caller基準で絶対化した出力先をSDKへ渡す。
C11／O2、`ASSERTIONS=1`・`EXPORT_ALL`、12 C export、`cwrap`／`HEAPF32`、incoming `wasmBinary`を維持する。
C compilerは`EMCC`で指定する。既存のC++ recipeの`EMXX`とは分けて試験した。

着手時の本体は`b9a4cf604e08850d0da43d58cdf74b1292b66b96`でcleanだった。
担当を分ける前に旧レシピ・source helper・pin・SavePoint・出力・既存対応ソースの66ファイルを記録した。
SDK原本・pin、Tauri、公開API・音源処理・Mixer値と過去の測定記録は変更していない。
26番目のreceipt、必須入力・ビルド試験、実WASM checkerと配布用source helper／文書を更新した。
詳細は[検証JSON](wasm_sdk_nuked_opn2_adoption_01.json)を参照する。

## ソースと生成物

C wrapper・Nuked coreの2翻訳単位と`ym3438.h`、計3入力は旧原本とSDKでbyte一致した。
Nuked coreのLGPL-2.1-or-later、元のprovenance／READMEを保持する。
core Cのversion commentは1.0.12、header／READMEは1.0.9という既存差もそのまま残し、全体を単一のupstream versionとは扱わない。
Tetoricaのwrapper／recipeに対応するSDKのBSD-3-Clause表記は、coreのLGPL表記と分けて同梱した。

生成JS／WASMは配布済み・旧手順再ビルド・SDK・通常docs・配布ソース単独再ビルドの5組すべてでbyte一致した。

| ファイル | bytes | SHA-256 |
| --- | ---: | --- |
| `nuked_opn2_wasm.js` | 32,804 | `cff4c49f6db3f3aebd8f990d1e80efd6d686ab296bc1706734dc6d9d1fbd581a` |
| `nuked_opn2_wasm.wasm` | 21,071 | `de4eb53660a8fd98230509efe038c4b75dcfd7dc57424a25a5be3db277a468c1` |

4経路のbuildでcompiler警告は出ていない。全52個の既存生成JS／WASMと先行25 receiptも保持した。

## Nuked固有のAPIと比較条件

- 既存`Ym2612`へ別のmodule factoryを注入する。WASMのnative save／load・native mute exportはなく、`supportsState()`はfalse、保存要求は既存どおり拒否する。
  JSのowned PCM・`reserveStereoFrames()`・borrowed `generateStereoView()`、同期hookを維持する。public low-level Intoはない。
- envelope出力の互換ABIはあるが、4 traceは意図して0。音声は通常の生成と一致し、ymfmの内部envelope観測と同じ機能を提供するものではない。
- 各bus byte writeの直後に24 internal clockを進める。address／dataのregister pairでは48 clockになる。
  通常の1 PCM frameも24 clockを合計し、11倍して16-bit clamp後に正規化する。write中に捨てた出力はPCM frame集計へ加えない。
- YM2612 modeのladder／DCを維持する。cold idleは`792 / 32768`で、key-off・pan無効・DAC中央も常に0とは限らない。
  256 code×2 ninth-bit×4 panの2,048通りをmultiplexer／signに基づく独立の期待値と照合した。ymfmのDAC式を流用していない。
- rateは`floor(clock / 144)`の計算で、clock setterではない。raw status port 0 readはlatchを更新し、他portはそのlatchを返し得るため、同じ読出し履歴で比較した。
- resetはper-chip stateを初期化する。chip typeはmodule-globalで、各createが同じYM2612 modeを設定する。複数handleの独立性は確認したが、異なるchip typeの同居は主張しない。
- 実`YM2612Synth`／DirectTransportと、実Sega PSG付き`GenesisAudioEngine`／`VgmPlayer`を使う。
  このWASMのsnapshot非対応を確認し、checkpoint 0からの明示reset／replay fallbackを比較した。新しい保存状態APIやseek機能の追加ではない。

## 実WASM比較

`scripts/check_nuked_opn2_wasm_sdk.mjs`を独立レビュー後にfreezeした。
最終freezeは実行・source closure 48、build snapshot 7、過去の基準記録4の59記録。
実compiler入力は旧／SDK各3の6。広いprovenance 9とpackage範囲guard 28も記録するが、重複や存在しないpackageパスの確認を含むので固有入力として加算しない。

旧再ビルド／配布済み版をそれぞれSDKと比較した。旧2組は同一binaryなのでcoverageは重複加算しない。
各77シナリオ×3 pitch計算clock×2分割の462比較、reset再演奏120回を含む1,044実行で、PCM・127-frame続行probe・read／status／IRQ・hookの差は0。
6CH、algorithm／operator、LFO／SSG-EG／CH3／CSM／timer／DAC／pan、pending bus latchとwrite clock、実Synth・Engine／Playerを含む。
所有PCMの保持（buffer再確保・実heap拡大・dispose後）とborrowed PCMの一致、zero-envelope、interleaved handleも確認した。
観測はfixture event／block後のAPI境界で、全hardware clockのtraceではない。

各組の両buildで生成した実出力は次のとおり。

| 実出力 | ステレオフレーム |
| --- | ---: |
| シナリオ本文・reset再演奏 | 6,414,336 |
| 続行probe | 132,588 |
| wrapperの正の自己試験 | 83,816 |
| 実Synth | 12,136 |
| 実Genesis Engine生成（prefetch込み） | 19,808 |
| 合計 | 6,662,684 |

EngineからPlayerへ渡した13,140 frameは19,808生成frameの一部であり、再加算していない。
CLIは主63＋追加7の70実行。68種類の期待どおりの拒否とhelp／正常462比較が成功した。
入力上書き・alias・不正receipt／別ABI・実行中package範囲変更などを拒否し、入力を保持した。

## 対応ソースの配布

`copy_nuked_sources.mjs`は固定manifestと対象libraryの全入力を検証してから書き込む。
SDK core／header／wrapper・README／LGPL noticeとSDKのBSD noticeを使用し、standalone recipeの2箇所だけ`vendor/nuked-opn2`から`third_party/nuked-opn2`へ移す。
配布物の`sources/LICENSE.tetorica`はSDK `LICENSE`そのもの。アプリのymfm向けLICENSEで代用しない。
`sources/Nuked-OPN2.md`へ両noticeと再ビルド方法を記載した。

full runtimeの共通helperをFM npmも使い、従来の重複コピーを除いた。Analyzer・Synthにも同じhelperを適用し、Playgroundの既存helper経路も維持した。
配布ソースだけでEmscriptenを実行し、JS／WASMの一致を確認した。SDK dispatcher・Python importer・ネットワークは不要。
BSD notice追加は非コンパイルファイルだけの追加で、実compiler入力3ファイルとstandalone recipeは単独再ビルド時から不変。

notice補完前の証拠は`pre-notice/`へ保存し、helper変更を含む最終入力で2組のparityを再freeze／再実行・独立監査した。
音源やcompiler入力が変わらないため、成功済みPython／Nodeを無意味に繰り返していない。配布物はnoticeを含む最終版で再検証した。
READMEの「Nukedは配布物に含まれない」という古い記述も、実際のoptional module／対応ソース同梱に合わせて修正した。

## その他の検証

- offline importer／ビルド経路のPython 120件、YM2612／Genesis／Worklet／Mixer／既定値のNode 193件が成功した。
- active calibrationの66 source guardと3 generator checksは不変。Nukedはこれらのhash対象外で、既存測定記録の書換えや再校正値の追加は不要だった。
- Chromium／WebKitでpublic Nukedの6CH・pitch／pan／release／reset／owned PCMとMixerを確認した。
  Playgroundでも既存4 YM2612 route×3周波数を両browserで再測定し、実PC key操作を確認した。最終destination接続前からzero Gainを設けた。
  4 route×3周波数×2 browserの24 captureは、既存のprimary 0.9単位換算後に相対差1e-6以内で旧測定値へ一致した。
  実Analyzerの`?engine=nuked`でもowned PCM・state非対応、gain 0.775938・0.5への変更・mute／resetを確認した。
  Playgroundは実Nuked合成Worklet、Analyzerは主スレッドGenesis Engineと出力transportを使う既存経路。
- 最終FM npmは805ファイル・26 WASM engine・942参照と型／実installを検証した。
  tarballは1,592,203bytes、展開後5,937,047bytes。Analyzer ZIPは378ファイル、Synth ZIPは190ファイルで、最終Nuked生成pair・対応ソース・両noticeを同梱する。
  docs／実tar／install／両ZIPの68項目でソース・生成物・licenseを照合した。Analyzer ZIPはSynth／Genesis Engineを含みNuked合成Workletを含まない。Synth ZIPはNuked Worklet／Synthを含みGenesis Engineを含まない既存構成を保持する。

固定SDKを使うWASMは計26／27 artifact。残りは`dx7`。次はDX7を進める。
SDK原本・Tauri・Mixer値は変更していない。commit／push・公開・remote CI・Native実行・実機聴音は今回の対象外。
SPCのWebKit初期化中closeは引き続き別の未解決事項として残す。
