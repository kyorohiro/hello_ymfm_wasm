# Game Boy APU WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_gameboy_apu_wasm.sh`を同梱SDK `0.1.1`のWASMレシピへ切り替えた。
固定revisionは先行16 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルをoffline検証し、呼出し側の出力先を絶対化してSDK dispatcherを実行する。
`EMXX`、C++17／O2、11 C export、`cwrap`／`HEAPF32`とmemory growthを維持する。
元のレシピにEXPORT_ALL・明示的ASSERTIONS・Perlによる後処理はない。
公開JS API、Synth、機種用接続とMixer値は変更していない。

着手時の本体は`8136696cba9b9b6b407c206c29a8e20de129da61`でcleanだった。
固定SDK／Tauriとpinは変更せず、先行16音源の生成記録・32出力も保持した。
build receipt、importer必須入力とビルド経路試験、README・ビルド文書・Save Pointを更新した。

## 入力・生成物

実装・ライセンス・由来記録8組のうち7組はbyte一致する。
残るcore headerはSDK側に`NativeGameboyAccess`のfriend宣言とコメントだけが追加されている。
その1行を除けば一致し、DSP・データfield・WASM出力への変更はない。
2翻訳単位の実依存はwrapper・core cpp・core headerの3ファイルで、個別catalogにも列挙済み。
MAME適応版と原本のBSD-3-Clause宣言・由来を保持する。

Emscripten `6.0.6-git`で、配布済みdocs・旧手順再ビルド・SDK・通常出力のJS／WASMがすべてbyte一致した。
JSは11,497bytes、WASMは13,782bytes。既存校正記録11件とMixer生成器の検査も通り、音量調整は不要だった。
詳細なhash・試験結果は[検証JSON](wasm_sdk_gameboy_adoption_01.json)を参照する。

### 古い直接Web用生成物の同期

`web/generated/`だけに、保存状態exportのない旧pair（JS 11,257bytes／WASM 13,377bytes）が残っていた。
直接Web用のprimary／generic Workletはこのpairを使うが、docs・npm配布物は上記のdocs pairを使っていた。
旧Web版を別途凍結し、共通のregister／mute／reset／owned PCMだけでSDK版と比較した。
15シナリオ×9 clock／rate構成×2 block分割＝270ケース・1,158,300出力フレームで差0だった。
2 pulseの全duty・sweep、waveの3 level、7／15bit noise、4 voice混合、pan／volume／power／mute／resetを含む。
旧Web版の保存状態互換性は主張しない。

その後、Webの2生成物をテスト済みSDK pairへ同期した。既存docs版と同じ保存状態exportを利用できる。
旧Webのhash・export一覧・比較用一時scriptの全文とcase manifestは別証拠として保存する。
main checkerの旧配布版比較と、旧Web比較の範囲を区別する。

## 維持した音源・状態の仕様

- DMGの2 pulse・32×4bit wave・7／15bit noiseを生成する。CGB等の別variantは追加しない。
- 8192 CPU cycleごとの8-step sequencerがlength／sweep／envelopeを進める。
  コアの既存trigger・length-enableの追加clockや、wave再生中のRAM書込windowも維持する。
- NR51は上位nibbleが左、下位が右。現在のコアのNR50は下位3bitが左、上位3bitが右。
  この移行では実機仕様への変更を混ぜず、既存のmappingを比較する。
- 出力frameの時間に重なるnative tickの保持sampleを、整数位相とdurationで重み付けして積分する。
  最初のtickは即時に実行する。muteは合成後のvoiceごとのmixに適用し、位相は進める。
- NR52 power-offはwave RAMを保持する。一方resetはDMG初期16-byte patternと合成時刻を復元し、host muteを保持する。
- native stateは16-byteのmagic／size／rate／clock headerとC++ objectコピーで、今回のwasm32では312bytes。
  wave RAM・位相・保持sample・mute・rate／clockを含み、ABI paddingも含む。
  比較するのはheaderと復元後PCMの完全一致で、paddingを含むpayload全byte一致やportable形式とは扱わない。
- native loadはpointer・全size・headerと復元先／bodyのrate／clockを検査する。
  信頼した同一build形式の状態に限り、任意の内部fieldを壊すfuzzや深い不正状態検証は行わない。
- 公開chip stateは同一instanceのWeakMap token。Engine stateはさらにrate／volume／channelMaskの一致を要求する。
  `generateStereo()`と`processFrames()`はowned配列で、Engineの`process(left,right,n)`はそれをcaller bufferへコピーする。
  read／status／IRQ、低レベルInto・borrowed view APIは追加しない。

## 検証範囲

専用checkerは旧手順再ビルドとSDK、配布済みdocsとSDKの2組で比較する。
各876ケース（chip 816＋Engine 60）、438構成が成功した。
同一instanceの状態復元192回、信頼したraw状態の相互復元132回、reset／再演奏276回を含む2,352実行で差0。
本文2,209,836＋続行probe 228,144＝2,437,980出力ステレオフレームを比較した。
正の自己試験126,486＋実Player生成313,440を加えた合計は各2,877,906フレーム。
内部native tickとPlayer引渡し248,840フレームは重複加算していない。

独立したsquare／wave／noise model、全256 NR51 mask、NR50の左右倍率、wave RAMの書込windowと初期pattern、
length切れ・sweep overflow・envelope clock・mute中の位相継続・低clock時の即時tick／muteを確認した。
owned出力は後続生成・実容量拡大・実WASM heap拡大・dispose後も保持されることを確認した。
VgmPlayerは実際の`0xb3`命令と4 voiceを使い、実checkpoint／seekとopaque Player stateからの続行を比較する。

- Pythonのimport／ビルド経路試験83件と、Game Boy APU／Synth／voice panel／Analyzer／lessonの既存試験79件が成功した。
- Chromium／WebKitで主Game Boyと追加Game Boyの計4 Worklet経路を確認した。
  既存Mixer値`0.36`、振幅`0.09000000357627869`を維持した。
- 同じ両BrowserのWeb Audio／mainで既存の2つのKeyboard試験をGame Boyだけに絞って確認した。
  editor側はpulse 0／1、初回Run前の発音、floating／dockの対象保持、channel変更・古いkeyup・画面離脱・Stopを確認した。
  Chip／CH routing側はwaveとnoiseの発音・release・選択と最終Stopを確認した。
  合計4 voiceを扱う。最初の接続前から最終zero gainを設け、音源・Mixer／monitor値は通常のまま使った。
  元の試験・本体は変更せず、既存filterと一時harnessを使用した。
- 隔離npm配布物の803ファイル、26 WASM engine、942相対参照と型・実行検証が成功した。
  tarballは1,590,432bytes、展開後5,933,288bytes。既存packageのGame Boy sampler検証も通った。
- Analyzer ZIPの753ローカル参照、370ファイルと収録Game Boy JS／WASMの一致を確認した。

固定SDKのWASM参照は計17 artifact、残り10。次はNES APU／FDSが候補。
Native backend、remote CI、実機の聴音、npm／アプリの公開は今回の対象外。
