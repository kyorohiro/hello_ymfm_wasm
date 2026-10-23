# Native追加YM2203

2026-10-23。[追加音源計画](todo_createSoundChip01.md)の次の対象として、
`createSoundChip('ym2203')`をNativeへ接続する。

```js
const opn = await createSoundChip('ym2203', {id: 'opn'});
opn.setPreset(0, FM_PRESETS['one-op-basic']);
opn.noteOn(0, 'C4');
opn.ssg.tone(0, {period: 284, volume: 8});
await mixer.set(opn.id, {volume: 0.5});
```

## 対応範囲

- 独立したFM 3CH＋SSG 3CH。YM2612や他のMode用コアは同時生成しない。
- YM2203単体のmono出力を左右へ同じ値で送り、Mixerで音量・panを操作する。
- FMのoperator／preset、CH3特殊モード・CSM・timer、SSGのtone・noise・envelope、
  raw write、clock、prescalerを扱う。Hz指定のヘルパーは既存Browser APIと同じ標準prescalerを前提とする。
- SSGのnoise generatorとhardware envelopeは、そのインスタンス内の3CHで共有する。
  明示的に保存した音量0と、keyOffの一時的な音量0を区別する。
- `scheduleRegisters(entries, durationSamples)`は既存Browser APIに合わせ、
  元の44,100 Hz sample位置で書込み、再生完了時にPromiseを解決する。
  reset・dispose・所有者取消しの後に、古い予約が再発音しないようにする。
  Nativeでは同時に準備・再生できる予約は1件、1件131,072 entriesまで。
  出力128 framesのどの区間でも256 writes以内に制限し、過密な予約は受付時に理由を示して拒否する。
  時刻をずらしたり、writeを間引いたりはしない。

## ラックと寿命

PSG・YM2612と同じ追加ラックへ接続し、**3種類の合計16台**を上限とする。
準備中・破棄待ちも数え、Nativeのインスタンス番号は共通の単調増加系列にする。
種類の異なる命令・状態取得・disposeを別の音源へ適用しない。

生成・大きな予約データの準備・最終解放は制御側で行い、callbackにallocation・最終free・待機lockを追加しない。
statusの適用待ちでRunning Mutexを保持しない。
Stop／再Run／Mode変更、同IDでの再生成、古いWorker・未来の予約も確認する。

## 演奏と画面

Main／Workerで同じAPIと演奏時計を使う。通常FM、CSM、SSGの所有者と手動試奏を区別し、
一方のloop終了で別のloopやKeyboardの音を止めないようにする。
Mainの各loopには安定したprivate groupを割り当て、通常writeと予約writeの両方をNativeで追跡する。
予約完了後に残る音も、後から別の所有者が置き換えた音と区別して取り消す。
JSに過去の予約tokenを溜め続けない。Workerは既存のperformance／ownerを使う。
長時間の予約を取り消した際は、イベントでJSの完了待ちも解放し、同じ音源ですぐ再予約できるようにする。

Mixer・共通FX・liveFx・monitor・録音へ接続する。
生成・破棄の通知だけでは`mixer/current.json`を変更しない。

OPN音色画面で主音源・追加YM2612・追加YM2203を選べるようにする。
YM2203はFM 3CHで、pan・LFO・DACを編集対象にしない。
SSG欄でtone period、tone／noise source、retained volume、envelope利用、
共有noise period・envelope period／shapeを表示・編集する。
Shape変更は共有envelopeを再始動し、Periodだけの変更はphaseを維持する。
画面を開いたりRefreshしたりするだけでは、presetやenvelope shapeを書き込まない。

SSG欄とFM欄の選択はKeyboardの対象インスタンス・CHに結び付ける。
TFI／VGI保存は選択中のFM 3CHを対象にする。
FMを持たないModeでも、追加音源がある間はOPN画面を表示できるようにする。
viewは適用済みsnapshotを読み、選択・通知・編集完了・Refreshで更新する。常時ポーリングは追加しない。

## 検証

物理音声デバイスを開かず、実コアのオフライン比較とNative IPCを模擬した画面操作を分ける。

- 実際の追加音源用Worklet・配布WASMとのPCM／status／IRQ／4 read ports比較。
  44.1／48／96 kHz、FM 3CH・全algorithm、SSG 3CH・noise・全envelope shape、prescaler・clock・resetを含める。
- 既存PC-98用コアとの比較も行い、追加用profileで主音源のreset動作を変更しないことを確認する。
- Rustで同種2台＋YM2612＋PSG＋Mode主音源、共有16台上限、失敗時の原子性、
  古い予約・所有者取消し、手動試奏、Stop・dispose・状態待ちを確認する。
