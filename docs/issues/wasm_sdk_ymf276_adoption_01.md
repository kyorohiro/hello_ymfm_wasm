# YMF276 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_ymf276_wasm.sh`を同梱SDK `0.1.1`の`ymf276`ターゲットへ切り替えた。
固定revisionは先行22 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルをoffline検証し、出力先を絶対化してSDK dispatcherを実行する。
SDKの共有OPN-variant recipeを使い、C++14／O2・`OPN_VARIANT=ymf276`を維持する。
SSG flag、明示的なASSERTIONS／EXPORT_ALL、Perl cleanupは追加していない。
11 C export、runtimeの`cwrap`／`HEAPF32`、incomingの`wasmBinary`／`locateFile`を維持する。

着手時の本体は`64946c842d0365873f578dd088088b73691dd50a`でcleanだった。
担当agentへ分ける前に、旧レシピ・共有レシピ・既存出力・pin・SavePointの57ファイルを記録した。
本体の共有`build_opn_variant_wasm.sh`、YM3438のSDK shim、YMF288の既存レシピは変更していない。
SDK pin・原本、Tauri、公開APIとMixerの数値も変更していない。
23番目のreceipt、必須入力・ビルド経路試験、実WASM比較checkerと文書を更新した。
詳細なhash・検証結果は[検証JSON](wasm_sdk_ymf276_adoption_01.json)を参照する。

## 入力と生成物の差

実コンパイルは共有wrapperとOPN／ADPCM／SSG coreの4翻訳単位、quoted header closureは7ファイル。
全11入力は旧原本とSDKでbyte一致し、固定manifestとも一致する。BSD-3-Clauseと由来を保持する。
共有coreをコンパイルするが、今回の選択はYMF276で、SSG出力を追加するものではない。

生成JSは各経路で11,466bytes、SHA-256は`76bef5969998cf45fe3d1452592b5bc74f9f1c363740a9b011f8d5462ddd096c`。
WASMのbytesは異なる。

| ビルド | bytes | SHA-256 |
| --- | ---: | --- |
| 配布済みdocs | 18,797 | `41b5fc30e6bb06b12fd60adf39fc78e696924690bb917987dba0929501a16ae0` |
| 旧手順再ビルド | 18,797 | `6f05073cb4d9da741a12e908097af3e9b27cd52e1942966c3df758b15475073a` |
| SDK・通常docs・今回のFM npm | 18,813 | `c5c06bc94d0dec355c9acea7c408bb85c82b169666fdc47cc9bc7f0f6033bc01` |

旧再ビルドとSDKには、埋め込まれた`src/ymfm_fm.ipp`／`src/ymfm_opn.cpp`と`vendor/ymfm/...`の差がある。
検証済みSDKの11入力を旧配置に置き、共有recipeの4箇所だけを`vendor/ymfm`から`src`へ移す一時ビルドで、旧再ビルドのJS／WASMを完全に再現できた。
この実験は配置差の切り分け用で、配布用source bundleを追加したものではない。

配布済みWASMと旧再ビルドはsize・data section・printable string集合が同じだがcode sectionのhashが異なる。
この過去の差の原因は確定しておらず、binary一致や過去の完全なsource provenanceは主張しない。
両方を別の基準として、SDK版との音声・read／status／IRQを比較した。
旧配置・SDK配置・通常出力のビルドでは同じ2件の既存compiler警告が出る。診断はパスを正規化すると一致し、抑制flagや無関係なcore修正は加えていない。

## APIとresetの比較条件

- `Ymf276`は既存`OpnVariant`を使う。4 bus portへのwrite／read、status・IRQとowned stereo PCMが公開API。
  通常OPNのbindingと異なり、native save／load・mute・borrowed／Into・低レベルobserver APIはない。
- `sampleRate(clock)`は`floor(clock / 144)`を計算するだけで、clockや生成rateを変更しない。
  比較で使う3つのpitch計算clockはF-numberを作る条件であり、動的clock設定やresampler試験とは扱わない。
- chip resetはFM register／operator phaseとadapter timer／IRQを初期化するが、一部のengine counterとDAC data／enable／addressを保持する。
  warm reset／再設定は同じ前歴を与えた旧／SDK同士で比較し、新規インスタンスと同じPCMになるとは仮定しない。
- `YMF276Synth`は実際の`OPNFMSynth`／`OPNDirectTransport`を使う。
  Synthの`getState()`はJS側のregister modelで、nativeの復元可能なsnapshotではない。
  音色・pitch／pan・release、モデル・callbackとregister転送は、この既存consumerとして確認した。
- YMF276用AudioEngine／VgmPlayer・RuntimeSynth・合成Workletの実装はない。
  Playground modeやAnalyzerの再生／header判別経路も追加していない。

## 実WASM比較

