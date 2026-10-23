# Native追加YM2612

2026-10-23。[追加音源計画](todo_createSoundChip01.md)の次の対象として、
`createSoundChip('ym2612')`をNativeへ接続する。

```js
const lead = await createSoundChip('ym2612', {id: 'lead'});
const bass = await createSoundChip('ym2612', {id: 'bass'});
const pulse = await createSoundChip('segapsg', {id: 'pulse'});
lead.setPreset(0, FM_PRESETS['one-op-basic']);
bass.setPreset(5, FM_PRESETS['one-op-basic']);
await mixer.set(lead.id, {volume: 0.5, pan: -0.3});
await mixer.set(bass.id, {volume: 0.5, pan: 0.3});
lead.noteOn(0, 'C4');
bass.noteOn(5, 'C3');
pulse.tone(0, {note: 'G4', attenuation: 10});
```

## 音源と対応範囲

- ymfmのYM2612単独コアを生成する。FM 6CHとDAC registerを持ち、PSGは生成しない。
- 主音源のGenesis用合成経路から分離し、Browser版の追加音源と同じgain 1の出力を使う。
  Genesis側のFM用0.9倍・DC調整は追加音源へ適用しない。
- operator／preset、pan／LFO、CH3特殊モード／CSM、timer、raw write、clockを扱う。
- DACは`setDacEnabled()`と`writeDac()`で操作できる。
  追加音源用の既存Browser APIにはないPCM sample／bank再生を、主音源のDACへ転送しない。
- 追加用は通常のymfm。主音源で選択するNukedの挙動は維持する。

## 共通ラック

Sega PSGのラックへYM2612を追加し、種類ごとにDSP・状態・voice管理を持つ。
PSGとYM2612の**合計16台**を上限とし、準備中・破棄待ちも数える。
ユーザー用Mixer IDとNativeのインスタンス番号を分け、両種類で同じ番号系列を使う。

生成・メモリー確保・最後のコア解放は制御側で行う。
callbackは固定スロットを処理し、型の違う命令・状態取得・破棄要求を別の音源へ適用しない。
古いWorker・未来の予約・遅れたdisposeが、同じMixer IDの新しい音源へ届かないようにする。

Stop／再Run／Mode変更で追加音源を片付け、Mode主音源の借用と寿命は維持する。
非YM2612 modeの`useSoundChip('ym2612')`は、追加した共有音源を取得する。
状態取得の適用待ちでNativeの制御Mutexを保持しない。

## 演奏・表示・Mixer

Main／Workerで同じFM・raw DAC APIを使い、Workerは既存の演奏時計・ownerへ参加する。
CH3のCSMによる発音とCH6のDACも取消しの対象とし、手動試奏のleaseと区別する。

各インスタンスはMixerへ接続し、共通FX・liveFx・monitor・録音へ流す。
作成・破棄の通知だけでは`mixer/current.json`を変更しない。

既存OPN音色画面へ音源選択欄を追加する。主音源と追加YM2612を選び、
6CHのoperator・algorithm・pan・LFO・DAC・CH3特殊設定を編集する。
FMを持たないModeでも追加YM2612の接続中は画面を開けるようにする。
その画面のKeyboardと、Keyboardタブの対象選択は、インスタンスに結び付ける。
TFI／VGIの書出しも選択中の音源の6CHを対象とし、追加音源の編集結果を保存できる。

表示は適用済みのsnapshotを使い、JSの先読み中の音色状態を上書きしない。
選択・表示中の通知・明示的なRefreshで取得し、新しい常時ポーリングは追加しない。
音色画面を開くだけで初期presetを書き込まない。

## 検証方針

物理音声デバイスを開かず、実コアのオフライン描画とNative IPCを模擬した画面操作を分けて確認する。

- 実際の追加音源用Workletと配布WASMを比較し、44.1／48／96 kHz、全6CH、
  algorithm／operator／pan、DAC、timer／CSM、clock、reset、状態読取りを確認する。
- Rustで同種2台＋PSG＋Mode主音源、種類をまたぐ上限、失敗時の受付、
  古い予約・所有者取消し、手動試奏、生成前後のStop、制御側での回収を確認する。
- 実logic WorkerとMainで、作成・取得・同ID置換・clock適用・Keyboard・loop停止を確認する。
- Chromium／WebKitで、Mixer・音色選択・編集・試奏・個別破棄・Stop／再Run、
  FMを持たないModeでの追加音色画面を確認する。
