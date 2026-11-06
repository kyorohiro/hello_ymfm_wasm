# Tetorica S-DSP Synth

Product identifier: `tetorica-sdsp-synth`. This is the initial SNES Synth.

[Open the Synth](index.html) · [SNES Playground](../playground/index.html?mode=snes)

Play eight physical SNES S-DSP voices, draw a waveform, load BRR or audio, and
learn the hardware ADSR / GAIN envelope. The UI follows Tetorica SPU / DMG /
2A03 / HuC6280 Synths: output monitor, compact keyboard, Octave, two Pitch wheels,
collapsible sections and controls that leave the computer keys available.

## Play

1. Select **Enable audio**, or press a displayed computer key.
2. Use **Wave** to draw a 128-point cycle, or load an audio file / raw BRR sample.
3. Adjust the hardware envelope, save a preset or copy JavaScript for Playground.

Editing or loading a sample does not open an audio device. Allocation uses the
eight hardware voices in round-robin order, stealing an old voice when needed.
A replaced key's later release cannot stop its new owner. Key-off uses the
S-DSP's hardware release. **Stop all sound** silences the DSP and clears held
notes while keeping the instrument. Leaving the window also stops held notes.

## One waveform canvas

**Sine**, **Triangle**, **Saw** and **Square** create a 128-point normalized cycle.
Draw on the same canvas; releasing the stroke applies it, and an interrupted
stroke is discarded. The source is converted to a looping BRR sample in
software. The declared cycle frequency is 32,000 / 128 Hz at hardware
`PITCH=4096`; keyboard notes use the hardware PITCH register to transpose it.

When a BRR sample is selected, this canvas displays its decoded waveform as a
preview. Use Wave to author a cycle. Sample replacement and loop edits stop held
notes and reuse the sample RAM; repeated edits do not fill an append-only bank.
Volume, envelope, Root / base PITCH and Pitch-wheel changes apply to held voices.

BRR compression is lossy. The S-DSP core then performs Gaussian interpolation,
hardware envelopes and mixing; the output monitor shows the resulting audio.

## Load audio or raw BRR

**Load audio…** decodes offline, combines channels to mono, resamples at the
selected **8,000 / 16,000 / 32,000 Hz**, and encodes BRR. There is no automatic
normalization. Only the final mono PCM is clamped to `[-1,1]` before encoding,
including any decoder / resampler overshoot. The browser uses a cancellable
module Worker for BRR encoding. Other formats depend on the browser's decoder;
WAV is the portable choice.

The software input cap is 32 MiB and decoded duration is capped at 30 minutes.
The smaller **sample-RAM limit** still applies: the initial Synth reserves
1,024 bytes for its directory and accepts at most **64,512 BRR bytes**, or
**114,688 decoded frames**. At 32 kHz that is about 3.58 seconds; at 8 kHz it is
about 14.34 seconds. Longer input is rejected with an explanation, not silently
trimmed. Choose a shorter clip or lower conversion rate.

**Load BRR…** accepts complete raw 9-byte BRR blocks, ending at their END block.
Headers or trailing bytes are not accepted as sample data. BRR stores neither
a sample rate, a musical root note nor the loop address. The initial declaration
is C4 at the displayed base PITCH; set it to match your material. For raw looping
BRR with no supplied loop position, the initial editable loop start is 0; this
is a choice, not recovery of the original loop address.

**Root note** and **base PITCH** declare the playback reference. Audio imports
set base PITCH from the selected conversion rate so that Root plays at the
prepared speed. Other keyboard notes / Pitch transpose relative to that
reference. Hardware PITCH is limited to 1–16,383; unavailable keyboard notes are
disabled. **Loop** and its start use 16-frame BRR block boundaries. Turning Loop
on does not repair a discontinuous seam.

Invalid files, cancelled preparation and late results keep the current sound.
Once a validated sample starts applying, the UI closes the cancellable stage
and shows **Applying…** until the audio processor has accepted it.

## Hardware ADSR and GAIN

These controls set S-DSP register codes, not a software envelope in seconds:

| Mode | Controls |
| --- | --- |
| ADSR | Attack 0–15, Decay 0–7, Sustain level 0–7, Sustain rate 0–31 |
| GAIN: Direct | Level 0–127 |
| GAIN: Linear decrease | Rate 0–31 |
| GAIN: Exponential decrease | Rate 0–31 |
| GAIN: Linear increase | Rate 0–31 |
| GAIN: Bent increase | Rate 0–31 |

GAIN decrease modes do not preload an envelope. A fresh key-on starting at zero
can remain silent in a decreasing mode. Start a voice with ADSR or Direct GAIN,
then change its mode to hear the decrease from that hardware envelope level.
Key-off uses a fixed hardware release, independent of these rate controls.

Signed left / right voice volumes are hardware settings; negative values invert
that side's polarity. Initial levels leave room for eight voices in the DSP
mixer. Raising them can saturate the hardware mix. Master is a separate final
bus control from 0 to 380%; above 100% its bar turns orange.

## Save, reuse and scope

The portable `tetorica-sdsp-voice` preset v1 includes waveform data, raw BRR,
explicit tuning, loop start, stereo volume and envelope settings. JSON files
are capped at 256 KiB. **Copy JavaScript** exports setup code for Playground's
SNES mode using the existing `snes` API and BRR encoder.

The hardware features in this version are eight voices, BRR decoding, Gaussian
interpolation, PITCH, signed volumes and ADSR / GAIN. Drawing, audio conversion,
sample management and keyboard allocation are software authoring tools.

SPC sound import, Echo / FIR, Noise and pitch modulation are later stages. No
SPC700 driver or song playback is included. Echo is disabled in this version;
the future Echo implementation must reserve its RAM before samples are loaded.

## Source and verification

- [preset.js](preset.js), [instrument.js](instrument.js): validation and owned hardware voices.
- [sample.js](sample.js), [audio_import.js](audio_import.js): bounded sample preparation.
- [editor.js](editor.js), [synth.js](synth.js): UI and performance controls.
- [audio.js](audio.js), [processor.js](processor.js): single-context AudioWorklet host.
- [Implementation TODO](../issues/todo_snes_synth_01.md).

```sh
npm run test:snes-synth
npm run test:snes-synth:browser
sh scripts/package_itch_snes_synth.sh 0.0.1
```

Packaging copies the original readable JavaScript / CSS modules, comments and
relative imports. Compiler-generated WASM / loaders remain unchanged. Matching
`snes_spc` C++ sources, the wrapper, rebuild recipe and LGPL-2.1-or-later notices
are included. No Nintendo IPL ROM, game recordings or game sample banks ship
with the Synth. See the included licenses for each component.

## 日本語

SNESの8つの実voiceを使い、BRR音色、hardware ADSR／GAINを触る初版です。
128点波形を描くか、WAV等・raw BRRを読み込み、同じcanvasで波形を確認できます。
BRRに元音階やrateは入っていないため、Root noteとbase PITCHで明示します。
GAINの減衰モードは初期Envelopeを自動で増やさず、新しい発音では無音になる
場合があります。まずADSR／Directで鳴らしてから切り替えると変化を確認できます。
SPC音色読み込み、Echo／FIR、Noise／ピッチ変調は後続です。
