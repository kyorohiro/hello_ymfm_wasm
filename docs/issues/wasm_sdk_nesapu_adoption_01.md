# NES APU／FDS WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_nesapu_wasm.sh`を同梱SDK `0.1.1`のWASMレシピへ切り替えた。
固定revisionは先行17 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルをoffline検証し、呼出し側の出力先を絶対化してSDK dispatcherを実行する。
C++17／O2、wrap／alias／FP設定、例外設定、18 C export、runtime 5項目とincoming loader 5項目を維持する。
公開API、JS reference、Synth、機種用接続とMixer値は変更していない。

着手時の本体は`7ced3e9485835f9a7fc4d31a8fdd2dd418dee81c`でcleanだった。
SDK／Tauriとpinは変更せず、先行17音源の生成記録・34出力も保持した。
build receipt、必須入力・ビルド経路試験、配布用ソースのコピー、README・ビルド文書・Save Pointを更新した。

## 入力・生成物とライセンス

実装・ライセンス・作者・由来記録10組がbyte一致した。
2翻訳単位の実依存はwrapper・core cpp・core headerの3ファイルで、個別catalogにも列挙済み。
JSNES由来部分のApache-2.0、FDS由来部分のMIT、AUTHORSと由来記録を保持する。

Emscripten `6.0.6-git`で、配布済みdocs・旧手順再ビルド・SDK・通常出力・webのJS／WASMがすべてbyte一致した。
JSは16,041bytes、WASMは30,410bytes。既存校正記録11件とMixer生成器の検査も通り、音量調整は不要だった。
詳細なhash・試験結果は[検証JSON](wasm_sdk_nesapu_adoption_01.json)を参照する。

## 維持したAPI・観測情報

- 非同期`NesApu.create()`はWASM、同期`new NesApu()`は既存JS referenceを使う。
  2 pulse・triangle・noise・DMCと、作成時に許可したFDSを扱う。
- 64 KiBのRAM upload／read、64-byte FDS wave／32-entry modulation、5／6 voice mute、owned PCMとborrowed viewを維持する。
  resetはRAM・register・FDS table・合成履歴を消し、muteとC APIの現在clockを保持する。
- `getState()`は400byte・31項目の適用済み観測情報。RAM本体・filter履歴・resampler全状態を含む保存形式ではない。
  save／load APIやWASM checkpointは追加しない。観測の読出しは音声時刻を進めず、返す配列はコピーする。
- NESの非線形mix／filter履歴はmute中にも変化する。unmute後の音声が一度もmuteしなかった参照とbit一致するとは扱わず、
  同じmute履歴を与えた既存JS referenceのPCMと照合する。
- Cの`native_nes_set_clock`はbaseClockを残してclock converterを有効にする。reset後も有効なため、
  clock変更後の再演奏シナリオは最初からbase clockでconverterを有効にした同じ条件で比較する。
  公開wrapperの`clock` propertyは作成時の値で、現在のC clockは`getState().clock`で観測する。
- export済みCの`native_nes_stop`はRAM／waveを保持し、APU gateを止めてFDS gainを0にする。
  非exportの新しいchannel Stopとは区別する。公開wrapperへ新しい`stop()`は追加しない。
- 既存Analyzer／VgmPlayerのNES Engineは別のJS referenceで、そちらの保存状態機能は維持する。
  WASM用Player adapterを新設せず、今回のWASM比較をJS Playerのcheckpoint検証とは扱わない。

## 配布用ソースの再ビルド

mainの新しいshimをそのままコピーすると、source bundle単体ではSDK importerが見つからなくなる。
`scripts/copy_nes_sources.mjs`はpinのmanifest hashとSDKの10入力をすべて検証してから出力するよう変更した。
実装・wrapper・license・由来はSDKの検証済みbytesを使う。standalone recipeはcompiler flagsを保ち、
`vendor/tetorica-nes`の2箇所だけを既存bundle layoutの`third_party/tetorica-nes`へ移す。
既存のsource配置とJSNES／fixNESのnoticeも保持する。

bundleの`sources/`から`sh scripts/build_nesapu_wasm.sh docs/generated`を実行し、SDK pairとのbyte一致を確認した。
recipeの引数省略時は`dist/wasm/`。SDK checkout・Python importer・networkは不要。
隔離fixtureでcore・recipe・manifestの3種類の改変が、出力作成前に拒否されることも確認した。
npm／Analyzer ZIPにも同じ10入力とpath変換済みrecipeが収録される。

## 検証結果

旧手順再ビルドとSDK、配布済みdocsとSDKの2組で各912ケースが成功した。
31 APUシナリオ＋FDS追加14シナリオを、NTSC／PAL・3 rate・FDS有無・2 block分割で比較する。
FDSなし372＋あり540、456構成、reset／再演奏276回を含む2,100実行で差0。
本文2,150,400＋続行probe 203,700＝2,354,100出力ステレオフレームを比較した。
正の自己試験74,820を加えた実WASM出力は各2,428,920フレーム。
補助JS referenceの3,598フレームとnative内部tickは重複加算していない。

全31項目のcontrol直後／終端観測、64 KiBの実readback、DMC最終fetch IRQとaddress wrap・完了後の非再始動、
FDS IO／wave／modulationのgateとenvelope／master、C clock変更、bulkとsingle-sample生成も確認した。
owned配列は異なるscratch書込・実容量拡大・実heap拡大・dispose後も保持され、
borrowed viewと64 KiB upload stagingは確保済み領域を使う。0〜128 frameの再利用はnative mallocを呼ばないことを確認した。

VGMは実parserの`0xb4`とtype `0xc2` RAM blockをrecording targetへdispatchして確認した。
これはparser単体の確認で、WASM Player／checkpointのintegrationとは扱わない。
既存JS VGM／FDSの回帰試験は別途実行した。

- Pythonのimport／ビルド経路87件、NES／FDS／Synth／voice panel／VGM関連の既存試験77件が成功した。
- Chromium／WebKitで主NESと追加NESの計4 Worklet経路を確認した。既存Mixer値`1.16`、振幅`0.0747143067419529`を維持した。
- 同じ両BrowserのWeb Audio／mainで既存NES WASM試験を絞って実行した。
  pulse／FDSのpitch、DMC、全6CH Keyboard、Operatorsのpulse／FDS編集・Hold／外側release、Stop後のwave／RAM保持が成功した。
  processorからの観測でWASM backend・単一primary・隠れたFMなしを確認した。
  最初の接続前から最終zero gainを設け、音源・Mixer／monitor値は通常のまま使った。
  元の試験・本体は変更せず一時harnessを使い、Workerとpackage用Browserケースは実行していない。
- npm配布物の803ファイル・26 WASM engine・942参照と型／実行検証が成功した。
  tarballは1,590,486bytes、展開後5,933,627bytes。
- Analyzer ZIPの753参照・370ファイル、収録WASMとsource bundleの一致を確認した。Analyzerの既存JS NES再生経路は変更していない。

固定SDKのWASM参照は計18 artifact、残り9。次はSNES／SPCが候補。
Native backend、remote CI、実機の聴音、npm／アプリの公開は今回の対象外。
