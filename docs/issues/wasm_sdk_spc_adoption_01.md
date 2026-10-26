# SNES／SPC WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_spc_wasm.sh`を同梱SDK `0.1.1`の`spc`ターゲットへ切り替えた。
固定revisionは先行18 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルをoffline検証し、出力先を絶対化してSDK dispatcherを実行する。
C++14／O2、accurate S-DSP、ASSERTIONS、33 C export、runtimeの3項目と生成JSのPerl cleanupを維持する。
SPC700ファイル再生とS-DSP単体合成は同じ既存WASMを使う。公開API・Synth・Mixerの数値は変更していない。

着手時の本体は`ef783f2099a97cd8faed4ec5f1cf90efbd103059`でcleanだった。
SDK pin・原本とTauriは変更せず、先行18 artifactの生成記録・36出力も保持した。
build receipt、必須入力・ビルド経路試験、配布ソースのコピー、比較checkerと文書を更新した。
詳細なhash・試験結果は[検証JSON](wasm_sdk_spc_adoption_01.json)に記録する。

## 入力・生成物

wrapper・SNES-SPC全24ファイル・プロジェクトLICENSEの26組で、旧原本とSDKの対応がbyte一致することを確認した。
ビルドレシピは別途flags・export・runtime・cleanupを比較し、維持を確認した。
5翻訳単位の実依存は12ファイル。LGPLと由来・変更記録を保持し、optional fast DSPやfilterは追加していない。

生成JSは全経路で41,458bytes、SHA-256は`13106eb82513dac0b3d3e4983b9cb1843eedcdf698ec385a5a91cf9d1d27b699`。
WASMには次の差がある。

| ビルド | bytes | SHA-256 |
| --- | ---: | --- |
| 配布済み・旧手順再ビルド・配布ソース単体 | 63,200 | `cbbe06819574249217f35da16eebd45a53274e53251f31242e7dd407b03d0d70` |
| SDK・通常docs出力・今回のnpm／Analyzer ZIP | 63,074 | `9a8f6facab15990346cc712e8b14bf316c2b7fcc1260f9ccbea49efea39df408` |

ASSERTIONSが保持する`__FILE__`の配置が`third_party/snes-spc/`から`vendor/snes-spc/`へ変わる。
SDKの入力・flagsを保ち、レシピのパス5箇所だけを旧配置へ戻す配布ソース単体ビルドで、旧WASMのbytesを再現できた。
旧版とSDK版のバイナリ同一性は主張せず、PCM・RAM・DSP・traceを別途比較した。

## 維持したAPIと比較範囲

- `SpcCore`はSPC700＋accurate S-DSPでSPCファイルを再生する。`SnesDspCore`はDSP単体のBRR・RAM・DSP register・timelineを扱う。
  native rateは32,000 Hz、trace clockは1,024,000 Hz。出力は呼出し側が所有するFloat32配列へコピーする。
- `snapshot()`は64 KiB RAM・128 DSP bytes・`nativeFrames`のコピーで、解析用の観測情報。
  CPU register・DSP内部位相・出力FIFO全体を含む保存形式ではなく、任意位置の状態復元APIは追加していない。
- SPCのrestart／resetは保持した元ファイルから再ロードする。DSP単体のresetはRAM・DSPを消す。双方でmute設定は保持する。
  失敗したSPC loadが既存の続行再生を壊さないことも比較した。
- 8 voice muteは出力を抑える一方、BRR・envelope・PMONは進む。既にqueuedされたPCMやecho RAMの残響は残る。
  同じmute履歴で旧／SDKを比較し、一度もmuteしなかった全状態との同一性は主張しない。
- CPUが再生中のBRR RAMを書き換える場面には、upstreamのDSP遅延更新によるblock分割依存がある。
  その場面は同じ分割を与えた旧／SDKで比較する。128-frame分割で捕捉したtraceのtimeline再生は、異なる分割でも比較する。
- trace・RAM読出し範囲のdiscovery／filter、observerのoverflowと途中開始時の絶対時刻、timelineのコピー所有・終端・再開を確認した。
  timelineは元出力の4-frame FIFOを維持し、終端後のsilenceはnative位置を進めない。

## 配布用ソース

