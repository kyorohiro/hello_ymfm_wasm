# Experimental Saturn SCSP core

`Scsp` in [web/scsp.js](../web/scsp.js) provides a synchronous raw register,
RAM and PCM interface to the fixed SDK's MAME-derived SCSP instrument.
The same C++ core is available to Native callers as `tetorica::scsp` and
`<tetorica/scsp.h>`.

Each handle owns 32 physical slots and 512 KiB RAM. Output is fixed at 44,100 Hz.
The wrapper injects the generated WASM factory and creates no audio device.
There is no musical voice allocator, file decoder or output resampler here.
This is a local repository API. The Web Audio Playground mode/Worklet and initial
slot inspector / PCM and envelope editor are integrated. Tauri Native routing now
supports primary/additional instances, Main/Worker, PCM upload and the same editor.
A dedicated PCM/LFO Synth and npm `tetorica-fm2612/scspsynth.js` entry point are available.
`createSoundChip('scsp')` is the Playground runtime factory, separate from that instrument entry point.

## Try it in Playground

Open [Playground in Saturn mode](playground/index.html?mode=scsp). Choose **SCSP →
Prepare audio**, then **Hold to play**, or choose **Saturn SCSP / PCM slot 32** in
Keyboard and play with the computer keyboard. Opening the mode alone creates no
audio device. The slot inspector shows all 32 configurations and sample RAM use;
the editor supports waveform drawing, PCM8/16 conversion and hardware EG codes.

1. Select a physical slot, then an existing PCM or **Sine / Triangle / Saw / Square**.
2. Draw on the single waveform canvas. Set root frequency, source sample rate,
   format and loop start (`-1` means one shot), then click **Apply PCM to this slot**.
3. Play a new note. PCM assignment and EG edits take effect at the next keyOn;
   TL / direct level / pan are explicit live controls.
4. **Copy voice JavaScript** exports the applied PCM, tuning, loop, EG and mix.
   Paste it into Code and Run to recreate the voice without private bank IDs.
   The generated text is also available when clipboard permission is unavailable.

**Audio file → PCM selection** reads WAV and browser-supported audio such as
M4A (up to 64 MiB). Choose start/end seconds, the selection sample rate and the
recorded root MIDI note, then **Use selection in waveform → Apply PCM**.
The full recording remains in browser memory. Each SCSP sample has **2..65,535
points** (about 1.486 s at 44.1 kHz); lower the selection rate for a longer sound.
Stereo channels are averaged with no automatic normalization or pitch detection.
The initial selection explicitly shows the first region that fits. Oversized
selections fail without changing the recording, waveform or chip RAM.
Decoding uses an offline audio decoder when needed and never starts playback.

Drawing and selection are software authoring tools. Neither writes chip RAM.
Apply reuses an idle editor page when possible. All preset references in other
slots and currently held/releasing native voices protect their sample data. Stop
scheduled playback before Apply; queued commands are never invalidated by an edit.
Repeated idle edits therefore keep RAM use bounded; pressing Stop
permits reuse of pages protected only by playback. The RAM counter includes
reserved page capacity. Pages do not shrink or become general-purpose free RAM;
`reset({clearRam:true})` releases the whole bank.

Ordinary JavaScript `loadPCM` allocations are permanent until the bank is cleared.
Editor sample handles marked `editorOwned` may expire when an idle page is reused;
assigned/shared/sounding samples remain valid. Copy voice exports actual PCM via
ordinary `loadPCM`, so it does not depend on these temporary IDs. Selecting another
slot or assigned PCM discards an unapplied waveform draft; the loaded recording
remains available for another selection in this panel.
EG controls show SCSP register codes, not approximate milliseconds. Higher rate
codes are faster; KRS 15 disables scaling. The requested gate is not an EG meter.

