# YM2151 / YM2164 WASMの固定SDK参照

日付: 2026-10-25

## 変更内容

`scripts/build_ym2151_wasm.sh`を、同梱SDKのWASMレシピへ切り替えた。
SDKは先行するOPN系と同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定379ファイルと`third_party/soundchip-sdk.json`は変更していない。
着手時の本体は`c92b43569cd76ebeadc7cf80c553ba1389fc500f`でcleanだった。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh ym2151`を実行する。
相対出力先は呼出し側を基準に解決し、`EMXX`でコンパイラーを指定できる。
既存のC++14／O2、15個のexport、`cwrap`／`HEAPF32`、Perlによる生成glueの末尾空白除去を維持する。
OPMレシピは従来どおり明示的な`ASSERTIONS`設定を追加しない。

YM2151／YM2164は引き続き同じWASMで扱う。
公開`Ym2151.create({variant: 'ym2164', ...})`はOPP、既定の`'ym2151'`はOPMを選ぶ。
両variantの8CH、YM2164のTimer B divider、同期`read()`／`generateStereo()`、
フック、既存Engineと状態APIを維持する。Mixer値と音源ごとの出力比は変更しない。

importerの必須入力、共有ビルド試験、CIのoffline検証と公開ビルド手順も拡張した。
通常出力は比較用SDK出力とbyte一致し、共有`docs/generated/build-info.json`は
先行4音源の記録と生成物を保持する。

## ソースと生成物

本体とSDKの10件のソース・ヘッダー・ライセンスがbyte一致。
2翻訳単位が実際に読む9ファイルも、`src/`と`vendor/ymfm/`を対応づけると一致する。
旧配布済み生成物、旧レシピの再ビルド、SDKビルドの3組を保存して比較した。
入力・出力hashと試験要約は[検証JSON](wasm_sdk_ym2151_adoption_01.json)を参照する。

Emscriptenは`6.0.6-git`。生成JSは3組とも同じ15,584bytes。
旧2組のWASMは31,306bytes、SDK版は31,322bytesでhashは異なる。
SDK版ではassertionに含まれるパスも`src/...`から`vendor/ymfm/...`へ変わる。
同じコンパイラーによる旧レシピの再生成も配布済みWASMとhashが異なるため、
バイナリー一致と実行結果一致は区別する。

## 検証

`scripts/check_ym2151_wasm_sdk.mjs`で、旧レシピ再ビルドとSDK、配布済み版とSDKの2組を比較した。

- 各1,408比較: 生PCM1,344＋既存AudioEngine64、各17,640,320出力ステレオフレームで差0。
  両ビルドとown／cross-state／reset後の継続を含む。Engine内部の生PCMは重複加算しない。
- 112シーン／clock／variant、3 clockとEngineを合わせて704設定。
  通常／不規則block分割、PCM・read／status／IRQ・同期フック・最終状態bytes、
  Engineの残余と保持sampleを比較した。
- checkpointは重点32設定に絞り、通常blockでown復元・同一variant内の両方向raw状態復元・reset継続を各64回実行した。
  通常／不規則の64ケースで状態を保存するが、全1,408ケースで復元を試したという意味ではない。
- 全8CH／8algorithm／feedback、operator key mask、4種のLFO波形と独立AMD／PMD、
  ノイズ全32period、pan、mute、KC／KFとpending address、timer／CSMを比較した。
- 自己試験ではcarrier単独のCH8 noise有効／無効・period差・CH1への非影響、
  4種LFOの出力差、通常key-onなしのCSM発音を明示確認した。
- Timer Aは両variantで4生PCMフレーム、Timer BはYM2151が16、YM2164が32でIRQを立てた。
  同じregister設定でOPPのTimer Bだけが2倍になることも確認した。
- 生PCMは`floor(clock / 64)`。3,579,545／4,000,000／8,000,000Hzと、
  既存Engineの44.1／48／96／192kHz出力を比較した。

public resetはhandleを再生成してJS mute maskを再適用し、raw resetはfree-running counterを保つ。
この2つの既存動作を区別して比較した。owned PCMは発音中の値を保存し、
同じbufferの再利用と実際のcapacity増加後も以前の配列が変わらないことを確認した。
raw状態交換は今回の両ビルド・同一variant内での確認であり、公開snapshotの同一instance制約は維持する。
Web／docs wrapperは既存4種類のimport cache queryだけを正規化して一致と実hashを確認した。
自己試験398,836生PCMフレームと復元前に状態を乱す1,984出力フレームは、
上記の主比較出力数とは分けてJSONに記録する。
デバイスを開くことや音量補正を加えることはしていない。
引数検査は不正18形式をファイル読込み前に拒否し、`--help`が成功することも確認した。

- Python35件成功: importer16＋YM2612のビルド経路3＋他4 artifactの各4件。
  fresh copyからの既定／相対出力、改変拒否、既存4音源の記録・生成物保持を確認した。
  OPMの2翻訳単位、15 export、assertion設定も区別して検査する。
- 既存YM2151／Synth／OPM state／Playground・Inspector／MSX複合試験53件成功。
  全8CHのstereo、各operatorの発音、LFO・noise・latch保存、混合・seek、YM2164 Timer Bも含む。
- Chromium／WebKitで追加生成YM2151と主X68000、計4経路の実Worklet出力が成功。
  gainは`0.516785`を維持し、非有限値・範囲超過は0。聴音側はmuteした。
- 同じ2ブラウザーの既存音色／Keyboard UI試験も成功。
  operatorの440／880／1320／1760Hz、pan・algorithmの音声変化、CH8編集、
  key-up／focus／blur／Stop、コード演奏との共存、読み取りpollingを確認した。
  最終destinationだけをzero gainへ接続する一時harnessを使い、元の試験・アプリは変更していない。
- 隔離npm tarballの803ファイル、26WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。
  `release/hello_ymfm_wasm_ym2151-sdk_itch_vgm_analyzer.zip`に比較済みJS／WASMを収録した。
- アクティブな校正記録は今回のYM2151生成物をhash参照していなかった。
  校正記録とMixer数値は保持し、両生成器の`--check`も成功した。

SDK／Tauriリポジトリは変更していない。公開手順は[ビルド文書](../building_ym2612_wasm.md)、
再開地点は[Save Point](savePoint.md)を参照する。
remote CI、OS／機材での聴音、npm・アプリ公開は未実施。
