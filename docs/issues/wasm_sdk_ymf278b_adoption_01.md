# YMF278B WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_ymf278b_wasm.sh`を同梱SDK `0.1.1`の`ymf278b`ターゲットへ切り替えた。
先行24 artifactと同じrevision `e4b7d7ecef60e3927ac04815cd9f985f62c82f04`の379ファイルをoffline検証し、caller基準で絶対化した出力先をSDK dispatcherへ渡す。
C++14／O2、`EXPORT_ALL`、15 C export、runtimeの`cwrap`／`HEAPF32`／`HEAPU8`、incomingの`wasmBinary`を維持した。
明示ASSERTIONSやPerl cleanupは追加していない。

着手時の本体は`a74a893c783056e5f371b52fd09700414ccb1139`でcleanだった。
担当を分ける前に旧レシピ・pin・SavePoint・既存出力の56ファイルを記録した。
SDK原本・pin、Tauri、他のビルドレシピ、公開API・音源処理・Mixer数値は変更していない。
25番目のreceipt、必須recipe・4件のビルド経路試験、比較checker・文書を追加した。
実測に基づくAnalyzer校正記録の後継03と、既存WAV比較試験の参照側修正も含む。
詳細は[検証JSON](wasm_sdk_ymf278b_adoption_01.json)を参照する。

## ソース・生成物

wrapperとOPL／ADPCM／PCM coreの4翻訳単位、quoted header 7ファイルの全11入力が旧原本とSDKでbyte一致する。
固定manifestとBSD-3-Clauseの由来・ライセンスを保持した。
生成JSは全経路15,707bytes、SHA-256 `90bdbac9c20f5afd286e26033118a7d71d548307638b0caf417bbebb06447d48`。

| WASM | bytes | SHA-256 |
| --- | ---: | --- |
| 配布済み・旧手順再ビルド | 26,811 | `001442e4d5f8ca18bd90094fbd70442d0e9dfcb944cc936b1de4372e988f849b` |
| SDK・通常docs・FM npm・Analyzer ZIP | 26,827 | `6bfd3214793073de8b54230fbacb9f67ddf64010c8052c3d026135ffb077ce30` |

今回は配布済み版と旧再ビルドのJS／WASMが完全一致した。
検証済みSDKの11入力を旧配置へ置き、recipeの4箇所だけ`vendor/ymfm`から`src`へ移した一時buildは両方を再現した。
埋め込まれた`ymfm_fm.ipp`／`ymfm_opl.cpp`のパス差を切り分ける実験で、配布ソースbundleの追加ではない。
旧／SDK／通常／配置比較の4 buildでcompiler警告は出ていない。

## 維持したAPIと比較条件

- 18FM・24PCMの混合DO2出力を16-bit clamp後に正規化する。FM bus 2／3のDO0とPCM bus 2／3のDO1はDO2へ合算しない。
  全FM／PCM channel、4OP pairと独立mute、8／12／16-bit sample・loop／envelope／pitch／panを比較した。
- native rateは`floor(clock / 768)`、標準33,868,800 Hzでは44,100 Hz。`sampleRate(clock)`は計算で、clock setterではない。
  Engineのclock設定は既存の出力frame accumulator／平均化・保持によるrate変換へ反映する。
- サンプルメモリーは最大4 MiB。partial load、growのzero fill、shrink／再grow、clear、bus RAMアクセスと範囲検証を維持した。
  native RAMへのbus writeはJSのupload mirrorを更新しない。public resetはchipを作り直し、そのJS mirrorと18FM／24PCM mute maskを再適用する。
- raw C resetはnative RAM・一部free-running counter・address latch・FM fractional positionを保持する。
  interface自体は再生成しないが、FM reset callbackはtimerの取消し・IRQ resetを行う。public resetと同じ状態復元とは扱わない。
- 同期write／read／status／IRQ・hookとowned `generateStereo()`を保持する。native snapshot・borrowed／Into・named Synthは追加しない。
  最初のstatus readはchip IDを消費し、NEW2切替でもID通知が発生する。通常観測から破壊的なPCM port 5 readを除き、RAM readは専用fixtureで確認する。
  hookはAPI境界の通知で、全master clockのtraceやhardware busy timingではない。
- 既存`Ymf278bAudioEngine`・`VgmPlayer`・Analyzer経路を使う。seekは先頭から再演奏する既存方式で、checkpoint復元ではない。
  PCM・2 MiB外部ROM用データはすべて独自の合成波形で、実機YRW801 ROMは配布していない。

## 実WASM比較

