# SID register lab

This first C64 milestone is a small **6581 register / filter experiment**. The
regular [C64 Playground mode](../index.html?mode=c64) now provides code-driven
Main / Worker playback and a SID state tab; a complete Synth is a later stage.
This lab uses the real compiled
chip core in an AudioWorklet, not Web Audio oscillators or a Biquad substitute.

## 試し方

ローカルのWebサーバーで `playground/sid-lab/index.html` を開き、
**Play 220 Hz** を押します。まずSawのまま **LP** を選び、Cutoffを下げてください。
低い数値付近まで下げると変化が分かりやすく、Resonanceで強調が変わります。
CutoffはHzではなく、実レジスターの11-bit codeです。

- **Triad**: 3つの実voiceでドミソを鳴らします。共有filterで3声を処理します。
- **Release**: Gateを落とし、hardware envelopeのReleaseを残します。
- **Stop**: コアと出力を即時リセットします。設定は保持します。
- **Pulse**: Pulse widthを変えると倍音が変わります。ADSRも保持中に変更できます。
- **Ring**: Triangleを選んで試してください。voice 3がvoice 1を変調します。
- **Sync**: 同じvoice 3からvoice 1を同期します。Modulator Hzを変えて聴きます。
- Sync／Ringはvoice 3を無音の変調元に使うため、Triadを休止します。
  On／Offは単音を再発音し、3音からの切り替えでは停止します。
- Waveform／Spectrumは同じcanvasの表示を切り替えます。

初期状態では音を出しません。最初のPlayでaudioを準備します。
既存PlaygroundのRunを停止してから別ページで試してください。

## Scope and controls

The chip is **MOS 6581 only**, using a simplified filter model from
[floooh/chips](https://github.com/floooh/chips). This is an initial, permissively
licensed implementation; it is not a calibrated model of analog chip variation.
There is no 8580 selector, `.sid` song playback, VGM import, Native backend,
keyboard allocation or preset UI yet. This lab remains independent of regular
Playground Run / Worker sessions.
Those stages are tracked in [the TODO](../../issues/todo_sid_01.md).

Waveform, pulse width, ADSR, Sync / Ring, filter routing, cutoff, resonance and
the chip volume are implemented through SID registers. Test notes, triad
triggering, output level, voice allocation and the oscilloscope are software.
The host adds a 12 Hz DC blocker to the chip's mono output. The SID volume
register remains 15; the lab Output level is a separate software gain.

PAL = 985,248 Hz, NTSC = 1,022,727 Hz. Clock changes stop the sound and rebuild
the chip on the next Play. Test note frequencies are recalculated for that clock.
The output sample rate follows the browser audio device (8–96 kHz supported).

## Reuse and verification

The readable modules are [audio.js](audio.js), [processor.js](processor.js),
[lab.js](lab.js), [SidCore](../../js/sid.js), and
[SidTestInstrument](../../js/sid_test_instrument.js).
The [complete matching core sources and build recipe](../../sources/sid/README.md)
include the pinned original, marked patches, licenses, Native host, and WASM
bridge. The chip uses **zlib**, Tetorica's wrapper uses **BSD-3-Clause**.

Example on a browser main thread (adjust the module URL to your application):

```js
import {SidCore, sidFrequency} from '../../js/sid.js';

const sid = await SidCore.create({sampleRate: 48000, clockHz: 985248});
const frequency = sidFrequency(220, sid.clockHz);
sid.writeRegister(0, frequency & 255);
sid.writeRegister(1, frequency >> 8);
sid.writeRegister(5, 0x26); // Attack 2, Decay 6
sid.writeRegister(6, 0xc5); // Sustain 12, Release 5
sid.writeRegister(24, 15); // Dry, chip volume 15
sid.writeRegister(4, 0x21); // Saw + Gate
const mono = sid.render(48000);
sid.writeRegister(4, 0x20); // Gate off
sid.dispose();
```

`readRegister()` reads the chip bus (OSC3 and ENV3 are readable hardware
registers). `getState().registers` is a software shadow of **written values**,
and `voices` is debug inspection; it does not pretend all SID registers can
be read back on hardware. Each bus access advances one clock; output samples
generated during accesses are queued and preserved.

From the repository root:

```sh
npm run build:sid
npm run test:sid
node scripts/check_sid_native.mjs --work-dir release/sid-validation
npm run test:sid:browser
```

The Native comparison creates two self-authored WAV files (tone and filter
sweep), plus PCM hashes, clock / model / sample rate and source-hash metadata.
Matching Native / WASM output verifies this port and its timing; it does not
prove real-hardware accuracy. Automated browser checks mute the final speaker
output. Human listening and real SID music comparison remain separate checks.

For an independent downloadable lab with its corresponding source kit:

```sh
node scripts/package_sid_lab.mjs
```

Later, existing `.sid` music can provide examples and reference WAVs through
[sidplayfp](https://github.com/libsidplayfp/sidplayfp/wiki/sidplayfp). Unlike
VGM register logs, PSID / RSID require execution of C64 music programs. Playback
and timed register capture will be investigated after this standalone chip path.
