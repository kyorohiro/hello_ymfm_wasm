# Sega PCM WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_segapcm_wasm.sh`を同梱SDK `0.1.1`の`segapcm`ターゲットへ切り替えた。
固定revisionは先行19 artifactと同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
379ファイルをoffline検証し、呼出し側の出力先を絶対化してSDK dispatcherを実行する。
C++17／O2、13 C export、runtimeの`cwrap`／`HEAPF32`／`HEAPU8`、`wasmBinary`初期化とPerl cleanupを維持する。
`EXPORT_ALL`や明示的なASSERTIONS設定を追加せず、既存のcompiler-default設定を使う。

着手時の本体は`95edc7a8b11190c95a78694f3a887c8c47557e81`でcleanだった。
SDK pin・原本とTauri、公開API・音量の数値は変更していない。
先行19 artifactの生成記録と既存生成物を保持し、20番目のreceipt、必須入力・ビルド経路試験、比較checkerと文書を追加した。
詳細なhash・試験結果は[検証JSON](wasm_sdk_segapcm_adoption_01.json)を参照する。

## 入力と生成物

wrapper、Sega PCMのcpp／header、`chip_state.h`とライセンス／由来の8組は旧原本とSDKでbyte一致した。
実コンパイルはwrapperとcoreの2翻訳単位。実際のquoted includeは3辺で、`segapcm.h`から`chip_state.h`へ到達する。
既存SDK catalogのsource一覧にはこのstate helperが含まれていないが、固定manifestの全検証と明示的な改変拒否試験で保護する。
固定SDK原本やcatalogの内容は書き換えていない。MAME由来のBSD-3-Clauseと作者・変更記録を保持する。

配布済みdocs・旧手順再ビルド・SDK・通常docs出力・直接Web用のJS／WASMはすべてbyte一致した。

| 生成物 | bytes | SHA-256 |
| --- | ---: | --- |
| `segapcm_wasm.js` | 12,513 | `2bfd3948d3aa2d1219c92c88648dab5149b9fa742a412bd15e23b69909faf5c5` |
| `segapcm_wasm.wasm` | 13,966 | `e54bc16d69965c1180c465fb0ab554a94849538311b786e1f121cd28d7b17a9f` |

## APIと実際の利用経路

- `SegaPcm`の16 voice、左右の独立volume、unsigned 8-bit ROM、bank shift／mask、loop／stop、muteとresetを維持する。
  `generateStereo()`は所有Float32配列を返す。chip wrapperにborrowed／Into／read／status／IRQ／setClock APIはない。
- 公開`saveState()`は同一インスタンス・同一build用のopaque token。ROM、voice位置・mute・nativeの積分状態を保持する。
  比較用のraw bytesには330-byte prefixとROMが含まれるが、portableな保存形式の契約を追加するものではない。
  信頼できる同じ構成同士に限ってraw stateの旧／SDK相互継続も比較した。
- resetはROMとmuteを保持し、voice／積分状態を初期化する。mute中もaddress・fractionとnative時刻は進む。
  `clearSampleMemory()`はvoiceをdisableしない。既に保持されたsampleは次tickまで残り、以後の空ROM読出しはbyte 0の符号変換によって-128となる。
  この既存動作を維持し、clearをsilenceと同一視しない。
- `SegaPcmAudioEngine`は同期の主スレッド合成、任意のSega PSGとの混合、master／source muteとcaller-buffer出力を扱う。
  Engineに状態保存facadeがないため、既存`VgmPlayer`のcheckpointは使えない。seekは元VGMをresetして先頭から再演奏する。
- 現在の利用側はAnalyzerの単体／PSG混合、YM2151＋Sega PCM、Samples preview、WAV／CLIとnpmの低レベルAPI。
  Playgroundのmode・`useSoundChip()`対応を追加した作業ではない。

## 実WASM比較

`scripts/check_segapcm_wasm_sdk.mjs`で旧手順再ビルド／配布済みdocsの2組をそれぞれSDK版と比較した。
最終checkerと実行依存・package／ビルド入力26件をfreezeし、実行後もhashを照合した。
合成したROM／VGMだけを使用し、音声deviceは開かない。

