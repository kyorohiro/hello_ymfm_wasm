# Native追加YM2413・AY-3-8910

2026-10-23。[追加音源計画](todo_createSoundChip01.md)のYM2413とAY-3-8910を並行して進める。
MSX／Master Systemの複合音源をそのまま増やさず、それぞれ単独のC++コアを生成する。

```js
const extraOpll = await createSoundChip('ym2413', {id: 'opll-lead'});
const extraAy = await createSoundChip('ay8910', {id: 'ay-tone'});
extraOpll.setVoice(0, {instrument: 3, attenuation: 4});
extraOpll.noteOn(0, 'C4');
extraAy.tone(0, {note: 'G4', volume: 8});
await beat(1);
extraOpll.keyOff(0);
extraAy.keyOff(0);
```

## 対象API

- `createSoundChip('ym2413')`：既定3,579,545 Hz、9CHのOPLL。
  15種類の内蔵音色、全CH共通のUser patch、2operator、音量・sustain・pitch、6 melodic＋5 drumsのrhythmに対応する。
  rhythmはphysical CH6／7／8とvolume registerの上位・下位nibbleを共有する。
- `createSoundChip('ay8910')`：既定1,789,773 Hz、3CHのtone／noise。
  CHごとのmixerと音量、共有noise period、共有envelope period／shape、pitchに対応する。
  明示的な音量0は保持し、一時的なkeyOffと区別する。
- 既存Browser用client・実際の追加音源Workletを基準にする。
  `initialize()`・`reset()`・clock・raw write・戻り値・validationも照合する。
  現在の追加音源APIにない機能を主音源から暗黙に公開しない。
- `useSoundChip()`はMaster System／MSX／MSX Audioの内蔵音源を従来どおり借用する。
  他ModeではRun内で追加音源を共有する。`createSoundChip()`は別インスタンスを作る。

## 共通の接続と寿命

追加ラックを8種類合計16台・64 MiBへ広げる。準備中・退役待ちも含める。
生成・大きな準備・最終解放は制御側で行い、音声callback内のallocation・最終free・待機lockを増やさない。
余計な同居チップ・PCM領域は生成しない。

Mainのprivate owner、Workerのperformance／owner、手動試奏を区別する。
他ownerが後から鳴らした音を、古いkeyOff・loop停止・遅い手動解放で消さない。
YM2413のrhythm mask／共有volume nibbles、AYの共有mixer bitsも対象voiceの範囲で変更する。
明示resetは既存APIどおりインスタンス全体を対象にし、手動保持中は保護する。

JSの編集用状態とNativeの適用済みsnapshotを分ける。
clockは適用確認後に反映し、読取りで予約済み編集や演奏時計を変更しない。
同時生成の集約、Stop中の生成取消し、dispose後のcache破棄、同ID再生成、遅いsnapshotを確認する。

## 画面とKeyboard

既存のYM2413／AYタブへ追加インスタンスを表示する。
対象instanceとCHを選んで編集・試奏し、下部Keyboardからも同じ音源を選択できるようにする。
YM2413はrhythm modeの切替で9 melodicと6 melodic＋5 drumsの選択肢を切り替える。
Workerが未来に予約した切替は、受信時に表示だけを先行させず、音声側の適用と取消しに合わせる。
User patchはチップ全体、AYのnoise／envelopeもチップ全体へ効くことを既存画面で示す。

初回表示・Refreshは観測のみ。追加音源の表示は接続・状態通知・編集完了・明示Refreshで更新する。
音声と画面の常時ポーリングを新設しない。
接続tokenを確認し、古い画面操作・状態応答・解放を同IDの新音源へ届かせない。
生成・破棄だけで`mixer/current.json`を書き換えない。

## 検証と統合

二種類の実装は並行し、以下は音源別に通してから配布物へ統合する。

1. 実際の追加Worklet／配布WASMと44.1／48／96 kHzでPCM・状態を比較する。
   全CH、OPLL音色・User patch・全drum、AY共有noise／全envelope shape、clock・resetを含める。
2. 手動再triggerは通常の音声生成に任せる。制御側で音声を生成・破棄しない。
   低clockでの音声保持中に一つを止めても、他のvoiceのPCMが消えないか確認する。
3. Native実ラックで同種2台、両音源と既存6種類、共有上限・予算、Main／Worker／手動発音、
   取消し・生成失敗・個別破棄・同ID再利用・Stop／再Run・全Native Modeを確認する。
4. Chromium／WebKitの実Main／logic Workerと画面・Keyboard・Mixerを確認する。
   Native IPCのみmockし、AudioContext／AudioWorklet・物理音声デバイスを生成しない。
5. 主音源Master System／MSX／MSX Audioの回帰、配布ZIP・Tauri取込み・module参照・
   同梱ソースと原典snapshotを照合する。

実機試聴・長時間のdropout、他OS／CPUのCI確認は、オフライン・mock検証と分けて記録する。

## 音声比較とオフライン測定