独立レビュー後の`scripts/check_ymf278b_wasm_sdk.mjs`と入力をfreezeした。
実行・source closure 68、build snapshot 7、過去の基準記録3の計78記録を両比較の前後で再照合した。
実compiler入力は旧／SDK各11の22。より広いSDK provenance 33とpackage範囲guard 17も記録する。
これらは重複・存在しないpackageパスの確認を含むため、固有入力として加算しない。

旧再ビルド／配布済み版をそれぞれSDKと比較した。旧2組は同一binaryであり、coverageを重複加算しない。
各684比較・1,508実行（public reset再演奏140回を含む）でPCM・127-frame続行probe・read／status／IRQ・hookの差は0。
raw chipと既存Engineの計342設定を通常／不規則blockで比較し、実Playerの2 clock×4 rate、synthetic外部ROM保持も確認した。
各組の両buildで生成した実出力は次のとおり。

| 実出力 | ステレオフレーム |
| --- | ---: |
| シナリオ本文・reset再演奏 | 6,176,768 |
| 続行probe | 191,516 |
| wrapperの正の自己試験 | 605,762 |
| Engine controlと独立手組みsource | 25,348 |
| 実VGM Engine・seek prefix | 448,386 |
| 合計 | 7,447,780 |

Engineの内部native生成はEngine出力と重複加算しない。Playerの引渡し済みframeも別のviewとして扱い、再加算していない。
wrapper controlsでは独立のformat decode／DO2 routing、native RAMとupload mirrorの差、4 MiB端点、reset、mute、timer、実heap拡大／dispose後のPCM保持を確認した。
CLIは主62＋追加7の69実行。67種類の期待どおりの拒否とhelp／正常684比較が成功した。
alias・依存／入力上書き・不正receipt・実行中package範囲変更・別音源YMF262のABIを拒否し、入力を保持した。

## 校正・Browser・配布物

- Analyzerの既存[02記録](analyzer_extra_levels_02.json)を保存し、新buildで6 route×3周波数の18行を実測した。
  sources以外の全項目、測定値・PCM hash・分割差・defaultsが厳密一致した。変化したsourceはYMF278B WASMのhash／sizeだけ。
  実測結果を[03記録](analyzer_extra_levels_03.json)へ保存し、generatorと生成commentを03参照へ変更した。hashだけの更新ではない。
  AnalyzerのYMF278B値`1.465915`、FM packageのunity fallbackを含む全数値は維持した。PCM音色や実機の混合比を新たに校正したものではない。
- Chromium／WebKitでpublic factory・既存FM helper・Engineを使い、18FM／24PCM、pitch／pan／mute／reset、4 MiB memory・owned PCMを確認した。
  実`SoundChipMixer`と上流meterを使い、最初のdestination接続前から最終zero Gainを設けた。
- 実Analyzer UIでも両browserのFM・embedded PCM・混合・PSGの4例を再生した。
  既存AudioEngine／VgmPlayerとAudioWorklet出力transport、Mixer表示147%・値1.465915、0.5への変更・mute・resetを確認した。
  音源合成は既存の主スレッドEngineであり、chip合成Workletを新設したものではない。
- active source guards 66、既存3 generator checks、runtime／数値関連27ファイルの不変を確認した。
- FM npmは803ファイル・26 WASM engine・942参照と型／実installの検証が成功した。
  tarballは1,590,692bytes、展開後5,934,228bytes。Analyzer ZIPは753参照・370ファイルを検証した。
  今回のAnalyzer ZIPには生成pair・wrapper・AudioEngine・VgmPlayerを含む。狭いZIPには`opl_synth.js`を含まない既存構成を保持した。
  実tar／install／ZIPの資産・LICENSE／notice計23項目を照合した。

## 既存試験と参照側の修正

Python SDK試験115件が成功した。OPL4・Mixer・校正・VGM render／export／notes／samplesのNode試験は最終106件が成功した。
初回は105成功／1失敗で、手組みBrowser engineとCLIのWAV比較だけが失敗した。
SHAを検証した配布済みWASMを一時loaderで注入して同じ失敗を再現し、SDK移行による変化ではないことを確認した。
手組み側にCLI／Analyzerと同じ既存`installPlaybackMixer()`を追加した試験だけの修正で、旧WASMの2件・SDK版の全106件が成功した。
期待WAVやgain値の書換え、productionの音源／Mixer修正は行っていない。

先行24 receipt・他50生成JS／WASM、SDK379ファイル・pin、過去の校正記録、SavePointの旧記録を保持した。
固定SDKを使うWASMは計25／27 artifact。残り2は`nuked_opn2`と`dx7`。次の候補はNuked OPN2。
commit／push・公開・remote CI、Native／Tauri・実機聴音は今回の対象外。
SPCのWebKit初期化中closeは引き続き別の未解決事項として残す。