各比較組は3 clock（100,000／4,000,000／50,000,000 Hz）×3 output rate（8,000／44,100／96,000 Hz）×2 block分割。
29 chipシナリオにEngineのケースを加えた306構成・612比較（chip 522＋Engine 90）、2,214シナリオ実行が成功した。
PCM、全native state bytes／ROM、各block境界の観測と続行probeの差は0。
同一インスタンスの復元252回、比較用raw stateの相互復元252回、reset／再演奏486回を含む。
全16 voice、左右volume・alias、全voiceの加算と交互mute、address／fraction・end wrap、bank切替、ROMの部分転送・拡縮・clearを確認した。
owned PCMの上書き・capacity拡大・実heap拡大・dispose後の保持も確認した。

各比較組の両build合計は次のとおり。2組の同じcoverageを固有ケースとして重複加算しない。

| 実出力 | ステレオフレーム |
| --- | ---: |
| シナリオ本文・復元／再演奏本文 | 4,225,320 |
| 続行probe | 281,178 |
| wrapper／正の自己試験 | 76,202 |
| 実Playerが要求したEngine生成 | 614,454 |
| 復元前の意図した状態変更 | 7,812 |
| 合計 | 5,204,966 |

Playerが受渡した515,076フレーム（seekで破棄するprefixを含む）は別の計数で、先読み分を含む上のEngine生成総数へ再加算しない。
実parserの`0xc0` registerと`0x67/0x80` ROM block、reset／再演奏、6位置の先頭からのseekを比較した。
Engineと実PSGの混合・mute／gain・caller-buffer値も確認した。raw chipのstate復元とPlayerのcheckpointは区別する。

## WAV比較試験の参照側修正

既存`test/segapcm-render.test.mjs`の手組み参照Engineに、CLI／Analyzerが使用する校正Mixerが入っておらず、最初の比較が失敗した。
変更前の試験と固定した配布済みJS／WASMを一時import hookで組み合わせ、同じ失敗を再現した。
試験の参照側へ既存`installPlaybackMixer()`と解析済みconfigurationを一度適用し、元の全byte一致assertionを維持した。
修正後はbank0／bank1／PSG／OPM／OPM＋PSGの5 fixtureで、SDK版と旧配布版の双方が成功した。
製品のMixer・音量・合成を変更した修正ではない。

## Browser・配布物・既存試験

- SDK import／ビルド経路のPython試験95件と、Sega PCM／OPM／Samples／Mixer関連の既存Node試験71件が成功した。
  上記の旧配布版を使う修正後の比較試験2件も成功した。初回の失敗logと原因の証拠は保持する。
- Chromium／WebKitで実Analyzerのbank0／bank1／PSG混合を再生した。
  実際の主スレッドEngine生成、bankの正負・stereo、既存gain `0.261709`、絶対gain変更・mute／Resetとpage errorなしを確認した。
  AudioWorkletは出力transportとして使う。最初の接続前から最終destinationをzero gainにし、上流の音源・Mixer／観測は維持した。
  最初の一時harnessのstorage仮定が誤っていた失敗も残し、読み込み前後の実状態比較へ直した最終結果は両browserで成功した。
- 最終checkerに対する独立CLI確認は46実行。help・正常実行と44種類の期待どおりの拒否が成功した。
  同一／symlink入力、入力配下・既存出力・依存ファイル上書き、不正loader／WASM／receiptを拒否し、入力は保持した。
- 校正の66 source hashと2つの既存generator checksが成功した。AnalyzerのSega PCM gain `0.261709`は保持する。
  npmの共通calibrated presetにはSega PCMの測定値がなく、従来どおりgeneric unityを使う。この2用途を混ぜていない。
  配布済み生成物が同一なので、校正のhashだけの更新・再測定記録の置換は行っていない。
- FM npmの803ファイル・26 WASM engine・942参照と型／実行検証が成功した。
  tarballは1,590,727bytes、展開後5,934,164bytes。公開していない。
- Analyzer ZIPの753参照・370ファイルを検証した。
  ZIPのSega PCM関連7項目とFM packageの6項目が、実際に確認したruntime／生成物／BSD noticeに一致する。
  既存のBSD notice配布を保持し、Sega PCM用の新しいstandalone source bundleは追加していない。

固定SDKを使うWASMは計20／27 artifact。
残り7は`k051649`、`nuked_opn2`、`ym3438`、`ymf276`、`ymf278b`、`ymf288`、`dx7`。次の候補はK051649（SCC）。
Native／Tauri、remote CI、合成Worker、Audify、hardware microphone・実機聴音は今回の対象外。
前回SPC移行時に記録したWebKit初期化中closeの未解決事項は、今回も解決した扱いにはしない。
