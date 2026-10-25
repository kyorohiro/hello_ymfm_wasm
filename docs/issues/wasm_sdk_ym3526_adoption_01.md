# YM3526 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_ym3526_wasm.sh`を同梱SDKのWASMレシピへ切り替えた。
SDKは先行する7 artifactと同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定379ファイルと取り込み記録は変更していない。
着手時の本体は`14cf50a2ca3487ad13dc3180db2cdbe4936f33d7`でcleanだった。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh ym3526`を実行する。
出力先は呼出し側を基準に絶対化し、`EMXX`でコンパイラーを指定できる。
C++14／O2、12 export、`cwrap`／`HEAPF32`とmemory growthを維持する。
旧recipeと同じく、明示的な`ASSERTIONS`指定やPerlによるglueの空白除去は行わない。
既存の同期`read()`／`generateStereo()`、9CH・2OPのFM、リズム、Mixer値を変更しない。

YM3526はOPL1で、演算子の波形はsineのみ。OPL2の波形選択registerを書いても既存どおり無効となる。
既存のWASM／JSには保存・復元APIがないため、raw reset・public reset・再演奏・seekを比較した。
public resetはhandleを再生成してJS mute maskを再適用し、raw resetはfree-running counterとpending addressを保持する。
今回snapshot APIは追加していない。

importerの必須入力と共有ビルド試験を拡張した。
通常出力は比較用SDK出力とbyte一致し、共有`docs/generated/build-info.json`へYM3526を追加した。
先行7音源の記録・生成物は保持した。公開ビルド文書も更新し、既存CIのoffline試験対象へ追加した。

## ソースと生成物

本体とSDKの実装・ヘッダー・ライセンス12組がbyte一致した。
4翻訳単位が実際に読む11ファイルも、`src/`と`vendor/ymfm/`を対応づけると一致する。
SDKのcatalogは今回の全実依存を列挙している。
入力・出力hashと実行結果は[検証JSON](wasm_sdk_ym3526_adoption_01.json)を参照する。

Emscriptenは`6.0.6-git`。生成JSは配布済み・旧recipe再ビルド・SDKの3組とも同じ14,274bytes。
旧2組のWASMは18,878bytes、SDK版は18,894bytesでhashは異なる。
旧recipeの再ビルドも配布済みWASMとhashが異なるため、バイナリー一致と実行結果一致は区別する。

## 実WASM比較

`scripts/check_ym3526_wasm_sdk.mjs`で旧recipe再ビルドとSDK、配布済み版とSDKの2組を比較した。

- 各1,494比較: 生PCM 1,302＋既存AudioEngine 192。PCM・続行probe、read／status／IRQと同期フック、
  JSの残余／保持sampleを比較し、各18,759,234出力ステレオフレームで差0。
  本文17,952,768＋各シーン後の257-frame probe 806,466を含む。
- clockごとに217個のrawシーン、Engine込み計747設定を通常／不規則block分割で比較した。
  全9CH×connection 2種類×feedback 8段階、operator倍率・AM／vibrato／envelope／sustain、
  5打楽器と全32rhythm key mask、mute、timer／IRQ／CSM、pending bus latchを含む。
- 通常blockの重点75設定で両ビルドをpublic resetして同じ命令列を再実行し、計150回の再演奏が一致した。
  状態を保存して途中からloadしたという意味ではない。
- Native PCMは`floor(clock / 72)`。3,579,545／4,000,000／8,000,000Hzと、
  Engineの44.1／48／96／192kHzで平均化／sample保持を比較した。
- 正の自己試験でconnection／feedback、AM／vibrato、sustainが実際にPCMを変えること、
  OPL2 waveform指定では変わらないことを確認した。
  全9CHと5打楽器のmute→unmuteで内部進行を保つこと、owned配列の保持と実capacity増加も確認した。
- Timer Aは4、Timer Bは16 native frameでIRQを発生した。mask／unmask、stop／clearも確認した。
  IRQをmaskしたTimer Aでも、通常key-onなしのCSMで全9CHが単独発音することを確認した。
- 別枠の実VgmPlayerで3 clock×3 rateの9構成それぞれを全曲再演奏し、各6地点から257-frame継続を比較した。
  `seekPlayback`は既存の先頭からの再構築を使い、保存checkpointは常に0件だった。
  実際にEngineが生成した773,082フレームとplayerの引渡し646,698フレームを分け、後者を重複加算しない。
- 自己試験439,962出力フレームと上記Player生成は主比較とは別集計で、合計19,972,278生成フレーム。

statusの固定下位bit`0x06`、Timer A／Bの`0x40`／`0x20`、IRQの`0x80`、
偶数portのstatus aliasと奇数portの`0xff`も実フックと合わせて確認した。
raw reset後にaddressなしでdataを書いた場合と明示register指定のPCMを照合し、pending addressの保持も確認した。
公開snapshotや生の内部状態bytesの比較は含まない。

## その他の検証

- Python47件成功: importer16＋YM2612のビルド経路3＋他7 artifactの各4件。
  fresh copyからの既定／相対出力、header解決、改変拒否、先行7音源の記録・bytes保持を確認した。
- 既存OPL／Synth／Inspector／VGM export・operator表示試験81件成功。
  OPL系共通試験も含み、音色編集・A4・Stop／再trigger・mute・timer・seek等の回帰を確認した。
- Chromium／WebKitで追加生成／DOS PC主音源の計4経路の実Worklet出力が成功。
  聴音側をmuteし、gain`1.03357`と非有限値・範囲超過0を確認した。
- 同じ2ブラウザーで既存YM3526音色／Keyboard UI試験も成功。
  A4、carrierの部分編集、Hold／release、PC／Guitar鍵盤、Stop後の全gate解除を確認した。
  最終destinationだけをzero gainへ接続する一時harnessを使用し、元の試験・本体は変更していない。
  このUI検証はmain実行のみで、Workerや他OPL chipのBrowser UI試験は含まない。
- 隔離npm tarballの803ファイル、26WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。
  `release/hello_ymfm_wasm_ym3526-sdk_itch_vgm_analyzer.zip`に比較済みJS／WASMを収録した。
- アクティブな校正記録には影響するhash参照がなく、再測定は不要だった。
  既存校正記録・Mixer数値と両生成器の`--check`を維持した。

SDK／Tauriリポジトリは変更していない。公開手順は[ビルド文書](../building_ym2612_wasm.md)、
再開地点は[Save Point](savePoint.md)を参照する。
固定SDKのWASM参照は計8 artifact、残り19。次は同じOPL系のYM3812が候補。
remote CI、OS／機材での聴音、npm・アプリ公開は未実施。
