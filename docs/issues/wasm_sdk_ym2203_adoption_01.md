# YM2203 WASMの固定SDK参照

日付: 2026-10-25

## 変更内容

`scripts/build_ym2203_wasm.sh`を、既に同梱済みの固定SDKのWASM用レシピへ切り替えた。
SDKはYM2612と同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`、379ファイル。
`third_party/soundchip-sdk.json`とSDK原本は変更していない。

主な変更は次のとおり。

- 固定ファイル群をoffline検証してからSDKの`build-wasm.sh ym2203`を実行する。
- C++14／O2／assertions、15個のexport、生成JSのPerlによる整形を維持する。
- 呼出し側を基準に相対出力先を解決し、`EMXX`でコンパイラーを指定できる。
- 生成WASMと`docs/generated/build-info.json`を更新する。
  YM2203の記録を追加しても既存YM2612の記録と生成物を変更しない。
- importerの必須入力へYM2203のwrapper・レシピ・`opn_state.h`を追加する。
- 分離環境でのビルド試験を両音源で共有し、CIと公開ビルド手順を更新する。

公開JS API、同期`read()`／`generateStereo()`、FM／SSGの混合比、Mixerの値は変更しない。
SDKを別checkoutやリモートから取得する処理も追加していない。

## ソースと生成物

本体とSDKで27件のソース・ヘッダー・ライセンスがbyte一致。
10翻訳単位の実際の依存25件も、`src/`と`vendor/ymfm/`を対応づけると一致する。
入力と検証結果の要約は[検証JSON](wasm_sdk_ym2203_adoption_01.json)に保存する。

Emscripten `6.0.6-git`で旧レシピとSDK版を別出力先へ実ビルドし、
さらにSDK版を通常の出力先へビルドした。通常出力は比較用SDK出力とbyte一致。
生成JSは配布済み／旧レシピ再ビルド／SDKの3組で同一の35,153bytes。
WASMは旧2組45,290bytes、SDK版45,306bytesで、hashは異なる。
SDK版ではassertに含まれるソースパスが`vendor/ymfm/...`へ変わる。
バイナリーの同一性と実行結果の一致は別に評価した。

## 実WASM比較

`scripts/check_ym2203_wasm_sdk.mjs`で、旧レシピ再ビルドとSDK、配布済みWASMとSDKの2組を比較した。

- 各432比較: 生PCM336比較＋既存AudioEngine96比較、2,160回の実行。
- 各9,770,400出力ステレオフレーム。両ビルドと状態復元・reset後の再生を含む。
  Engineでは変換後の出力フレームを数え、内部で生成した生PCMを重ねて数えない。
- PCM・read/status/IRQ・フック・状態bytes・Engineの余剰時間と保持サンプルが差0。
- 各比較で自身の状態復元432回、両方向のraw状態復元432回、reset後の継続432回。
  公開JSのopaque snapshotは、引き続き別instanceの状態を拒否する。
- FM全3CH／8algorithm、SSG全3tone・全16envelope・32noise期間、gate、
  音源別／FMチャンネル別mute、CH3特殊周波数、timer／CSM、latch、resetを含む。
- クロック3,579,545／4,000,000／8,000,000Hz、通常／不規則なblock分割。
- 既存Engineで44.1／48／96kHzと、保持サンプルを確認する1.5MHzの出力を比較する。
- モノラル信号が左右同じ値で出ること、FMとSSGが1回ずつ加算されることも確認する。

YM2203の生PCM出力は`clock / 4`で、プリスケーラー6／3／2を切り替えてもこの出力レートは変わらない。
内部のFM／SSGの進み方が変わるため、アドレス単独書き込みの副作用と保存／復元も比較した。
Web／docsのEngine importは既存の2つのcache query表記だけを正規化して照合し、
実ファイルのhashも別に記録する。音声の計算を置き換えた比較ではない。

## その他の検証

- Python23件成功: importer16件、YM2612ビルド経路3件、YM2203ビルド経路4件。
  旧`src/`・`wasm/`・`w/`・Git・npm・実Emscriptenがないfresh copyから入力を解決する。
  ここは記録用コンパイラーで経路を試験し、実音の検証とは区別する。
- 既存OPNの状態・タイマー・範囲・YM2203 Synth／SSG試験34件成功。
- Chromium／WebKitの主音源PC-98／26と追加YM2203の計4経路で実Workletを確認。
  出力は聴音側をmuteし、音量・振幅と左右の一致を測定した。
- 隔離したnpm tarballの803ファイル・全26WASM engine・実行・asset URL・型の検証が成功。
- AnalyzerとnpmのMixer生成器の`--check`が成功。
  アクティブな校正記録はYM2203生成物のhashを参照していないため、記録の再測定・更新は不要。
- `sh scripts/package_itch_vgm_analyzer.sh ym2203-sdk`が成功し、753ローカル参照を検証。
  ZIPは`release/hello_ymfm_wasm_ym2203-sdk_itch_vgm_analyzer.zip`。

公開手順は[ビルド文書](../building_ym2612_wasm.md)、現在地は[Save Point](savePoint.md)を参照。
今回の変更は本体だけで、SDK・Tauriのリポジトリは変更していない。
remote CI、OS／機材での聴音、npm公開・アプリ公開は未実施。
