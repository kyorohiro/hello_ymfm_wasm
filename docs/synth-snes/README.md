# Tetorica S-DSP Synth

Product identifier: `tetorica-sdsp-synth`. A standalone SNES S-DSP instrument.

[Open the Synth](index.html) · [SNES Playground](../playground/index.html?mode=snes)

Play eight physical SNES S-DSP voices, choose a BRR or Noise voice from an SPC
snapshot, draw a waveform, load BRR or audio, and explore hardware Noise,
pitch modulation (PMON), ADSR / GAIN and Echo / FIR. The UI follows Tetorica SPU / DMG /
2A03 / HuC6280 Synths: output monitor, compact keyboard, Octave, two Pitch wheels,
collapsible sections and controls that leave the computer keys available.

## Play

1. Select **Enable audio**, or press a displayed computer key.
2. Use **Drawn wave** to draw a 128-point cycle, load audio / raw BRR, select
   **Noise**, or choose **Sounds from SPC → Load SPC…** and select a voice candidate.
3. Adjust the hardware envelope, enable **S-DSP Echo**, or enable **Pitch Modulation**
   for a Wave / BRR source and edit its modulator.
4. Save a preset or copy JavaScript for Playground.

Editing or loading a sample does not open an audio device. Allocation uses the
eight hardware voices in round-robin order, stealing an old voice when needed.
PMON uses two adjacent hardware voices per note, for four playable notes.
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
Drawing or choosing a shape updates the existing BRR RAM while keeping held
notes, release envelopes, playback positions and Echo history. The decoder
uses the edited bytes at its next block fetch; it does not restart the note.

When a BRR sample is selected, this canvas displays its decoded waveform as a
preview. Use Wave to author a cycle. With PMON enabled, choose **Carrier** or
**Modulator** as the edit target on this same canvas. The carrier remains the
selected drawn Wave or decoded BRR preview. **Modulator source** selects its own
editable 128-point Wave or a BRR sample. A modulator BRR appears as a read-only
decoded preview with its own Root / base PITCH and loop controls. **Load audio…**
and **Load BRR…** replace the selected Carrier / Modulator target; the file action
and conversion hint name that target. Switching targets alone changes no sound.
Sample replacement, loop edits, active modulator-source changes and Echo / PMON
On / Off rebuild the bank, stopping held notes and old Echo tails. Repeated
drawn Wave edits reuse their existing RAM without rebuilding the bank. Volume, envelope, Root / base PITCH, Pitch wheels and
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
waveform preview. PMON settings are remembered but paused in Noise mode;
Noise retains eight independently gated voice envelopes.

## Hardware Pitch Modulation

Open **Pitch Modulation** after the Echo panel and turn on **Enable Pitch Modulation**
for a Wave or BRR source. The real S-DSP uses the previous voice's envelope-scaled output to
modulate the next voice's PITCH. This Synth assigns fixed pairs **0 → 1,
2 → 3, 4 → 5 and 6 → 7**, giving four notes in round-robin order. Each key
starts and releases both voices together; a stolen pair keeps the same safe
ownership rules as an ordinary voice.

The modulator's left/right volumes are zero, so it supplies modulation without
adding its own sound to the mix. Only the carrier sends audio to Echo. Adjust
the modulator's independent hardware **ADSR / GAIN** to shape modulation depth;
Direct GAIN provides a steady level, while the other modes change it over time.
A decreasing GAIN envelope starting at zero can produce no modulation until
it has first been raised with ADSR or Direct GAIN.

