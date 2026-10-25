# OKIM6258 WASMの固定SDK参照

日付: 2026-10-25

## 変更内容

`scripts/build_okim6258_wasm.sh`を同梱SDKのWASMレシピへ切り替えた。
SDKは先行するOPN／OPM系と同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定379ファイルと取り込み記録は変更していない。
着手時の本体は`d21e39073857aae8a7c86f4a2cd8a65aa424e8d5`でcleanだった。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh okim6258`を実行する。
出力先は呼出し側を基準に絶対化し、`EMXX`でコンパイラーを指定できる。
C++14／O2、明示ASSERTIONS設定なし、9 export、`cwrap`／`HEAPF32`とPerlによる生成glueの末尾空白除去を維持する。
既存の同期`writeOki6258()`／`processFrames()`、状態APIとMixer値を変更しない。
read／status／IRQの公開APIは追加していない。
Native用のthread-safe table初期化対策をWASMのコンストラクターへ適用する変更も行っていない。

importerの必須入力と共有ビルド試験を拡張した。
通常出力は比較用SDK出力とbyte一致し、共有`docs/generated/build-info.json`へOKIM6258を追加した。
先行5音源の記録・生成物は保持した。CIのoffline検証と公開ビルド手順も更新した。

## ソース・生成物・記録範囲

本体とSDKの実装・ヘッダー・ライセンス・由来8組がbyte一致。
2翻訳単位が実際に読む4ファイルも、include pathを対応づけると一致する。
Emscriptenは`6.0.6-git`。今回は旧配布版・旧recipe再ビルド・SDKの全3組で、
JS 14,797bytes／WASM 20,173bytesがそれぞれbyte一致した。
入力と出力hash、実行結果は[検証JSON](wasm_sdk_okim6258_adoption_01.json)を参照する。

固定SDKのOKIM6258 catalogには、実依存`vendor/ymfm/chip_state.h`の列挙漏れがある。
SDKの個別`build-info`はこのcatalogに従うため、その個別入力一覧に同headerは含まれない。
一方、完全同梱した379ファイルのmanifest／offline検証は同headerもhash検証する。
実依存とhashは今回のJSONの`sourceAudit`にも保存し、headerの改変でコンパイラー起動前に止まる試験を追加した。
SDK原本や過去の生成記録を編集して、この記録範囲の違いを隠すことはしていない。
次回SDKのcatalog更新時の追記候補として残す。

## 実WASM比較

`scripts/check_okim6258_wasm_sdk.mjs`で、旧recipe再ビルドとSDK、配布済み版とSDKの2組を比較した。

- 各2,048比較: raw C ABI 1,728＋既存AudioEngine 320、各23,949,880出力ステレオフレームで差0。
  両ビルドとown／cross-state／reset後の継続を含み、PCM・全73byte状態・同期命令列とhost設定を比較した。
- 1,024設定、通常／不規則block分割を比較。clockは4／8.192／24MHz、rawの出力rateは8／44.1／96kHz。
  8種の4-bit flagsと、Engineの8／44.1／48／96kHzを含む。
- checkpointは重点34設定に絞り、通常blockでown復元68回（raw 48／公開opaque 20）、
  同一設定内の両方向raw状態復元68回、reset継続68回を実行した。
  通常／不規則の68ケースで状態を保存するが、全2,048ケースで復元を試したという意味ではない。
- 低nibble→高nibbleの既知ベクトル、独立JSデコードとの照合、FIFO 8byteのoverflow時の新規データ破棄、
  underflow時の最終sample保持、部分消費・wrap・遅延供給を検証した。
- pan、clockのpending byte／register11でのcommit・上位bit mask、divider 1024／768／512とalias、
  10／12-bit clamp、stopの優先・再trigger、mute／master volumeの出力とdecoder継続を確認した。
- 発音中のowned PCMが同じbufferの上書きとcapacity増加後も保持されることを確認した。
  自己試験1,520出力フレーム、復元前に状態を乱す2,108出力フレームは主比較数と分けて記録した。

resetはFIFOのcount／cursorを戻すが、未使用の8byte保存領域をzeroにする動作ではない。
全73byteを比較する準備として、両ビルドへ同じ8byteのzero書込み→resetを実APIで行う。
active constructor stateとPCMがこの準備で変わらないことを別のpositive試験で確認した。
これはチェッカー内だけの準備であり、製品の初期化や保存状態を書き換える変更ではない。
raw状態の交換は今回の両ビルド・同一clock／flags／rate内に限定し、
公開snapshotの同一owner・音量／mute設定一致の制約は維持する。
引数検査は不正18形式をファイル読込み前に拒否し、`--help`が成功することも確認した。

## その他の検証

- Python39件成功: importer16＋YM2612のビルド経路3＋他5 artifactの各4件。
  fresh copyからの既定／相対出力、両include directoryでのheader解決、改変拒否、
  既存5音源の記録・bytes保持を確認した。
- 既存OKI／Synth／OPM state／Playground・Inspector／VGM描画試験52件成功。
  FMとの混合・seekと、途中のFIFO／nibble・保持sample復元も含む。
- Chromium／WebKitで追加生成OKIM6258とX68000主PCMの計4経路が成功。
  実Worklet出力を聴音側muteで捕捉し、gain`0.128849`、非有限値・範囲超過0を確認した。
- 同じ2ブラウザーの既存PCM音色／ファイル／Keyboard UI試験も成功。
  divider512／1024／768で約660／330／440Hz、左右pan、WAV読込み、不正decode時の保持、
  one-shot終端、同rate再trigger、keyup／focus／blur／Stop、背景コード・OPMとの共存、
  読取りpollingを確認した。最終destinationだけをzero gainへ接続する一時harnessを使い、
  元の試験・アプリは変更していない。
- 隔離npm tarballの803ファイル、26WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。
  `release/hello_ymfm_wasm_okim6258-sdk_itch_vgm_analyzer.zip`に比較済みJS／WASMを収録した。
- アクティブな校正記録には影響するhash参照がなく、再測定は不要だった。
  既存校正記録・Mixer数値と両生成器の`--check`を維持した。

これでX68000のFM・ADPCM双方のWASMビルドが同じ固定SDKを参照する。
SDK／Tauriリポジトリは変更していない。公開手順は[ビルド文書](../building_ym2612_wasm.md)、
再開地点は[Save Point](savePoint.md)を参照する。
remote CI、OS／機材での聴音、npm・アプリ公開は未実施。
