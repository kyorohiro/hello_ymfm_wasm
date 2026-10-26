# K051649（SCC）WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_k051649_wasm.sh`を同梱SDK `0.1.1`の`k051649`ターゲットへ切り替えた。
固定revisionは先行20 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルをoffline検証し、出力先を絶対化してSDK dispatcherを実行する。
C++17／O2、9 C export、runtimeの`cwrap`／`HEAPF32`と`wasmBinary`初期化を維持する。
既存どおり`EXPORT_ALL`・明示的なASSERTIONS設定・Perl cleanupは追加していない。

着手時の本体は`289dac7dd684046d3f7c39aecb69813c8444386b`でcleanだった。
初回のgit status確認後に担当agentのimporter／試験編集が始まったため、freeze時のstatusも別に残した。
旧レシピ・既存出力・pin・SavePointの56ファイルは、freeze時に基準commitのbytesと直接照合した。
SDK pin・原本、Tauri、公開API・Mixer値は変更していない。
21番目のreceipt、必須入力・ビルド経路試験、実WASM比較checkerと文書を更新した。
詳細なhash・検証結果は[検証JSON](wasm_sdk_k051649_adoption_01.json)を参照する。

## 入力と生成物

wrapperとcore／header・ライセンス／由来の全7組は、旧原本とSDKでbyte一致した。
実コンパイルはwrapperとcoreの2翻訳単位。quoted includeは双方から`k051649.h`へ到達する2辺で、追加のstate helper依存はない。
保存したupstream cpp／headerは比較・由来用で、今回コンパイルするものではない。
MAME由来のBSD-3-Clause、作者・変更記録を保持する。

配布済みdocs・旧手順再ビルド・SDK・通常docs出力・直接Web用のJS／WASMはすべてbyte一致した。

| 生成物 | bytes | SHA-256 |
| --- | ---: | --- |
| `k051649_wasm.js` | 11,133 | `57d445ef13022fd9c1522c7547cf0ab9b11f312e6cad704fce13ccdee7e056e7` |
| `k051649_wasm.wasm` | 9,399 | `837df7a31733a58dc9ed5409a5b9fc70e1bf8893b03b4af35ce86cbfcc7a5d5c` |

## 維持したAPIと利用経路

- `K051649`は5 voice、SCCの共有wave、SCC+の独立wave書込み、frequency／volume／key／test registerとnative muteを扱う。
  返すPCMはowned Float32 stereo配列で、このコアの左右は同じmono信号になる。
- chipにはread／status／IRQ・state保存／復元・動的clock変更・borrowed／Into APIがない。
  内部状態のserializeを追加せず、同じ命令後のPCM、続行probe、reset／再設定で比較した。
- resetはwave・voice・積分状態を消し、muteを保持する。mute中も合成位相は進む。
  frequencyが8以下では新しいwave sampleへの進行が止まるが、既に保持されたsampleが残る場合がある。
  冷状態の無音と、発音途中の保持出力を区別して既存動作を確認した。
- `K051649AudioEngine`のgain／全体mute／声別muteとcaller-buffer出力を維持する。
  `MsxAudioEngine`は既存のAY／OPLL／Y8950／SCC構成を扱う。
  SCCを含むEngineには保存状態facadeがなく、実`VgmPlayer`のseekは元VGMを先頭から再演奏する。
- 主な利用側はAnalyzerのMSX再生、CLI／WAVとnpmの低レベルAPI。
  PlaygroundのMSX／MSX Audio modeへSCCを追加した作業ではない。

## 実WASM比較

`scripts/check_k051649_wasm_sdk.mjs`を独立レビュー後にfreezeした。
実行依存のstatic graph 22ファイルを含む34入力と、旧再ビルド・配布済み・SDKのビルド入力を合わせた41記録をコピー・照合した。
freezeしたcheckerをfreezeした入力に対して実行し、終了後も原本／コピー双方のhashを確認した。
fixtureは合成したwave／VGMのみで、音声deviceは開かない。

