# Native追加音源の混在・継続再生

2026-10-24。[全21種類の追加生成](todo_createSoundChip01.md)と
[生成取消し・寿命管理](native_dynamic_lifetime_01.md)に続き、異なる追加音源を一緒に使う場合を確認する。

## 目的と範囲

実RustのShared／Rendererと追加ラックを使い、演奏中の命令・転送・所有者の取消し・破棄・Stop／再開を検証する。
既存のMode単体の長時間試験と、C++単独コアの台数別benchmarkだけでは確認できない、
混在ラックの受付・保持参照・回収を対象にする。

通常再生に計測用のpollingやDSP変更を加えない。音源ごとのデフォルト音量の調整は今回の対象外。
音量測定は、その試験用音色・発音数・設定に対する値として残す。

## 自動試験

- FM＋RF5C164＋DX7、SNES＋SPCを含む構成、サンプルメモリーの多い構成を分ける。
  公開21種類を一度に生成せず、既存の合計16台・64 MiB上限を維持する。
- 同じ演奏命令を固定128フレームと可変長のcallbackで処理し、連続PCMを比較する。
  一方のowner取消しや破棄で、別音源の演奏まで止めないことを確認する。
- 待機命令・転送・退役を含む予算、受付失敗時の巻き戻し、Stop後の回収と再生成を確認する。
- 音源別と混合信号のpeak／RMS、非有限値・過大値、処理時間と予約メモリーを記録する。
  最終clamp後のPCMだけで異常がないと断定しない。
- 短時間版を通常のテスト／CIに加え、長時間版は任意に実行できるようにする。
  共有CIの速度に固定の合格閾値を置かない。

## 実機で聴く共通Example

`examples/genesis/mixed-chip-stability.js`を、Web Audio／NativeとMain／Workerで同じまま実行する。
独立したYM2612・RF5C164・DX7を使い、合成した短いサンプルと決まった音列で比較する。
固定Mixer IDは`scene-fm`／`scene-pcm`／`scene-dx7`。KeyboardはFMの演奏loopと別CHを使う。

一周を繰り返して聴き、Mixerで各音源をMute／Soloして違いを確認する。
Stop後に再Runし、以前の音・音色・サンプルや鳴りっぱなしの鍵盤が残らないことも確認する。
Example内の音量は混合用の初期設定であり、全音源のラウドネス補正値ではない。

Browser試験は実画面で同じExampleをMain／Worker・Web Audio／Nativeへ渡し、Stop／再Runも確認する。
Web Audioは実WASM／Workletの出力をテスト専用の無音observerで観測する。
Native IPCはmockであり、Native PCMの検証は実Rust試験へ分ける。

実機の音切れ・OS／ドライバーの問題は、自動試験だけで解消したとは扱わない。

## 検証結果

実Rustの試験は48 kHzで次の3構成を使う。対象は7種類の代表的な組合せであり、全21種類の全組合せではない。

| 構成 | 同時使用する追加音源 | 観測した最大予約bytes |
| --- | --- | ---: |
| FM／PCM／DX7 | YM2612・RF5C164・DX7 | 3,457,864 |
| SNES／SPC混在 | 上記＋SNES・SPC | 8,711,113 |
| メモリー転送あり | 上記＋YM2608・YM2610 | 19,278,121 |

- 短時間版の3試験、3構成、7種類の単独発音が成功した。
  固定128／可変1・7・31・64・127・128・257・511フレームの分割で、4,096フレームのPCMをbit単位で比較した。
- 長時間版は各Run 30秒、2 Runを3周し、3構成合計25,947,648フレーム（約9分相当）を生成した。
  18回のowner取消し・Stop／再開と、未来命令の保持参照156件の回収を確認した。
  Stop後の予約bytes・待機命令・残存instanceは0。安全側のgainで非有限値・制限境界のsampleも0。
  このMac ARM64のdebug buildで、構成別のrender計測は約8.68／11.60／16.25秒だった。
  コンパイルや準備を含むrunnerの時間とは区別し、機器のcallback締切を保証する値にはしない。
- 合計16台の混在ラックは27,828,592 bytesを予約し、17台目を拒否した。
  破棄待ちのslotと未来命令の保持参照を数え、callbackで回収するまで次の生成を受け付けないことを確認した。
- メモリーの受付失敗と複数音源のトランザクション失敗で、先に準備した変更と予約が巻き戻ることを確認した。
  8 MiBの試験用予算でpayloadの失敗を調べ、既定64 MiBもpermit予約で満たして拒否・解放後の復旧を確認した。
  後者は64 MiBの実payloadを読み込む試験ではない。
