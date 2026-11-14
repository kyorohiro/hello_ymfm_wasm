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

## Code and Files

Choose **Code**, then **Run** to play the same physical HuC6280 used by the
controls above. The starter `index.js` uses `await useSoundChip("huc6280")`,
`liveLoop`, musical scales and the chip object's methods. **Apply** updates code
while retaining `context`, named loops and `livePrepare` values. Run starts a
fresh performance. Switching back to **Keyboard** keeps Code running, so you can
play keys, edit controls or load another sound during the loop.

The channel selector offers **Synth** and **CH1–CH6** in normal, Code and VGM modes. Synth
edits the authored instrument; a physical channel shows that channel. Normal
and Code modes allow editing, while VGM CH views are read-only.
**Auto update** reads the configured wave and sent registers at up to 20 Hz;
turn it off to reduce readback. This is an observation of software writes, not
an oscillator-phase measurement. During Code, manual channel edits retain their changed
fields in the authored instrument. Raw Code register writes do not overwrite
the saved instrument. **Stop** fades the software output briefly, cancels Code
and restores the authored settings with all notes released.

In normal mode a physical CH has independent settings and keyboard ownership.
Selecting CH or Synth alone does not copy or unify settings. Stop / blur releases
manual notes while retaining these channel settings. Shared Synth edits broadcast
only changed sound fields; explicit sound loads, source / routing / PCM changes
replace the normal channel setup. Normal CH settings are session state, outside
the single-voice preset format. Starting and stopping Code restores the common
instrument. Selecting a physical CH before audio is enabled is passive; enable
audio or play a key before editing its actual settings.

`noteOn(channel, note)` / `noteOff(channel)` use this Synth's **Software
Envelope**; `keyOn(channel)` / `keyOff(channel)` operate the raw hardware gate.
Noise is available on CH5 / CH6 and does not follow note pitch. Hardware LFO
still has the fixed CH2 → CH1 route: Code must explicitly set CH2's period when
it should follow a melody. DDA uses the current shared PCM asset and software
sample feeding. Choose Synth to replace that asset; physical-channel controls
can adjust its playback settings. `liveFx` effects run in software after the PSG.
Completion, type hints and source navigation distinguish these host tools from
the chip API.

**Files** holds `index.js`, presets, text and binary assets. Selecting a sound
loads it without stopping Code; selecting JSON while Keyboard is visible keeps
the Keyboard tab. Right-click a file for duplicate, rename, delete and creation
actions. Save sound stores a portable preset under `presets/`. The menu imports
and exports files or a whole Cassette project. Local recovery and project import
restore editable data without running Code or opening audio. Cassette projects
are limited to **16 MiB expanded**, including settings and metadata; the existing
direct audio / preset imports retain their **32 MiB** input limit. A large sound
can therefore be played and saved separately even if it exceeds the project
limit.

## Sounds from VGM

Use **Load VGM / VGZ…** in the collapsible **Sounds from VGM** section.
Choose a PC Engine VGM or gzip-compressed VGZ, then choose a sound from the
**Wave** / **Noise** / **LFO** / **PCM** list. Analysis alone keeps the current instrument; only an
explicit sound choice loads it. Cancel, failed imports and closing the library
keep the current sound. Files and expanded VGZ data are limited to 64 MiB.

**Wave / PCM: keep loudest volume variant** optionally groups Wave or PCM entries whose data
and all other sound settings match, showing the highest channel-volume version.
It is off by default and can be toggled after loading; turning it off restores
every entry. Different pan, rate, Loop or other sound settings remain separate,
as do Noise / LFO sounds. The representative retains its own channel,
timestamp and preset; uses, origins and warnings are combined. Equal volumes
keep the first entry. Switching the option keeps the current instrument and
held notes. If a selected quieter entry becomes hidden, its selection marker
clears; choosing the loud representative is a separate action.

