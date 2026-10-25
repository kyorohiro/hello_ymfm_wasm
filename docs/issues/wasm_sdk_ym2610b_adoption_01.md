# YM2610 / YM2610B WASMの固定SDK参照

日付: 2026-10-25

## 変更内容

`scripts/build_ym2610b_wasm.sh`を、同梱SDKの共有WASMレシピへ切り替えた。
SDKは先行するYM2612・YM2203・YM2608と同じ`0.1.1`／
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。固定379ファイルと取り込み記録は変更していない。
着手時の本体は`2d63a038d199823e18517fcc1a9f5830fb9f7510`でcleanだった。

全固定ファイルをoffline検証してからSDKの`build-wasm.sh ym2610b`を実行する。
相対出力先は呼出し側を基準に解決し、`EMXX`でコンパイラーを指定できる。
既存のC++14／O2／assertions、18個のexport、`cwrap`／`HEAPF32`／`HEAPU8`、
Perlによる生成glueの末尾空白除去を維持する。

両variantは引き続き同じWASMで扱う。公開`Ym2610B.create({variant: false, ...})`は
YM2610の4FM CH、既定の`variant: true`はYM2610Bの6FM CHを選ぶ。
独立したADPCM-A／B ROM、SSG、同期`read()`／`generateStereo()`と既存Engineを維持する。
Mixerの値・音源ごとの出力比・JS公開APIは変更しない。

importerの必須入力と共有ビルド試験を拡張した。通常出力は比較用SDK出力とbyte一致し、
共有`docs/generated/build-info.json`は先行3音源の記録・生成物を保持する。
CIのoffline検証と公開ビルド手順も更新した。

## ソースと生成物

本体とSDKの27件のソース・ヘッダー・ライセンスがbyte一致。
10翻訳単位が実際に読む25ファイルも、`src/`と`vendor/ymfm/`を対応づけると一致する。
旧配布済み生成物、旧レシピの再ビルド、SDKビルドの3組を保存して比較した。
Emscriptenは`6.0.6-git`。入力と出力のhash、各試験の要約は[検証JSON](wasm_sdk_ym2610b_adoption_01.json)を参照する。

生成JSは3組とも同じ36,296bytes。旧2組のWASMは51,156bytes、SDK版は51,172bytesでhashは異なる。
SDK版ではassertionに含まれるパスも`src/...`から`vendor/ymfm/...`へ変わる。
同じコンパイラーによる旧レシピの再生成も配布済みWASMとhashが異なるため、
バイナリー一致と以下の実行結果一致は区別する。
旧／SDKのビルドに共通するymfmの3CH用templateに対するarray-bounds警告は今回変更していない。

## 実WASM比較

`scripts/check_ym2610b_wasm_sdk.mjs`で、旧レシピ再ビルドとSDK、配布済み版とSDKの2組を比較した。

- 各1,108比較: 生PCM1,044＋既存AudioEngine64。両variantを実際に別handleで生成した。
- 各14,063,856出力ステレオフレーム。両ビルドとown／cross-state／reset後の継続を含む。
  Engineは変換後出力を数え、内部の生PCMを重ねて加算しない。
- PCM、read／status／statusHi／IRQ、同期バス操作、最終状態bytesとEngineの残余・保持sampleが差0。
- 87シーン／clock、3 clock、両variantとEngineを合わせて554設定。
  通常／不規則block分割の出力も一致した。
- checkpointは重点36設定に絞り、通常blockでのown復元・同一variant内の両方向raw状態復元・reset継続を各72回実行した。
  全1,108ケースで状態復元を試したという意味ではない。
- 全6物理FM CH／8algorithm／feedbackを比較。YM2610の物理CH0／3が無音、Bでは発音することも確認した。
- SSGの3tone、全16envelope、noise全32period、LFO／SSG-EG、pan、CH3特殊周波数、
  timer／CSM、address／frequency latchとsource muteを含む。
- ADPCM-Aの6声と独立したBのROM再生、pan、repeat／one-shot、部分上書き、resize、clear、
  ROMの独立性、状態復元を独自データで比較した。外部の音源ROMは使用しない。
- wrapper自己試験は不正な状態長・ROM長・転送範囲を拒否し、A／Bそれぞれの16MiB末尾境界も確認する。
- 別枠のwrapper試験でAの全6声とBの終了フラグ、mask／clear／再発音、
  BのrepeatによるROM末尾折返し後の発音と終了フラグ非設定を確認した。
  この終端・repeat試験は両variant・両ビルドで計1,048,128生PCMフレーム。
  wrapper自己試験全体の1,113,736生PCMフレームは上記の主比較フレーム数へ加算していない。
- 生PCMは`clock / 16`。3,993,600／7,987,200／8,000,000Hzと、既存Engineの
  44.1／48／96kHzおよび1MHz出力を比較した。

public wrapperに`setHooks()`はないため追加していない。同期バス命令と観測時点のread／status／IRQを記録した。
raw状態交換は今回の両ビルド・同一variant内での確認であり、公開snapshotの同一instance制約を変更しない。
Web／docs wrapperは既存の2つのimport cache query表記だけを正規化し、それ以外の一致と実hashを確認した。

## その他の検証

- Python31件成功: importer16＋YM2612のビルド経路3＋YM2203／YM2608／YM2610Bの各4件。
  実コンパイラーのないfresh copyからの入力解決、既定／相対出力、改変拒否、既存3音源の記録と出力保持を確認した。
- 既存OPN state／timer／範囲／YM2610 Synth・VGM描画試験40件成功。
- Chromium／WebKitで追加生成YM2610／BとNeo Geo／Neo Geo Bの主音源、計8経路が成功。
  実Worklet出力を捕捉し、聴音側はmuteした。Mixer gainは全経路`1.03357`を維持する。
- 隔離npm tarballの803ファイル、26WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。
  `release/hello_ymfm_wasm_ym2610b-sdk_itch_vgm_analyzer.zip`に比較済みJS／WASMが収録された。
- 影響する生成物を参照するアクティブな校正hashはなかった。既存校正記録とMixer数値は保持し、両生成器の`--check`も成功。

CLI描画とBrowser Engineの既存比較試験は、Browser側だけAnalyzerのMixerを適用していなかった。
旧配布版でも10 fixture／variantすべてで差を再現し、同じMixerを通すと全10出力がbyte一致した。
`test/ym2610-render.test.mjs`の比較条件だけを揃え、初回38成功／2失敗から40成功へ確認した。
この修正のために製品の音声処理・初期値は変更していない。

チェッカーの引数検査は不正18形式をファイル読込み前に拒否し、`--help`が成功することも確認した。

初回ビルドとnpm検証はsandbox外のツールキャッシュへの書込みで停止したため、
承認された制限外実行で成功を確認した。権限制限を回避する製品変更は入れていない。

これで通常OPNのYM2612／YM2203／YM2608／YM2610／YM2610B用4 artifactが固定SDK参照になった。
次はYM2151用WASMへの展開が候補。SDK／Tauriリポジトリは変更していない。
公開手順は[ビルド文書](../building_ym2612_wasm.md)、再開地点は[Save Point](savePoint.md)を参照。
remote CI、OS／機材での聴音、npm・アプリ公開は未実施。
