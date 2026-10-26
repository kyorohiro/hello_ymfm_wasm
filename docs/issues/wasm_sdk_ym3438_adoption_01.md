# YM3438 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_ym3438_wasm.sh`を同梱SDK `0.1.1`の`ym3438`ターゲットへ切り替えた。
固定revisionは先行21 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルをoffline検証し、出力先を絶対化してSDK dispatcherを実行する。
SDKの共有OPN-variant recipeを使い、C++14／O2・`OPN_VARIANT=ym3438`を維持する。
SSG flag、明示的なASSERTIONS／EXPORT_ALL、Perl cleanupは追加していない。
11 C export、runtimeの`cwrap`／`HEAPF32`、incomingの`wasmBinary`／`locateFile`を維持する。

着手時の本体は`8ad4aa8a4823e2c1797a19e51fbbaacbd864b332`でcleanだった。
担当agentへ分ける前に、旧レシピ・共有レシピ・既存出力・pin・SavePointの57ファイルを記録した。
本体の共有`build_opn_variant_wasm.sh`とYMF276／YMF288のレシピは変更していない。
SDK pin・原本、Tauri、公開APIとMixerの数値も変更していない。
22番目のreceipt、必須入力・ビルド経路試験、実WASM比較checkerと文書を更新した。
詳細なhash・検証結果は[検証JSON](wasm_sdk_ym3438_adoption_01.json)を参照する。

## 入力と生成物の差

実コンパイルは共有wrapperとOPN／ADPCM／SSG coreの4翻訳単位、quoted header closureは7ファイル。
全11入力は旧原本とSDKでbyte一致し、固定manifestとも一致する。BSD-3-Clauseと由来を保持する。
共有coreをコンパイルするが、今回の選択はYM3438で、SSG出力を追加するものではない。

生成JSは各経路で11,466bytes、SHA-256は`023cf6770e2cd0b9983f7a6793d55cc21c2de47750a19458567b6ccb11c3f81e`。
WASMのbytesは異なる。

| ビルド | bytes | SHA-256 |
| --- | ---: | --- |
| 配布済みdocs | 18,762 | `8868f560f070cab6cdd4e199f8ab48831143fb976451e3d1283eef8a791b98de` |
| 旧手順再ビルド | 18,762 | `93ec57db48022630d8be67a65f02e65ab3680dbfb5ce972902ab3cf4ea44df2a` |
| SDK・通常docs・今回のFM npm | 18,778 | `a6c49e22d9b5ff703a7f4da6df877e067dd494dc3e4354987e23151297b1d984` |

旧再ビルドとSDKには、埋め込まれた`src/ymfm_fm.ipp`／`src/ymfm_opn.cpp`と`vendor/ymfm/...`の差がある。
検証済みSDKの11入力を旧配置に置き、共有recipeの4箇所だけを`vendor/ymfm`から`src`へ移す一時ビルドで、旧再ビルドのJS／WASMを完全に再現できた。
この実験は配置差の切り分け用で、配布用source bundleを追加したものではない。

配布済みWASMと旧再ビルドはsize・data section・printable string集合が同じだがcode sectionのhashが異なる。
この過去の差の原因は確定しておらず、binary一致や過去の完全なsource provenanceは主張しない。
両方を別の基準として、SDK版との音声・read／status／IRQを比較した。
旧配置・SDK配置・通常出力のビルドでは同じ2件の既存compiler警告が出る。診断はパスを正規化すると一致し、抑制flagや無関係なcore修正は加えていない。

## APIとresetの比較条件

- `Ym3438`は既存`OpnVariant`を使う。4 bus portへのwrite／read、status・IRQとowned stereo PCMが公開API。
  通常OPNのbindingと異なり、native save／load・mute・borrowed／Into・低レベルobserver APIはない。
- `sampleRate(clock)`は`floor(clock / 144)`を計算するだけで、clockや生成rateを変更しない。
  比較で使う3つのpitch計算clockはF-numberを作る条件であり、動的clock設定やresampler試験とは扱わない。
- chip resetはFM register／operator phaseとadapter timer／IRQを初期化するが、一部のengine counterとDAC data／enable／addressを保持する。
  warm reset／再設定は同じ前歴を与えた旧／SDK同士で比較し、新規インスタンスと同じPCMになるとは仮定しない。
- `YM3438Synth`は実際の`OPNFMSynth`／`OPNDirectTransport`を使う。
  Synthの`getState()`はJS側のregister modelで、nativeの復元可能なsnapshotではない。
  音色・pitch／pan・release、モデル・callbackとregister転送は、この既存consumerとして確認した。
