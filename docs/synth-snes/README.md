# Tetorica S-DSP Synth

Product identifier: `tetorica-sdsp-synth`. A standalone SNES S-DSP instrument.

[Open the Synth](index.html) · [SNES Playground](../playground/index.html?mode=snes)

Play eight physical SNES S-DSP voices, choose a BRR or Noise voice from an SPC
snapshot, draw a waveform, load BRR or audio, and explore hardware Noise,
ADSR / GAIN and Echo / FIR. The UI follows Tetorica SPU / DMG /
2A03 / HuC6280 Synths: output monitor, compact keyboard, Octave, two Pitch wheels,
collapsible sections and controls that leave the computer keys available.

## Play

1. Select **Enable audio**, or press a displayed computer key.
2. Use **Drawn wave** to draw a 128-point cycle, load audio / raw BRR, select
   **Noise**, or choose **Sounds from SPC → Load SPC…** and select a voice candidate.
3. Adjust the hardware envelope or enable **S-DSP Echo** and edit its controls.
4. Save a preset or copy JavaScript for Playground.

Editing or loading a sample does not open an audio device. Allocation uses the
eight hardware voices in round-robin order, stealing an old voice when needed.
A replaced key's later release cannot stop its new owner. Key-off uses the
S-DSP's hardware release. **Stop all sound** clears held notes and Echo tails
while keeping the instrument and its Echo settings. Leaving the window also
stops held notes.

## One waveform canvas

**Sine**, **Triangle**, **Saw** and **Square** create a 128-point normalized cycle.
Draw on the same canvas; releasing the stroke applies it, and an interrupted
stroke is discarded. The source is converted to a looping BRR sample in
software. The declared cycle frequency is 32,000 / 128 Hz at hardware
`PITCH=4096`; keyboard notes use the hardware PITCH register to transpose it.

When a BRR sample is selected, this canvas displays its decoded waveform as a
preview. Use Wave to author a cycle. Sample replacement, loop edits and Echo
On / Off rebuild the bank, stopping held notes and old Echo tails. Repeated
edits reuse sample RAM. Volume, envelope, Root / base PITCH, Pitch wheels and
Echo parameters other than Enable apply to held voices.

BRR compression is lossy. The S-DSP core then performs Gaussian interpolation,
hardware envelopes and mixing; the output monitor shows the resulting audio.

## Hardware Noise

Choose **Sound source → Noise** to use the S-DSP's hardware Noise generator.
**S-DSP Noise → Noise clock** selects a hardware rate code from 0 to 31;
changes apply while holding a key. All eight voices share one generator and
one clock, with separate signed voice volumes and ADSR / GAIN envelopes.
Multiple keys add voice envelopes to the same Noise signal, not independently
tuned noise sources. Echo / FIR remains available for Noise.

Clock 0 holds the generator's current value instead of advancing it; it is
not a mute setting and can produce a steady DC level. Nonzero codes change
the Noise texture. Keys trigger envelopes, while note names, Octave and the
Pitch wheels do not tune Noise; Octave and Pitch controls are disabled in
this mode. Sample loading, drawing, loop and BRR tuning controls are hidden.
The output monitor displays the actual DSP output rather than a generated
waveform preview.

## Sounds from SPC

1. Open **Sounds from SPC → Load SPC…** and choose an `.spc` file (up to 16 MiB).
2. Opening it only lists candidates; the current instrument stays in place.
3. Leave **Import Echo / FIR settings** off for the voice alone, or check it to
   include the snapshot's shared Echo settings. This only affects the next selection.
4. Select **CH1 · SRCN …**, **CH1 · Noise** or another available row, then play
   the keyboard.
5. Edit the imported sample or Noise clock, envelope and Echo with the existing
   controls. **Save preset…** embeds its source data and settings; the original
   SPC is no longer required to load that preset. **Copy JavaScript** also
   exports the selected source.

The list contains the snapshot's eight physical voice records, including
inactive ones. Different voices using the same SRCN remain separate because
their PITCH, signed left/right volume or envelope may differ. Activity is only
an ENVX / OUTX hint. The importer examines BRR voices' SRCNs, not every directory slot.
Collapse **Sounds from SPC** to keep the waveform or spectrum in view while editing.

