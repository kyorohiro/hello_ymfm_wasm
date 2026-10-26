# 32X PWM WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_pwm32x_wasm.sh`を同梱SDK `0.1.1`のWASMレシピへ切り替えた。
revisionは先行14 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルのoffline検証後にdispatcherを実行し、出力先を呼出し側から絶対化する。
C++14／O2／`-ffp-contract=off`、23 C export、`cwrap`／`HEAPU8`／`HEAPU16`／`HEAPF32`を維持する。
従来どおり`EXPORT_ALL`と明示的な`ASSERTIONS`指定、Perlのglue整理は行わない。

着手時の本体は`ad6f44da66c8ad96fccf8b302189463e0a9c235f`でcleanだった。
SDK／Tauriとpinは変更せず、先行14音源の記録・28出力を保持した。
公開API、Mixer値、同期JS参照実装と標準GenesisAudioEngineの`SimplePwm` defaultは変更していない。
対象は32Xの独立PWM endpoint、非同期factoryと、明示的なMAME-modelのEngine経路である。

## 入力・生成物と配布用ソース

本体とSDKの実装・ライセンス・由来記録7組がbyte一致した。
1翻訳単位・2実依存（wrapperとcore header）は個別catalogにもすべて列挙されている。
MAME由来のFIFO／routing／timerのBSD-3-Clauseと由来記録を保持する。

Emscripten `6.0.6-git`で、配布済み・旧手順再ビルド・SDK・docs・webの全組がbyte一致した。
JSは12,398bytes、WASMは10,636bytes。`web/generated/`にも実利用されるpairがあるため、こちらも照合した。
校正記録とMixer生成器は変更せず維持できた。hashと実行結果は[検証JSON](wasm_sdk_pwm32x_adoption_01.json)を参照する。

`copy_pwm_sources.mjs`は配布用ソースへmainの新shimをコピーすると単体buildできなくなるため、
固定SDKのstandalone recipe・core・wrapper・由来記録7ファイルをコピーするよう変更した。
manifest自体をpinへ照合し、必要な全入力を検証してから書き出す。READMEは明示出力引数を示す。
コピーしたsourceだけで実際にWASMを再buildし、検証済みJS／WASMとのbyte一致を確認した。
独立コピーでcore／recipe／manifestの改変を試し、出力作成前の拒否も確認した。
最終npm配布物とAnalyzer ZIPに同じ7入力を収録した。利用側のSDK checkout・Python・networkは不要。

## 比較と維持した仕様

専用checkerの旧再ビルド／配布済み版とSDKの両比較は、各864ケース（raw 744＋Engine 120）で差0。
432構成、同一instance復元336回・raw相互復元216回・reset／再演奏312回を含む2,592実行を比較した。
本文2,439,480＋probe 168,480＝2,607,960フレームに、正の自己試験32,394と実Player生成356,220を加え、
各2,996,574出力ステレオフレームとなる。補助JS参照7,680とPlayer引渡し290,240は重複加算していない。

- 深さ3のFIFO／overflow／read flagsとlive array、全16 routing、cycleの0／1／端点・再write時のflush、
  timer cadence／fractional phase、DAC／duty、clock／rate／gain／muteを比較した。
- 72byteのwasm32 `State`は構造体のmemcpyであり、ABI paddingと未使用FIFO slotを含む。
  比較はdecodeした有効fieldとPCMを使い、全raw byteの一致やportableなsnapshotとは扱わない。
  public stateは同一instance tokenで、clock／rate／gain／outputMode／muteを含まない。
- owned出力、要求長のborrowed view、reserve、`renderInto()`の部分領域、実容量／heap拡大とdisposeを確認した。
- 実FM／PSGを使うMAME-model Genesis混合、保存時点からの継続、実VgmPlayerの`0xb2`・
  16bit stream／12bit mask、forward／loop／reverse／stop、checkpoint／seekを確認した。
  active FMのresetをpower-onと同一とは扱わない。入力波形とVGMは独自作成。

## その他の検証

- Python75件が成功。先行14 routeの条件を保持し、1 TU／quoted header／FP flagsと改変のcompiler前拒否を確認した。
- 既存PWM／Genesis／CLI／Analyzer試験は最終51件すべて成功した。
  当初50成功／1失敗だったWAV比較は、手組みBrowser参照のcalibrated Mixer不足を旧byte同一環境でも再現した。
  試験だけに既存Mixerを設置し、stereo差を実gainへ換算した。WAV完全一致・reset・mute・stream・符号と精度の検査は維持した。
- Chromium／WebKitで追加PWMと32X通常mode（内部ID `genesis-full`）の計4 Worklet経路が成功。
  gain `0.128818`と振幅`0.12881800532341003`を維持した。Nukedの直接captureは含まない。
- 同じ両Browserで既存package runtimeをmainだけに絞って確認した。
  factory／Worklet／transportのPCM・Stop／restart／close、MegaSynthの混合・reset無音・再開、
  Playground schedule／frame進行と同梱Exampleが成功。最終destinationを接続前からzero gainとし、meter値は通常のまま使った。
  PWMの既存Keyboard試験caseはなく、Keyboard検証とは扱わない。Worker／Native／Audify／聴音は対象外。
- 最終npm配布物803ファイル・26 WASM engine・942相対参照と型・実行検証、Analyzer ZIP753参照・370ファイルが成功した。

README・ビルド文書・Save Pointも更新した。WASMの固定SDK参照は計15 artifact、残り12。
次はPC EngineのHuC6280が候補。npm／アプリ公開とremote CIは未実施。