`scripts/copy_spc_sources.mjs`はpinのmanifest hashと全26入力を検証してから出力する。
wrapper・全24 vendorファイル・ライセンス／noticeはSDKの検証済みbytesを使う。
standalone recipeはflagsを維持し、`vendor/snes-spc`の5箇所だけを既存bundle layoutの`third_party/snes-spc`へ移す。
core・recipe・manifestの改変が出力作成前に拒否されることを隔離fixtureで確認した。

bundleの`sources/`から`sh scripts/build_spc_wasm.sh docs/generated`で実ビルドした。
引数省略時は`dist/wasm/`。SDK checkout・Python importer・networkは不要。
生成物は上表の旧配置WASMを再現し、SDK版との音声比較も通った。
FM npm・VGM npm・Analyzer ZIPに、今回のSDK生成物と対応する全26入力・変換済みrecipeが収録される。

## 検証結果

旧手順再ビルド／配布済みdocs／配布ソース単体の3組をそれぞれSDK版と比較した。
各組は40シナリオ・2分割の80ケース、両buildで160シナリオ実行。
PCM、観測RAM／DSP／nativeFrames、trace・timelineの差は0だった。
全8 voiceの個別発音、BRR全4 filter・end／loop／address wrap、GAIN／ADSR／KOFF、pitch・noise・stereo／echo／PMONを含む。
実heap拡大・scratch上書き・dispose後の出力所有も確認した。

各比較組の両build合計は、要求1,018,156、受渡し済み1,017,898出力ステレオフレーム、native位置の増分1,017,766。
失敗を期待するtrace試験では例外までにnativeが進む場合があり、timeline終端のsilenceは位置を進めないため、これらは別々に数える。
3組は同じシナリオを反復したもので、固有coverageへ重複加算していない。

- Pythonのimport／ビルド経路91件、SPC／SNES関連の既存Node試験222件が成功した。
- Chromium／WebKitの主SNES・追加SNES計4 Worklet経路が成功した。
  Mixer gain `0.131825`、校正振幅`0.12881811176027572`を維持し、最大相対誤差は`1.3643e-8`。
  校正のhashだけを更新する処理は行わず、既存測定記録・数値は保持した。
- 既存SNES Browser試験をWeb Audio／mainへ絞った実行は両browserで成功した。
  BRR再利用・独立インスタンス、Mixer mute／音量／FX比、reset／KOFF／Stopを確認した。
  全8CHのKeyboard／Operators UIを確認したという意味ではない。
- SPCファイル再生は両browser×44,100／48,000 Hzの4ケースが成功した。
  pause・mute・seek・seek cancel・Stop／restart・不正ファイル後の復帰を含む。
- **WebKitの初期化中close試験は未解決。** 2回ともrequestはAbortErrorで中断し、遅れて作られたnodeもなかったが、AudioContextが`running`のままだった。
  Chromiumの同試験は成功。旧WASMのclose単独試験は成功したが、同じ再生手順を含む旧版比較は先に無音判定で停止したため、移行による新規問題とも既存問題とも確定していない。
  Browser試験全体を成功扱いせず、`browserLifecycle.passed=false`として証拠を保持する。元の試験・runtimeは変更していない。
  再開時は、既存Browser試験の再生→close順序、AudioContext所有・resume／closeと一時mute harnessを切り分ける。
- FM npmの803ファイル・26 WASM engine・942参照と型／実行検証が成功した。
  tarballは1,590,727bytes、展開後5,934,164bytes。
- VGM npmもtarballの隔離offline installからSPC解析・render・export・CLI回帰検証が成功した。
  157 modules、820,818bytes圧縮／2,704,030bytes展開。既存版番号のままローカル検証し、公開していない。
- Analyzer ZIPは753参照・370ファイルを検証した。WASM・対応ソースも照合した。

Browser確認は最初の音声接続前から最終destinationをzero gainとし、音源・Mixer／FX・観測値を維持した。
Worker・Native backend・Audify・hardware microphone・実機聴音・remote CIは未実施。
SDK参照のWASMは計19／27 artifact。残り8は`k051649`、`nuked_opn2`、`segapcm`、`ym3438`、`ymf276`、`ymf278b`、`ymf288`、`dx7`。
次の移行候補はSega PCM。上記WebKit closeの切り分けは独立した未解決事項として残す。