BRR import preserves the sample bytes, resolved block-aligned loop, signed voice
volumes and ADSR / GAIN register settings. The **captured BRR PITCH is declared
at C4** for audition. C4 is a playback reference, not a recovered original note.
Adjust Root note to retune; BRR itself contains no original musical root.

Noise voices import their captured shared clock, signed volumes and ADSR / GAIN,
including voices with PITCH 0 or invalid SRCN / BRR data: those sample settings
do not determine the Noise signal. Their rows show **Noise clock**, not musical
tuning. Audition uses this Synth's Noise generator state; the captured LFSR
state is not restored. A captured clock 0 therefore holds its current value,
which can be DC.

This is a snapshot instrument import. It does not execute the SPC700 driver,
play the song, restore its current envelope / BRR decoder history, or recover
later instrument changes. A new key-on starts a new hardware envelope. Original
master volume and the old Echo buffer are not imported. With the option off,
candidate presets start with Echo off. With it on, Delay, signed Feedback,
left/right Return and all eight signed FIR coefficients are imported. The
selected voice's original Echo-send flag becomes **Send all notes**, so its
behavior remains consistent across the Synth's round-robin voices. The original
eight-bit channel mask is not applied to unrelated keyboard notes.

If the snapshot disables Echo RAM writes, the preset starts with Echo off but
keeps the captured parameters. A frozen buffer or past Echo tail is not restored.
A voice originally excluded from Echo imports with Send off; zero Return values
also remain zero. These cases are explained in the list. The shared Echo starts
with an empty buffer, not the song's prior mixed audio. PMON voices can load their base
BRR with an explicit warning that pitch modulation is omitted. Captured voice
volumes are preserved without normalization; high polyphonic levels can clip
the DSP mixer. Use Voice level to adjust them before the final Master bus.

For BRR voices, zero PITCH, unresolved / unaligned loop targets and incomplete
or oversized samples stay visible with an unavailable reason. Zero voice
volume and decreasing GAIN may be silent on a new key-on; their rows explain
how to audition them. Invalid files, Cancel and superseded reads keep the
current instrument and previous candidate list. Once selection starts applying,
cancellation ends and **Applying…** remains until the processor acknowledges it.
Editing or replacing the instrument outside SPC selection clears its row highlight.
Changing the import option does not alter the current sound. A row is highlighted
only for its loaded import mode. If an Echo-enabled candidate exceeds the
33,786-byte sample limit, it is unavailable in that mode with a reason. Turn
the option off to select its voice alone; no Echo setting is silently discarded.

## Load audio or raw BRR

**Load audio…** decodes offline, combines channels to mono, resamples at the
selected **8,000 / 16,000 / 32,000 Hz**, and encodes BRR. There is no automatic
normalization. Only the final mono PCM is clamped to `[-1,1]` before encoding,
including any decoder / resampler overshoot. The browser uses a cancellable
module Worker for BRR encoding. Other formats depend on the browser's decoder;
WAV is the portable choice.

The software input cap is 32 MiB and decoded duration is capped at 30 minutes.
The smaller **sample-RAM limit** still applies. The Synth reserves 1,024 bytes
for its directory and, while Echo is enabled, another 30 KiB for Echo:

| Echo | Maximum BRR bytes | Maximum decoded frames | Duration at 32 / 8 kHz |
| --- | ---: | ---: | --- |
| Off | 64,512 | 114,688 | About 3.58 / 14.34 seconds |
| On | 33,786 | 60,064 | About 1.88 / 7.51 seconds |

The current limit appears next to the conversion controls. Longer input is
rejected with an explanation and no trimming. Enabling Echo on a sample that
does not fit keeps the current sample with Echo off. Choose a shorter clip or
lower conversion rate to use Echo.

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

## Hardware Echo and FIR

Open **S-DSP Echo** and turn on **Enable Echo**. This uses the S-DSP core's
shared hardware Echo path for all eight voices, with separate dry output:

| Control | Meaning |
| --- | --- |
| Delay | Hardware code 0–15. Codes 1–15 select 16–240 ms in 16 ms steps. |
| Feedback | Signed register value −128–127 returned to the Echo buffer. |
| Return left / right | Signed −128–127 levels for the delayed signal. |
| Send all notes | Add voices to Echo; turning Send off lets existing tails decay. |
| FIR · Echo tone | Eight signed −128–127 hardware coefficients for the Echo signal and feedback. |

Delay code 0 uses a four-byte buffer, one stereo frame at 32,000 Hz
(0.03125 ms); it is not a zero-length buffer. The DSP adopts a changed length
at a buffer boundary. Delay, Feedback, Return, Send and FIR changes apply while
playing. Negative Return or Feedback values can invert polarity. Large
coefficients or feedback can distort or sustain the Echo.

**FIR · Echo tone** starts folded. It shapes the Echo path, including feedback,
and leaves the dry voice unfiltered. **Identity FIR** sets the coefficients to
`[127, 0, 0, 0, 0, 0, 0, 0]`. This is an integer hardware filter, not a
cutoff / resonance control or a software effect.

The Synth rebuilds the sample bank on Echo On / Off, sample / loop replacement
and Stop, clearing held voices and previous Echo tails. Echo settings stay in
place on Stop. The 30 KiB reservation accommodates every Delay code, so live
Delay changes do not move the buffer over BRR data. Original SPC Echo settings
are imported only when **Import Echo / FIR settings** is checked before selecting
a candidate; they remain editable in this panel.

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

The portable `tetorica-sdsp-voice` preset v3 includes the selected Wave / BRR /
Noise source, shared Noise clock, waveform data, raw BRR, explicit sample
tuning, loop start, stereo volume, envelope and Echo / FIR settings. Existing
v1 / v2 presets migrate to v3 without changing their sound source; v1 adds
Echo off and both formats add the default Noise clock 31. JSON files are capped
at 256 KiB.
**Copy JavaScript** exports setup code for Playground's SNES mode, awaiting
`snes.setEcho(...)` before `snes.loadBRR(...)` so RAM is reserved before upload.
Noise setup uses the existing raw `snes.writeDsp(...)` API for NON and the
shared FLG clock bits. This feature requires no shared-runtime or npm update.

The repository runtime exposes `SnesSynth.setEcho()` / `getEcho()` and async
Main / Worker / Native client methods. Its first Echo enable reserves
`$0000–$77ff`, moves the directory to `$7800–$7bff`, and places BRR from `$7c00`.
An existing bank must fit before relocation starts. Disabling Echo through the
shared API keeps that reservation for the instance; use a fresh Synth to free
it. The standalone app does this rebuild on both Echo On and Off. Returned FIR
arrays are detached from settings, and validation rejects capacity or parameter
errors before modifying the existing instrument.

The hardware features in this version are eight voices, BRR decoding, Gaussian
interpolation, sample PITCH, shared Noise, signed volumes, ADSR / GAIN and
shared Echo / FIR.
Drawing, audio conversion, sample management and keyboard allocation are
software authoring tools.

Pitch modulation remains a later stage. No SPC700 driver or song
playback is included in this Synth.

## Source and verification

- [preset.js](preset.js), [instrument.js](instrument.js): validation and owned hardware voices.
- [sample.js](sample.js), [audio_import.js](audio_import.js): bounded sample preparation.
- [spc_import.js](spc_import.js), [spc_browser.js](spc_browser.js): passive SPC snapshot extraction and explicit voice selection.
- [editor.js](editor.js), [synth.js](synth.js): UI and performance controls.
- [audio.js](audio.js), [processor.js](processor.js): single-context AudioWorklet host.
- [Implementation TODO](../issues/todo_snes_synth_01.md).

```sh
npm run test:snes-synth
npm run test:snes-synth:browser
sh scripts/package_itch_snes_synth.sh dev
```

Packaging copies the original readable JavaScript / CSS modules, comments and
relative imports. Compiler-generated WASM / loaders remain unchanged. Matching
`snes_spc` C++ sources, the wrapper, rebuild recipe and LGPL-2.1-or-later notices
are included. No Nintendo IPL ROM, game recordings or game sample banks ship
with the Synth. See the included licenses for each component.