- YM3438用AudioEngine／VgmPlayer・RuntimeSynth・合成Workletの実装はない。
  Playground modeやAnalyzerの再生／header判別経路も追加していない。

## 実WASM比較

`scripts/check_ym3438_wasm_sdk.mjs`を独立レビュー後にfreezeした。
実行・source／build closure 48ファイル、ビルドsnapshot 7ファイル、過去の基準記録4ファイルの計59記録をコピーして照合した。
compiler入力は旧／SDK各11ファイルの計22。freezeしたcheckerと入力を実行し、終了後も原本／コピー双方のhashを照合した。

旧手順再ビルド／配布済みdocsの2組をそれぞれSDK版と比較した。
各組は75シナリオ×3 pitch計算clock×2 block分割の450比較、warm reset／再設定114回を含む1,014実行。
6CH・全algorithm／operator、LFO・SSG-EG・channel 3 special、timer／CSM、CMOS DAC、bus latch／stereoを含む。
本体PCM・続行probe、fixture event後とrender block後のread／status／IRQ、regular／irregular分割の差は0。
register eventはaddress／dataの2 write後に観測し、個別bus-byte fixtureは各byte後に観測する。全master clockのtraceではない。
2組は同じcoverageの反復で、固有ケースとして重複加算しない。

各組の両build合計は次のとおり。

| 実出力 | ステレオフレーム |
| --- | ---: |
| シナリオ本文・warm reset／再設定 | 6,230,016 |
| 127-frameの続行probe | 128,778 |
| wrapperの正の自己試験 | 39,250 |
| 実Synth consumer | 14,336 |
| 合計 | 6,412,380 |

独立の正の自己試験で6CHのpan、CMOS DACの値、timer／IRQの発生・clear、rate計算が合成を変えないことを確認した。
owned PCMのscratch上書き・capacity拡大・実heap拡大・dispose後の保持も確認した。
nativeの保存状態復元や実機精度を検証したという意味ではない。

## Browser・配布物・既存試験

- SDK import／ビルド経路のPython試験103件と、OPN variant／factory／tone／Mixer関連の既存Node試験58件が成功した。
  製品runtimeや既存試験の参照側修正はない。
- Chromium／WebKitで実public wrapper／direct Synthの6CH発音・pitch・pan・release・resetとowned PCMを確認した。
  実`SoundChipMixer.connect()`、上流のmeter、gain／pan／mute／Resetを使い、最初のdestination接続前から最終zero Gainを設けた。
  合成は主スレッドで、生成PCMをAudioBufferSourceから出力した。YM3438合成Workletや実Analyzer UIの試験ではない。
  未対応の`createWorkletSoundChip()`要求がmodule／context作成前に拒否されることも確認した。
- 最終checkerの独立CLI確認は60実行。help・正常実行と58種類の期待どおりの拒否が成功した。
  symlink／hardlink alias、入力配下・既存出力・依存上書き、不正loader／WASM／receiptを拒否し、入力を保持した。
- 校正の66 source hashと既存3 generator checksが成功した。YM3438は現在の測定対象外で、共通presetは従来どおりunity fallback。
  calibration値・過去の測定記録・hash guardは更新していない。
- FM npmの803ファイル・26 WASM engine・942参照と型／実行検証が成功した。
  実tarballは1,590,704bytes、展開後5,934,180bytes。install済みpackageでも6CHのdirect SynthとSDK assetの一致を確認した。
- Analyzer ZIPは753参照・370ファイルを検証した。
  既存どおり`ym3438.js`／`opn_variant.js`を含むが、YM3438の生成pair・named Synthは含まない。
  これらを同梱するのはfull runtime／FM npm側であり、AnalyzerのYM3438再生対応とは扱わない。
  実tarball・install済みpackage・ZIPで計21項目の資産・既存LICENSE／由来noticeを照合した。
- 調査中の配布範囲の誤った仮定と、一時package harnessの広すぎるsource-path判定は訂正し、初期記録・修正理由も保存した。
  productionや既存package構成を変える修正ではない。

固定SDKを使うWASMは計22／27 artifact。
残り5は`nuked_opn2`、`ymf276`、`ymf278b`、`ymf288`、`dx7`。次の候補はYMF276。
Native／Tauri、remote CI、hardware microphone・実機聴音・npmやアプリの公開は今回の対象外。
SPCのWebKit初期化中closeは引き続き未解決として別に残す。