- 安全側の試験用gainでは、制限前の混合信号に非有限値・±1超過はなかった。
  単独発音はpeakだけでなくAC-RMSも正で、一定のDCだけを音の成功としない。
  unity gainの測定ではSNES／SPCを含む2構成のpeakが約1.046／1.038となった。
  これは試験用音色・発音数に対する測定であり、各チップのデフォルト音量を決める値にはしない。
- 予約メモリーはNativeの管理対象の値であり、OSのRSSやJS／IPC一時データを含まない。
  制御側の大きなdebug構造体を作る試験threadに8 MiBのstackを明示した。
  実デバイスの音声callbackのstack安全性やdropoutを、この設定から保証しない。

### Exampleと終了処理の検証

実画面でのStop／再Runにより、既存の終了処理で次の問題を再現し修正した。

- Native Stop後のKeyboard解放が、すでに破棄した追加音源へ届く。
  退役済み音源へのcleanup命令だけを抑止し、非同期の後処理を完了させる。
  通常の破棄済みAPI操作は引き続き失敗させ、次の同ID音源へは命令しない。
- Webの即時消音で切断した接続を、Mixerの後処理でも切断しようとして例外になる。
  その旧接続が存在しない場合を扱い、所有するgraphを解放する。別の接続や再生成後の接続は触らない。
- 非同期`liveCleanup()`のRF5C164 keyOff応答より先にclientを破棄する。
  出力は直ちに切断し、KeyboardとliveCleanupの完了後にclientを破棄する。
  次Run・finalize・実AudioContextのフェード終了もこの完了を待つ。
  cleanup自身が`await pg.stopAll()`しても、自分の破棄待ちでdeadlockしないよう物理停止と最終回収の待機を分けた。

終了時に閉じたportを2回transferしていたNodeのテスト用Workerも、実際と同じ1回のtransferに直した。
遅延応答をWorker内部で保留し、閉じたあとで届いても実logic Workerのcleanupへ進むことを確認した。

- JavaScript全体4,765件成功、1件skip。Mode型チェック成功。
- Rust全体693件成功、4件ignore。Tauriの`npm test`も成功（Node 31件）。
- 最終Tauri配布物でChromium／WebKitそれぞれ8ケース成功。
  同じExampleをWeb Audio／Native、Main／Workerで各2回、Stopと同ID再生成を含めて実行した。
- 実Web Workletの混合PCMと単独3音源のAC-RMSが正で、非有限値・±1超過は0。
  最終測定の混合peakはChromium約0.102、WebKit約0.094。測定窓は曲の冒頭に各1秒で、全40秒の音量校正ではない。
  Stop後のWeb PCMは0、Nativeの追跡対象port／listener／Worker・未完了IPCは0。
  Native経路でAudioContext／AudioWorkletを作っていないことも確認した。
- Playground ZIPをTauriへimportし、874ファイルと975件のローカル参照・初期コード・API・ライセンスを確認した。
- Nativeソース21組の固定内容と、対応ソースZIPの1,398ファイルの一致を確認した。

Nativeの画面試験はIPCをmockしている。Native実PCMはRust試験で別に検証し、物理出力の試聴とは区別する。

## 再実行

Tauriリポジトリで実行する。短時間版は既存の各OS向けCIにも加え、JSONを`native-validation` artifactへ保存する。

```sh
node scripts/check_native_extra_stability.mjs --out=native-validation/extra-stability.json
node scripts/check_native_extra_stability.mjs --long --seconds=30 --rounds=3 --out=native-validation/extra-stability-long.json
```

長時間版は可変長のcallbackで継続再生する。固定／可変のbit比較は上記4,096フレームの窓を別に用いる。
`--release`でrelease build、`--compare=前回.json`で同条件の計測値を比較できる。
速度の合否判定は追加していない。

BrowserでのExample確認は親リポジトリから実行する。

```sh
node scripts/check_playground_native_backend_browser.cjs --extra-stability-only --root=w/tetorica-fm2612-playground-tauri/dist --out=/private/tmp/native-extra-stability-browser-final
```

## 配布物

- Playground ZIP: `release/hello_ymfm_wasm_native-extra-stability_itch_playground.zip`
- SHA256: `417ebc53b2f0428af02113049f89e628777620205a1764622b72da01bcdc17ae`
- 対応ソースZIP: `w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`
- 対応ソースZIP SHA256: `76e36619b9644bbfb2e0a3f9126b5e95a48200a0bdde9a550bff3df6f75bb5c9`

今回の試験JSONは`/private/tmp/native-extra-stability-bounded-final.json`、
`/private/tmp/native-extra-stability-long.json`、`/private/tmp/native-extra-stability-browser-final/`、
`/private/tmp/native-extra-stability-sources.json`へ出力した。
