# Native追加YM3526・YM3812・Y8950

2026-10-23。[追加音源計画](todo_createSoundChip01.md)のOPL系3種類をまとめて実装し、音源別に検証する。
各instanceは選択した1種類だけを生成する。主音源のDOS PC／MSX Audioは維持する。

2026-10-24追記：[Y8950 ADPCMのメモリー・サンプル再生API](y8950_adpcm_01.md)を、
主音源と追加音源の両方へ接続した。以下の「ADPCM memory APIは別項目」は、初回対応時の範囲を示す。

```js
const extraOpl = await createSoundChip('ym3812', {id: 'opl-lead'});
extraOpl.setOperator(0, 1, {tl: 12});
extraOpl.noteOn(0, 'C4');
await beat(1);
extraOpl.keyOff(0);
```

## 対象

- YM3526：OPL、9CH・2operator、sine waveform、rhythm。
- YM3812：OPL2、9CH・2operator、waveform enableと4種類のwaveform、rhythm。
- Y8950：現在の追加Playground APIで使う9CH・2operator・rhythm・raw register。
  ADPCM memory APIの新設は別項目。コアへの未提供memory／I/Oは既存Browser追加音源と同じ扱いにする。

既定clockは3種類とも3,579,545 Hz。
実際の`playground_opl_worklet.js`と公開clientを基準に、initialize／reset、operator／preset、
algorithm／feedback、note／frequency／pitch、key gates、LFO、rhythm、timer／CSM、clockを照合する。
YMF262の18CH／4op／2bankの追加生成は次の作業とする。

## 演奏・状態・寿命

共有ラックを11種類合計16台・64 MiBへ広げ、準備中・退役待ちも含める。
Native instanceとMixer IDを分け、Stop中の生成・個別dispose・同ID再生成・cache失効を確認する。
生成・大きな準備・最終解放は制御側で行い、音声callback内のallocation・最終free・待機lockを増やさない。

Mainのprivate owner、Workerのperformance／owner、手動試奏を区別する。
通常keyとCSMのsource、physical CH6／7／8を共有するdrums、同じregisterの別bitを追跡し、
古いloopの取消し・keyOff・手動解放で後発の別ownerを止めない。
明示resetは既存APIどおりinstance全体を対象とし、手動保持中は保護する。

JSの編集用stateとNativeの適用済みsnapshotを分け、読取りで予約済み編集や演奏時計を変更しない。
clockは適用確認後に反映する。試奏開始は通常のsource intervalで再triggerし、制御側で音声を生成・破棄しない。
低clockで保持中のPCMも、取消し対象のvoiceだけを除いて他のvoiceを残す。

## 画面とKeyboard

追加音源がある時に各OPLタブを表示し、instanceとFM CHを選んで編集・試奏する。
YM3812はwaveformを編集でき、YM3526／Y8950は既存どおりsineだけを表示する。
下部Keyboardでは通常9 melodic、rhythm時6 melodic＋5 drumsを選べるようにする。
既存の主音源・Browserの選択規則は維持する。

rhythm表示は適用済みのlayout revisionから更新する。
未来のOFFより即時Keyboard ONが先に適用される場合も、実際の順で9→11→9へ追従する。
状態待ちはinstanceごとに1件へ集約し、読取り専用待機を命令FIFOから分ける。
初回表示・Refreshは観測のみとし、常時ポーリングを新設しない。
古いsnapshot・画面操作・解放が、同IDの新しい接続へ届かないことも確認する。

追加音源も独立Mixer、共通FX・monitor・録音へ接続する。
生成・破棄だけでは`mixer/current.json`を変更しない。

## 検証

1. 各chipの実追加Worklet／配布WASMと44.1／48／96 kHzでPCM・status／IRQを比較する。
   全CH・waveform差・algorithm、rhythm／共有LFO、timer／CSM、cold／initialize／reset、clock、試奏を含める。
2. 同種2台ずつ・3種類と既存8種類、共有台数・予算、取消し・生成失敗・退役、
   Main／Worker／手動発音、clock・Stop・dispose・同ID再利用・全Native Modeを確認する。
3. 共有drum operators、通常FMとのalias、別ownerの保持PCM・予約を消さないことを確認する。
4. Chromium／WebKitの実Main／logic Workerと、音色編集・Keyboard・Mixer・主音源借用を確認する。
   Native IPCのみmockし、AudioContext／AudioWorklet・物理音声デバイスを生成しない。
5. 既存DOS PC／MSX Audioと追加音源の回帰、配布ZIP・Tauri取込み・module参照・同梱ソースを確認する。

オフライン・mock検証と、実機試聴・長時間のdropout・他OS／CPUの確認は分けて記録する。


## 音声比較とオフライン測定

