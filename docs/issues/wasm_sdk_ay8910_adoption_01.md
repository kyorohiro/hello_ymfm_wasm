# AY-3-8910 / YM2149 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_ay8910_wasm.sh`を同梱SDKのWASMレシピへ切り替えた。
SDKは先行11 artifactと同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定379ファイルと取り込み記録は変更していない。
着手時の本体は`0175fb15fcd48c141682f16cc6604713217d7134`でcleanだった。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh ay8910`を実行する。
出力先は呼出し側を基準に絶対化し、`EMXX`でコンパイラーを指定できる。
従来どおりC++17／O2、公開C ABIの10 export（AYの8関数＋malloc／free）、`cwrap`／`HEAPF32`とmemory growthを維持する。
`EXPORT_ALL`と明示的な`ASSERTIONS`指定、Perlによるglueの空白除去は行わない。
WASMの内部補助4関数を含む全16 export（14関数＋memory／table）も旧版と一致した。

公開API・Synth・Inspector・Mixer値は変更していない。
共有artifactはAY-3-8910のtype `0`／flags `0, 1`と、YM2149のtype `0x10`／flags `0, 1, 0x10, 0x11`を扱う。
既存の同期`read()`／`generateStereo()`を維持し、snapshot、Into、status／IRQ、envelope監視フックは追加しない。

importerの必須入力と共有ビルド試験を拡張し、通常出力の`build-info.json`へAYを追加した。
先行11音源の生成記録と22生成物は保持した。公開ビルド文書とSave Pointも更新した。

## ソースと生成物

本体とSDKの実装・ヘッダー・ライセンス・由来記録7組がbyte一致した。
2翻訳単位が実際に読む3ファイルも、`third_party/mame-ay8910/`と`vendor/mame-ay8910/`を対応づけると一致する。
SDKのcatalogは実依存をすべて収録している。
MAME由来のstandalone AY適応版のBSD-3-Clause宣言とライセンスを保持する。
入力・出力hashと実行結果は[検証JSON](wasm_sdk_ay8910_adoption_01.json)を参照する。

Emscriptenは`6.0.6-git`。配布済み・旧recipe再ビルド・SDK・通常出力のすべてで、
JS 12,113bytes、WASM 13,549bytesがbyte一致した。
AYを追跡する2つのアクティブ校正記録にもhash変更はなく、両Mixer生成器の`--check`が成功した。
校正記録の差し替えや再測定、音量変更は不要だった。

## 実WASM比較

`scripts/check_ay8910_wasm_sdk.mjs`で旧recipe再ビルドとSDK、配布済み版とSDKの2組を比較した。
入力はこの試験のために作成したregister列とVGMで、外部の楽曲は含まない。

- 各8,208比較（raw 7,344＋既存AudioEngine 864）で、PCM・127-frame続行probe、
  全registerの読出し・configured sample rate・Engine制御が一致した。
  各37,468,404出力ステレオフレームで差0。本文35,223,552＋probe 2,244,852を含む。
- 6つのtype／flag構成、3 clockと通常／不規則block分割で、3 tone、32 noise period、
  16 envelope shapeと0／1／17／65535 period、全64 mixer mask、固定level、IO latch、mute／resetを比較した。
- public reset後の重点再演奏は計1,260回。snapshotのloadを比較したという意味ではない。
- rawは44.1kHz、選択したEngine経路は8／44.1／48／96kHzで比較した。
  AYコアはnative tickをconfigured出力rateへ整数時間で積分するため、JSの追加resamplerはない。
  YM2149のdivider flagは、入力clockを2倍にしたPCMが通常dividerと一致することも確認した。
- 正の自己試験では、全16 envelopeの変化と既存alias、6構成の出力差、mute中の位相継続、
  full-byte latchと実効mask、raw／public reset、owned両側bufferの上書き・実際の容量拡大・disposeを確認した。
  追加生成は両build計811,166フレーム。
- 実VgmPlayerで6構成×3 clock×3 rateの54通りを全曲再演奏し、各6地点の257-frame継続を照合した。
  `0xa0` commandのAY register、headerのtype／flags、先頭からの再構築を確認した。
  保存checkpointは常に0件。実際のEngine生成4,638,492フレームを集計した。
- 専用checkerの合計は各42,918,062生成フレーム。
  Engineから委譲した同じchip生成と、Player引渡し3,880,188フレームは重複加算していない。

## 維持した既存仕様

- readは保存した8bit値を返す。音の計算ではtone coarse／noise／volume／shapeの有効bitを使う。
  raw C引数は8bitへ切り詰められ、register番号は下位4bitへaliasする。public writeは範囲を検証する。
- IO 14／15とdirection bitは保存latchで、外部CPUへのcallbackはない。
- raw／public resetは同じhandleを使い、register・tone／noise／envelope counter・RNG・積分履歴を初期化する。
  Nativeのmute maskは保持する。mute中も合成は進み、解除後は継続中の位相へ戻る。
- 音量0やcold registerにはDAC table由来のDCが残る場合がある。
  出音の正の試験ではpeakだけを使わず、波形の変化・AC成分を確認する。全mute `7`は厳密な0を確認した。
- AYとYM2149ではenvelopeの段数とstepが異なる。shapeの再writeはstepを再開始するが、period counterをresetしない。

実機そのものの波形や内部状態bytesの一致を主張する試験ではない。

## その他の検証

- Python63件成功。fresh copyの既定／相対出力、C++17／export設定、実header解決、
  改変のcompiler実行前拒否、先行11音源の記録・出力保持を確認した。
- AY wrapper／Synth／Inspector／Analyzer monitor、MSX parser／mutes／analysis／複合renderの既存試験45件が成功。
- Chromium／WebKitで追加AY、MSX主音源、MSX Audio主音源の計6経路の実Worklet出力を確認した。
  Browser側は既定のAY構成を使い、全6 type／flagの比較はNodeの実WASM checkerで行った。
- 同じ両BrowserでMSX／MSX Audioの初期演奏、AY tone／noise／envelopeの操作と再trigger、
  各音源のPC／Ukulele Keyboard、Stopの保持動作を確認した。Web Audio／mainだけに絞った一時harnessを使い、
  最終destinationをzero gainにした。既存試験ファイルと本体の動作は変更していない。
- 隔離npm tarballの803ファイル、26 WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。370ファイルのZIP内のAY JS／WASMも比較済み出力と一致した。

固定SDKのWASM参照は計12 artifact、残り15。次はSega PSGが候補。
SDK／Tauriリポジトリ、公開APIとMixer定数、旧校正記録は変更していない。
remote CI、Native backend、OS／機材での聴音、npm・アプリ公開は未実施。
