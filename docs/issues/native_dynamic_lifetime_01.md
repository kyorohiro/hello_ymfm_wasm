# Native追加音源の生成取消し・寿命管理

2026-10-24。[Native追加音源計画](todo_createSoundChip01.md)の全21種類を対象に、生成途中の取消しと遅延応答の回収を揃える。

## 対象

`segapsg`、`ym2612`、`ym2203`、`ym2608`、`ym2610`、`ym2151`、`ym2413`、`ay8910`、
`ym3526`、`ym3812`、`y8950`、`ymf262`、`rf5c164`、`okim6258`、`gameboy`、`nes`、
`huc6280`、`dx7`、`pwm`、`snes`、`spc`。

音源DSP・PCM・clock・公開APIを変えず、NativeのMain／logic Workerにおける生成・停止・破棄を対象にする。
Browser経路、Mode主音源の借用、共有`useSoundChip()`の取得規則を保つ。

## 完了条件

- 全21種類で、生成待ち中の`stopLoop()`・Stop・Worker終了と再Runを確認する。
- 生成取消しはJSの待機とID予約を速やかに解放し、取り消した呼出しの続きから演奏しない。
- Native IPCの実行そのものを取り消せるとは扱わない。既に開始した生成は追跡し、遅い成功応答のあとで、そのinstanceを一度だけ破棄する。
  古いsession／世代から新しいsessionへdisposeを送らず、実行中IPCを未完了のまま放置しない。
- Native生成とendpoint初期化、port接続、Workerへの応答配送の各境界で取消しを確認する。
  途中の失敗やcleanup例外でも、台数・ID・port・listener・Mixerへの接続を取り残さない。
- Worker応答を遅らせ、loop停止後に届いてもclientや演奏を復活させない。
  破棄要求にはinstance番号を付け、同じMixer IDの新しい音源を誤って破棄しない。
- 共有`useSoundChip()`はrunに属する。片方の待機loopを止めても、同じ生成を待つ別loopとcacheを維持する。
- 共通の16台・64 MiB予算を維持する。Native未完了処理の資源は、実際の完了・破棄まで保持する。
- 明示的な診断・テストだけで観測し、通常再生のpollingを増やさない。

## 検証

共通factoryの直接テスト、実NativeGenesisSynth＋Main／実Node Workerの全種類テスト、
Chromium／WebKitの実Playground画面を使う。
Native IPCだけをmockし、物理デバイス・DSP精度・実heapのGCまで証明したとは扱わない。
Native側のDSP・予算・回収は既存Rustテストと対応ソース照合で別途確認する。

## 実装結果

- runtimeとlogic Workerは、対応種類の一覧`dynamicSoundChipKinds`から生成の追跡対象を決める。
  初期対応のSega PSG／YM2612／YM2203にも取消しsignalを渡し、全21種類のMain／Worker経路を揃えた。
- 共通factoryは取消した呼出しを先に終了させる。未完了のNative生成は追跡を続け、
  遅れて成功したinstanceだけを一度破棄する。取消し後のendpoint初期化とready通知を防ぐ。
- Native生成後のperformance接続待ちも取消し対象にした。portごとのdetachで、
  その接続のlistenerと5秒の応答待ちtimerを外し、別音源の接続とclockを維持する。
- Workerへ遅れて届いた生成応答は、portを閉じ、instance番号を指定して即時破棄する。
  同じMixer IDで作り直した音源や、共有`useSoundChip()`を待つ別loopには影響させない。

Native IPCの途中強制取消しは追加していない。Stopによる物理側の終了は、既存のFIFOで未完了IPCを待つ。
音声DSP・Native API・台数とメモリーの予算は変更せず、通常再生のpollingも追加していない。

## 検証結果

- 修正前にYM2612のMain／Worker生成待ちと遅いWorker応答で失敗を確認し、回帰テストにした。
- 共通factoryの直接テスト13件、全21種類のMain／実Node Workerの共通テスト212件が成功。
  Stop・loop停止・Worker終了／再Run・同ID再生成・共有待機者・接続の破棄を確認した。
  performance Hostの全13件も成功し、接続待ちの取消しと再接続を確認した。
- JavaScript全体は4,755件成功、1件skip。Modeの型チェックも成功。
- TauriのRust全体は690件成功、4件ignore。
- 最終Tauri配布物をChromium／WebKitで各71ケース検証し、両方成功。
  全21種類のMain／Worker生成待ちと遅いWorker応答、同ID再生成、共有待機者を確認した。
  最終状態の音源・予約ID・未完了IPC／命令・追跡対象port／listener／Workerはすべて0。
  Native経路でAudioContext／AudioWorkletを作っていないことも確認した。
- 配布ZIPをTauriへimportし、873ファイルと975件のローカル参照・Mode初期コード・API・ライセンスを検証した。
- Nativeソース21組の固定内容と、対応ソースZIPの1,395ファイルを照合し成功した。

BrowserテストのNative IPCはmockである。実デバイスの音質・音切れ・heapのGC・高負荷時の締切は、この検証の対象外。

### 主な再実行コマンド

```sh
node --test web/*.test.mjs docs/playground/*.test.mjs docs/vgm_analyzer/*.test.mjs test/*.test.mjs
node scripts/check_playground_mode_types.mjs
node --experimental-vm-modules scripts/check_playground_package.mjs w/tetorica-fm2612-playground-tauri/dist
node scripts/check_playground_native_backend_browser.cjs --extra-creation-only --root=w/tetorica-fm2612-playground-tauri/dist --out=/private/tmp/native-extra-lifetime-browser-final
```

以下は`w/tetorica-fm2612-playground-tauri`で実行する。

```sh
python3 scripts/import_release.py --check
cargo test --locked --manifest-path src-tauri/Cargo.toml --quiet
python3 scripts/prepare_native_sources.py
python3 scripts/check_native_sources.py --bundle --out=/private/tmp/native-extra-lifetime-sources.json
```

### 配布物

- Playground ZIP: `release/hello_ymfm_wasm_native-extra-lifetime_itch_playground.zip`
- SHA256: `0109113aee200b741babb8f2e3205739bb27f5b67a5118d0049908eb31521d68`
- 対応ソースZIP: `w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`
- 対応ソースZIP SHA256: `bcbad751c29e344c6e613e383806acec7026fb1ac2ee0098dc09f8653559276d`