**Ratio**, from **0.125 to 8**, is a software tuning control that writes hardware
PITCH registers. For a drawn modulator Wave it multiplies the keyboard-note
frequency, including Pitch. For a BRR modulator it multiplies the playback speed
declared by that sample's Root / base PITCH after keyboard transposition. It
does not infer either BRR sample's original fundamental. Carrier and modulator
BRR samples keep independent references. Ratio, either sample's Root / base PITCH
and both envelopes apply to held notes, and Pitch wheels
transpose both voices. The modulator PITCH is clamped to **1–16,383** at the
hardware limit, so extreme notes or ratios can stop preserving the requested ratio.
Choose **Modulator** on the existing sample canvas, then **Modulator source →
Drawn wave** to draw a cycle or choose Sine, Triangle, Saw or Square. Choose
**BRR sample** to preview a loaded modulator and edit its separate tuning / loop;
audio and BRR loads target whichever sample is selected. An empty BRR modulator
is a valid draft, but keys and JavaScript audition require a loaded sample.
BRR encoding and keyboard pair allocation
are software authoring tools; PMON and both envelopes run in the actual S-DSP.
Editing only the Carrier / Modulator Wave keeps both voices and Echo running.
Changing PMON On / Off or its sample source rebuilds the bank and stops held
notes and Echo tails. Ratio, Envelope / GAIN and Pitch edits retain their owners.
Noise temporarily pauses PMON because Noise output is not tuned by sample PITCH;
returning to Wave / BRR restores the remembered setting.

## Sounds from SPC

1. Open **Sounds from SPC → Load SPC…** and choose an `.spc` file (up to 16 MiB).
2. Opening it only lists candidates; the current instrument stays in place.
3. Leave **Import Echo / FIR settings** off for the voice alone, or check it to
   include the snapshot's shared Echo settings. **Import PMON pairs** also starts
   off; enable it to select a recorded BRR carrier with its preceding modulator.
   Both options affect only the next selection.
4. Select a voice or available **CH… → CH… · PMON** row, then play the keyboard.
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
BRR with an explicit warning that its original pitch modulation is omitted
when **Import PMON pairs** is off. This base-voice mode remains available even
when the recorded pair cannot be imported. Captured voice
volumes are preserved without normalization; high polyphonic levels can clip
the DSP mixer. Use Voice level to adjust them before the final Master bus.

For BRR voices, zero PITCH, unresolved / unaligned loop targets and incomplete
or oversized samples stay visible with an unavailable reason. Zero voice
volume and decreasing GAIN may be silent on a new key-on; their rows explain
how to audition them. Invalid files, Cancel and superseded reads keep the
current instrument and previous candidate list. Once selection starts applying,
cancellation ends and **Applying…** remains until the processor acknowledges it.
Editing or replacing the instrument outside SPC selection clears its row highlight.
Changing either import option does not alter the current sound. Both options
are locked while **Applying…** waits for acknowledgement. A row is highlighted
only for its loaded Echo / PMON mode. If an Echo-enabled candidate exceeds the
33,786-byte sample limit, it is unavailable in that mode with a reason. Turn
the option off to select its voice alone; no Echo setting is silently discarded.

**Import PMON pairs** (`#spcIncludePmon`) applies only to rows whose recorded
PMON bit is set and whose carrier is not Noise; ordinary BRR and Noise rows
keep their usual variants. Supported pairs are isolated adjacent BRR voices.
Noise modulators, incoming / outgoing PMON chains, zero BRR PITCH, invalid
sample / loop data and combined RAM overflow leave that pair unavailable with
a reason. No unsupported pair silently falls back to its base voice while
the option is on; turn the option off to choose the base-voice variant.

Pair import embeds both BRR samples and their resolved loops, independent
envelopes and captured PITCH values. Both samples declare Root **C4**, with
**Ratio 1**, so C4 writes each captured PITCH. These are playback references,
not recovered original notes or a measured fundamental-frequency ratio.
Captured signed modulator L/R volumes remain inspection metadata; audition
sets its L/R to zero and omits its Echo send. Only the carrier contributes dry
audio and feeds Echo. Both envelopes restart on key-on; elapsed ENVX, decoder
phase / history, the original master mix, SPC700 updates and song playback are
not restored. Direct GAIN 0 or a fresh decreasing GAIN may therefore start
without modulation; the list explains these cases.

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