## 日本語

SNESの8つの実voiceを使い、BRR音色、hardware Noise、ADSR／GAIN、共有Echo／FIRを
操作するSynthです。
128点波形を描くか、WAV等・raw BRRを読み込み、同じcanvasで波形を確認できます。
BRRに元音階やrateは入っていないため、Root noteとbase PITCHで明示します。
GAINの減衰モードは初期Envelopeを自動で増やさず、新しい発音では無音になる
場合があります。まずADSR／Directで鳴らしてから切り替えると変化を確認できます。
**Sounds from SPC → Load SPC…** でSPCを開き、CH1〜CH8の候補から音色を
選択できます。開くだけでは現在の音色を変えません。選択後は既存の鍵盤で試奏し、
編集・プリセット保存・JavaScript出力ができます。BRR、解決済みLoop、左右音量、
ADSR／GAINを取り込み、BRRは保存時点のPITCHをC4の再生基準として宣言します。
元の音階を推測したものではないため、必要ならRoot noteを調整してください。
一覧は折りたためます。不正ファイルやCancel、古い読み込み結果では今の音色を保ちます。
SPCの曲再生やdriverの時間変化は再現せず、BRRのPITCH0・不正Loop等は理由を
表示して選択不可にします。Noise候補は共有clock・左右音量・ADSR／GAINを取り込み、
PITCH0や不正なSRCN／BRRでも選択できます。Noiseの内部LFSR状態は復元せず、
本Synth側のgeneratorで試奏します。PMON／Echoを省略する候補には説明を表示します。
**Import Echo / FIR settings** は初期Offです。Onにしてから候補を選ぶと、
元のDelay・signed Feedback・左右Return・8つのFIR係数も取り込みます。
選択CHのEcho送信の有無をSend all notesへ対応させ、チェック変更だけでは今の音を
変えません。元のEcho書き込みが無効ならEcho Offで設定値を保持します。
過去のEcho buffer・残響・曲全体のmixは復元せず、新しい発音からEchoを鳴らします。
Echo有効時の容量を超える候補は理由付きで選択不可になり、Offへ戻すと音色だけを選べます。

**Sound source → Noise** では、8声で1つの実機Noise generatorを共有します。
**Noise clock** は0〜31のhardware codeで、保持音にも即時反映します。
clock0は無音指定ではなく、generatorの現在値を保持するためDCになる場合があります。
各voiceのADSR／GAIN・左右音量とEcho／FIRは操作できますが、鍵盤はEnvelopeの
発音に使い、音階・Octave・PitchではNoiseを調律しません。Octave／Pitchは無効に
なり、sample読込・描画・Loop・tuningは隠れます。monitorは実DSP出力を表示します。

**S-DSP Echo → Enable Echo** で、8声共通の実S-DSP Echoを有効にできます。
Delay、Feedback、左右Return、Sendを操作でき、FIR詳細は折りたたんであります。
Delayはcode1〜15が16ms刻みの最大240ms、code0は4byte・32kHzのstereo
1frame（0.03125ms）のbufferです。Feedback・Returnと8つのFIR係数は
−128〜127のsigned値で、FIRはEcho経路とfeedbackの音色を変えます。
dry音にはかかりません。Echo On／Off、sample／Loop変更、Stopではbankを
再構成して保持音と古い残響を消し、それ以外のEcho調整は演奏中へ反映します。
Stop後もEcho設定は保ちます。

Echo Onでは30KiBを予約するため、BRR上限は33,786byte／60,064framesです。
Offでは64,512byte／114,688framesです。容量不足では現在音を保って拒否し、
勝手に切り詰めません。プリセットv3はsource・Noise clock・Echo／FIRも保存します。
従来のv1／v2形式は元のsourceを保って移行し、v1はEcho Off、両形式のNoise clockは
31を初期値にします。JavaScript出力ではBRR読込前に `await snes.setEcho(...)` を
実行し、Noiseは既存の `snes.writeDsp(...)` でNON／FLGを設定します。
共有runtime／npmの更新は不要です。SPCから取り込んだEcho設定も、このpanelで
編集・保存できます。ピッチ変調は今後の対応です。
