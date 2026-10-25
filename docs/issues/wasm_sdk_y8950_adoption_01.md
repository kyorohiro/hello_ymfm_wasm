# Y8950 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_y8950_wasm.sh`を同梱SDKのWASMレシピへ切り替えた。
SDKは先行10 artifactと同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定379ファイルと取り込み記録は変更していない。
着手時の本体は`915afaa7a15060c5e106b6b6f28ca93d3ce76654`でcleanだった。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh y8950`を実行する。
出力先は呼出し側を基準に絶対化し、`EMXX`でコンパイラーを指定できる。
C++14／O2、14 export（muteが先頭）、`cwrap`／`HEAPF32`／`HEAPU8`とmemory growthを維持する。
旧recipeと同じく、明示的な`ASSERTIONS`指定やPerlによるglueの空白除去は行わない。
公開API・Mixer値、同期`read()`／`generateStereo()`とサンプルメモリーのload／clear APIは変更しない。

既存のWASM／JSにsnapshotとInto APIはない。raw reset・public reset・再演奏・seekを比較し、APIの追加は行っていない。
Y8950のFMはOPL1のsineのみ。OPL2の波形選択registerを書いても既存どおり無効になる。

importerの必須入力と共有ビルド試験を拡張した。
通常出力は比較用SDK出力とbyte一致し、共有`docs/generated/build-info.json`へY8950を追加した。
先行10音源の記録・生成物は保持した。公開ビルド文書も更新し、既存CIのoffline試験対象へ追加した。

## ソースと生成物

本体とSDKの実装・ヘッダー・ライセンス12組がbyte一致した。
4翻訳単位が実際に読む11ファイルも、`src/`と`vendor/ymfm/`を対応づけると一致する。
SDKのcatalogは今回の全実依存を列挙している。
入力・出力hashと実行結果は[検証JSON](wasm_sdk_y8950_adoption_01.json)を参照する。

Emscriptenは`6.0.6-git`。生成JSは配布済み・旧recipe再ビルド・SDKの3組とも同じ15,461bytes。
旧2組のWASMは22,409bytes、SDK版は22,425bytesでhashは異なる。
旧recipeの再ビルドも配布済みWASMとhashが異なるため、バイナリー一致と実行結果一致は区別する。

## 実WASM比較

`scripts/check_y8950_wasm_sdk.mjs`で旧recipe再ビルドとSDK、配布済み版とSDKの2組を比較した。

- 各1,794比較（生PCM 1,458＋既存AudioEngine 336）で、PCM・続行probe、read／status／IRQと同期フック、
  JSの残余／保持sampleとアップロード用メモリーミラーを比較した。各22,833,498出力ステレオフレームで差0。
  本文21,823,488＋各シーン後の257-frame probe 1,010,010を含む。
- clockごとに243個のrawシーン、Engine込み計897設定を通常／不規則block分割で比較した。
  全9CHの2OP connection／feedback、AM／vibrato／envelope／sustain、sineのみの波形仕様、
  5打楽器と全32rhythm key mask、timer／IRQ／CSM、mute、pending bus latchを含む。
- 通常blockの重点171設定で両ビルドをpublic resetして再実行し、計342回の再演奏が一致した。
  状態を保存して途中からloadしたという意味ではない。
- Native PCMは`floor(clock / 72)`。3,579,545／4,000,000／8,000,000Hzと、
  Engineの44.1／48／96／192kHzで平均化／sample保持を比較した。
- ADPCMはDelta-N、level、外部RAM／CPU feed、繰り返し／EOS／停止、4種類のmemory mode、
  FM・リズムとの混合、独立muteを実PCMで確認した。EOS最短例は65 native frameだった。
- 2MiB上限と最終64byte、offset／sizeの拒否、growのzero fill、shrinkと再grow、clear、
  CPU recordと範囲外writeを、期待データを独立アップロードしたADPCM出力と照合した。
  memory系の正の自己試験57,867フレーム／buildはwrapperの集計へ含めた。
- 実VgmPlayerで3 clock×3 rateの9構成を全曲再演奏し、各6地点の257-frame継続を比較した。
  独自に作成したtype `0x88`ブロックで読み込んだ1,536byteの長さ・hashも全seek後に確認した。
  `seekPlayback`は先頭からの再構築で、保存checkpointは常に0件だった。
- 主比較とは別に、自己試験555,780＋実際のPlayer Engine生成773,082を集計した。
  専用checkerの合計は24,162,360生成フレーム。Player引渡し646,698は重複加算していない。

## 維持したメモリー・statusの既存仕様

- CPUのrecord writeとraw C loadはNative RAMを変更するが、JSの`sampleMemory`ミラーは更新しない。
  raw resetは実RAMを保持し、public resetはhandle再生成後にJSミラーを再アップロードする。
  この2つを同じ「状態復元」として扱わない。raw resetが保持するfree-running counter／pending addressも比較した。
- clearはサンプル配列を消す操作で、decoderをresetせず、即時無音を保証しない。停止は既存のdecoder制御を使う。
- 現在のCPU recordでは設定済みの最終byteへwriteしない既存端点を保持した。
- 現在の`read_data`は09／1AをADPCM index `0x02`／`0x13`へ渡し、CPU-data index 8へ届かない。
  09／1Aは0、0Fは`0xff`となる。外部RAMの直接readbackやdummy cursorを検証したという主張はしない。
  通常観測はeven portとstatus／IRQに限定し、data readは専用の有限な試験で比較した。
- statusにはEOS `0x10`／BRDY `0x08`／PLAYING `0x01`とtimer／IRQがあり、OPL1の固定`0x06`はない。
  masked statusの読出しで隠れたtimer flagがFM側へ反映され消える既存動作も区別した。
  読まずにunmaskした場合のflag露出と、読んだ場合の次のtimer発火を別々に確認した。
- Engineはmute切替時に保持sampleを0へ戻す。unmute直後の保持区間の0を除き、次のnative sampleから
  継続中の参照PCMへ一致することを確認した。mute control自体はpublic reset後も保持する。

公開snapshotや生の内部状態bytesの比較、read_dataの機能修正は含まない。

## その他の検証

- Python59件成功: importer16＋YM2612のビルド経路3＋他10 artifactの各4件。
  fresh copyの既定／相対出力、header解決、改変拒否、先行10音源の記録・bytes保持を確認した。
- OPL／Synth／Inspector／ADPCM／preview／VGM export・render／MSX複合描画の既存試験126件が最終成功。
  当初125成功／1失敗だったY8950 WAV比較試験は、CLIに入る校正Mixerが手組みのBrowser参照側に抜けていた。
  assetを差し替えず、凍結した配布済みWASMをSHA検証付きの一時loaderで注入して同じ失敗を再現した。
  参照側へ既存`installPlaybackMixer()`を追加した試験だけの修正で、配布済み版も2／2成功した。
  音源の処理・Mixer定数・公開APIは変更していない。
- Chromium／WebKitで追加生成／MSX-AUDIO主音源の計4経路の実Worklet出力が成功。
  FM gain`1.03357`、非有限値・範囲超過0を確認し、同じ2ブラウザーでFMの音色／Keyboard UIも成功した。
- 同じ2ブラウザーでADPCMのprimary／追加生成を計4経路確認した。PCMとStop後の無音、
  既存Sample Editorのファイル入力／trim／gain、ADPCM Keyboard、波形更新、追加音源のdisposeも成功した。
  既存helperを一時harnessでWeb Audio／mainだけに絞り、最終destinationをzero gainにした。
  元の試験・本体は変更していない。Native／Worker／Native resource計測／実マイクは対象外。
- 隔離npm tarballの803ファイル、26WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。
  `release/hello_ymfm_wasm_y8950-sdk_itch_vgm_analyzer.zip`に比較済みJS／WASMを収録した。
- アクティブな校正記録には影響するhash参照がなく、再測定は不要だった。
  校正記録・Mixer数値と両生成器の`--check`を維持した。

SDK／Tauriリポジトリは変更していない。公開手順は[ビルド文書](../building_ym2612_wasm.md)、
再開地点は[Save Point](savePoint.md)を参照する。
固定SDKのWASM参照は計11 artifact、残り16。次はAY-3-8910が候補。
remote CI、OS／機材での聴音、npm・アプリ公開は未実施。