`scripts/check_native_extra_opl.mjs`で実際の追加Worklet・配布WASMと比較した。
44.1／48／96 kHz、3 profiles合計354ケース・2,174,976 stereo framesでPCM・status／IRQの差分0。
全CH・profile別waveform・CSM・Y8950 raw CPU data、clock・reset、公開allNotesOffを含む。
既存主音源もDOS PC 198ケース・1,216,512 frames、MSX Audio 138ケース・847,872 framesで差分0。

公開`allNotesOff()`のraw gate解放、Worklet内部のhost silence、runtime取消しの即時消音を区別する。
前者はrelease tails・CSM・Y8950出力を既存Browser版どおり扱い、取消しでは対象sourceだけを終了する。

Timer controlのIRQ resetは実際のtimer loadを変更しない。
CSMの所有権はregisterの最後のbyteだけで判断せず、effective Timer A loadを追跡する。
CSM取消しではTimer Aを終了し、effective Timer Bは維持する。
Y8950はmemory APIがなくてもraw CPU data／空memoryから発音でき、execute=0後にDCが残ることもある。
そのsourceの所有権をreset／取消しまで保持し、他ownerのFMを保ったまま解放する。

共有drum operators、通常FMとの両方向alias、別voiceのpending preview、CSM・ADPCM DCを含む
保持PCMの分離をfixtureで確認した。音声生成中のallocation／freeは0。

Apple M2・Clang 17 `-O2`、48 kHz、2秒分を3回測った中央値。
各音源はFM9・LFOを動かす。

| 台数 | YM3526 CPU時間／音声時間 | YM3812 | Y8950 |
| --- | --- | --- | --- |
| 1 | 0.70% | 0.69% | 0.79% |
| 2 | 1.38% | 1.38% | 1.56% |
| 4 | 2.76% | 2.78% | 3.12% |
| 8 | 5.42% | 5.48% | 6.55% |
| 16 | 10.83% | 11.07% | 12.21% |

C++ heapはYM3526 9,136 B／台、YM3812 15,280 B／台、Y8950 9,232 B／台。
2 YM3526＋3 YM3812＋3 Y8950＋既存8種類を各1台、計16台で13.09%、C++ heap 2,380,448 B。
描画中allocation／freeは全ケース0。
Rustラック・固定queue・退役待ち・allocator overhead・IPC・FX・UIを含まない測定であり、
実機のcallback締切・dropoutを保証しない。`scripts/benchmark_native_extra_chips.mjs`で再実行できる。

ARM64のRust layoutはInstance 14,720 B、Shared 4,992 B、Renderer 1,656 B、session Shared 137,088 B。
1台の固定予約1,114,112 Bは退役queue 1,048,576 Bと管理余裕64 KiBを含む。
新しい3種類のコアはその余裕に収まり、追加RAMや同居チップを確保しない。

## 完了時の検証結果

- JS全体：4,343成功・1 skip。Native追加OPLを含む重点検証380件、UI関連33件も成功。
  最後のdrum表示文言の調整後はKeyboardの6件を再確認した。
- Rust全体：463成功・物理デバイス等の4件はignored。追加OPLの重点検証22件も成功。
- Chromium／WebKit：最終Tauri取込み物で追加OPL・OPLL／AY・YM2151・YM2610・
  YM2608・YM2203・YM2612・PSGの8系統が成功。
  実Main／logic Workerを動かし、Native IPCのみmockした。
- OPL3種類各2台と既存8種類の計14台、個別Mixer、operator／rhythm編集、
  PC Keyboardの対象選択・解放、同ID再生成、Stop／Run、主音源借用を確認した。
  rhythm適用順の追従と古いsnapshotの排除も確認した。

配布ZIP・Tauri取込み・対応ソースを更新した。

| 成果物 | 照合結果 |
| --- | --- |
| `release/hello_ymfm_wasm_native-extra-opl_itch_playground.zip` | SHA-256 `2f93cc5aaa6d25990376b24d8ea8a8256c15d396f0b66efc3b9ca6f99b97de2c` |
| Tauri取込み | 863 files、release lock照合成功 |
| 配布module／asset参照 | 911参照、Mode starter・Native API・WASM・license検証成功 |
| Native対応ソースbundle | 1,353 files、SHA-256 `a59dc2d0191908764e56b572d9d5de27f93d5090e5a02d96ae288d227e2dd0fc` |
| 固定ソースsnapshot | 21件、現在のソース・同梱ZIPとの照合成功 |

Nativeビルド・オフラインDSP検証はmacOS ARM64で実施した。
ブラウザー検証ではAudioContext／AudioWorkletを生成しておらず、物理デバイスでの試聴・
長時間のdropout・他OS／CPUの確認は未実施。commit・npm公開・itch.io公開は行っていない。