旧手順再ビルド／配布済みdocsの2組をそれぞれSDK版と比較した。
各組は3 clock（100,000／1,789,773／4,000,000 Hz）×3 output rate（8,000／44,100／96,000 Hz）×2 block分割。
38 chipシナリオとEngineのケースで387構成・774比較（chip 684＋Engine 90）、reset／再演奏360回を含む1,908実行が成功した。
本体PCM・127-frameの続行probe、regular／irregular分割の差は0。
2組は同じcoverageの反復で、固有ケースとして重複加算しない。

5 voice別の発音、signed wave／volume値、SCCの第4／第5声共有とSCC+の独立、全5声の加算・mute bits、
frequency threshold、test registerのwave書込み保護・counter reset、register alias／無視される範囲を正の自己試験でも確認した。
owned PCMのscratch上書き・capacity拡大・実heap拡大・dispose後の保持、Engineのgain／caller-buffer値も比較した。
native stateの直接観測やsnapshot復元を確認したという意味ではない。

各比較組の両build合計は次のとおり。

| 実出力 | ステレオフレーム |
| --- | ---: |
| シナリオ本文・reset／再演奏 | 3,907,584 |
| 続行probe | 242,316 |
| wrapper／Engineの正の自己試験 | 34,122 |
| 実MSX PlayerのEngine生成 | 2,384,316 |
| 合計 | 6,568,338 |

Player受渡しの2,185,560フレーム（seekで破棄するprefixを含む）は別計数で、先読みを含むEngine生成総数へ再加算しない。
実parserの`0xd2`、AY＋SCCの実混合、reset／再演奏・複数位置の先頭からのseekを比較した。
checkpointがなく統計も空であることを確認し、新しい保存機能は追加していない。

## Browser・配布物・既存試験

- SDK import／ビルド経路のPython試験99件、SCC／MSX／Analyzer／Mixer関連の既存Node試験47件が成功した。
  今回の移行に伴う製品runtimeや既存試験の参照側修正はない。
- Chromium／WebKitで実AnalyzerのSCC単独、既存方式でSCC+へ変換したfixture、AY＋OPLL＋Y8950＋SCCの全混合を再生した。
  全混合は各子音源が非0で、校正済み子音源の合計と実出力が一致した。SCC／SCC+の対応fixtureのPCMも一致した。
  gain `1.103844`／絶対gain `0.5`の一度だけの適用、Mixer／source mute・Resetを確認した。
- 最初の接続前から最終destinationをzero Gainにし、上流の合成・Mixer／観測を維持した。
  合成は主スレッド、AudioWorkletは出力transport。両browserで4回のWorklet→sink接続を確認した。
  初回の一時harnessは接続カウンターの仮定が誤っており失敗したため、実際の最終接続を数えるよう修正した。失敗JSONも保持し、製品は変更していない。
- 最終checkerの独立CLI確認は53実行。help・正常実行と51種類の期待どおりの拒否が成功した。
  同一／symlink入力、入力配下・既存出力・依存ファイル上書き、不正loader／WASM／receiptを拒否し、入力を保持した。
- 校正の66 source hashと既存generator checksが成功した。AnalyzerのSCC gain `1.103844`と既存測定記録を保持した。
  npmの共通calibrated presetにはSCC測定がなく、従来どおりgeneric unityを使う。
  生成物が同一なので、校正のhashだけの更新や過去の測定記録の置換は行っていない。
- FM npmの803ファイル・26 WASM engine・942参照と型／実行検証が成功した。
  実tarballは1,590,728bytes、展開後5,934,164bytes。install済みpackageのSCC直接APIとMSX entry、実asset URLも確認した。
- Analyzer ZIPの753参照・370ファイルを検証した。
  実tarball・install済みpackage・ZIPの計21項目で、SCC資産と既存BSD LICENSE／READMEが一致した。
  BSD notice配布を保持し、新しいSCC用standalone source bundleは追加していない。npmやアプリの公開はしていない。

固定SDKを使うWASMは計21／27 artifact。
残り6は`nuked_opn2`、`ym3438`、`ymf276`、`ymf278b`、`ymf288`、`dx7`。次の候補はYM3438。
Native／Tauri、remote CI、合成Worker、Audify、hardware microphone・実機聴音は今回の対象外。
SPC移行時に記録したWebKit初期化中closeの未解決事項は、今回のSCC Browser成功とは別に残す。
