# System初期音量を聴く共通Example

2026-10-24。[固定の初期音量校正](playground_chip_levels_01.md)に続き、
全22種類の追加音源を実機で順番に聴けるExampleを追加する。

## 使い方

1. Genesis modeで`examples/genesis/chip-level-comparison.js`を開き、Run fileに選ぶ。
   古いCassetteにファイルがなければ、New Cassetteで新しいExample一式を用意する。
2. MixerタブのPresetで**System（read-only）**を選ぶ。
3. RunしてConsoleを開く。現在の音源名・波形・440 Hzを順番に表示する。
   全22音源を1回再生して完了する。もう一度聴く場合は再Run、途中でもStopできる。

WorkerのConsole表示は、実際の発音より先読み時間だけ先行することがある。

Mega CD／32X／32X Nuked／legacy Genesis Nukedにも同じExampleを含める。
Web Audio／Native、Main／Workerで同じソースを使う。

## 比較する音

FMは無変調の単一carrier、PCM／wavetableは合成sin波、Sega PSG／AY／NES pulseは矩形波。
校正で使った公開APIの基準音を、440 Hz・各1.2秒、発音解除後0.08秒で再生する。
音源間の無音区間は`max(0.35秒, Worker先読み時間 + 0.1秒)`。
標準の先読み0.5秒なら、合計約41秒にチップ生成・データ転送の時間が加わる。
Mainも同じ設定から間隔を決め、先読み設定そのものは変更しない。

SNES／SPCは実DSPのGaussian overflowを避けたBRRの7/8 headroomを維持する。
この基準データの出力振幅は他の基準より7/8であり、Mixer側で追加の補償はしない。
音程のハードウェア量子化、コーデック、周波数特性、波形による体感音量差も聴き比べの対象。
sin波と矩形波のRMSや聴感を揃える処理は加えない。

FXを空にし、基準音そのものを比較する。各チップのMixer Volume／Pan／Mute／Soloは変更しない。
Systemを選ばない場合はユーザーの種類別初期値もそのまま使う。
固定Mixer IDを指定しない一時音源なので、保存したID別設定を比較に持ち込まない。

## 生成と終了処理

`scripts/build_playground_chip_comparison.mjs`が校正用FM／PCMの基準音から通常のJSを生成する。
配布Exampleに外部import、eval、計測polling、校正用contextは必要ない。
編集する場合はVirtual Filesの通常のExampleとして扱える。

各音源を生成してから`try/finally`で囲み、通常時は発音解除して破棄する。
Stop／初期化失敗時も破棄し、退役済みNativeコアへ追加のkeyOffを送らない。
Workerの破棄命令は先読み時間だけ遅れて実行されるため、
次の生成までその時間以上の無音の間を置く。最後の破棄後にも同じ間を置く。
トップレベルで1回だけ実行し、liveLoopの例外時再試行や未登録のliveCleanupに頼らない。

```sh
node scripts/build_playground_chip_comparison.mjs --check
node --test scripts/build_playground_chip_comparison.test.mjs docs/playground/playground_examples.test.mjs
node scripts/check_playground_native_backend_browser.cjs --chip-comparison-only --root=w/tetorica-fm2612-playground-tauri/dist --out=/private/tmp/chip-comparison-final
```

自動試験では配布Exampleをそのまま再生し、全22の生成順序・同時1台・System倍率・
途中Stop／再Run・終了後のport／Worker解放・保存済みMixerファイルの非変更を確認する。
Webでは実Worklet／WASMのPCMを試験専用observerで確認し、試聴出力は無音にする。
Nativeの画面試験はIPC mockであり、物理出力の音質は実機で聴いて確認する。

## 初回21種類版の検証結果と配布物

生成再現性・全21逐次実行・先読み0／0.5／2秒の解放待ち・途中Stop・初期化失敗・無音待機中の取消しの6試験が成功。
JavaScript全体4,861件成功、1件skip。Tauriの`npm test`も成功（Node 31件）。
カタログと生成済みExample bundleの一致を確認した。

- 最終Tauri配布物をChromium／WebKitで、Web Audio／Native・Main／Workerの全8通りで確認した。
  各通りで11番目の音源の途中にStopし、再Runして全21を完走した。
  合計256回の生成、接続音源は最大1台、Native mockのラックも最大1台。
- 実Web Worklet／WASMで84窓のPCMを観測し、全音源のAC-RMSが正で、非有限値・±1超過は0。
  各基準音の期待振幅との差は、Chromium最大約0.069%、WebKit最大約0.074%。
- current.json／default.jsonの元のbytes、Mixerの明示設定のexportがすべて維持された。
  Native終了後の待機命令・受付中要求・追加音源・Worker・port／listenerは0。
- Web Workerでは、YM2612／FXのAudioWorkletへ移管した2本を従来のNative専用observerが
  Main側の未解放portとして数える偽陽性を、空Workerでも再現した。
  移管した同一portの所有先とAudioContextのclosedを確認する専用observerを加え、
  未帰属の残存portを0件と検証した。固定本数を無条件に許容する処理にはしていない。
  この変更は検証用コードだけに適用する。

- Playground ZIP: `release/hello_ymfm_wasm_native-chip-comparison_itch_playground.zip`
- SHA256: `bf60bd625eb1c65152a5c1529bce3ea6a2840ee1f1582ef0d3e2f4e3ec174147`
- Tauriの`dist`へ876ファイルを取り込み、977ローカル参照・初期コード・API・WASM・ライセンスを確認済み。
- Nativeソース21組と、対応ソースZIPの1,400ファイルの一致も確認した。
- 対応ソースZIP SHA256: `9b4d54fde2c9ecc6a1c3269d5321b2f22b22b2c899c59d048e8155a754dd29cc`

ソース照合結果は`/private/tmp/chip-comparison-sources-final-v3.json`。
最終再生結果は`/private/tmp/chip-comparison-final-chromium-v3/chromium-chip-comparison.json`と
`/private/tmp/chip-comparison-final-webkit-v3/webkit-chip-comparison.json`。
空Workerでの所有権確認は`/private/tmp/chip-comparison-web-lifecycle-baseline.json`。

## YM2610Bを含む22種類版

[追加YM2610B](native_dynamic_ym2610b_01.md)をFM基準音に加え、同じ生成器から22種類のExampleを作り直した。
ファイル名・Preset選択・保存値を変更しない規則は維持し、完了表示は`Chip comparison complete: 22/22`となる。
両ブラウザー・Native／Web Audio・Main／Workerの全8通りで途中Stopから再Runし、22種類を完走した。
合計264回生成、実Web PCM 88窓。旧21種類版の実績とは分けて[YM2610Bの検証記録](native_dynamic_ym2610b_01.md)に残した。