`scripts/check_ymf276_wasm_sdk.mjs`を独立レビュー後にfreezeした。
実行・source closure 67ファイル、ビルドsnapshot 7ファイル、過去の基準記録4ファイルの計78記録をコピーして照合した。
reportにはより広いSDK由来34入力とpackage範囲guard 14件も記録する。これらは重複や存在しないpackageパスの確認を含む分類で、固有入力として加算しない。
compiler入力は旧／SDK各11ファイルの計22。freezeしたcheckerと入力を実行し、終了後も原本／コピー双方のhashを照合した。

旧手順再ビルド／配布済みdocsの2組をそれぞれSDK版と比較した。
各組は77シナリオ×3 pitch計算clock×2 block分割の462比較、warm reset／再設定120回を含む1,044実行。
6CH・全algorithm／operator、LFO・SSG-EG・channel 3 special、timer／CSM、YMF276固有の14-bit FM／DAC shift、bus latch／stereoを含む。
本体PCM・続行probe、fixture event後とrender block後のread／status／IRQ、regular／irregular分割の差は0。
register eventはaddress／dataの2 write後に観測し、個別bus-byte fixtureは各byte後に観測する。全master clockのtraceではない。
2組は同じcoverageの反復で、固有ケースとして重複加算しない。

各組の両build合計は次のとおり。

| 実出力 | ステレオフレーム |
| --- | ---: |
| シナリオ本文・warm reset／再設定 | 6,414,336 |
| 127-frameの続行probe | 132,588 |
| wrapperの正の自己試験 | 107,080 |
| 実Synth consumer | 14,336 |
| 合計 | 6,668,340 |

独立の正の自己試験で6CHのpan、timer／IRQの発生・clear、rate計算が合成を変えないことを確認した。
YMF276固有の14-bit FM経路を維持し、DACは256 data code×2 ninth-bit×4 panの2,048通りを正の期待値と照合した。
既存coreのDAC右shiftによりninth bitが落ち、選択した側の値が`(code - 128) / 32768`になることを確認する。
実YM3438の生成pairをYMF276名にした負の対照はABIを通るが、このDAC検査で拒否される。
owned PCMのscratch上書き・capacity拡大・実heap拡大・dispose後の保持も確認した。
nativeの保存状態復元や実機精度を検証したという意味ではない。

## Browser・配布物・既存試験

- SDK import／ビルド経路のPython試験107件と、OPN variant／factory／tone／Mixer関連の既存Node試験58件が成功した。
  製品runtimeや既存試験の参照側修正はない。
- Chromium／WebKitで実public wrapper／direct Synthの6CH発音・pitch・pan・release・resetとowned PCMを確認した。
  実`SoundChipMixer.connect()`、上流のmeter、gain／pan／mute／Resetを使い、最初のdestination接続前から最終zero Gainを設けた。
  合成は主スレッドで、生成PCMをAudioBufferSourceから出力した。YMF276合成Workletや実Analyzer UIの試験ではない。
  未対応の`createWorkletSoundChip()`要求がmodule／context作成前に拒否されることも確認した。
- 最終checkerのCLI確認は主試験60実行と追加7実行の計67実行。help・正常実行と65種類の期待どおりの拒否が成功した。
  symlink／hardlink alias、入力配下・既存出力・依存上書き、不正loader／WASM／receipt、wrong-core対照を拒否し、入力を保持した。
- 校正の66 source hashと既存3 generator checksが成功した。YMF276は現在の測定対象外で、共通presetは従来どおりunity fallback。
  calibration値・過去の測定記録・hash guardは更新していない。
- FM npmの803ファイル・26 WASM engine・942参照と型／実行検証が成功した。
  実tarballは1,590,695bytes、展開後5,934,196bytes。install済みpackageでも6CHのdirect SynthとSDK assetの一致を確認した。
- Analyzer ZIPは753参照・370ファイルを検証した。
  既存どおり`ymf276.js`／`opn_variant.js`を含むが、YMF276の生成pair・named Synthは含まない。
  これらを同梱するのはfull runtime／FM npm側であり、AnalyzerのYMF276再生対応とは扱わない。
  実tarball・install済みpackage・ZIPで計21項目の資産・既存LICENSE／由来noticeを照合した。
- 一時consumerの事前確認とcompiler prefixの判定修正、sandboxのlisten EPERMを初期記録とともに保存した。
  同じbrowser harnessは必要な権限を付けて成功した。
  productionや既存package構成を変える修正ではない。

固定SDKを使うWASMは計23／27 artifact。
残り4は`nuked_opn2`、`ymf278b`、`ymf288`、`dx7`。次の候補は共有OPN-variantの残るYMF288。
Native／Tauri、remote CI、hardware microphone・実機聴音・npmやアプリの公開は今回の対象外。
SPCのWebKit初期化中closeは引き続き未解決として別に残す。