Active PMON shares this budget between the **complete carrier and modulator**
uploads. A drawn Wave consumes **72 BRR bytes**; a BRR source consumes its own
byte length. With a Wave modulator, the carrier limits remain **64,440 bytes
dry** / **33,714 with Echo**. A BRR modulator makes that reservation variable.
The samples are counted separately even if their bytes or SRCN are identical;
there is no deduplication. The capacity display and selected-target conversion
hint show the available budget. Over-budget edits keep the current instrument;
samples are never trimmed. Inactive sample drafts, paused PMON in Noise mode
and disabled PMON do not reserve a modulator upload.

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

The portable `tetorica-sdsp-voice` preset v5 includes the selected Wave / BRR /
Noise source, shared Noise clock, waveform data, raw BRR, explicit sample
tuning, loop start, stereo volume, envelope, Echo / FIR and PMON's enable flag,
ratio, modulator source, Wave and embedded BRR / tuning / loop, plus its
independent envelope. Both sample assets are saved, so the original SPC or audio
file is not required. Strict v1–v4 inputs migrate to v5: v4 keeps its authored
Wave PMON, while v1–v3 add PMON off without changing their sound source; v1 adds
Echo off and v1 / v2 add the default Noise clock 31. JSON files are capped
at 256 KiB.
**Copy JavaScript** exports setup code for Playground's SNES mode, awaiting
`snes.setEcho(...)` before `snes.loadBRR(...)` so RAM is reserved before upload.
Noise setup uses the existing raw `snes.writeDsp(...)` API for NON and the
shared FLG clock bits. PMON setup uploads both BRR samples, configures one
adjacent pair with a silent modulator, and uses the existing raw `writeDsp`
API for PMON routing. These features require no shared-runtime, WASM or npm update.

The repository runtime exposes `SnesSynth.setEcho()` / `getEcho()` and async
Main / Worker / Native client methods. Its first Echo enable reserves
`$0000–$77ff`, moves the directory to `$7800–$7bff`, and places BRR from `$7c00`.
An existing bank must fit before relocation starts. Disabling Echo through the
shared API keeps that reservation for the instance; use a fresh Synth to free
it. The standalone app does this rebuild on both Echo On and Off. Returned FIR
arrays are detached from settings, and validation rejects capacity or parameter
errors before modifying the existing instrument.

The hardware features in this version are eight voices, BRR decoding, Gaussian
interpolation, sample PITCH, shared Noise, adjacent-voice PMON, signed volumes, ADSR / GAIN and
shared Echo / FIR.
Drawing, audio conversion, sample management and keyboard allocation are
software authoring tools.

SPC pair import supports isolated adjacent BRR pairs. No SPC700 driver or song
playback is included in this Synth.

## Files and Code performance

Filesで音色・コード・素材をまとめて保存し、Codeで現在の音色を演奏できます。
BPM連動の演奏例、Code画面での鍵盤入力、自動保存・復旧、Cassette ZIPに対応します。

**Files** opens a local project containing JavaScript, editable text, binary assets
and named `.sdsp.json` sounds. **Save sound** adds the complete current preset,
including carrier / modulator BRR, Noise, PMON and Echo, without replacing an
existing saved sound. Select a sound JSON to apply it; editing its JSON alone
keeps the current instrument until you select it again. Existing portable v1–v5
presets still load through **Load preset…**.

Sound edits, Files and Code save locally. Reopening restores the project without
opening audio or running JavaScript. **Export project** / **Import project…** use
a Cassette ZIP with the sound, Code and binary files together. Export the project
to keep a portable copy; browser storage failures are shown beside Files. A failed
initial restore keeps the unread project and does not overwrite it with defaults.
The local project uses its own S-DSP storage namespace. Saved portable presets
and projects from other Synth apps are not changed.