Wave imports retain the recorded 32 five-bit samples, channel level and stereo
balance. Noise imports retain the CH5 / CH6 clock and channel settings. LFO imports
capture CH1 and CH2 together: both waveforms and periods, rate, depth, Reset and
CH2's output state / level / stereo balance. Different note pitches share ordinary
Wave / Noise entries; LFO period changes remain distinct paired settings.
PCM imports reconstruct supported complete HuC6280 DAC streams and uniform
direct DAC intervals, retaining the five-bit data, playback rate, channel level
and stereo balance. Their list entries identify **DAC stream** or **Direct DAC**
and show the rate, duration and Loop state. **C4 plays the recorded
rate**; other keys change the software playback speed. Selecting a PCM entry opens
the existing DDA PCM preview and controls, and Save preset includes its PCM data.
The first implementation accepts uncompressed banks and fixed CH1–CH6 DAC
destinations, with step / base, explicit or previous lengths, bank-end lengths,
millisecond lengths, fast block starts, Reverse and Loop. A positive recorded
interval must include every sample write. An interrupted sequence, changing rate,
overlapping DAC writes, compressed bank or current-selected-channel destination
is omitted. The final held DAC value after the stream ends is not replayed;
the Synth uses its normal one-shot silence / release behavior. Extraction is
limited to 65,536 bank blocks, 100,000 starts, 4,096 assets and 16,777,216 total
prepared samples, in addition to the VGM file limits.

Direct DAC extraction requires a recorded DDA key-on transition and an explicit
key-off or DDA-disable boundary. The first DAC write must be at the key-on
timestamp. At least three timestamped DAC values must have
the same positive write interval, and the final value must be held for one more
such interval before the boundary. Writes at the same timestamp use the final
value; a terminal write with no audible duration at key-off is excluded. Rate is
derived from the VGM 44,100-tick timebase without rounding fractional rates such
as **5,512.5 Hz**. A changing interval, audible mix change, unknown state or
overlapping DAC stream is omitted with an explanation. Direct imports are
one-shots: Loop and the original musical note are not inferred.
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

**Irregular or incomplete direct DAC intervals, unsupported DAC streams and
unknown settings are omitted with an explanation.** PCM extraction requires known source data, stream settings
and channel state; it does not infer an entire sample from an interrupted or
unexplained stream. Song notes and later register automation are not replayed.
LFO requires
both written period registers and both complete waveforms, plus the rate and
control settings. Unknown data is not replaced with a built-in wave. Song-time
oscillator phases and elapsed LFO counters are not reconstructed.

## VGM reference playback

Import a VGM / VGZ in **Sounds from VGM**, or use the menu's **Project files…**.
The original file is saved under `vgm/` in Files with a unique name. The **VGM**
selector above Waveform / Spectrum lists these files. Select a song, then press
**Play**. The same button becomes **Pause**, then **Resume**. **Stop** returns to
the beginning while retaining the selected song and your edited instrument.
Opening, selecting or restoring a project never starts playback automatically.

Reference playback renders the recorded HuC6280 writes with the existing chip
core, including timed Wave, Noise, hardware LFO and supported direct / streamed
DAC writes. It plays **once**, through the existing Master volume and output
monitor. VGM loop points do not automatically repeat. The reference chip is
independent of the authored instrument; Pause retains unheard PCM and its exact
offset so Resume continues at the heard song position.

Code and reference playback run one at a time. Play / Resume stops Code and
releases manual keys; Run stops the reference song. **Stop all sound** stops
both. Pause or Stop the song to play your edited instrument on the keyboard.
Changing or loading an instrument stops the reference song.

Select **CH1–CH6** to see the VGM's Wave, Noise, LFO, level, stereo balance,
period and Gate in the same instrument UI. This view is read-only and follows
the **heard position**, rather than prefetched audio. Unknown Wave RAM stays
blank; missing register fields show an unknown marker. DDA shows the last
recorded five-bit DAC code, without assuming a continuous sample or root note.
These observations never replace your authored instrument.