**Run** starts the original sine melody. The editable
`examples/scsp/scsp-stereo-pcm.js` uploads signed PCM16 and plays two stereo slots.
Both Main and Worker use the same SCSP AudioWorklet. Stop immediately silences
held/infinite releases and cancels future notes; the primary sample bank remains
available until explicitly reset or the audio runtime is recreated.

```js
const saturn = await useSoundChip('scsp'); // Reuses this mode's primary.
saturn.noteOn(31, 'A4');
// Later:
saturn.keyOff(31);
```

`await createSoundChip('scsp', {id:'saturn-extra'})` creates an independent
32-slot / 512 KiB instance in Web Audio. Dispose additional instances when done.
The browser facade has the musical API below, with asynchronous `loadPCM` and
`getState`. Samples carry a bank identity so a cloned handle cannot accidentally
select the same numeric ID in another instance. PCM uploads are preparation
barriers; Worker note controls retain the normal lookahead schedule.

Host output at 44.1/48/96 kHz uses the streaming converter shared with PS1; the
SCSP core itself always runs at 44.1 kHz. No extra output compensation is applied.
Playground's System Mixer policy uses measured SCSP source gains for the primary
and additional instances. It comes from a full-range PCM16
single-voice reference across Chromium/WebKit, Main/Worker and 44.1/48 kHz, with
220/440/880 Hz checks and an unchanged shared output target. This balances digital
output units; it is not a subjective loudness or real-hardware calibration.
Explicit and saved Mixer values remain absolute. Raw `Scsp` / `ScspSynth` output
and default register levels are unchanged. The npm Mixer calibrated preset also
includes the measured SCSP fallback; it remains opt-in.
See [measurement and verification](issues/scsp_calibration_01.md) and the
[Native integration record](issues/native_scsp_transport_01.md) for the current measurements.
SSF/68000 execution and DSP controls remain later stages. Slot modulation is described below.

### Desktop Native Audio

Rebuild the Tauri app with the imported frontend, select **Saturn (SCSP)** and
**Native**, then Prepare audio. The 32-slot inspector, Hold, PC Keyboard, PCM file
selection, Apply PCM, named EG and live mix use the Native callback. Main/Worker
can borrow `useSoundChip('scsp')` or create an independent `createSoundChip('scsp')`.
Each instance starts with the same original sine and owns its own 512 KiB RAM.

The command transport prepares immutable register batches. A scheduled note
captures its preset when submitted; later edits do not rewrite that reservation.
Inspector settings are authored parameters, not an envelope/activity meter.
Actual playing RAM addresses are observed separately, including release tails.
Editor Apply requires scheduled playback to be stopped, and cannot overwrite RAM
still referenced by a held/releasing Native slot. Stop retires those references;
clear reset also invalidates the old PCM handles. Stale manual releases cannot
release a replacement voice. A clear reset applies immediately even inside timed
Worker playback and retires older reservations before another upload.

## Musical PCM API

`ScspSynth` in [web/scspsynth.js](../web/scspsynth.js) wraps an exclusively owned
`Scsp`. Local TypeScript declarations are supplied for both classes. It takes
signed `Int8Array` / `Int16Array` PCM, supplies big-endian RAM encoding, named EG
fields, note names/MIDI notes, live frequency and hardware mix controls.
It creates no AudioContext. The Playground layer supplies its audio device and transport.

After creating `chip` as in the raw example below:

```js
import {ScspSynth, createScspInitSample} from './web/scspsynth.js';

const synth = new ScspSynth(chip); // Resets registers; owns/disposes chip.
try {
  const initial = createScspInitSample();
  const sample = synth.loadPCM(initial.pcm, initial.options);
  synth.setPreset(0, {
    sample,
    envelope: {attackRate: 31, releaseRate: 24},
    totalLevel: 12, // Hardware attenuation, 0 is loudest.
  });
  synth.noteOn(0, 'C4'); // Slot 0, not automatic polyphonic allocation.
  const held = synth.generateStereo(44100);
  synth.setNote(0, 'E4'); // Live pitch change, without retrigger.
  synth.noteOff(0);
  const tail = synth.generateStereo(44100);
  // held / tail contain native-rate stereo PCM, not an audio device.
} finally {
  synth.dispose();
}
```

