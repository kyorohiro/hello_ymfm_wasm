# HuC6280 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_huc6280_wasm.sh`を同梱SDK `0.1.1`のWASMレシピへ切り替えた。
固定revisionは先行15 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルのoffline検証後にSDK dispatcherを実行し、呼出し側の出力先を絶対化する。
`EMXX`、C++14／O2、`EXPORT_ALL=1`、8 C export、`cwrap`／`HEAPF32`とmemory growthを維持する。
元のレシピに明示的なASSERTIONS指定とPerlによる後処理はない。
公開API、Synth、機種用接続とMixer値は変更していない。

着手時の本体は`c90e7ffa03dfa95b8b35eefb4326413300e0e9d2`でcleanだった。
固定SDK／Tauriとpinは変更せず、先行15音源の生成記録・30出力も保持した。
新しいbuild receipt、importerの必須入力とビルド経路試験、README・ビルド文書・Save Pointを更新した。

## 入力・生成物

本体とSDKの実装・ライセンス・由来記録8組がbyte一致した。
2翻訳単位の実依存3ファイル（wrapper、core cpp、core header）も配置を対応づけると一致する。
個別catalogは実依存3ファイルを列挙済み。MAME適応版と原本のBSD-3-Clause宣言を保持する。

Emscripten `6.0.6-git`で、配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMがすべてbyte一致した。
JSは13,612bytes、WASMは8,935bytes。
既存校正記録11件とMixer生成器の検査も維持でき、再測定と音量変更は不要だった。
詳細なhash・試験結果は[検証JSON](wasm_sdk_huc6280_adoption_01.json)を参照する。

## 維持した音源・復帰の仕様

- 音が出るのは6 voice。選択registerには6／7も保持できるが、合成対象外で無音。
  各voiceは32 sample・5bitのwave RAM、12bit periodを持ち、period 0は4096として扱う。
- enable・DDA切替とwave indexを保持する。DDA 1→0でindexを0に戻し、
  wave書込はdisabled時にindexを進める。DDA書込はDAC値を更新する。
- global／channel balanceの上位nibbleが左、下位が右。voice volumeは5bitで、既存の非線形tableを使う。
  host mute中も音源の位相は進み、muteは音量へ適用する。
- noiseはCH4／5、LFOはCH1からCH0へのperiod変調。既存コアの振舞いを維持し、実機精度の変更は行わない。
- 出力frameごとに整数位相へclockを足し、発生したchip tickのsampleを平均する。
  clockが出力rateより低くtickがないframeは直前sampleを保持する。JS側に別のresamplerはない。
- resetはwave RAM・register・voice・整数位相・保持sampleを初期化する。noise seedは1、host muteとengine volumeは保持する。
- `writeHuc6280Stream()`の明示portは一時選択後に元のchannelを復帰する。port `0xff`は現選択channelを使う。
- 公開低レベルadapterは`Huc6280AudioEngine`。`processFrames()`はowned配列を返す。
  snapshot、read／status／IRQ、borrowed view、Into APIは存在せず、今回も追加しない。
  復帰はreset／再演奏とVgmPlayerの先頭からのseekを比較する。

## 検証範囲

専用checkerは実HuC6280 WASMを、旧手順再ビルドとSDK、配布済み版とSDKの2組で比較する。
独自に作成した波形・register列・VGMを使い、PCMと続行probe、公開engineのbuffer所有とstream channelを照合する。
VgmPlayerのB9 register命令、type 05／chip 1bのDDA stream、stop／順序／replay／seekも扱う。

両比較とも各828ケース、46シナリオ×9 clock／rate＝414構成が成功した。
選択した14シナリオのreset／再演奏252回を含む1,908実行で差0。
本文1,465,344＋続行probe 185,076＝1,650,420出力ステレオフレームを比較した。
正の自己試験130,044＋実Player生成614,454を加えた合計は各2,394,918フレーム。
chip内部のtickとPlayerへの引渡しframeは重複加算していない。

自己試験では、32段階DDAとglobal／channel balanceの独立計算、wave indexの実PCM、
CH4／5の全32 noise rateの18bit LFSR／divider／tick平均モデル、LFOの4 modeとreset bit、
mute中の位相継続・低clock時の保持sample、reset後にRAMを再uploadしない確認も実行した。
owned出力は後続生成・実容量拡大・実WASM heap拡大・dispose後も保持されることを確認した。

- Pythonのimport／ビルド経路試験79件と、HuC6280／Synth／Inspector／Analyzer／renderの既存試験63件が成功した。
- Chromium／WebKitでPC Engineの主HuC6280と追加HuC6280の計4 Worklet経路を確認した。
  既存Mixer値`0.44`、振幅`0.07097228989005089`を維持した。
- 同じ両BrowserのWeb Audio／mainで既存voice UIを確認した。6CHのpitch、左右pan、音量、
  wave描画／編集、DDAの設定と試聴guard、noise CH4／5、Guitar／PC Keyboardの所有・release・focus／blur・Stop、
  背景loopとの併用、設定保持・再Runが成功した。UIのLFO確認はregister編集で、可聴変調は専用WASM checkerで扱う。
  最初の接続前から最終zero gainを設け、音源・Mixer／monitor値は通常のまま使った。
  元の試験・本体は変更せず、既存`--main` filterと一時harnessを使用した。
- 隔離npm配布物の803ファイル、26 WASM engine、942相対参照と型・実行検証が成功した。
  tarballは1,590,433bytes、展開後5,933,288bytes。既存packageの実HuC6280 Client／Worklet／Inspector検証も通った。
- Analyzer ZIPの753ローカル参照、370ファイルと収録HuC6280 JS／WASMの一致を確認した。

固定SDKのWASM参照は計16 artifact、残り11。次はGame Boy APUが候補。
Native backend、remote CI、実機の聴音、npm／アプリの公開は今回の対象外。