Choose **Code**, select `/index.js`, and press **Run**. **Apply** retains `context`
and replaces named loops while playing; **Stop** releases Code-owned notes and
keeps the edited instrument. Switching Keyboard / Code changes the view while
Code continues. Computer keys play in either view outside text editors, inputs,
Files and dialogs; key-up and window blur release manual keys. **Stop all sound**
also clears held notes and the hardware Echo tail.

```js
const snes = await useSoundChip("snes");
setBpm(120);
liveLoop("melody", async () => {
  await snes.noteOn(CH1, choose(scale("C4", "minorPentatonic", 1)));
  await beat(0.5);
  await snes.noteOff(CH1);
  await beat(0.25);
});
```

This Synth performance handle shares the existing S-DSP, sample bank, current
sound, keyboard allocator and Master. Its note methods are asynchronous; await
them before starting a musical wait. `beat()` follows `setBpm()`, while `sleep()`
measures seconds. Performance lanes **0–7** identify Code notes; **CH1–CH6** are
aliases for 0–5, and numeric 6 / 7 address the last two lanes. They are not fixed
DSP voice numbers. Notes use the same round robin / stealing rules as the
keyboard: eight ordinary notes, or four PMON pairs, shared with manual keys.
Noise uses its shared clock and ignores the requested musical pitch.

The handle exposes `noteOn(lane, note)`, `noteOff(lane)`, `getState()`,
`allNotesOff()` and `dispose()`. The last two release only that Code session's
notes. Note names and integer MIDI 0–127 are supported. The editor sets the
Wave / BRR bank, envelopes, Noise, PMON and Echo; edits apply through the existing
live-update rules. This app-specific performance handle differs from Playground's
raw `SnesSynth` channel / RAM API. **Copy JavaScript** retains the existing
Playground setup-code export. Software `liveFx()` runs after the S-DSP; hardware
Echo / FIR remains part of the S-DSP.

Code uses the shared Synth editor, with text editing available if Monaco cannot
load. Local modules can be imported from Files and `file()` reads project assets.
Maximize Code to edit beside Files. JavaScript is limited to 2 MiB, and the project
reserves room for the full sound within the 16 MiB Cassette limit. Looper / Event
Rec and SPC song playback are outside this first Files / Code update.

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

SNESの8つの実voiceを使い、BRR音色、hardware Noise・PMON、ADSR／GAIN、共有Echo／FIRを
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
**Import PMON pairs**（`#spcIncludePmon`）は初期Offです。OnにしてPMON記録のある
BRR carrierを選ぶと、直前のBRR modulatorも取り込みます。通常のBRR／Noise行には
影響しません。両BRRはRoot C4・Ratio1で、それぞれの捕捉PITCHをC4で再現します。
両sample・Loop・独立Envelopeを保持しますが、元音階や基音の比を推測したものではありません。
modulatorの捕捉左右音量は確認用metadataとして残し、試奏では左右0にして直接鳴らさず、
carrierだけをEchoへ送ります。単純な隣接2声pairが対象で、Noise modulator、PMON chain、
BRR PITCH0、不正sample／Loop、合計容量超過は理由付きで選択不可になります。
Onのままbase音色へ自動退避せず、Offへ戻せば従来のbase音色候補を選べます。
両Envelopeはkey-onで再開し、経過ENVX・decoder位相／履歴・master mix・driver・曲は復元しません。
**Import Echo / FIR settings** は初期Offです。Onにしてから候補を選ぶと、
元のDelay・signed Feedback・左右Return・8つのFIR係数も取り込みます。
選択CHのEcho送信の有無をSend all notesへ対応させ、チェック変更だけでは今の音を
変えません。両チェックは次の選択だけに使い、Applying中はprocessorのACKまで固定します。
選択表示もEcho／PMONの組み合わせを区別します。元のEcho書き込みが無効ならEcho Offで設定値を保持します。
過去のEcho buffer・残響・曲全体のmixは復元せず、新しい発音からEchoを鳴らします。
Echo有効時の容量を超える候補は理由付きで選択不可になり、Offへ戻すと音色だけを選べます。