- Slots are explicit integers 0..31. `noteOn(slot, note)` retriggers that slot;
  `keyOn(slot)` uses its authored frequency. Other held slots keep their gates.
- `loadPCM` requires exactly one `rootNote` or `baseFrequencyHz`. This describes
  the original waveform at `sourceSampleRate` (default 44100), not the desired
  playback note. The original 64-sample sine has a root of 44100/64 Hz.
- Each waveform contains 2..65535 samples. Omit `loopStartSamples` for a one shot,
  or specify a forward loop `[loopStartSamples, pcm.length)`. Reverse/ping-pong
  modes remain raw-core features awaiting a high-level verification pass.
- Pitch is quantized to hardware OCT/FNS. Out-of-range values are rejected;
  the realized ratio is returned by `scspPitch`, and `setFrequency` / `setNote`
  return the realized frequency of the sounding sample. Steps longer than a
  forward loop are rejected because this inherited core wraps once per frame.
- `setPreset` and `setEnvelope` author the **next keyOn**. `setFrequency`,
  `setNote` and `setMix` are live controls. Pending sample changes do not alter
  the tuning reference of a sample that is already sounding.
- Envelope fields are `attackRate`, `decay1Rate`, `decay2Rate`, `decayLevel`,
  `releaseRate` (0..31), and `keyRateScaling` (0..15, 15 disables scaling).
  Rates are hardware codes, with larger values faster, not milliseconds.
  Defaults are immediate attack/release and no decay. The inherited EG is an
  approximation; its initial gain is not guaranteed to be exactly unity.
- Mix fields are `totalLevel` (0..255 attenuation), `directLevel` (0..7 send),
  and raw `pan` / DIPAN (0..31). Pan 0 is center, 15 right-only, 31 left-only.
  These are hardware codes rather than linear sliders. Summed output retains
  core clipping; choose attenuation for chords. No extra gain compensation is added.
- RAM is a 512 KiB append-only bank. Each allocation is two-byte aligned and
  includes one interpolation guard sample; `getState()` reports allocated/free
  bytes. This initial direct-output API reserves no RAM for custom DSP programs.
  Input PCM is copied and returned sample descriptors are frozen and bank-owned.
  There is no individual unload/replace/compaction yet.
- `allNotesOff()` starts releases, which may be infinite. `stopVoices()` silences
  immediately while retaining samples/presets. It resets the native frame clock;
  a downstream resampler must also be reset to discard held interpolation frames.
- `reset()` clears presets/gates but retains the bank. `reset({clearRam:true})`
  clears it and invalidates all previous descriptors. IDs are not reused.
  `dispose()` also disposes the exclusively owned core. Do not mix raw core
  register/RAM writes with this adapter.
- State slots contain authored presets and requested gates, not an envelope or
  active-slot meter; a one shot can end while its requested gate remains true.

Verify without audio devices or commercial game files:

```sh
node --test web/scsp.test.mjs web/scspsynth.test.mjs
./node_modules/.bin/tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 web/scspsynth.types.test.ts
```

These checks use the real WASM core. Further checks:

```sh
node --test web/playground_scsp_worklet.test.mjs web/ps1_resampler.test.mjs
node scripts/check_playground_scsp_browser.cjs
```

The browser checker covers Chromium/WebKit and Main/Worker, with physical output
muted throughout. This is PCM/transport verification, not a human listening test.

## Generate original PCM without game files

From the repository root, run this as a Node ES module (`node --input-type=module`).
It returns PCM arrays; it does not play through speakers.