**Auto update** starts On and publishes at up to 20 Hz. Off retains a full-chip
snapshot, so changing CH views uses the same observation time. On catches up to
the heard position. Pause publishes one exact consumed-position snapshot even
when automatic updates are Off; Resume continues playback. To audition your
authored instrument while paused, select Synth. Selected-song-CH keyboard
audition / Capture, CH On / Off, Seek and direct VGM editing remain later steps.

The player accepts VGM **1.61–1.72** and requires one HuC6280 at the normal
**3,579,545 Hz** PC Engine clock. Other chips,
dual / variant chips, unsupported stream forms and malformed timelines are
rejected before the player acquires audio. An invalid song keeps the accepted
song and edited instrument. Song loading accepts up to **64 MiB** compressed or
expanded, but Files / Cassette still has its **16 MiB total expanded project**
limit. If a source cannot be copied into Files, sound extraction can still
finish and reports the copy failure separately. A valid file without a complete
static instrument can still be kept for reference playback.
Supported DAC streams use uncompressed banks; stop a stream before changing
its bank / stride setup. Preparation is bounded to one hour, four million
commands, 192,000 Hz per stream and 384,000 Hz across active streams. Extra
headers, compressed / ROM banks and excessive command bursts are rejected
with an explanation.

Opening the page or editing a sound does not start an audio device. Playing a
key can also initialize audio. One HuC6280 PSG renderer supplies these channels:

| Source | Keyboard voices | Hardware controls |
| --- | --- | --- |
| Wave, LFO off | Six, CH1–CH6 | 32 five-bit samples, volume and left / right balance |
| Wave, LFO on | One CH1 / CH2 pair | CH2's waveform modulates CH1; optional CH2 output has its own level / balance |
| Noise | Two, CH5 / CH6 | Per-channel noise-clock code, volume and left / right balance |
| DDA PCM | Six, CH1–CH6 | Five-bit direct DAC; samples are supplied by software |

Allocation uses available channels in round-robin order and replaces an old
voice when the pool is full. Releasing a replaced key cannot stop its new owner.
The common keyboard instrument applies its Noise settings to both noise channels;
Code and physical-channel edits can set them independently.
Changing source or the LFO routing can stop held notes; play a new note after
those changes. Editing only the Main or LFO wave keeps the held keys and the
software envelope's progress. There is no separate Apply button.

**Noise does not follow the keyboard note or Pitch wheel.** Its 0–31 clock code
sets the noise texture; it is not a frequency in Hz. Noise controls can change
while notes are held. LFO is inactive while Noise is selected.

## One waveform editor

Choose **Main** or **LFO** as the edit target on the same canvas. **Sine**,
**Triangle**, **Saw** and **Square** prepare a waveform, or draw all 32 samples
yourself. Each sample is an integer from 0 to 31, matching the PSG's five-bit
Wave RAM. A shape applies immediately; a drawing applies on pointer release.
An interrupted stroke is discarded. Wave edits keep sounding notes, their
pitch and envelope timing; releasing the key still releases the same voice.
The hardware wave-upload path resets the wave index / oscillator phase, so
this preserves the performance rather than the exact pre-edit phase.

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
audio conversion choices remain **8,000–44,100 Hz**. The separate live DAC rate
changes how quickly the prepared data is read and supports finite rates
**1–192,000 Hz**, including fractional rates derived from direct DAC timing.
Rates above the
audio output rate skip intermediate DAC codes rather than increasing the host's
output sample rate.

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
Hiding the page or leaving its window releases manual keys while Code continues.
**Stop all sound** releases held notes and stops Code.
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

Irregular or incomplete direct-write PCM extraction, unsupported DAC stream
forms, CD-ROM² ADPCM / CD-DA and full PC Engine emulation are not included.

## API, sources and licenses

