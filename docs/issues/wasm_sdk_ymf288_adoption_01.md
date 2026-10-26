# YMF288 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_ymf288_wasm.sh`を同梱SDK `0.1.1`の`ymf288`ターゲットへ切り替えた。
先行23 artifactと同じrevision `e4b7d7ecef60e3927ac04815cd9f985f62c82f04`の379ファイルをoffline検証する。
出力先をcaller基準で絶対化し、SDK dispatcherを実行する。
共有OPN-variant recipeのC++14／O2・`OPN_VARIANT=ymf288`・`OPN_HAS_SSG`を維持した。
11 C export、runtimeの`cwrap`／`HEAPF32`、incomingの`wasmBinary`／`locateFile`を保持し、明示ASSERTIONS／EXPORT_ALL／Perl cleanupは追加しない。

着手時の本体は`b1a05ef17f34e92f81a6db0fd6ba8805ed52f26a`でcleanだった。
担当を分ける前に旧レシピ・共有レシピ・pin・SavePoint・既存出力の57ファイルを記録した。
SDK原本・pin、Tauri、共有アプリレシピ、先行YM3438／YMF276のshim、公開API・Mixerの数値は変更していない。
24番目のreceipt、必須recipe・4件のビルド経路試験、比較checker・文書を追加した。
詳細なhashと実行結果は[検証JSON](wasm_sdk_ymf288_adoption_01.json)を参照する。

## 入力と生成物

共有wrapperとOPN／ADPCM／SSG coreの4翻訳単位、quoted header 7ファイルの全11入力は旧原本とSDKでbyte一致する。
固定manifestとBSD-3-Clauseのライセンス・由来を保持した。記録上の広いSDK provenanceと実コンパイル入力は区別する。
生成JSは各経路で11,466bytes、SHA-256 `9e98de8c8649cce49f8a8dcb12bbd0679f0f591a0d1c0c16a1c4c82ce263dd86`。
WASMのbytesは異なる。

| ビルド | bytes | SHA-256 |
| --- | ---: | --- |
| 配布済みdocs | 23,803 | `b28340f9a0e9b1d3143a01c49d7644244df2b5f2c3639812bec1c81ea3a2e218` |
| 旧手順再ビルド | 23,803 | `6d25e8dcd645dceb2137230f27adfda82887f3f487d4a31629c20f29bc33f8c8` |
| SDK・通常docs・今回のFM npm | 23,819 | `34b4211983b0af5bc7479809d949693164b34e2a94e01db1a77abe545d6f4f23` |

SDKの検証済み11入力を旧配置へ置き、共有recipeの4箇所だけを`vendor/ymfm`から`src`へ移した一時buildは、旧再ビルドのJS／WASMを完全に再現した。
埋め込まれる`src/ymfm_fm.ipp`／`src/ymfm_opn.cpp`とSDK配置の差を切り分ける実験であり、配布ソースbundleの追加ではない。
配布済み版と旧再ビルドはsize・data section・printable string集合が同じで、code sectionは異なる。
この過去の差の原因は確定しておらず、過去のbinary／source完全一致を主張しない。両方を別基準としてSDKと比較した。
4経路のbuildには同じ既存compiler警告2件があり、パス正規化後の診断は一致する。抑制flagやcore変更は追加していない。

## YMF288固有の比較条件

- `Ymf288`は既存`OpnVariant`の4 bus port write／read・status／IRQ・owned stereo PCMを使う。
  native save／load・mute・borrowed／Into・ROM load・低レベルobserver APIはない。
- 最大fidelityの出力rateは`floor(clock / 16)`、標準8 MHzでは500,000 Hz。
  `sampleRate(clock)`は計算だけで合成状態を変えない。3 pitch計算clockはF-number生成条件で、動的clock／rate変更やresampler変更の試験ではない。
  FM内部prescaleは6、FM出力は9生成frameごとに更新する既存経路。SSGの有効clockは入力clock／4。
- `OPN_HAS_SSG`のresetはHandleを同じアドレスに再構築する。SSG resampler・保持FM・timer／IRQも初期化するため、今回は新規インスタンスとのreset再現比較が可能。
  YM3438／YMF276のwarm reset条件を流用していない。
- low-level resetはFM 3CH。`YMF288Synth.reset()`の`0x29=0x83`で6CHを有効にする。
  Synthは既存のFM-only `OPNFMSynth`／`OPNDirectTransport`で、`getState()`はJS register model。native復元snapshotではない。
- mono SSGの第3出力を左右それぞれのFM出力へ加算してclampする既存wrapperを使う。
  3 tone／noiseと16 envelope、FMとの加算を実PCMで確認する。独立の加算controlはclamp前の範囲で、飽和境界の全数検査ではない。