```js
import {readFile} from 'node:fs/promises';
import factory from './docs/generated/scsp_wasm.js';
import {Scsp} from './web/scsp.js';

const chip = await Scsp.create({
  moduleFactory: factory,
  moduleOptions: {wasmBinary: await readFile('./docs/generated/scsp_wasm.wasm')},
});
try {
  const bytes = new Uint8Array(128);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 64; i++) {
    view.setInt16(i * 2, Math.round(8192 * Math.sin(i * 2 * Math.PI / 64)), false);
  }
  chip.loadRam(bytes, 0x1000); // Signed PCM16, big-endian bytes.
  for (const [address, value] of [
    [0x400, 0x020f], // 512 KiB memory mode, master volume 15.
    [0x002, 0x1000], // Slot 0 sample byte address.
    [0x004, 0], [0x006, 64], // Loop start/end in samples.
    [0x008, 31], [0x00a, 0x3c1f], // Fast attack/release, no decay, KRS disabled.
    [0x010, 0], // OCT=0 / FNS=0: one source sample per output frame.
    [0x016, 0xe000], // Direct output level 7, center pan.
    [0x000, 0x1820], // Key-on + execute, forward loop, PCM16.
  ]) chip.write(address, value);

  chip.prepare(128); // Reserve WASM transfer buffers before real-time use.
  const pcm = chip.generateStereo(8192);
  console.log(chip.sampleRate, pcm.left.length); // 44100, 8192.
  chip.write(0, 0x1020); // Clear key bit and execute the release.
  const tail = chip.generateStereo(4410);
  console.log(tail.left.slice(-4)); // Silence after the programmed release.
} finally {
  chip.dispose();
}
```

At this pitch, a 64-sample cycle has a fundamental of `44100 / 64` Hz.
Musical sample tuning will belong to the higher-level Synth API.

## Raw API rules

- `write(byteOffset, value, mask = 65535)` writes selected bits of an aligned
  16-bit register. Addresses are relative byte offsets, not Saturn bus addresses.
- Supported ranges: slot words `0x000..0x3fe`, master `0x400`, DSP ring config
  `0x402`, monitor `0x408`, and ring/DSP reads `0x600..0xee2`.
  Ring/COEF/MADRS/MPRO writes end at `0xbfe`, excluding `0x7c0..0x7fe`.
  The underlying C API rejects unsupported words and master modes before mutation.
- PCM8 is signed. PCM16 RAM bytes are big endian; loop addresses count samples,
  and sample start addresses count bytes. Host RAM transfers reject out-of-range
  spans; internal chip reads wrap within its 512 KiB memory.
- `readRam` returns an owned copy. `renderInto(left, right, frames, offset)`
  requires nonoverlapping `Float32Array` destinations outside WASM memory.
  Inputs are checked before advancing the core. `nativeFrames` counts successful
  rendered frames; reset clears the counter.
- `reset()` resets slots/DSP and mutes the master while retaining RAM.
  `reset({clearRam:true})` clears RAM as well. `dispose()` is idempotent.
- `prepare(frames)` allocates transfer storage for later blocks up to that size.
  The C++ render does not allocate. The JS wrapper creates PCM views during
  transfer, and larger requested blocks can grow its WASM buffers.

## Verification and limits

The original PCM16 sine is bit-identical between Native and WASM for 8,192
stereo frames. Initial tests also cover signed PCM8, stereo pan/slot 31,
finite/clamped 32-slot mixing, release/reset, transfer bounds, partial writes,
owned-handle isolation and render-block partitioning.
These are compatibility/portability checks, not comparisons with real hardware.

DSP code is retained from the pinned MAME implementation but has not
yet been behaviorally verified. Noise uses a deterministic per-instance software
PRNG, not a verified hardware algorithm. CPU timers/IRQ, DMA, serial MIDI,
external inputs, SSF playback and game-tone import are not provided.
Upstream's EG/DSP approximations remain; raw DAC clipping is retained.