**Sound source → Noise** では、8声で1つの実機Noise generatorを共有します。
**Noise clock** は0〜31のhardware codeで、保持音にも即時反映します。
clock0は無音指定ではなく、generatorの現在値を保持するためDCになる場合があります。
各voiceのADSR／GAIN・左右音量とEcho／FIRは操作できますが、鍵盤はEnvelopeの
発音に使い、音階・Octave・PitchではNoiseを調律しません。Octave／Pitchは無効に
なり、sample読込・描画・Loop・tuningは隠れます。monitorは実DSP出力を表示します。
PMONの設定は保持して休止し、Noiseでは8つのvoice Envelopeを使います。

**Pitch Modulation → Enable Pitch Modulation** はWave／BRR向けの実機ピッチ変調です。
直前のvoiceのEnvelope適用後出力で次のvoiceのPITCHを変調します。
0→1／2→3／4→5／6→7を2声1組として割り当て、最大4音のラウンドロビンで
発音・離鍵します。変調側は左右音量0で直接鳴らさず、carrierだけをEchoへ送ります。
変調側の独立したhardware ADSR／GAINで変調の強さと時間変化を作れます。
初期値はDirect GAIN64です。減衰GAINはゼロから増やさないため、まずADSR／Directで
立ち上げてから切り替えると変化を確認できます。

Ratioは0.125〜8で、Wave modulatorではPitchを含む鍵盤周波数を倍にし、BRR modulatorでは
独自のRoot／base PITCHから鍵盤移調した再生速度を倍にします。両BRRの元の基音は推測しません。
Ratio・両BRRのRoot／base PITCH・両Envelope／GAINは保持音へ反映し、Pitch wheelは両voiceを
一緒に移調します。変調側PITCHは1〜16,383へclampするため、高低音や大きな比では
指定したRatioを保てない場合があります。Sampleの**Carrier／Modulator**で対象を
切り替え、同じcanvas1枚を使います。**Modulator source → Drawn wave**は128点波形を
描くかshapeを選び、**BRR sample**は復号波形の読取専用previewと専用tuning／Loopを表示します。
**Load audio…／Load BRR…**は選択中の対象を置き換え、ボタンと説明にも対象を表示します。
空のmodulator BRRはdraftとして保存できますが、読み込むまでは発音・JavaScript試奏はできません。
対象切り替えだけでは音を変えません。波形／source編集・PMON On／Off・sample／Echo layoutの
変更では保持音と残響を止めます。変調自体はhardware、波形のBRR化と鍵盤のpair割り当ては
softwareの機能です。NoiseからWave／BRRへ戻すと、保持したPMON設定へ戻ります。

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
勝手に切り詰めません。PMON有効時はcarrier＋modulator両sampleの完全なbyte数を合計します。
Waveは各72byte、BRRは各data長です。変調側がWaveならcarrierの上限は
Echo Offで64,440byte、Onで33,714byteですが、変調側BRRの予約量は可変です。
同じSRCN／同じbytesでも2回分を数え、重複排除はしません。読込対象に応じた残容量を表示し、
容量不足では原音を保って拒否します。無効／Noiseで休止中のPMONや非選択sampleはRAMを使いません。
プリセットv5はsource・Noise clock・Echo／FIRに加え、PMONのOn／Off・Ratio・Wave／BRR source・
両sample・個別tuning／Loop・独立Envelopeも保存します。元SPC／音声ファイルは不要です。
strictな従来v1〜v4形式を移行し、v4のWave PMONは保持、v1〜v3は元sourceを保ってPMON Offにします。
v1はEcho Off、v1／v2のNoise clockは31を初期値にします。
JavaScript出力ではBRR読込前に `await snes.setEcho(...)` を実行し、
既存の `snes.writeDsp(...)` でNoiseのNON／FLGやPMON隣接routingを設定します。
既存APIだけを使い、共有runtime／WASM／npmの更新は不要です。SPCから取り込んだ
pairやEcho設定も、このpanelで編集・保存できます。