- Chromium／WebKitで実Main／logic Worker、Mixer、clock、FM／SSG音色編集・Keyboard、
  TFI／VGI ZIP、同ID再生成、非FM Mode、Stop／再Runを確認する。
- 最終dist・Tauri取込み・同梱ソースZIPの一致を確認する。

## 検証結果

- `scripts/check_native_extra_ym2203.mjs`：実際の追加音源用Worklet／配布WASMとの比較で、
  195ケース・1,198,080 stereo frames、PCM・status・IRQ・4 read portsの差分0。
  C++のcallback内allocation／freeも0。44.1／48／96 kHzで確認した。
- `scripts/check_native_ym2203.mjs`：既存PC-98用の186ケース・1,142,784 framesも差分0。
  既存のresetが保持する出力remainder／PCMは維持し、追加用profileだけをWorkletに合わせてclearする。
- ソース段階と最終distのChromium／WebKitで、YM2203 2台＋YM2612＋PSG、実Main／logic Worker、
  独立clock・prescaler、Mixer、FM／SSG編集、Keyboard、3CH分のTFI／VGI ZIP、
  同ID再生成、非FM Mode、予約完了待ち・reset取消しを確認した。
  IPCをmockし、AudioContext／AudioWorklet・物理音声デバイスは生成していない。
- 最終distでは1時間の予約をloop途中で取り消し、同じ音源ですぐ再予約できることも確認した。
  既存の追加YM2612／PSGのMain／Worker・音色編集・Keyboard・Stop／再Runも両ブラウザーで通った。
- Node全体は4,239成功・1 skip。新しいYM2203を含む関連69テストも成功。
  Rust全体は353成功・4 ignored（うち追加YM2203 20件、既存PC-98 17件）。
  同時lookup、生成中のloop取消し、通常writeと予約writeの置換、完了後の残音、
  手動試奏、CSMのcached gate、同batchの取消し、過密schedule拒否を含めて確認した。
- 検証したNativeビルドはmacOS ARM64。MSVC／GCC・他CPUは既存CIで確認する。
  物理音声デバイスでの試聴・長時間のドロップアウト確認は、この検証には含まない。

### オフラインDSP測定

Apple M2・Clang 17、48 kHzで2秒分の音声を各3回測定した中央値。
各YM2203はFM 3CH・4operator、SSG 3CH・共有noise／envelopeを動かす。

| YM2203台数 | CPU時間 | 音声時間に対する割合 | C++コアの確保量 |
| --- | --- | --- | --- |
| 1 | 0.022秒 | 1.11% | 4,120 B |
| 2 | 0.046秒 | 2.29% | 8,240 B |
| 4 | 0.091秒 | 4.55% | 16,480 B |
| 8 | 0.183秒 | 9.16% | 32,960 B |
| 16 | 0.356秒 | 17.80% | 65,920 B |

4 YM2203＋4 YM2612＋8 PSG（合計16台）は0.200秒・9.99%、コア確保量40,416 B。
全ケースで描画中のallocation／freeは0。
Rustの固定queue・予約data・状態共有・allocator overhead・IPC・FX・UIは含まない。
ラック全体のメモリー量や、実機でのcallback締切・ドロップアウトを保証する値には使わない。
`scripts/benchmark_native_extra_chips.mjs`で再実行できる。

ARM64のRust layoutでは、追加Instanceは9,600 B（YM2203 Shared 4,992 Bを含む）。
退役queueは1 MiB／台、共通Session Sharedは137,088 B。
予約entriesは最大2 MiBで、インスタンスの保留データ上限4 MiBに含める。
これらは上のC++コアの確保量と区別する。

## 配布・同梱

- `web`から`docs/js`へ同期し、cache revisionを`native-extra-ym2203-1`へ更新した。
- `release/hello_ymfm_wasm_native-extra-ym2203_itch_playground.zip`を作成した。
  SHA256: `3176f0c1fcb22b520594034b6d5072013c7576b1e28540b4c22b77cf9fe944f2`。
- Tauriへ854ファイルを取り込み、release lockと一致した。
  856件のlocal module／asset参照と、Mode starter・WASM・ライセンスの存在を検証した。
- Native source ZIPは1,322ファイル。SHA256:
  `40fe26b7c02aa9f86293405e2adeaaa60321beb651b2467626b6eb6137c56029`。
  21種類の原典snapshot、および現在のソースと同梱ZIPの一致を確認した。
- npm・itch.ioへの公開は行っていない。