Build from the authenticated fixed SDK:

```sh
sh scripts/build_scsp_wasm.sh
node --test web/scsp.test.mjs
```

Source and attribution are retained in
[the fixed SDK component](../third_party/tetorica-soundchip-native/vendor/mame-scsp/README.md),
with its [BSD-3-Clause license](../third_party/tetorica-soundchip-native/vendor/mame-scsp/LICENSE).
The development checkout is not used by the root build recipe.
See [SCSP TODO](issues/todo_scsp_01.md) for the remaining integration stages.

The pinned generated SCSP loader does not consume `wasmBinary` itself in an
AudioWorklet. `Scsp.create` explicitly compiles supplied bytes and installs the
loader's `instantiateWasm` hook. Invalid supplied bytes fail instead of silently
loading a different file. No SDK source, pin or generated WASM modification is
needed for this bridge.

## Browser SCSP Synth

専用ページ：[SCSP Synth](synth-scsp/index.html)。HTTPSまたはlocalhostで開く。

1. **Start audio** → 画面鍵盤、または `A W S E D F T G Y H U J K` で演奏。
2. Sine／Triangle／Saw／Squareを選ぶか、単一canvasを描画し、**Apply PCM** → 新しい音を弾く。
3. 音声ファイルは **Use selection in waveform** → **Apply PCM** の順。
   長い録音はhostに保持し、最大65,535点の区間を選ぶ。区間・rate・基準音は手動指定。
4. **Save preset** は適用済みPCMとEG／mixをJSONへ保存。**Open preset** で戻せる。

Slot 1を編集用に予約し、他の31 slotsを鍵盤のpolyphonyへ割り当てる。
EG／PCMは次の発音、Pitchとmixはheld音へも反映する。**Stop** は即時消音し、
発音元のRAM参照を解放して編集pageを再利用できるようにする。通常の離鍵はreleaseを維持する。
描画／音声変換／preset保存はソフト側の機能。SCSP hardware LFOを操作できる。slot FM／DSP編集／SSFは後続。
専用Synthのpost gainは0.125×Volume。raw SCSP加算の飽和特性は維持している。

専用itch.io ZIP：`sh scripts/package_itch_scsp_synth.sh VERSION`。
作成済みZIPを保護するため同じversionの上書きは拒否する。
ZIP内の`index.html`をHTTPS／localhostで配信すれば、repoや外部runtimeなしで動作する。
C++／JavaScript元入力・hash・license・再ビルド手順を同梱。
[配布検証記録](issues/scsp_synth_distribution_01.json)。

## SCSP hardware LFO（npm 0.2.36以降）

`ScspSynth.setLfo(slot, patch)` は発音をやり直さず、指定fieldだけをlive更新する。
`setPreset(slot, {lfo: patch})` は次のkeyOn用。presetとstateには `lfo` が含まれる。

```js
saturn.setLfo(0, {
  frequencyCode: 20, // 6.15 Hz nominal
  pitchWave: 2,     // 0 saw / 1 square / 2 triangle / 3 noise
  pitchDepth: 3,    // 0..7; 0 is off
  amplitudeWave: 2,
  amplitudeDepth: 4,
  reset: false,
});
saturn.setLfo(0, {reset: true});  // LFORE: both phases held at zero
saturn.setLfo(0, {reset: false}); // resumes without note retrigger
```

Pitch／amplitudeはslotごとに同じfrequency code（0..31）を共有する。
`SCSP_LFO_FREQUENCIES_HZ`、`SCSP_LFO_PITCH_CENTS`、`SCSP_LFO_AMPLITUDE_DB`、
`SCSP_LFO_WAVEFORMS` は表示用の公称table。低速を維持する32-bit位相とLFOREの扱いを
SDK adapterで修正した。既存のgain／waveform tableは維持している。
短いforward loopはPLFOの最大stepを含めて検証し、RAM境界を越える設定を変更前に拒否する。
Main／Worker、primary／extra Native、Inspector／Synthで共通の設定を利用する。

