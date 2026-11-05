# Tetorica HuC6280 Synth

Product identifier: `tetorica-huc6280-synth`.

[Open the synthesizer](index.html) · [HuC6280 Playground](../playground/index.html?mode=huc6280)

Play the PC Engine's six-channel PSG, draw a wavetable and take the sound away
as a preset or JavaScript. The English-language browser UI follows Tetorica's
SPU / DMG Synths: output monitor, compact keyboard, two Pitch wheels, Octave,
and controls that leave the computer keys available for playing.

## Play and edit

1. Select **Enable audio**, then click a key or use the displayed computer keys.
2. Choose **Wave**, **Noise** or **DDA PCM**. Every key plays the selected source.
3. Draw a waveform, change the controls, then save a preset or copy JavaScript.

## Sounds from VGM

Use **Load VGM / VGZ…** in the collapsible **Sounds from VGM** section.
Choose a PC Engine VGM or gzip-compressed VGZ, then choose a sound from the
**Wave** / **Noise** / **LFO** list. Analysis alone keeps the current instrument; only an
explicit sound choice loads it. Cancel, failed imports and closing the library
keep the current sound. Files and expanded VGZ data are limited to 64 MiB.

Wave imports retain the recorded 32 five-bit samples, channel level and stereo
balance. Noise imports retain the CH5 / CH6 clock and channel settings. LFO imports
capture CH1 and CH2 together: both waveforms and periods, rate, depth, Reset and
CH2's output state / level / stereo balance. Different note pitches share ordinary
Wave / Noise entries; LFO period changes remain distinct paired settings.
The list shows the original channel, first
time and occurrences, with 24 entries per page. Imported sounds turn **Software
Envelope off**, so audition starts from the recorded hardware settings. You can
turn it on afterward, edit the wave on the existing canvas, save a preset or copy
JavaScript. Editing clears the library's selected-sound marker.

Only fully known Wave RAM is used. The importer follows the write pointer and
its DDA reset; a write at an unknown playback position cannot be reconstructed
as an ordinary waveform. Such data is omitted with an explanation. Initial
settings and explicitly disclosed reset assumptions are used; the song's notes,
driver envelopes, vibrato and later automation are not replayed. Global balance
and nonstandard clocks may require approximation, reported in the library.

**DDA / DAC streams and incomplete paired settings are omitted.** LFO requires
both written period registers and both complete waveforms, plus the rate and
control settings. Unknown data is not replaced with a built-in wave. Song-time
oscillator phases and elapsed LFO counters are not reconstructed.

Opening the page or editing a sound does not start an audio device. Playing a
key can also initialize audio. One HuC6280 PSG renderer supplies these channels:

| Source | Keyboard voices | Hardware controls |
| --- | --- | --- |
| Wave, LFO off | Six, CH1–CH6 | 32 five-bit samples, volume and left / right balance |
| Wave, LFO on | One CH1 / CH2 pair | CH2's waveform modulates CH1; optional CH2 output has its own level / balance |
| Noise | Two, CH5 / CH6 | Shared noise-clock code, volume and left / right balance |
| DDA PCM | Six, CH1–CH6 | Five-bit direct DAC; samples are supplied by software |

Allocation uses available channels in round-robin order and replaces an old
voice when the pool is full. Releasing a replaced key cannot stop its new owner.
Changing source, wave data or the LFO routing can stop held notes; play a new
note after applying those edits. There is no separate Apply button.

**Noise does not follow the keyboard note or Pitch wheel.** Its 0–31 clock code
sets the noise texture; it is not a frequency in Hz. Noise controls can change
while notes are held. LFO is inactive while Noise is selected.

## One waveform editor

Choose **Main** or **LFO** as the edit target on the same canvas. **Sine**,
**Triangle**, **Saw** and **Square** prepare a waveform, or draw all 32 samples
yourself. Each sample is an integer from 0 to 31, matching the PSG's five-bit
Wave RAM. A shape applies immediately; a drawing applies on pointer release.
An interrupted stroke is discarded.

Numbers use **− / value / +** controls with drag and keyboard adjustment.
Source and other discrete choices use buttons. Clicking sound controls leaves
the performance keys available; text fields retain normal text editing.
Sections can be collapsed while watching the output display.

## DDA PCM audio

