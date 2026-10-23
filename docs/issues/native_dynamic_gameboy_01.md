# Native追加Game Boy

2026-10-24。[追加音源計画](todo_createSoundChip01.md)のGame Boy追加生成。
Mode内蔵と同じNativeコアを使い、独立したAPUを追加ラックへ接続する。

```js
const gb = await createSoundChip('gameboy', {id: 'handheld'});
gb.initialize();
gb.pulse.setVoice(0, {duty: 0.5, volume: 10});
gb.pulse.noteOn(0, 'C4');
await beat(1);
gb.pulse.keyOff(0);
```

## 対象と完了条件

- pulse 2CH・wave・noise、既定4,194,304 Hz、独立Wave RAM・power・master volume・左右routing。
- 同じ単独C++コアを再利用し、不要な同居チップを生成しない。
- `createSoundChip()`は全Native Modeで独立したAPUを作る。
  `useSoundChip()`はGame Boy Modeの内蔵を借用し、他のModeでは共有追加音源を取得する。
- 現在のBrowser公開API・初期値・同期操作と非同期clock操作の契約を維持する。
  configured voice・予約済み編集と、適用済みregister／gateの読取りを分ける。
- 追加15種類合計16台・64 MiB。生成・最終回収は制御側で行い、callback内の
  allocation・最終free・待機lockを増やさない。
- Main／Worker、独立Mixer、音色情報のpulse／wave／noise編集、Keyboardのinstance／CH選択。
- 手動試奏・loop所有者・古いrelease・取消し・power／共有routing操作を区別し、
  別CHや別インスタンスの発音・波形RAM・音色を誤って変更しない。
- 生成待ち中Stop、同ID再生成、遅延応答・未来の適用待ち・個別disposeを回収する。
  観測のための常時pollingを増やさない。

## 検証方針

配布Worklet／WASMと実C++を44.1／48／96 kHzで比較する。
全4CH、clock、Wave RAM、power、routing、reset／Stop、可変callback分割、独立2台を対象とする。
Rustでは所有者・共有registerのbit保持・台数／予算・取消し・失敗時のtransactionを確認する。
Chromium／WebKitで実Main／logic Workerと既存画面を動かし、Native IPCのみmockする。
物理音声デバイスを開かず、実機試聴・dropout評価とは区別する。

## 検証結果

配布中の実Game Boy Worklet／WASMと144ケース・1,317,168 stereo framesを比較した。
44.1／48／96 kHz、1frame／128frame／不規則なcallback分割でPCMの最大差分0。
既存Mode内蔵の42ケース・396,912 framesも差分0。

最初のclock変更でBrowserは外側のresamplerを生成する。
Nativeは以前から保持していた直前のPCMを使っており、最初にclockを遅くした時に1frameだけ異なっていた。
Nativeも最初のclock変更時にresamplerを有効にするよう揃えた。
以降のclock変更はfractional phaseと保持PCMを維持する。固定ソースとWASMは変更していない。

単独C++検証では独立性、register／Wave RAM／clockを保ったStop・CH別Stop、
DMGのreset時波形、読取り専用snapshot、source muteのphase／register／reset保持と
clock／rateの境界を確認した。source muteは既存コアの機能を使い、Browserの公開APIは増やさない。
音声生成中のallocation／freeは0。

Apple M2・Clang 17 `-O2`、48 kHzで2秒分をfresh processで3回測った中央値。
各Game Boyはpulse 2CH・wave・noiseを動かす。

| Game Boy台数 | CPU時間／音声時間 |
| --- | --- |
| 1 | 2.90% |
| 2 | 5.80% |
| 4 | 11.65% |
| 8 | 23.25% |
| 16 | 46.29% |

1台のC++ heapは328 B。全15種類各1台＋YM2612もう1台、計16台の混在は15.27%、
C++ heapは2,488,288 B。callback内のallocation／freeは0。
Rustラック・queue・IPC・FX・UI・音声デバイスは測定外。
特にGame Boyの多重生成は演算量が増えるため、16台の受付上限は実機の処理余裕を保証しない。

