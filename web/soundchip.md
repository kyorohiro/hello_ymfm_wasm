# Sound chip factories

`createSoundChip` は既存の低レベルチップを初期化する入口です。
音色の設定、Note On、スピーカー出力を追加するものではありません。

```javascript
import { createSoundChip } from './soundchip.js';
const opm = await createSoundChip('ym2151');
try {
  // opm.write(...) でレジスタ設定後、opm.generateStereo(...) でPCM生成。
} finally {
  opm.dispose();
}
```

対応名: `ay8910`, `y8950`, `ym2151`, `ym2203`, `ym2413`, `ym2608`,
`ym2610b`, `ym2612`, `ym3438`, `ym3526`, `ym3812`, `ymf262`, `ymf276`,
`ymf278b`, `ymf288`。各ラッパーの機能・ROM要件はそのままです。

Node.jsではローカルWASMを読み込み、ブラウザーでは生成済みモジュールの
ローダーがWASMを取得します。Web AudioやDOMは使いません。
ソースツリーでは `docs/generated/`、公開用 `docs/js/` では隣の `generated/`
を既定の配置とします。別の配置ならディレクトリURLを指定してください。

```javascript
const chip = await createSoundChip('ymf262', {
  assetBaseUrl: new URL('./assets/chips/', import.meta.url),
});
```

`moduleFactory` を渡すと自動ロードを省略し、`moduleOptions` をそのまま渡します。
`moduleOptions.wasmBinary` や `locateFile` でWASM読み込みを指定することもできます。

## ゲームに必要なチップだけ同梱する

便利な共通入口は動的importを含みます。配布物に何が含まれるかはバンドラー次第です。
最小構成には、チップを一切importしない `soundchip_factory.js` を使ってください。

```javascript
import { createSoundChipFactory } from './soundchip_factory.js';
import { Ym2151 } from './ym2151.js';
import moduleFactory from './generated/ym2151_wasm.js';

const createSoundChip = createSoundChipFactory({
  ym2151: (options = {}) => Ym2151.create({ moduleFactory, ...options }),
});
const opm = await createSoundChip('ym2151');
// 使用後に opm.dispose()
```

この例のWASMは `ym2151_wasm.js` と同じ場所に置きます。登録したローダーは
生成要求時だけ実行されます。複数回呼ぶと独立したチップを生成し、共有しません。
この登録方式にはNode.js固有の依存もありません。Workerでは必要に応じて
WASMバイナリーとmoduleFactoryをローダーへ注入できます。

## チップ別の再生 Transport（0.2.6）

MegaSynth はゲーム埋め込み向けの統合 API として維持する。
基本のチップ例は `createSoundChip → Transport → Synth` で構成する。

```js
import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';
const chip = await createSoundChip('ym2612', {execution: 'worklet'});
const transport = new YM2612WorkletTransport(chip);
const fm = new YM2612Synth({transport});
try {
  fm.setPreset(0, FM_PRESETS.sine);
  await transport.start();
  fm.noteOn(0, 4, 553);
  await new Promise(resolve => setTimeout(resolve, 600));
  fm.noteOff(0);
  await new Promise(resolve => setTimeout(resolve, 200));
} finally {await transport.close(); await chip.dispose();}
```

Web の `execution: 'worklet'` は、WASM を Worklet 内で作る endpoint を返す。
生成済みの Main のチップをコピーしたり移動したりしない。
この入口の対応名は `ym2612`、`ym2608`、`gameboy`、`segapsg`、`ym2151`。
音源操作は Main の Synth で行い、Transport がレジスタ命令を送る。
通常の Worker は作らない。利用者が演奏ロジックを Worker に分ける場合、
Main が初期化した endpoint の `createTransportPort()` で追加の MessagePort を作って渡し、その Worker に Synth / Transport を置ける。
Main の制御用 port は保持されるため、演奏ロジックを Worker に移しても Main で開始・終了を管理できる。
既存の AudioWorkletNode を受け取る WorkletTransport の入口も維持する。
WASM の独自 factory 関数を Worklet に送ることはできないため、このモードは package の factory を使う。

`execution` を省略した `createSoundChip()` は従来どおり呼び出し元で WASM を作る。
Game Boy と Genesis PSG も `createSoundChip('gameboy')` / `createSoundChip('segapsg')` で生成できる。

