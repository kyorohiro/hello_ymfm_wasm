# Native追加YM2608

2026-10-23。[追加音源計画](todo_createSoundChip01.md)に沿って、
`createSoundChip('ym2608')`をNativeへ接続する。

```js
const opna = await createSoundChip('ym2608', {id: 'opna'});
opna.setPreset(0, FM_PRESETS['one-op-basic']);
opna.noteOn(0, 'C4');
opna.ssg.tone(0, {period: 284, volume: 8});
opna.rhythm.setVolume(20);
opna.rhythm.setVoice(0, {volume: 16, left: true, right: true});
opna.rhythm.keyOn(0);
await mixer.set(opna.id, {volume: 0.5});
```

## 対応範囲

- インスタンスごとにFM 6CH、SSG 3CH、rhythm 6音色、ADPCM-Bを持つ。
  rhythm ROM 8 KiBとADPCM-B RAM 2 MiBを分離し、別音源の転送・reset・破棄で書き換えない。
- FM operator／preset・pan／LFO、CH3特殊モード・CSM、timer・IRQ、raw write、clock、prescaler。
  既存Browserヘルパーと同じく、Hz指定のpitch計算は標準prescalerを前提とする。
- SSGのtone・noise・envelope、保持する音量0と一時的なkeyOffを区別する。
  noise generatorとhardware envelopeは同じインスタンス内の3CHで共有する。
- rhythmのROM転送、全体level・voiceごとのlevel／pan、keyOn／keyOff。
- ADPCM-BのRAM転送、sample範囲・Delta-N／再生速度・linear level・pan・repeat。
  `adpcm.loadSample()`はBrowser側で音声を読み込み・必要に応じてdecode・ADPCM-Bへencodeし、
  確定したbytesをNativeへ送る。生成・decode・転送中の取消しも、その所有者へ結び付ける。
- 初期rhythm ROMを読み込み、resetとbridgeの準備が完了してからInspector・Keyboardへ公開する。
  準備中の音源も台数とメモリー上限には含める。

## タイムライン

Browser追加音源の`prepareTimeline(events, blocks, durationSamples)`／`playTimeline()`に合わせる。
イベントは`[44100 Hz sample位置, port, register, value]`。
port 0／1はregister write、port 2は`blocks[register]`をRAMのbyte位置`value`へ転送する。

- 元の44,100 Hz位置を`ceil(position * 出力sampleRate / 44100)`で変換する。
- 準備時にeventsとblocksを所有コピーし、呼出し側の後の変更と分離する。
- 再生開始時はコアregisterをresetし、RAM／ROMと追加Workletの出力remainder／held PCMを保持する。
  既存PC-98主音源のresetは変更しない。
- 準備済みtraceは繰り返し再生できる。Promiseは転送受付ではなく、終端イベントを適用した再生完了で解決する。
- reset・loop停止・disposeで再生中／開始待ちを取り消す。reset後も準備済みtraceは残す。
  dispose／Run終了では準備済みdataも解放する。
- 取消し時はJSの長時間の完了待ちも解放し、同じ音源ですぐ準備・再生し直せるようにする。
  完了後に残る音の所有者も追跡し、後から置き換えた別loop・手動Keyboardの音まで止めない。
- 1 traceは131,072 eventsまで、所有payloadは8 MiBまで。
  bytesは`events * 32 + blocks数 * 24 + blocksの実bytes + 256`で数える。
  128 output framesのどの区間でもregister 256 writes・RAMコピー4 MiBまでとする。
  受付不能なtraceは事前に拒否し、writeの間引きや時刻変更はしない。

## 共通ラックとメモリー上限

PSG・YM2612・YM2203・YM2608を合わせて**16台**。
生成中・非activeでもcallbackや未来の命令が参照している破棄待ちも含める。
Nativeインスタンス番号は共通の単調増加系列で、同じMixer IDの再利用と区別する。

追加Nativeラックの所有するメモリー予算を**64 MiB**とする。

- 全種類で1台あたり1 MiBの固定retirement queueと64 KiBのコア・状態管理余裕を予約する。
- YM2608はさらにRAM 2 MiB＋ROM 8 KiBを予約する。
  YM2608を16台生成した固定予約は49.125 MiBとなる。
- 予約済みcommand・ROM／RAM転送・再利用可能timelineの所有payloadも数える。
  古いprepared dataと置換dataが同時に生きている間は、両方を数える。
- 退役したdataをcallbackや保留命令が参照している間、予算を先に返さない。
  callbackが進まない場合も、未回収分を含めて上限判定する。
- reservation失敗・validation失敗・生成失敗は制御側で巻き戻し、途中の設定だけを適用しない。
  共通予算による拒否は、異種・主音源との混在batchでもエンジンを停止させず、呼出し元へ理由を返す。
  awaitしないregister writeも、受付拒否を一度通知する。
- IPC受信時のJSON／DTO一時data、JS側・Browser decoderのdata、主音源・共通FX・sessionのメモリーは別枠。
  この64 MiBはプロセスの総使用量を保証する値ではない。

コア・大きなdataの準備と最終解放は制御側で行う。
callbackにallocation・最終free・待機lockを追加しない。
statusの適用待ちもRunning Mutexを保持せず、Stopやdisposeが進められるようにする。

## 画面とKeyboard

主音源・追加YM2612・YM2203と同じOPN画面から、追加YM2608を選ぶ。
FM 6CHのoperator・LFO・panを編集し、DAC欄は表示しない。
FMを持たないModeでも、追加OPNがある間はこの画面を表示する。
TFI／VGIは選択したインスタンスのFM 6CHを保存する。

