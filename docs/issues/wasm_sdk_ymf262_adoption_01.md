# YMF262 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_ymf262_wasm.sh`を同梱SDKのWASMレシピへ切り替えた。
SDKは先行する9 artifactと同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定379ファイルと取り込み記録は変更していない。
着手時の本体は`b20bd5c2fb398b5dc50c5c343f724f5f71cde51d`でcleanだった。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh ymf262`を実行する。
出力先は呼出し側を基準に絶対化し、`EMXX`でコンパイラーを指定できる。
C++14／O2、12 export、`cwrap`／`HEAPF32`とmemory growthを維持する。
旧recipeと同じく、明示的な`ASSERTIONS`指定やPerlによるglueの空白除去は行わない。
公開API・Mixer値を維持し、同期`read()`／`generateStereo()`とcaller-ownedな`generateStereoInto()`も変更していない。
既存AudioEngineは`generateStereoInto()`へ再利用scratch配列を渡す。この経路も比較した。

既存のWASM／JSには保存・復元APIがないため、raw reset・public reset・再演奏・seekを比較した。
public resetはhandleを再生成してJS mute maskを再適用し、raw resetはfree-running counterとpending addressを保持する。
今回snapshot APIは追加していない。

importerの必須入力と共有ビルド試験を拡張した。
通常出力は比較用SDK出力とbyte一致し、共有`docs/generated/build-info.json`へYMF262を追加した。
先行9音源の記録・生成物は保持した。公開ビルド文書も更新し、既存CIのoffline試験対象へ追加した。

## ソースと生成物

本体とSDKの実装・ヘッダー・ライセンス12組がbyte一致した。
4翻訳単位が実際に読む11ファイルも、`src/`と`vendor/ymfm/`を対応づけると一致する。
SDKのcatalogは今回の全実依存を列挙している。
入力・出力hashと実行結果は[検証JSON](wasm_sdk_ymf262_adoption_01.json)を参照する。

Emscriptenは`6.0.6-git`。生成JSは配布済み・旧recipe再ビルド・SDKの3組とも同じ14,274bytes。
旧recipe再ビルドと配布済みWASMは21,361bytesでbyte一致、SDK版は21,377bytesでhashが異なる。
バイナリー一致と実行結果一致は区別する。

## 実WASM比較

`scripts/check_ymf262_wasm_sdk.mjs`で旧recipe再ビルドとSDK、配布済み版とSDKの2組を比較した。

- 各3,456比較でPCM・続行probe、read／status／IRQと同期フック、JSの残余／保持sampleを比較し、
  各44,658,756出力ステレオフレームで差0。本文42,799,104＋257-frame probe 1,859,652を含む。
- clockごとに536個のrawシーン、Engine込み計1,728設定を通常／不規則block分割で比較した。
  2bankの全18CH、2OP connection／feedback、全6組の4OPと4 algorithm、8波形、NEW切替、
  4出力bus、5打楽器と全32rhythm key mask、mute、timer／IRQ、pending bus latchを含む。
- 通常blockの重点162設定で両ビルドをpublic resetして同じ命令列を再実行し、計324回の再演奏が一致した。
  状態を保存して途中からloadしたという意味ではない。
- Native PCMは`floor(clock / 288)`。OPL1／2の`clock / 72`とは区別し、Engineの別出力rateで平均化／sample保持を比較した。
- 各4OP algorithmを実際に発音させ、片方のpartnerによるmuteとunmute後の内部進行も確認した。
  4出力busはA+Cを左、B+Dを右へ合算する。単独bus・合算・飽和処理を実PCMで確認した。
- NEW=1の8波形、NEW=0の下位2bit選択、register `0x01`の波形gateを使わない既存仕様を確認した。
  NEW=0時の上位addressの下位bankへの折り返しと、既に書かれた上位bankの状態保持を区別した。
- Timer A／B、mask／unmask、stop／clearを確認した。YMF262はCSMのkey-onを行わない既存実装を維持する。
  status固定`0x06`はなく、offset下位2bitが0のportだけstatus、他3portは`0xff`となる。
- caller-ownedなInto配列の書込範囲、owned PCMの保持と実capacity増加、Engineのscratch再利用を確認した。
- 別枠の実VgmPlayerで3 clock×3 rateの9構成それぞれを全曲再演奏し、各6地点から257-frame継続を比較した。
  `seekPlayback`は既存の先頭からの再構築を使い、保存checkpointは常に0件だった。
  実際にEngineが生成した773,082フレームとplayerの引渡し646,698フレームを分け、後者を重複加算しない。
- 自己試験1,154,856出力フレームと上記Player生成は主比較とは別集計で、専用checkerの合計は46,586,694生成フレーム。

公開snapshotや生の内部状態bytesの比較は含まない。
単独busから合算clampを確認する一時probeは上記専用checkerのframe数へ加算していない。

## その他の検証

- Python55件成功: importer16＋YM2612のビルド経路3＋他9 artifactの各4件。
  fresh copyからの既定／相対出力、header解決、改変拒否、先行9音源の記録・bytes保持を確認した。
- 既存OPL／Synth／Inspector／VGM export・operator表示試験81件成功。
  OPL系共通試験も含み、4OP・左右出力・音色編集・Stop／再trigger・mute・timer・seek等の回帰を確認した。
- Chromium／WebKitで追加生成／DOS PC主音源の計4経路の実Worklet出力が成功。
  聴音側をmuteし、gain`0.516785`と非有限値・範囲超過0を確認した。
- 同じ2ブラウザーで既存YMF262音色／Keyboard UI試験も成功。
  18CH、A4、4OP pair、左右独立出力、carrierの部分編集、Hold／release、PC／Guitar鍵盤、Stop後の全gate解除を確認した。
  最終destinationだけをzero gainへ接続する一時harnessを使用し、元の試験・本体は変更していない。
  このUI検証はmain実行のみで、Workerや他OPL chipのBrowser UI試験は含まない。
- 隔離npm tarballの803ファイル、26WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。
  `release/hello_ymfm_wasm_ymf262-sdk_itch_vgm_analyzer.zip`に比較済みJS／WASMを収録した。
- アクティブな校正記録には影響するhash参照がなく、再測定は不要だった。
  既存校正記録・Mixer数値と両生成器の`--check`を維持した。

前回YM3812の検証JSONに残っていた音源名ラベル3箇所も訂正した。計測値・入力hashは変更していない。

SDK／Tauriリポジトリは変更していない。公開手順は[ビルド文書](../building_ym2612_wasm.md)、
再開地点は[Save Point](savePoint.md)を参照する。
固定SDKのWASM参照は計10 artifact、残り17。次はY8950（MSX-AUDIO）が候補。
remote CI、OS／機材での聴音、npm・アプリ公開は未実施。