```js
import {YM2612AudifyTransport} from 'tetorica-fm2612/node/transports';
const chip = await createSoundChip('ym2612');
const transport = new YM2612AudifyTransport(chip);
const fm = new YM2612Synth({transport});
try {
  fm.setPreset(0, FM_PRESETS.sine);
  await transport.start();
  fm.noteOn(0, 4, 553);
  await new Promise(resolve => setTimeout(resolve, 600));
  fm.noteOff(0);
  await new Promise(resolve => setTimeout(resolve, 200));
} finally {await transport.close(); chip.dispose();}
```

AudifyTransport は chip を借りる。Synth / チップの PCM 生成は呼び出し元のスレッドで行い、
デバイス管理だけを内部 Node Worker に隔離する。デバイス消費の通知で PCM を補充する。
停止・終了にはフェードを使う。`stop()` の後は再開でき、`close()` の後は新しい Transport を使う。
chip の `dispose()` は利用者の責任で、Transport を閉じてから行う。
`YM2608AudifyTransport`、`GameboyAudifyTransport`、`SegaPSGAudifyTransport`、`YM2151AudifyTransport` も同じ出力 lifecycle を持つ。
対応する Web の Gameboy / SegaPSG / YM2151 WorkletTransport は `chip_worklet_transport.js` にある。

DirectTransport は、手元で `generateStereo()` により PCM を生成し、WAV 保存や利用者の出力へ渡す用途に使う。
examples の `transport/direct/01-single-note` に PCM 生成・連結・Web 再生・WAV 保存をすべて記述する。
これらの追加入口は npm 0.2.6 以降で利用できる。

## 32X PWM 共通コア（0.2.7）

`createSoundChip('pwm', {clock: 23011361, sampleRate: 48000})` は MAME 由来の
FIFO・タイマー処理を持つ JavaScript コアを生成する。WASM・音声デバイスは不要。
レジスタ0〜4を `writeRegister(register, value)` で設定し、`generateStereo(frames)` で進める。
`reset` / `read` / `saveState` / `loadState` / `dispose` に対応。

npm 0.2.7 以降で利用できる。共通Worklet / Audify Transport、
MegaSynth / Playground / Node の入口を追加済み。利用方法は以下を参照。
VGM比較には `pwmModel: 'mame'` を使う。VGM側はcycle基準の振幅に揃える。
元の固定DAC換算を使う場合は `pwmOutputMode: 'dac'`。コア単体の既定はDAC換算、Analyzer／CLIのVGM再生の既定はMAME由来方式とcycle基準の振幅。
従来方式は `pwmModel: legacy` で選べる。
詳しくは `docs/issues/pwm32x_01.md` と `docs/demos/32x-pwm-compare.html` を参照。

### 32X PWM runtime (0.2.7)

The MAME-derived core is now available in MegaSynth (`new MegaSynth({mega32X: true})` / `synth.pwm` after `start()`), MegaSynthNode (`mega32X: true`) and Playground (`await useSoundChip('pwm')`).
Browser synthesis runs in AudioWorklet; MegaSynthNode generates it in its audio Worker. `scheduleWrites([{frame, register, value}, ...])` uses output-frame offsets relative to receipt of the batch. `getState().sampleRate` gives the units; these are not VGM 44,100 Hz offsets.

Standalone browser output:

```js
import {createSoundChip} from 'tetorica-fm2612';
import {PWM32XWorkletTransport} from 'tetorica-fm2612/pwm32x_transport.js';
const chip = await createSoundChip('pwm', {execution: 'worklet'});
const transport = new PWM32XWorkletTransport(chip);
await transport.write(0, 5);
await transport.write(1, 1047);
await transport.write(4, 700);
await transport.start();
// await transport.close() when finished.
```

The runtime wrappers use `duty` output with core gain 1; low-level direct `createSoundChip('pwm')` keeps raw `dac` gain .4. The Worklet endpoint's `gain` controls output volume (default .25).
For standalone Node playback, use `PWM32XAudifyTransport` from `tetorica-fm2612/node/transports`; it accepts the direct factory chip, wraps the same frame scheduler and borrows rather than disposes that chip. `PWM32XDirectTransport` generates PCM for a consumer-owned output or WAV export.
These APIs are available from npm 0.2.7. A PCM `loadSample`/`play` facade is not included; register writes and scheduling are available.
