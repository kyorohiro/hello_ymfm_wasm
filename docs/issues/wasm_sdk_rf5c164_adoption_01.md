# RF5C164 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_rf5c164_wasm.sh`を同梱SDK `0.1.1`のWASMレシピへ切り替えた。
固定revisionは先行13 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルのoffline検証後にSDK dispatcherを実行し、出力先を呼出し側から絶対化する。
`EMXX`、C++14／O2、`ASSERTIONS=1`／`EXPORT_ALL=1`、16 C export、
`cwrap`／`HEAPF32`／`HEAPU8`とmemory growthを維持する。
公開API、Synth、機種用接続とMixer値は変更していない。

着手時の本体は`70998f67e4820020ad78175cb3a97997ed4cfee6`でcleanだった。
固定SDK／Tauriとpinは変更せず、先行13音源の生成記録・26出力も保持した。
新しいbuild receipt、importerの必須入力とビルド経路試験、README・ビルド文書・Save Pointを更新した。

## 入力・生成物

本体とSDKの実装・state helper・ライセンス・由来記録8組がbyte一致した。
2翻訳単位の実依存4ファイルも、`src/`／`third_party/mame-rf5c164/`とSDKの配置を対応づけると一致する。
MAME適応版のBSD-3-Clause宣言とライセンスを保持する。

固定SDKの個別catalogには、実依存の`vendor/ymfm/chip_state.h`が列挙されていない。
このheader自体は同梱済みで、全379ファイルのmanifest検証と専用の改変拒否試験が保護する。
固定原本は変更せず、個別catalogの補足は将来のSDK更新候補として記録した。

Emscripten `6.0.6-git`で、配布済み・旧手順再ビルド・SDK・通常出力がすべてbyte一致した。
JSは35,162bytes、WASMは27,583bytes。
校正記録とMixer生成器の検査も維持でき、再測定と音量変更は不要だった。
詳細なhash・試験結果は[検証JSON](wasm_sdk_rf5c164_adoption_01.json)を参照する。

## 維持した音源・状態の仕様

- configured出力rateでPCMを生成し、clock／384の最新sampleを保持する。reset後の最初のframeでtickする。
  8 voiceのstep／address、fractional phase、左右の保持sampleを含めて比較する。
- sign-magnitudeの`0x80`／`0x00`は0、`0xff`はloop marker。
  loop先も`0xff`なら、そのvoiceはenableを保持したままaddressを進めず無音になる。
  panの下位nibbleが左、上位が右。8 voice合算後の両clamp端点も確認する。
- `read()`はvoice addressのbus読出しで、registerの保存値を返す機能ではない。
  `readMemory()`は絶対RAM、`writeMemory()`は選択中の4 KiB windowを使う。
  banked loadはbankとoffsetのORであり、加算ではない。
- chipのraw／public resetは64 KiB RAMを保持し、voice／bank／control／phaseを初期化する。
  一方、既存GenesisAudioEngineのresetはその後にRAMもclearする。この2つを区別する。
- `clearMemory()`はRAMだけを消す。保持sampleとphaseを消さず、次のnative tickまで旧sampleが残ることがある。
- Native stateは65,660bytesで、RAM 65,536bytes、voice／control／phase／保持sampleを含む。
  public snapshotは同一instance・同一buildのopaque token。
  信頼した比較build間のraw state復元と、公開tokenの所有制約を別々に確認する。
- `generateStereo()`はowned配列。後続生成・容量拡大・実WASM heap拡大・dispose後の保持を確認する。
  borrowed view／Into／IRQ APIは追加しない。

## 検証範囲

専用checkerは実RF5C164 WASMを、旧手順再ビルドとSDK、配布済み版とSDKの2組で比較する。
独自に作成した波形・register列・VGMを使い、PCM・bus読出し・RAMを含むstateと続行probeを照合する。
実GenesisAudioEngineのFM／PSG／PCM混合、opaque状態からの継続と、VgmPlayerのRAM転送・checkpoint／seekも扱う。
active FMのresetをpower-onと同一とは扱わず、既存YM2612のfree-running timingを保持する。

両比較とも各828ケース（raw 738＋Genesis Engine 90）、414構成が成功した。
同一instanceの状態復元234回、信頼したraw状態の相互復元144回、reset／再演奏342回を含む2,376実行で差0。
本文4,634,334＋続行probe 301,752＝4,936,086出力ステレオフレームを比較した。
正の自己試験16,178＋実Player生成470,160を加えた合計は各5,422,424フレーム。
内部source生成とPlayer引渡し373,260フレームは重複加算していない。
すべてのRAMとstateを実際にbyte比較し、reportにはそのhashを残した。

- Pythonのimport／ビルド経路試験71件と、RF5C164／Mega CD／サンプラー／Genesis状態の既存試験53件が成功した。
- Chromium／WebKitでMega CDの主PCMと追加RF5C164の計4 Worklet経路を確認した。
  既存Mixer値`0.280286`、振幅`0.12881797552108765`を維持した。
- 同じ両BrowserのWeb Audio／mainで初期コード、元の2つのPCM exampleとsamplerを確認した。
  合成WAVのファイル入力、保存asset復帰、8 voice／voice steal、Keyboardのpitch／release／focus／Stopと、
  oscillator-backed mock microphoneによる録音・cancel・遅延permissionの後始末が成功した。実マイクは使用していない。
  全出力を最初の接続前から最終zero gainへ送り、音源・Mixer／monitor値は通常のまま使った。
  既存helperは現在のexample数7に対して4件を想定していたため、一時harness内で元の3つの
  `/examples/mega-cd/`ファイル＋indexへ絞った。追加された共有exampleとWorkerは対象外で、元の試験・本体は変更していない。
- 隔離npm配布物の803ファイル、26 WASM engine、942相対参照と型・実行検証が成功した。
- Analyzer ZIPの753ローカル参照、370ファイルと収録RF JS／WASMの一致を確認した。

固定SDKのWASM参照は計14 artifact、残り13。次は32X PWMが候補。
Native backend、remote CI、実機の聴音、npm／アプリの公開は今回の対象外。
