# YM2608 WASMの固定SDK参照

日付: 2026-10-25

## 変更内容

`scripts/build_ym2608_wasm.sh`を、同梱SDKのWASM用レシピへ切り替えた。
SDKは先行するYM2612・YM2203と同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定ソース379ファイルと`third_party/soundchip-sdk.json`は変更していない。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh ym2608`を実行する。
C++14／O2／assertions、18個のexport、`cwrap`／`HEAPF32`／`HEAPU8`と既存ABIを維持する。
相対出力先は呼出し側を基準に解決し、`EMXX`でコンパイラーを指定できる。
通常出力先での実ビルドは比較用SDK出力とbyte一致した。
共有`docs/generated/build-info.json`へYM2608を追加し、先行2音源の記録と出力を維持した。

importerの必須入力と共有ビルド試験をYM2608まで広げ、CI・公開手順も更新した。
FM／SSG／リズム／ADPCMのAPI・出力比・Mixerの値は変更しない。

## 入力と生成物

本体とSDKで27件のソース・ヘッダー・ライセンスがbyte一致。
10翻訳単位の実依存25件も、`src/`と`vendor/ymfm/`を対応づけると一致する。
旧レシピの再ビルド、配布済みWASM、SDKビルドをそれぞれ保持して比較した。
入力hashと実行結果の要約は[検証JSON](wasm_sdk_ym2608_adoption_01.json)を参照する。

Emscriptenは`6.0.6-git`。生成JSは3組とも同じ36,356bytes。
旧2組のWASMは53,877bytes、SDK版は53,893bytesで、バイナリーhashは異なる。
SDK版ではassertに含まれるソースパスも`vendor/ymfm/...`へ変わる。
バイナリーの一致と、以下の実行結果の一致は区別する。

着手時の最初の読込みでは直前のYM2203差分が未commitだったが、
比較用入力を固定する前にユーザーのcommit `7845ecbbfc504ef547c2823c8e417ba7d2211d27`へ保存された。
固定時の作業ツリーはclean。こちらからcommit／resetは行っていない。

## 実WASM比較

`scripts/check_ym2608_wasm_sdk.mjs`で、旧レシピ再ビルドとSDK、配布済みWASMとSDKの2組を比較した。

- 各586比較: 生PCM522比較＋既存AudioEngine64比較。
- 各7,264,744出力ステレオフレーム。両ビルドと状態復元・reset後の再生を含む。
  Engineは変換後の出力を数え、内部で生成した生PCMを重ねて数えない。
- 全ケースでPCM・read/status/statusHi/IRQ・フック・最終状態bytesが差0。
- 2MiB RAMを含む保存状態の反復は22設定に絞り、自身の状態復元・両方向のraw状態復元・
  reset後の継続を各44回確認した。全586ケースで同じ回数の復元を試したという意味ではない。
- 全6FM CH／8algorithm、SSGのtone／全16envelope／noise、リズム6声、
  ADPCM-Bの先頭／RAM末尾再生・repeat・pan・clear、複合音源とmuteを比較した。
- 3,993,600／7,987,200／8,000,000Hz、通常／不規則block分割、
  プリスケーラー、timer／CSM、CH3特殊周波数、両portのlatchを含む。
- 既存Engineの44.1／48／96kHzと1.5MHz出力を、IRQ hook有無の両経路で比較した。
- wrapper自己試験で独自8KiBリズムROMと2MiB RAMの全量転送、末尾境界、clear、
  不正な保存状態のメモリー長の拒否を確認した。外部の音源ROMは使用しない。
- 公開snapshotを復元する前にRAMをclearしROMも書き換え、復元後のPCMと状態bytesを比較した。

生PCM出力は`clock / 8`で、プリスケーラー6／3／2は内部FM／SSGの進み方を変える。
ADPCMのCPU data読取りはRAMカーソルを進めるため、そのシーンだけ観測目的のport3読取りを省き、
実際のdata読取りは固定イベントとして比較した。診断自体で演奏命令列を変えないための扱い。
Web／docsのwrapperは既存の2つのimport cache query表記だけを正規化して照合し、実hashも記録する。

## その他の検証

- Python27件成功: importer16件＋YM2612のビルド経路3件＋YM2203／YM2608の各4件。
  記録用コンパイラーを使い、旧ソース・Git・npm・実Emscriptenのないfresh copyからの
  入力解決、相対／既定出力先、改変拒否、既存2音源の記録保持を確認した。
- 既存OPN state／timer／範囲／YM2608 Synth・リズム・ADPCM試験38件成功。
- Chromium／WebKitで主音源PC-98と追加生成YM2608の計4経路が成功。
  聴音側をmuteした実Worklet出力を観測した。
- 隔離npm tarballの803ファイル、全26WASM engine、実行・asset URL・型の検証が成功。
- Analyzer ZIP作成と753件のローカル参照検査が成功。
  ZIP: `release/hello_ymfm_wasm_ym2608-sdk_itch_vgm_analyzer.zip`。

## 校正記録

AnalyzerのアクティブなPSG03記録がYM2608生成物のhashを参照しているため、
実際にPSG／AY／NESとOPNA基準を再測定し`analyzer_psg_levels_04.json`へ保存した。
旧01／02／03は保持する。03との全測定値・基準・校正値は完全一致し、
差はYM2608 WASMのhashのみ。8個の生成Mixer値と他の音量設定は変更していない。
生成器の参照先と生成モジュールのコメントを04へ更新し、17試験と両生成器の`--check`が成功した。

公開手順は[ビルド文書](../building_ym2612_wasm.md)、再開地点は[Save Point](savePoint.md)を参照。
SDK／Tauriリポジトリは変更していない。remote CI、OS／機材での聴音、npm・アプリ公開は未実施。