SSG欄の後ろにrhythmとADPCM-Bの欄を追加する。
rhythmは6音色の選択、全体level・voice level・pan、
ADPCM-Bはsample範囲・Delta-N・level・panを表示・編集する。
範囲編集は8-bit DRAMの32-byte addressingを選ぶ。転送・音声decodeは公開APIを使う。
KeyboardはFM 0–5、SSG 0–2、rhythm 0–5、ADPCM-Bを選べる。
rhythmは固定音程、ADPCM-Bは設定済み範囲・速度で鳴らす。

画面の初回表示・Refreshはsnapshotの観測だけとし、presetや発音を書き込まない。
viewは選択・通知・編集完了・Refreshで更新し、常時ポーリングを追加しない。
古いUI・snapshot・Workerの応答が、同IDの新音源や別の選択先へ届かないようにする。
Mixerの生成・破棄だけでは`mixer/current.json`を書き換えない。

## 検証記録

物理音声デバイスを開く試聴と、以下のオフライン／mock検証は区別する。

- `scripts/check_native_extra_ym2608.mjs`：実際の追加音源用Worklet・配布WASMと比較。
  252ケース・1,585,152 stereo frames、PCM・status・IRQ・raw readの差分0。
  44.1／48／96 kHz、FM6・全algorithm、SSG全envelope、rhythm ROM・ADPCM RAM、
  memory upload／download、prescaler・clock・reset、転送付きtimelineと終端を含める。
  callback内allocation／freeは0。
- `scripts/check_native_ym2608.mjs`：既存PC-98主音源の30ケース・184,320 framesも差分0。
- Main／logic Worker・Mixer・Inspector・Keyboard・TFI／VGI・Stop／再Run・同ID置換は
  `scripts/check_playground_native_backend_browser.cjs --extra-ym2608-only`で確認する。
  Native IPCをmockし、AudioContext／AudioWorklet・物理音声デバイスは生成しない。

- ソース段階と最終distのChromium／WebKitで、実Main／logic Worker、同種2台＋YM2203＋YM2612＋PSG、
  独立clock・ROM／RAM、FM／SSG／rhythm／ADPCM-B編集、PC Keyboard、6CHのTFI／VGI ZIP、
  同ID置換・非FM Mode・Stop／再Run・timeline繰返し・reset取消しを確認した。
  1時間のtimelineを取り消し、同じ音源ですぐ準備・再生し直す操作も通った。
  AudioContext／AudioWorkletの生成は0。Native IPCはmockし、実DSPは上のコア比較で検証する。
- 最終distでは既存の追加YM2203／YM2612／PSGのMain／Worker・Mixer・編集・Keyboard・寿命管理も両ブラウザーで通った。
- Node全体は4,261成功・1 skip。関連JS 65件と画面21件も成功。
- Rust全体は379成功・4 ignored。追加YM2608 20件・予算ヘルパー6件を含む。
  22 Mode、メモリー上限・準備前予約・失敗時の原子性・置換／退役の重複保持、
  future command・所有者取消し・手動FM／SSG／rhythm／ADPCM-B／CSM、
  同じbatch内の取消し→再準備→再生、status待機中のStopを確認した。
  物理音声デバイスを開くignoredテストは実行していない。
- Nativeビルドの検証環境はmacOS ARM64。MSVC／GCC・他CPUは既存CI、物理デバイスでの試聴・長時間のdropout確認は別途。

### オフラインDSP測定

Apple M2・Clang 17 `-O2`、48 kHzで2秒分を3回測った中央値。

| YM2608台数 | 音声時間に対するCPU時間 | C++コアの確保量 |
| --- | --- | --- |
| 1 | 1.59% | 2,112,376 B |
| 2 | 3.14% | 4,224,752 B |
| 4 | 6.20% | 8,449,504 B |
| 8 | 12.46% | 16,899,008 B |
| 16 | 24.30% | 33,798,016 B |

1台の内訳はコア7,032 B＋ROM 8,192 B＋RAM 2,097,152 B。
4 YM2608＋4 YM2612＋4 YM2203＋4 PSGは15.76%、8,489,504 B。
描画中のallocation／freeは全ケース0。
Rustラック・固定queue・timeline data・allocator overhead・IPC・FX・UIは含まない。
実機のcallback締切や、ドロップアウトを保証する値ではない。
`scripts/benchmark_native_extra_chips.mjs`で再実行できる。

ARM64のRust layoutでは追加Instance 10,112 B（YM2608 Shared 5,248 Bを含む）、
Renderer 1,208 B、session Shared 137,088 B。退役queueは1,048,576 B／台。
固定予約1,114,112 Bに加え、YM2608はRAM／ROM 2,105,344 B、
所有payloadには実capacityと256 Bの管理余裕を予約する。

## 配布・同梱

- `web`から`docs/js`へ同期し、cache revisionを`native-extra-ym2608-1`へ更新した。
- `release/hello_ymfm_wasm_native-extra-ym2608_itch_playground.zip`を作成した。
  SHA256: `74067b32fda47f829dde7f835e006bddc1b6ac4c5ea1f49e8868a586cd386223`。
- Tauriへ856ファイルを取り込み、release lockとの一致を確認した。
  870件のlocal module／asset参照と、Mode starter・WASM・ライセンスの存在を検証した。
- Native source ZIPは1,327ファイル。SHA256:
  `8d62517b9e3b33e4eee92188b7e5232f25cb9c2fbffbc3df9d6bc41d1a215d97`。
  21種類の原典snapshot、および現在のソースと同梱ZIPの一致を確認した。
- npm・itch.ioへの公開は行っていない。