- [npm API catalog](../../packages/fm2612/README.md#api-entry-points): musical helpers and low-level APIs.
- [Huc6280Synth](../../tetorica_src/runtime/huc6280synth.js) and [Huc6280AudioEngine](../../tetorica_src/runtime/huc6280audioengine.js): authoring and synchronous register / PCM access.
- [Preset format](preset.js), [instrument and allocator](instrument.js), [AudioWorklet](processor.js), [browser audio lifecycle](audio.js) and [editor](editor.js).
- [Code host and starter](code_host.js), [shared-chip client / software FX](code_audio.js), [Live channel view](code_live.js), [types](code_declarations.js), [project format](code_project.js) and [Files](code_files.js).
- [VGM / VGZ extraction](vgm_import.js), [DAC stream PCM extraction](vgm_dac.js), [direct DAC PCM extraction](vgm_direct_pcm.js) and [sound library](vgm_library.js): passive analysis and explicit sound selection.
- [Reference source validation](song_source.js), [playback and Pause timing](song_preview.js) and [Files song controls](song_controls.js).
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
npm run test:huc6280-synth:code-browser
npm run test:huc6280-synth:song-browser
npm run test:huc6280-synth:live-browser
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
Keyboard／Codeを切り替え、同じHuC6280を`useSoundChip("huc6280")`で操作できます。
Code実行中も鍵盤・つまみ・波形編集・音色の読込を使えます。
CH1–CH6の表示・編集と自動更新、Files・Cassetteの保存／読込、型補完・実装への移動に対応します。
Runは新規実行、Applyはcontext等を保持、Stopは短くフェードして編集用設定へ戻します。
CodeのnoteOn／noteOffはSoftware Envelope、keyOn／keyOffは実機のゲート操作です。
liveFxやDDAのデータ供給もソフト側の機能です。復元したCodeを勝手に実行することはありません。
VGM／VGZからWave／Noise、CH1・CH2を組にしたLFO音色、対応する完全なDAC streamや一定間隔の直接DAC write区間のPCMを抽出できます。
Recorded periodsではC4が記録時のCH1周期、他の鍵盤はCH1だけを移調し、CH2は固定です。
両周期・速度・深さ・Reset・CH2の出力を保持します。
DDA PCMではWAV等をモノラル5bitへ変換し、6声で試奏、Root／Loop／Speedを変更できます。
DACは実機機能、データ供給・移調・Loop・Envelopeはソフト側の制御です。
PCM本体はプリセットv3へ保存し、v1／v2も読み込めます。
PCM一覧に由来・rate・時間・Loopを表示し、C4で記録時の速度、他の鍵盤で移調して試奏できます。
直接DACは既知のkey-on／key-offまたはDDA解除に囲まれた一定間隔の区間のみを採用します。最初のDAC writeはkey-onと同時刻が必要で、Loopや元の音階は推測しません。
音声変換は8,000–44,100Hz、live DAC rateは直接DAC由来の小数rateも扱える1–192,000Hzです。
間隔が変わる／終端が不明な直接DAC区間、未対応stream、不明な設定は理由付きで省略します。
VGM／VGZの元ファイルはFilesの`vgm/`へ保持し、モニター上の曲一覧からPlay／Pause／Resume／Stopできます。
模範演奏は1回再生で、現在のMasterと出力モニターを使い、編集中の音色を保ちます。
Codeと曲再生は排他的で、RunとPlayが互いの演奏を停止します。Pauseは未再生PCMとoffsetを保持します。
CH1–CH6を選ぶと、聞こえた位置の設定を同じ音色UIへ読み取り専用で表示します。
未記録Wave RAMは空欄、DDAは最後に書かれたDAC値を表示し、元のPCM音色や音階を推測しません。
自動更新は初期On・最大20Hz。OffはCHを切り替えても同じ観測時刻を保ち、Onで追従します。
Pause時は自動更新Offでも、実際に止まった位置を一度表示します。
通常時もCHごとに表示・設定・鍵盤を揃え、CHやSynthの選択だけで値を統一しません。
通常CH設定は一時的な状態で、単一音色presetには含めません。Code開始・終了では共通音色へ戻します。
鍵盤で編集用音色を弾くには曲をPauseしてSynthを選ぶか、Stopします。選択CHの試奏／Capture・Seekは後続です。
他チップの音を黙って省略せず、単一HuC6280以外や未対応データは理由付きで拒否します。
CD-ROM²音源は対象外です。
