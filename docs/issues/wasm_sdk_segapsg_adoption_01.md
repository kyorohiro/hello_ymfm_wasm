# Sega PSG WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_segapsg_wasm.sh`を同梱SDKのWASMレシピへ切り替えた。
SDKは先行12 artifactと同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定379ファイルと取り込み記録は変更していない。
着手時の本体は`7982bbe3380b7208d0b29ed426d47f4e236f9c71`でcleanだった。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh segapsg`を実行する。
出力先は呼出し側を基準に絶対化し、`EMXX`でコンパイラーを指定できる。
C++14／O2、`ASSERTIONS=1`／`EXPORT_ALL=1`、save／loadを含む12個の公開C export、
`cwrap`／`HEAPF32`とmemory growthを従来どおり維持する。Perlによるglueの空白除去は行わない。

同じSega PSG moduleを、Genesis系の通常／Nuked、Game Gear、Master System、追加音源、
Analyzer／CLI／npmが使う。GenesisのPSGもYM2612 WASMとは別のinstanceである。
公開API・Synth・機種用接続・Mixer値は変更していない。

importerの必須入力と共有ビルド試験を拡張し、通常出力の`build-info.json`へSega PSGを追加した。
先行12音源の生成記録と24生成物を保持した。README・ビルド文書・Save Pointも更新した。

## ソースと生成物

本体とSDKの実装・ヘッダー・state helper・ライセンス5組がbyte一致した。
2翻訳単位の実依存4ファイルは、`src/`と`vendor/ymfm/`を対応づけると一致する。
SDKのcatalogは実依存をすべて収録している。
Sega PSGとstate helperはTetoricaの独自コードで、配置先が`vendor/ymfm/`でもymfm由来にはならない。
既存BSD-3-Clauseを保持する。入力・出力hashと実行結果は[検証JSON](wasm_sdk_segapsg_adoption_01.json)を参照する。

Emscriptenは`6.0.6-git`。配布済み・旧recipe再ビルド・SDK・通常出力のすべてで、
JS 33,978bytes、WASM 27,286bytesがbyte一致した。
PSGを追跡する2つのアクティブ校正記録にもhash変更はなく、両Mixer生成器の`--check`が成功した。
校正記録の差し替えや再測定、音量変更は不要だった。

## 実WASM比較

`scripts/check_segapsg_wasm_sdk.mjs`で旧recipe再ビルドとSDK、配布済み版とSDKの2組を比較した。
入力はこの試験のために作成したregister列とVGMで、外部の楽曲は含まない。

- 各7,074比較（raw 6,984＋既存GenesisAudioEngine 90）で、PCM・127-frame続行probeと
  40byteのNative stateが一致した。各32,864,256出力ステレオフレームで差0。
- 3 clock×44.1／48／96kHz、通常のowned出力と不規則blockの即時消費borrowed出力を比較した。
  3 tone、全16 attenuation、pending byte latch、8 noise mode、tone 3との連動、全256 stereo maskを含む。
- 613frame地点のpublic同一instance状態復元414回、信頼した2 build間のraw状態復元324回、
  reset後の再演奏432回を確認した。公開opaque tokenを別instanceへ渡す機能は追加していない。
- 正の自己試験ではtone period 0／1の定常出力、noise LFSR、各声のmuteの効果と位相、
  全stereo maskの独立した左右和、状態長の拒否、reserve、owned配列とborrowed viewの寿命を確認した。
  PCM容量だけでなく実際のWASM heap拡大も確認した。追加生成は両build計392,930フレーム。
- 実GenesisAudioEngineでFMとPSGを混合し、既存gainとidle FMの基線を含めて比較した。
  active FM＋PSGはopaque状態からの継続を比較した。
  既存YM2612のresetはfree-running timingを保持するため、active FMのresetをpower-onと同一とは扱わない。
- 実VgmPlayerの`0x50`書込み、public状態、実checkpoint復元とseekを比較した。
  reset／seek用fixtureは実GenesisAudioEngine上のPSG演奏とidle FMを使う。
  Playerが生成した758,694フレームを別に集計した。
- 専用checkerの合計は各34,015,880生成フレーム。
  Engine内部の同じsource生成と、Player引渡しは重複加算していない。

## 維持した既存仕様

- PSGはconfigured出力rateで生成する。各frameでclockをaccumulatorへ加算し、rate×16以上の間だけ
  tone／noiseを進め、その時点のlevelを出力する。AY方式の時間平均やJS resamplerではない。
- tone period 0／1は定常の正出力。noise registerは同じ値の再writeでもLFSRを再seedする。
  byte latchと、tone 3によるnoise rateも状態に含む。
- resetはcounter／latchを初期化してstereoを`0xff`へ戻す。mute maskは保持する。
  保存stateはrate／clock／accumulator、tone／noise、stereo／latchを含み、muteは含まない。
- public stateは同じinstance・同じbuildのopaque token。raw C loaderの検証はpointer／長さに限られる。
  信頼しない同サイズのstate入力を安全に読み込めるという意味ではない。
- `generateStereo()`はowned配列。`generateStereoView()`は容量長の配列と結果objectを再利用する。
  有効なのは先頭の要求frame数で、次の生成・メモリー拡大・dispose前に消費する。
- 既存VGM汎用parserは`0x4f` stereo commandを2byteとしてskipする。
  今回も削除したfixtureと同じPCMになることを確認し、VGM stereo対応を追加したとは扱わない。
  Game Gear routingは直接APIとWorklet経路で確認する。

## その他の検証

- Python67件成功。fresh copyの既定／相対出力、コンパイル設定と実header解決、
  改変のcompiler実行前拒否、先行12音源の記録・出力保持を確認した。
- PSG wrapper／stereo／mute／stream／Worklet、Genesis状態／checkpoint、Analyzer monitor、
  PSG export／API／Master System examplesの既存試験52件が成功。
- Chromium／WebKitで追加PSG、Genesis通常／Nuked、Game Gear、Master Systemの計10経路の実Worklet出力を確認した。
  これはcentered基準波形の確認で、全256 stereo maskはNodeの実WASM比較で扱う。
- 別の実Worklet確認で、両BrowserのGame Gear CH0を`0xff`／左のみ`0x10`／右のみ`0x01`へ切り替えた。
  無効側のpeakは厳密な0、出力側は両Browserとも`0.008812476880848408`だった。
  Master Systemは公開stereo操作がなく、mono出力が左右同一であることを確認した。
  計4つのBrowser／mode経路、8つのcapture windowを使った。
- Master SystemのPSG／OPLL同居とKeyboard、Game Gear Keyboardを両BrowserのWeb Audio／mainで確認した。
  一時harnessの最終destinationをzero gainにし、音源・Mixer／monitor値は通常のまま使った。
  Worker、他音源のKeyboard、実機の聴音は対象外。既存試験ファイルと本体は変更していない。
- 隔離npm tarballの803ファイル、26 WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。370ファイルのZIP内のPSG JS／WASMも比較済み出力と一致した。

固定SDKのWASM参照は計13 artifact、残り14。次はRF5C164が候補。
SDK／Tauriリポジトリ、公開APIとMixer定数、旧校正記録は変更していない。
remote CI、Native backend、OS／機材での聴音、npm・アプリ公開は未実施。