Choose **DDA PCM**, then **Load audio…**. WAV is portable; other audio formats
depend on the browser's decoder. Loading uses an offline decoder and does not
open a speaker device. The source is mixed to mono, resampled at the selected
conversion rate and quantized to integers **0–31**, with **16 as silence**.
No automatic normalization is applied. Conversion rate is a preparation setting;
the separate live DAC rate changes how quickly the prepared data is read.

**Root note** plays the sample at its prepared rate. Keyboard notes, the Pitch
wheels and **Speed** change the software reading speed. **Loop** repeats the
whole sample. Rate / Root / Speed / Loop edits keep held voices and their current
positions. Enabling Loop after a one-shot has finished applies to the next note.
One-shot completion silences the DAC but retains held-key ownership until release.
Stop, release, voice stealing and changing source silence the affected DACs.

The **five-bit DAC is a HuC6280 hardware feature**. Sample feeding, resampling,
pitch control, looping and Envelope scheduling are **software features**. There
is no separate sample RAM bank or automatic PCM playback unit in this UI's model.
Writes are scheduled at output-frame boundaries, at most one DAC update per
channel per output frame. High playback rates skip intermediate source samples.
Software Envelope also eases non-looping sample endings; turning it off exposes
the raw gate. Loop-boundary discontinuities are retained.

The software limits are **32 MiB per input file**, **30 minutes decoded audio**,
and **16,777,216 prepared DAC samples**. A high conversion rate reaches the sample
limit sooner. Failures, cancelled imports and late results keep the current PCM.
PCM is stored in preset JSON as compact base64, one five-bit value per byte.
Large data is sent to the audio processor only when changed; ordinary notes and
parameter edits reuse the accepted asset, and replies carry metadata only.

**Copy DDA preset JS** exports the portable data and a synchronous Instrument
usage example. It is not a single-register Playground audition: continuous DDA
audio requires timed software writes, supplied here by the AudioWorklet host.

## Hardware LFO and software Envelope

Hardware LFO uses the PSG's fixed **CH2 → CH1** path. It is not arbitrary FM
routing. Enabling it selects a single carrier on CH1, with the LFO waveform
on CH2. Frequency is the 0–255 register code and Depth selects one of the hardware
modulation ranges. Reset holds the hardware reset bit. **CH2 output** preserves
an audible modulator's own level and stereo balance; it is off by default.
CH1 and CH2 share one keyboard owner and stop together.

Two period modes are available:

- **Follow keyboard** keeps the previous behavior: CH1 plays the keyboard note,
  and CH2's period follows it. Old version-1 presets use this mode.
- **Recorded periods** keeps independent periods. **C4 plays the recorded CH1
  period**, other keys / Pitch transpose CH1 relative to that reference, and
  CH2 keeps its recorded period. This mode is selected for imported LFO sounds.

Periods are shown as 1–4096, with 4096 encoded as zero in the chip registers.
Extreme transpositions reach the hardware period endpoints. You can edit the
periods, rate, depth and CH2 mix while a note is held; changing mode or routing
stops held notes. Main and LFO waves still share the same drawing canvas.

**Software Envelope** is a host feature. The HuC6280 PSG does not have SPU-style
hardware ADSR or reverb. Attack, Decay, Sustain and Release schedule channel
volume writes in software. Turn it off to compare the sustained raw PSG voice.
The default short attack / release makes the instrument easier to play.

The main waveform, volume, balance, noise generator and LFO are chip features.
Drawing, envelope scheduling, keyboard allocation, preset files and Pitch wheels
are software authoring / performance tools.

## Output and keyboard

**Waveform** and **Spectrum** monitor the final signal after Master through a
passive analyser branch. The monitor does not add a second speaker connection.
Master ranges from **0 to 380%**, with an orange bar above 100%.

Both **Pitch** wheels bend Wave notes by up to two semitones, stay synchronized
and return to center on release. Noise disables them. **Octave − / +** and the
shared Guitar / Bass / Ukulele layouts change the visible playing range.
**Stop all sound**, hiding the page or leaving its window stops held notes.
If the audio engine fails, use **Enable audio** to reconnect.

## Presets and JavaScript