- `0x20` bit 1によるFM register readback、ID `0xff=2`、削除されたI/Oの`0xff`、bank latchとhigh data readの0を確認する。
  CSM bitはcoreが除去する。DAC／ADPCM-Bはない。busyは共通interfaceが常にfalseを返すため、hardware busy timingは検証対象外。
- rhythm engineの6CHにはROMアドレス範囲があるが、bindingにROM loadやexternal read overrideはない。
  既存のzero external readで発生する人工的なdecode PCMとregister制御を比較した。実機のrhythm音色やROM再生を確認したという意味ではない。

## 実WASM比較

`scripts/check_ymf288_wasm_sdk.mjs`を独立レビュー後にfreezeした。
実行・source closure 67、build snapshot 7、過去の基準記録4の計78記録をコピーし、両比較の前後で原本・コピーを照合した。
実compiler入力は旧／SDK各11の計22。reportには広いSDK由来34入力とpackage範囲guard 14件も記録する。
これらは重複や存在しないpackageパスの確認を含む分類で、固有入力として加算しない。

旧再ビルド／配布済み版をそれぞれSDKと比較した。各組は101シナリオ×3 pitch計算clock×2分割の606比較。
reset／再設定150回を含む1,362実行で、PCM・続行probe・fixture event後とblock後のread／status／IRQの差は0だった。
FM 6CH・algorithm／operator・LFO／SSG-EG、3／6CH切替、SSG tone／noise／envelope、mode／ID／timer／IRQ mask、rhythm制御、reset・実direct Synthを含む。
register eventはaddress／dataの2 write後、個別bus-byte eventは各byte後に観測する。全master clockのhardware traceではない。
2組は同じcoverageの反復であり、固有ケースとして加算しない。

各組の両buildで生成した実出力は次のとおり。

| 実出力 | ステレオフレーム |
| --- | ---: |
| シナリオ本文・reset／再設定 | 8,368,128 |
| 127-frameの続行probe | 172,974 |
| wrapperの正の自己試験 | 254,050 |
| 実Synth consumer | 14,336 |
| 合計 | 8,809,488 |

正のcontrolで独立のFM／SSG・加算、mode／ID、timer／IRQ、rate計算、Handle再構築resetを確認した。
scratch上書き・capacity／実heap拡大・dispose後にもowned PCMが保持されることを確認した。
CLIは主試験60＋追加7の67実行。65種類の期待どおりの拒否とhelp／正常606比較が成功した。
alias・入力／依存上書き・不正loader／WASM／receipt・実YM3438誤接続・実行中package範囲変更を拒否し、入力を保持した。

## Browser・配布物・既存試験

- Pythonはbuild経路95件とimporter 16件を別コマンドで実行し、計111件が成功した。既存Node試験58件も成功した。
  初回のPython namespace指定のImportErrorは試験開始前のものとして保存し、正しい指定へ直した。試験やruntimeの期待値変更はない。
- Chromium／WebKitの実public wrapper・direct SynthでFM 6CHの440 Hz・pan・release・reset、SSG 3CH・混合とowned PCMを確認した。
  native PCMは500 kHzのまま検査し、一時harness内だけでAudioContextの48 kHzへ線形変換してAudioBufferSourceから出力した。
  実`SoundChipMixer.connect()`と上流meterを使い、最初のdestination接続前から最終zero Gainを設けた。
  合成Worklet、RuntimeSynth、Analyzer UI・Playground再生経路を追加・検証したものではない。未対応Worklet要求はcontext／module取得前に拒否した。
- 校正66 source hash、既存3 generator checks、runtime／数値関連26ファイルの不変を確認した。
  YMF288は未測定のため既存のunity fallbackを維持する。測定結果やhash guardの更新はない。
- FM npmの803ファイル・26 WASM engine・942参照とNodeNext／Bundler・型の正負検証が成功した。
  tarballは1,590,715bytes、展開後5,934,212bytes。実install済みpackageでもFM／SSG・direct SynthとSDK assetを照合した。
- Analyzer ZIPは753参照・370ファイル。既存wrapper `ymf288.js`／`opn_variant.js`のみを含み、YMF288生成pair・named Synthは含まない。
  full runtime／FM npm側には生成pairとSynthを含む。実tar／install／ZIPの資産・既存LICENSE／notice計21項目を照合した。
- browserのlocal listen、npm cache、Emscripten cacheのsandbox権限が必要だった。必要な権限で同じ検証・buildを実行し、production修正はしていない。

先行23 receiptと他50生成JS／WASM、SDK379ファイル・pin、数値・過去の校正記録、SavePointの旧記録を保持した。
固定SDKを使うWASMは計24／27 artifact。残り3は`nuked_opn2`、`ymf278b`、`dx7`。次の候補はYMF278B。
Native／Tauri・remote CI・実機聴音・npm／アプリの公開は今回の対象外。commit／pushもしていない。
SPCのWebKit初期化中closeは引き続き未解決として別に残す。