実際の追加Worklet／配布WASMと44.1／48／96 kHzで比較した。
YM2413は558ケース・2,285,568 stereo frames、AYは114ケース・466,944 framesで差分0。
初期化・全CH・全OPLL音色・User patch・drum masks、AY全envelope shapes、clock・reset、
低clockでのpublic allNotesOff・試奏を含む。

既存主音源も、Master System 60ケース・368,640 frames、MSX 93ケース・571,392 frames、
MSX Audio 138ケース・847,872 framesで差分0。

取消し用の即時消音と、Browser互換の試奏開始・公開操作を分けた。
OPLLの試奏は通常のsource intervalでkeyOffを消費してから再triggerする。
取消しは低clockで保持中のPCMから対象voiceだけを除き、他のvoiceを残す。
snare／hi-hat、tom／cymbalでは非線形clamp前の成分を保持し、片方の取消しで他方を消さない。
melodicとrhythm両方向のalias、保留中の別voiceの試奏も確認した。
音声生成中のallocation／freeは0。

Apple M2・Clang 17 `-O2`、48 kHz、2秒分を3回測った中央値。
各OPLLは全9CH、各AYはtone／noise／envelopeを動かす。

| 台数 | YM2413 CPU時間／音声時間 | AY CPU時間／音声時間 |
| --- | --- | --- |
| 1 | 0.79% | 0.19% |
| 2 | 1.62% | 0.35% |
| 4 | 3.32% | 0.75% |
| 8 | 6.46% | 1.35% |
| 16 | 12.34% | 2.66% |

C++コアの確保量はOPLL 11,184 B／台、AY 504 B／台。
OPLLはpower-on状態のbufferを含み、AYはOPLLを同時生成しない。
8種類を各2台、計16台で15.49%、C++ heap 4,577,280 B。
全ケースで描画中allocation／freeは0。
Rustラック・固定queue・退役待ち・allocator overhead・IPC・FX・UIを含まない測定であり、
実機のcallback締切・dropoutを保証しない。`scripts/benchmark_native_extra_chips.mjs`で再実行できる。

ARM64のRust layoutはInstance 14,720 B、共通Shared 4,736 B、Renderer 952 B、session Shared 137,088 B。
1台の固定予約は1,114,112 B。退役queue 1,048,576 Bと管理余裕64 KiBを含み、両コアはその余裕に収まる。
これ以外の所有payloadは共通予算規則で予約する。


## 接続・寿命の検証結果

- 関連JS 226件、画面40件が成功。Node全体は4,310成功・1 skip。
- Rust全体は441成功・4 ignored。新規OPLL／AYの27件を含む。
  同種2台ずつ＋既存6種類、8種類の共通16台・64 MiB、全22 Native Mode、独立Mixer、
  共有設定の手動保護、drum alias・nibble・明示intent、retained zero、Main／Workerの所有者、
  生成失敗・巻戻し・退役、clock・適用待ち・Stop・同ID置換を確認した。
- 未来のloop OFFより即時Keyboard ONが先に適用されるケースを、実logic Workerで再現して検証した。
  Keyboardの選択肢は適用順に9→11→9へ追従する。キャンセル・dispose中の待機解除も確認した。
- 状態通知はNativeの適用済み`layoutRevision`と`layoutPending`を観測する。
  読取り専用の待機を命令FIFOから分け、1 instanceに1件へ集約する。
  未来の特定命令を待ってStopを妨げず、UI側の常時ポーリングを追加しない。
- ソース段階と最終distのChromium／WebKitで、実Main／logic Worker、両音源各2台＋既存6種類、
  User patch／rhythm／AY音量・envelope編集、両Keyboard、9 melodic↔6 melodic＋5 drums、
  Mixer、同ID置換・Stop／再Runを確認した。Native IPCのみmockし、AudioContext／AudioWorkletを生成していない。
- Master System／MSX／MSX Audioの内蔵音源借用と追加生成の共存、
  最終distの既存追加YM2151／YM2610／YM2608／YM2203／YM2612／PSGも回帰確認した。
- Nativeのビルド・測定環境はmacOS ARM64。ほかのCPU・MSVC／GCCは既存CIで確認する。
  物理音声デバイスを開くignoredテスト、実機試聴・長時間のdropout確認は実行していない。

## 配布・同梱

- `web`から`docs/js`へ同期し、cache revisionを`native-extra-opll-ay-1`へ更新した。
- `release/hello_ymfm_wasm_native-extra-opll-ay_itch_playground.zip`を作成した。
  SHA256: `06004c79e7f89ad1568b8cf992ef1d5b2b6e8983bc964fbcf4d197674314197f`。
- Tauriへ862ファイルを取り込み、release lockとの一致を確認した。
  903件のlocal module／asset参照、Mode starter・Native API・WASM・ライセンスを確認した。
- Native source ZIPは1,347ファイル。SHA256:
  `de3a3bed402d4ca38ca43d028329073494bc7e0245aa06f0fb5a06c4feb3638f`。
  21種類の原典snapshotと、現在のソース／同梱ZIPの一致を確認した。
- npm・itch.ioへの公開は行っていない。