根拠は [Sega SCSP User's Manual §4.2.6](https://docs.exodusemulator.com/Archives/SSDDV25/segahtml/hard/scsp/hon/p04_26_j.htm)。
実機の音声測定による忠実度保証ではない。[実装・検証記録](issues/scsp_lfo_01.md)。
LFOはnpm 0.2.36で公開済み。下記のslot modulation追加はその後の開発版で、まだnpm未公開。


## SCSP slot modulation（0.2.36以降の開発版）

PlaygroundのFilesから `examples/scsp/scsp-two-slot-fm.js` を開き、Runする。
Slot 1（API 0）が無音の変調元、Slot 2（API 1）が可聴carrier。
SCSP tabでSlot 2を選び、**SCSP hardware slot modulation — live** のMDLを0〜12で変更できる。
Direct level 0で変調元の直接出力を消しても変調は残る。TLは変調量にも効く。
STWINHはstackへの書き込みを止め、以前の値を残す。音量muteではない。

```js
const saturn = await useSoundChip('scsp');
const pcm = Int16Array.from({length:64}, (_,i) => Math.round(8192*Math.sin(2*Math.PI*i/64)));
const wave = await saturn.loadPCM(pcm, {
  baseFrequencyHz:44100/64, loopStartSamples:0, modulationDepth:12,
});
saturn.setPreset(0, {sample:wave, directLevel:0});
saturn.setPreset(1, {sample:wave, totalLevel:16,
  modulation:{depth:9,xOffset:63,yOffset:63}});
saturn.noteOn(0,57);
saturn.noteOn(1,69);
saturn.setModulation(1, {depth:8}); // live, no retrigger
```

`modulation` は `{depth:0..15,xOffset:0..63,yOffset:0..63,writeInhibit:boolean}`。
`setPreset(slot,{modulation})` は次回keyOn用、`setModulation(slot,patch)` はlive。
Depth 0は両入力を切り離す。X/Yはslot番号ではなく、64-word sound stackの相対offset。
固定coreはslot書き込みdelayが0なので、直前slotの同frameは63、前frameは31。
manualの実機latencyに基づくslot→offset表と同一として扱わない。
Nativeで時刻予約するdepth変更は、その時点で投影されたX/Yと一緒にrouting wordをcommitする。
予約中に別のX/Yも変える場合はdepth/X/Yを同じpatchに明示する。

変調はPCM読み出しaddressを前後へずらす。`loadPCM` のsoftware allocation option
`modulationDepth` は許可する最大MDLで、full forward loop（start 0）のみ受け付ける。
coreの最大signed displacementに備えて前後に周期波形をコピーし、別sampleの読出しを防ぐ。
最大MDL 15では片側16,384点。これは実機機能ではなく安全なRAM配置を行うソフト側の処理。
descriptorの `address` は実発音のSA、`allocationAddress` は前方guardを含む領域の先頭、`byteLength` はその全長。
paddingを越えるdepth、one-shot／途中loopは高レベルAPIで拒否する。
既存のpaddingなしPCM、depth 0の発音は従来のまま。
Native callbackもRAM境界を検査し、変調で読まれるguardはrelease中も上書きから保護する。

この段階はphysical slot単位の接続。Copy voiceは選択slotだけを出力し、変調元を含む音色全体は保存しない。
専用Synthの自動複数slot割当・多声FM・複数operator presetは次段階。専用Synthではまだこのpanelを表示しない。
DSPのdelay用RAM ring buffer、振幅の掛け算によるring modulationとは別機能。
実機のslot latency／address clippingの精度保証は含まない。低MDL域もmanualの0〜4無変調と完全には一致しないため、APIはdepth 0を明示的なOffにしている。
根拠：[Sega SCSP User's Manual §4.2](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf)。