Save / Load uses the portable `tetorica-huc6280-voice` preset, version 3. Version-1
files migrate to Follow keyboard, Reset off and muted CH2, keeping their previous
behavior. Version-2 files retain their paired LFO settings and gain an empty
DDA configuration. The preset
contains the name, selected source, main and LFO waveforms, chip volume / balance,
noise clock, hardware LFO, embedded DDA PCM and Software Envelope. Preset JSON
is limited to 32 MiB. Invalid presets are rejected
before the current sound changes. Master, keyboard layout, octave and temporary
Pitch position are performance controls outside the preset.

**Copy JavaScript** produces a single-voice chip setup for the initialized
`pce` API in Playground's **HuC6280** mode. The snippet demonstrates hardware
parameters; keyboard allocation, software envelope scheduling and Master belong
to the host and are not reproduced by that chip-only audition. The generated
code stays visible for manual copying when the clipboard is unavailable.

DDA extraction from VGM DAC streams, CD-ROM² ADPCM / CD-DA, song playback
and full PC Engine emulation are not included.

## API, sources and licenses

- [npm API catalog](../../packages/fm2612/README.md#api-entry-points): musical helpers and low-level APIs.
- [Huc6280Synth](../../tetorica_src/runtime/huc6280synth.js) and [Huc6280AudioEngine](../../tetorica_src/runtime/huc6280audioengine.js): authoring and synchronous register / PCM access.
- [Preset format](preset.js), [instrument and allocator](instrument.js), [AudioWorklet](processor.js), [browser audio lifecycle](audio.js) and [editor](editor.js).
- [VGM / VGZ extraction](vgm_import.js) and [sound library](vgm_library.js): passive register analysis and explicit sound selection.
- [Five-bit PCM preparation](dda_pcm.js) and [offline audio import](audio_import.js): software conversion used by the DDA source.
- [Native core and adaptation notes](../../third_party/tetorica-soundchip-native/vendor/mame-huc6280/README.md): MAME-derived HuC6280 by Charles MacDonald, [BSD-3-Clause license](../../third_party/tetorica-soundchip-native/vendor/mame-huc6280/LICENSE).
- [Project license](../../LICENSE) and [complete attribution](../attribution.md).

The shared WASM is unchanged. The core retains MAME's imperfect / unverified
noise and LFO behavior; this UI does not claim complete hardware or analog
output fidelity. Reuse the modules you need and retain their source notices.

## Build and verify

From the repository root:

```sh
npm run test:huc6280-synth
npm run test:huc6280-synth:browser
sh scripts/package_itch_huc6280_synth.sh 0.0.1
```

The package command creates `release/tetorica_huc6280_synth_0.0.1_itch.zip`.
Use a new version argument for another archive; existing archives are preserved.
The ZIP has a root `index.html`, original editable JavaScript / CSS modules,
the original WASM pair, authenticated native sources, rebuild recipes, browser
source inputs and licenses. It can be served independently of this checkout.

Edit `synth-huc6280/` for the UI and instrument, `js/` for reusable helpers, or
`synth/synth_keyboard.js` for the shared keyboard, then reload. No JavaScript
build is needed. Authored files retain comments, identifiers and relative
imports without bundling or minification. Compiler-generated artifacts remain
unchanged under `generated/`, with corresponding C/C++ under `sources/`.

## 日本語での概要

PC EngineのHuC6280を、SPU Synthと同じ流れで試せるシンセです。
Waveは6声、Noiseは実機のCH5／CH6を使う2声。波形は32点・5bitで、
Main／LFOを切り替えて1つのcanvasで描きます。
Hardware LFOはCH2→CH1の専用配線で、有効時はCH1の単音へ切り替わります。
Software Envelopeはソフト側の音量制御で、実機のADSRではありません。
プリセット保存・読込とPlayground向けJavaScript出力に対応します。
VGM／VGZからWave／NoiseとCH1・CH2を組にしたLFO音色を抽出し、試奏・波形編集できます。
Recorded periodsではC4が記録時のCH1周期、他の鍵盤はCH1だけを移調し、CH2は固定です。
両周期・速度・深さ・Reset・CH2の出力を保持します。
DDA PCMではWAV等をモノラル5bitへ変換し、6声で試奏、Root／Loop／Speedを変更できます。
DACは実機機能、データ供給・移調・Loop・Envelopeはソフト側の制御です。
PCM本体はプリセットv3へ保存し、v1／v2も読み込めます。
VGMのDDA stream抽出とCD-ROM²音源は後続の検討対象です。