## 所有者・適用確認・回収

NR50の共有音量、NR51のCH別左右bit、NR52のpowerは他の所有者の発音も変更し得るため、
scopedなcode／Worker命令が別の所有者の発音を壊さないよう確認する。
CH別routingでは他CHのbitを保持し、手動保持中のwave DAC／Wave RAMを外部から変更しない。
画面の明示的なpower offはそのAPUの試奏を解除して適用し、別インスタンスは保つ。

configured voiceはkeyOff・自然終端後も保持する。C++のactive maskで有限音符の終端を確認し、
終了した手動leaseを解放する。JSも適用済みheldを確認してからleaseを反映し、
wave DACを停止する編集の後に古い試奏保持を戻さない。

clockのPromiseは実際の適用を確認して完了する。`status(after:id)`の待機は制御FIFOと分け、
未来の適用待ち中もStop・owner取消し・disposeを進める。
完了結果は固定512件の履歴を使い、失効したIDの再確認は成功扱いにしない。
全種類のtransaction受付後に取消しを確定し、受付失敗で他音源の古い予約だけを取り消さない。

InspectorからWorkerへのauthor状態はregister／voiceのaddress・bit mask別patchで送り、
別CHのpanや、未来に予約した同じregisterの別fieldを古い全体状態で戻さない。
読取りは適用済み状態だけを返し、author状態やclockを設定し直さない。

ARM64のInstanceは22,400 B、Game Boy Sharedは12,928 B、Rendererは352 B。
session Rendererは36,960 Bで、既存の固定予約1,114,112 B／台の管理余裕内に収まる。

## 最終統合

- JS全体：4,414成功・1 skip。新規GB11件を含む。関連重点97件、既存画面37件、Mode型検証も成功。
- Rust全体：548成功・4 ignored。追加GB18件と既存primary GB5件を含む。
- Chromium／WebKit：最終Tauri取込み物で実Main／logic Worker、独立GB2台＋既存14種類、
  計16台、個別clock・Wave RAM・Mixer、pulse音量・波形・noise幅・powerの画面編集、
  Keyboardタブの全4CH・Game Boyタブ上のPCキー、同ID再生成、Stop／Runを確認した。
- 演奏を続けるAPUを保ったまま、もう一方のpowerを切ることとWave RAM保持を確認した。
  Consoleに捕捉済みの演奏エラーがないことも検証する。
- Game Boy Modeの内蔵借用と追加生成を両実行方式で確認した。
  既存追加OKIM6258・RF5C164の画面・Keyboard・Mixer回帰も両ブラウザーで成功。
  Native IPCだけをmockし、AudioContext／AudioWorkletは0。

| 成果物 | 照合結果 |
| --- | --- |
| `release/hello_ymfm_wasm_native-extra-gameboy_itch_playground.zip` | SHA-256 `ea30385d44112ca7b9b05edff7087d1bc4fe4d7a02bd65421aa624e3f767ade2` |
| Tauri取込み | 866 files、release lock照合成功 |
| 配布module／asset参照 | 938参照、Mode starter・Native API・WASM・license検証成功 |
| Native対応ソースbundle | 1,369 files、SHA-256 `d65091869d075288008d53ce2c4fb520da2fab26c496dadba20753ca2d482a7e` |
| 固定ソースsnapshot | 21件、現在のソース・同梱ZIPとの照合成功 |

cache revisionは`native-extra-gameboy-1`。変更した公開clientとNative adapterを更新し、
変更のない共通Synth・Browser Workletのrevisionは維持する。
Nativeビルド・オフライン検証はmacOS ARM64で実施した。
物理音声デバイス・credential storeを使うテストは有効化していない。
実機試聴・長時間のdropout・他OS／CPUの確認は未実施。
commit・npm公開・itch.io公開は行っていない。