- 最終dist、Tauri取込み、原典と同梱ソースZIPの整合性を確認する。

## 検証結果

- C++と実際の追加音源用Worklet／配布WASMを198ケース、計1,216,512 stereo framesで比較。
  44.1／48／96 kHzのPCM・status・IRQ・4つのread portは差分0。
  callback内のC++ allocation／freeも0。`scripts/check_native_ym2612.mjs`で再実行できる。
- Chromium／WebKitでMain／実logic Worker、YM2612 2台＋PSG、clock／raw DAC、
  Mixer、同IDの再生成、個別破棄、Stop／再Runを確認した。
  追加音源のoperator編集・PCキー試奏と、FMを持たないModeでのタブ追加・除去も確認した。
  Native IPCをmockし、AudioContext／AudioWorklet・物理音声デバイスは生成していない。
- PSGの既存Main／Worker動作と、MixerのPreset・current・default・ZIP入出力も両ブラウザーで確認した。
- TFI／VGIの実ZIPを展開し、追加音源の編集値を保存でき、主音源の状態を変更しないことを確認した。
  FMを持たないModeでの書出し項目の表示・最後の追加音源破棄後の非表示も確認した。
- Node全体4,221成功・1 skip、最終画面関連70成功。
  Rust全体333成功・4 ignored。追加YM2612用17テストには、CSM所有者と通常CH3・手動試奏の相互保護を含む。
- 検証したNativeビルドはmacOS ARM64。MSVC／GCC・他CPUは既存CIで確認する。
  実デバイスでの試聴・長時間のドロップアウト確認は、このオフライン検証には含まない。

### オフラインDSPの台数別測定

Apple Siliconの同一ホストで48 kHz・2秒分を各3回測定した中央値。
各YM2612は6CH・4operator・LFO、PSGはtone 3CH＋noiseを動かす。
値は音声の長さに対するプロセスCPU時間で、callbackの締切やドロップアウトの保証ではない。

| YM2612台数 | PSG台数 | CPU時間／音声時間 | C++コアの確保量 |
| --- | --- | --- | --- |
| 1 | 0 | 1.35% | 5,776 B |
| 2 | 0 | 2.93% | 11,552 B |
| 4 | 0 | 5.60% | 23,104 B |
| 8 | 0 | 10.87% | 46,208 B |
| 16 | 0 | 23.27% | 92,416 B |
| 8 | 8 | 11.34% | 47,040 B |
| 0 | 16 | 1.75% | 1,664 B |

全ケースで描画中のallocation／freeは0。確保量はC++コアだけを対象とし、
Rustの固定キュー・状態共有・破棄待ち、allocator overhead、IPC・FX・UIを含まない。
ラック全体のメモリー量としては使わない。
`scripts/benchmark_native_extra_chips.mjs`で再実行できる。

ARM64のRust側のlayoutも確認した。`Instance`は9,600 B、
各インスタンスの退役キューは65,536 slot × 16 B = 1,048,576 B。
YM用Shared 5,248 BはInstance内に含まれ、共通Session Sharedは137,088 B。
C++コアと合わせて約1.015 MiB／台、16台で約16.24 MiBが基礎となる。
Arc・Vec等の管理情報、実際の待機命令、Mixer・FX・UI等はさらに必要になる。
上記のC++コアだけの表と区別する。

## 配布・同梱

- `web`から`docs/js`へ同期し、cache revisionを`native-extra-ym2612-1`へ更新した。
- `release/hello_ymfm_wasm_native-extra-ym2612_itch_playground.zip`を作成した。
  SHA256: `ca62a6f7cf8cded14849d84c22d9aa3a9a0dcee6349f2651b8d43a9fd4ab1a62`。
- Tauriへ851ファイルを取り込み、release lockと一致した。
  最終distで追加音源の演奏・編集・TFI／VGI ZIP書出しを両ブラウザーで確認した。
- Native source ZIPを更新。1,318ファイル、SHA256:
  `a7953191442071b8ef21522028a7fc8a80eceb9dcf64f8e26d1e2ee2285a2231`。
  21種類の原典snapshotと、現在のソース・同梱ZIPの一致を確認した。
- commit・公開は行っていない。

次はYM2203。OPNの追加用clientを再利用しつつ、SSG・共有noise／envelope・mono・prescaler・scheduleを照合する。
