# Tetorica CPS2 Synth · PCM preview

Serve the repository's docs directory over localhost or HTTPS and open
`/synth-cps2/`. Use AUTO for chords or select CH1–16 for a fixed PCM channel, then hold A S D F G H J K or a screen key.
AUTO has its own PCM voice. Each key press writes that voice to the next free channel in circular order, including when playing single notes. Held keys keep their channels. The outline marks the most recent destination. Select a PCM preset with AUTO active to change the sound across the rotation. Fixed channels keep their own editor settings, and the cassette saves the AUTO voice separately. Pitch follows the key. The ROM bank control can switch the held note’s sample data; volume
and pan can change during a held note. The factory demo VGMs include their generated sample ROM. PCM duet uses two pitched PCM channels. ADPCM trio triggers three one-shot samples, panned left, center and right.

## Workspace

Choose a track in the **VGM** list above the transport and press **Play VGM**. The built-in demos use the same transport as imported VGMs and appear under Files → /songs. Output shows the waveform or spectrum. The Files sidebar is available in both modes. Synth keeps the chip editor above the Keyboard / Code tabs. Code mode opens Files and groups Code, PCM, ADPCM, ROM, Mixer and Keyboard in one tab row. PCM, ADPCM, ROM and Mixer each have a tab. PCM contains the voice and register views. The keyboard is available in both modes when focus is outside the text editor. Use Guitar, Bass or Ukulele on the selected PCM channel. Choose Open, 5th or 12th, select the visible strings, or drag Octave (−2 to +2). Left/Right shifts the fret and Up/Down changes the string window. The four rows match the displayed keys. With **Use ADPCM** enabled (default), physical keys 1–3 trigger ADPCM; click the first three top-row frets (F labels) to play their PCM notes. Turn it off to play those frets with keys 1–3 outside the ADPCM tab. The ADPCM pads still respond to clicks.

## Register model

Select a PCM channel and open **Registers** to see the last 16-bit word written to each of its nine registers. A dash means the register has received no write. The sample address row retains the last written address while the playback address follows the PCM cursor. Seeking in a VGM restores both to the selected position.

Based on the [MAME QSound HLE implementation](https://github.com/mamedev/mame/blob/master/src/devices/sound/qsoundhle.cpp)
and [header](https://github.com/mamedev/mame/blob/master/src/devices/sound/qsoundhle.h).
The PCM update follows this software reference. Hardware comparison is pending.

| Register | Behavior |
|---|---|
| 8 × channel + 0 | Bank of the **following** channel, wrapping CH16 to CH1. Low 15 bits select a 64 KiB window. |
| +1, +3 | Signed address and fractional phase. ROM fetch uses the low 16 address bits. |
| +2 | Unsigned 4.12 rate. 0x1000 advances one ROM byte per DSP sample. |
| +4, +5 | Signed loop length and end address. On reaching the end, subtract loop length. |
| +6 | Signed volume. The keyboard releases a note by writing zero. |
| 0x80–0x8f | Per-channel pan. The Synth applies an approximate spatial PCM mix across 0x110–0x130 in standard mode. |

For ADPCM voice index `i` (0–2), the four registers at `0xca + 4*i` set the start byte, exclusive end byte, bank and signed volume. Write a nonzero word to `0xd6 + i` to trigger the sample. The voice latches volume at the start of the next high nibble. Pan uses `0x90 + i`. Each voice decodes one nibble every third DSP tick, high nibble first. The decoder follows MAME HLE and the step coefficients in [libvgm](https://github.com/ValleyBell/libvgm/blob/master/emu/cores/qsound_ctr.c).

PCM echo comparison plays a short note twice. The second note feeds a shared delay line for an audible tail. Registers `0xba–0xc9` set each PCM voice’s signed send, `0x93` controls signed feedback, and `0xd9` sets the delay end. Subtract the mode base (0x554 or 0x53c) for the delay in DSP ticks, up to 1024. ADPCM has no send register. Muting a PCM voice stops new input while the existing tail decays. The line and its two-sample average follow MAME HLE. The preview centers the return and applies mode requests immediately. Echo routing and DSP state timing remain approximate.

The DSP sample rate is 60 MHz / 2 / 1248. The audio worklet holds each sample
until the next DSP tick. The VGM export uses the conventional 4 MHz QSound
header, ROM block 0x8f, and big-endian 16-bit register data in command 0xc4.
See the [VGM specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt).

The exported demo plays in VGM Analyzer and renders in tetorica-vgm. The Synth enables spatial PCM. Other callers retain the linear preview by default. Each PCM or ADPCM voice can be muted independently.

## Pan comparison

Select **Files → /songs/tetorica-cps2-pan-comparison.vgm → CH1 → Play VGM**. A 50 ms percussion hit plays at 0.10, 0.60 and 1.10 seconds. CH1 restarts the same generated waveform, rate, phase and volume envelope each time. Its pan register changes from 0x110 to 0x120 to 0x130. Watch Pan in the PCM view or the 0x80 row in Registers. ☰ → Export → Download selected VGM / VGZ exports the selected file with its ROM.

The table gives left/right RMS in signed 16-bit sample units for the first 100 ms of each hit. The preview column uses the exported file in SongTransport at 44.1 kHz, before the output mixer. The reference column uses the same file in libvgm's CTR core, with its default player gain. Compare the balance within each stereo pair.

| CH1 pan | Preview L / R | libvgm CTR L / R |
|---|---:|---:|
| 0x110 · left | 1447 / 1149 | 2884 / 2340 |
| 0x120 · center | 1202 / 827 | 2371 / 1623 |
| 0x130 · right | 1144 / 1449 | 2332 / 2884 |

Standard-mode PCM uses a separate direct and filtered mix per ear. The direct paths delay by 46 and 48 DSP ticks. To estimate the filtered paths, we rendered a generated single-byte impulse at 24038 Hz in CTR, normalized each opposite-ear response to the direct peak, and averaged adjacent groups of three ticks. Nine measured pan positions (0 through 32, step 4) supply gain anchors with linear interpolation. This approximation uses the measured output and runs at the chip tick rate, before browser resampling.

For the left hit the Synth's right output first exceeds the comparison threshold at 0.27 ms and last exceeds it at 53.70 ms. CTR gives 0.29 and 53.74 ms. Thresholds were 4 and 8 signed 16-bit counts respectively to account for the player's gain. Additional checks at pan 7 and 25 included intermediate positions outside the gain anchors. Across five positions the unshifted stereo-channel waveform cosine similarities ranged from 0.962 to 0.997 over 100 ms. These measurements compare software renders. Hardware verification, custom filter/delay register settings and mode 2 remain open. ADPCM and the centered echo return retain their earlier mix.

To reproduce, export `tetorica-cps2-pan-comparison.vgm` (SHA-256 `2a89e645368bb1e17b7934e942e95a94f03f4589e8ea69c073e5270b1f11875f`) and run `vgm2wav --samplerate 44100 --bps 16 --fade 0 tetorica-cps2-pan-comparison.vgm ref.wav`. Check the render log for Core CTR. Each RMS window contains 4410 stereo frames starting at frame 4410, 26460 or 48510. [Reference implementation and revision](https://github.com/ValleyBell/libvgm/blob/c5c03a2c2514d38d2ab7b7e8dbd021af0b8292cb/emu/cores/qsound_ctr.c).

## Remaining work

- Compare generated PCM with an independent renderer, including bank boundaries.
- Extend the standard PCM spatial path to filter selection, programmable delays, mode 2, ADPCM and the echo return. Verify DSP initialization and host timing.

The MAME-derived PCM code uses the [BSD 3-Clause license](../../third_party/mame-qsound/LICENSE).

## PCM waveform editor

Select a PCM channel and hold a keyboard note. The shaded region runs from End minus Loop length to the exclusive End byte. The amber cursor samples the actual channel address at 20 Hz. A zero loop length allows the address to continue past the sample window. End and Loop length are bounded to the selected 256-byte instrument in this editor. Rate is the 4.12 register word for the current note. Editing Rate retunes the keyboard relative to that note. Each channel retains its settings. The controls also follow the selected PCM channel during demo playback.

Below the waveform, Echo send applies to the selected PCM channel. Delay (DSP ticks and milliseconds) and signed Feedback apply to all 16 PCM channels. Drag a value for large changes or use the buttons for single steps. The controls follow VGM writes and retain the captured settings after Stop.

## Editing sample ROMs

Files → /banks contains 0_default.rom (the examples), 1_sample.rom (two PCM waves and three ADPCM hits) and 99_empty.rom. Select the shared ROM in the QSound header or click its file in /banks. **New ROM…** creates an empty, named .bin in Files and opens it for editing. **Import ROM…** adds an existing raw image to the same list. Use **Import → PCM sample (WAV)…** to place PCM in a project ROM, or **ADPCM sample (WAV)…** to append an encoded pad. Choose the resulting preset in PCM or ADPCM.

The 128 slots are a Tetorica editing directory. Each entry describes a byte range in the raw ROM. Import ROM loads raw bytes without guessing sample boundaries. An imported image can be played via ROM bank and address controls; new slots append after its original data. Export cassette preserves the raw images, names, slot directories and voice settings. In the ROM tab, **Preset** lists shared preset items and, during a VGM, distinct ranges configured up to the playback position. These can overlap. A programmed range can belong to a silent voice. The VGM PCM preset picker and newly captured bank presets include ranges observed with nonzero rate and volume during playback. The ROM history also includes silent setups. Playing a VGM automatically adds its current ROM and matching preset JSON to **Files → /banks**. With **Auto apply** off, the ROM and JSON appear with an asterisk. **Save files** or enabling **Auto apply** commits the pair. **Export ROM** includes pending ranges. PCM ranges with the same bank, start, end and loop share one automatic preset across pitch changes. The first nonzero Rate observed becomes its reference rate. Selecting a PCM preset estimates pitch separately at the onset and inside its loop using signed ROM samples at native playback speed (Rate 4096) and the active chip clock. Editing the playback Rate leaves this sample pitch and the suggested C4 rate unchanged. The suggested C4 rate uses the loop estimate when available, then the onset. When the selected preset has Rate zero, the keyboard automatically uses the estimated C4 rate, or 4096 if the pitch is undetermined or outside the register range. Use **Measure pitch** in PCM to measure the current voice, or in ROM to measure the edited item range. Choose **Use C4 rate** beside Loop or Onset to apply that estimate. In ROM, **Save item** stores the edited rate. Unpitched regions can show “undetermined”. A different ROM image gets a separate file. Entries marked **Earlier ROM image** refer to overwritten bytes. Seek back before that ROM write to capture the earlier image.

**Export ROM** beside the ROM selector packages the selected raw `.rom` or `.bin` and its matching `.preset.json` in a ZIP. Extract both files and select them together in **Import ROM…**. The JSON is a Tetorica directory of editable slots and named presets. A PCM preset stores bank, start, exclusive end, raw rate and loop length. An ADPCM preset stores bank, start and exclusive end and plays as a fixed-rate one-shot. In ROM → Preset, **NEW** creates a named shared item from a ROM range. **DEL** beside the item picker removes the selected item. Full bank shows the loaded bytes of the selected bank with the item range highlighted. Drag to select a range or drag either edge to adjust it. Selection zooms to the waveform from Start to End. Adjust Bank, Start and End, and for PCM also Rate and Loop length. **Preview 1 s** plays the edited registers through a separate QSound voice at the project clock. **Save item** updates a named preset or saves a variation of a slot or current range. With Auto apply off, **Save files** commits the edits. Choose a preset in PCM or ADPCM and edit the destination voice. The pair describes sample addressing. The VGM carries sequencing, clock and effects writes.

PCM → **Voice** edits the channel's 64 KiB ROM bank number, start, end, loop and rate. **Registers** shows the applied register words. The bank number selects a region inside the shared ROM file. The two tabs support Left/Right, Home and End while focused.

## Loading saved presets

Choose a destination channel, then select the preset in Files and play C4. Use **Apply preset** when the shared ROM changes or Auto apply is off. Applying a preset while a VGM plays pauses the transport for audition. A matching source, clock and sample bank lets Code keep playing while the selected voice changes. Switching the shared ROM silences held voices and clears queued register schedules. Other channels also address that ROM. Shared echo delay and feedback keep their current settings. A missing song or mismatched bank prevents loading. **☰ → Export → Export cassette** includes presets and songs together. **☰ → Import → Import cassette…** restores them.

### Loading a preset from Code

Play **ADPCM trio**, pause after the first Voice 2 hit, select ADPCM Voice 2 and save its preset as **Hit**. With that ROM still active, run:

```js
await qsound.loadPreset(3, '/presets/Hit.adpcm.json');
liveLoop('hit', async () => {
  qsound.trigger(3);
  await beat(1);
});
```

For a PCM preset, use the same method with a channel from 1–16, then call `qsound.noteOn(3, 60)` to hear its saved C4 rate. The JSON format selects PCM or ADPCM (voices 1–3). When the preset needs another shared ROM, the error names the required source. To switch all voices explicitly, pass `{switchRom: '/songs/tetorica-cps2-adpcm-trio.vgm'}` as the third argument, or `{switchRom: null}` for the project ROM. A different saved bank image from the same song also requires an explicit switch. On a matching ROM, only the destination voice is reconfigured and scheduled accompaniment continues.

## ROM map

Open **ROM → ROM bank map**. Each numbered button represents one 64 KiB bank. The map distinguishes empty and loaded banks and records PCM and ADPCM reads. A raw file supplies all bytes up to its length, including zeros. For a playing VGM, a bank is loaded when a ROM data block supplies bytes in that bank. Select a number to inspect that bank. **Load PCM (WAV)…** converts a WAV to signed mono PCM and opens a placement dialog. Choose the bank and start byte, including a new bank number to grow the ROM. The dialog shows the exclusive end and any existing bytes to be replaced. Loading also creates a shared preset named after the file. With Auto apply off, **Save files** commits the ROM and preset together. Each row plots a distinct range in the selected bank. Voices with the same encoding, start, end and loop share a row. Green shows the PCM sample interval, amber its positive loop window, and blue an ADPCM sample interval. The displayed end address is exclusive. Wrapped intervals appear at both edges. A partial bank expands to fill the plot; hatching marks addresses beyond the loaded ROM if a voice refers to them. A negative PCM loop register is shown numerically.

Select a range to preview its starting 256-byte block. An ADPCM range uses a fresh predictor at the beginning of the block.
Bank register changes redirect reads into another bank. VGM ROM data blocks update the image at their recorded positions. **Export ROM** exports the current image and its preset catalog together. Pause or seek to export a particular version.

Before playback, the map shows the authored instruments. During VGM or Code playback it follows the most recently programmed start/end addresses and bank. A voice remains visible after release. Select its row to preview the block containing its start address in the ROM tab. Pause holds the song position for comparison. To see shared data, load Voice 2’s ADPCM trio preset onto Voice 3. One row then represents both voices at **0x0400–0x0600**, and the **2** and **3** keys trigger the two decoders while the map is open.

## ADPCM pads

A new cassette assigns the original `/samples/cabinet-snare.wav` to PCM CH1 and ADPCM Voice 1. Play C4 on CH1, then play a different note to transpose the snare. Press **1** to hear the same source as a fixed-rate ADPCM one-shot. On an existing cassette, choose **☰ → Import → Add factory demos** and assign the snare to the channels you want to compare.

Select an ADPCM voice and choose its preset. In ADPCM, the Keyboard panel shows three pads. A / S / D and 1 / 2 / 3 trigger voices 1–3, including while Code plays. Return to PCM to play pitched notes. The encoder mixes to mono and resamples at the project clock (about 8.01 kHz). Each pad fits one 64 KiB address bank.

Select Voice 1–3 to edit its start byte, exclusive end byte, ROM bank, signed volume and pan register. Trigger plays the selected voice. Keys 1, 2 and 3 trigger their respective voices independently. Key release leaves a one-shot running. The Sample control loads a generated pulse's bank and address range. Custom synth pad settings are saved with the cassette.

During demos, Code and imported VGMs the controls follow the selected chip voice. Pause a VGM to inspect it. Stop silences playback and retains all three ADPCM configurations and their sample ROM for audition. For example, play ADPCM trio, select Voice 2, press Stop, then Trigger. Edits to this captured configuration last for the audition session. Select another ROM in the ROM picker to change banks.

Select **Voice 2** during ADPCM trio, pause after its first hit, and choose **Save preset…** in the ADPCM tab. Select **Voice 3**, open the saved `.adpcm.json` under Files → /presets, then press **3**. The preset carries its address range, bank, signed level and pan and identifies its source ROM using the same scheme as PCM presets. All three voices and all PCM channels share the resulting ROM.

## Files and Auto apply

Right-click a file (or use Shift+F10) to open/apply, duplicate, rename or delete it. Renaming a VGM updates the presets that refer to it. Files displays the source and bank for the selected preset. A change to another song’s shared ROM always uses **Apply preset**. Auto apply opens same-source presets on selection and saves edits to JavaScript and the connected preset. With Auto apply off, changed files show an asterisk; **Save files** commits those edits to the cassette. Run and Apply execute the saved JavaScript. The browser draft retains pending edits across reloads.

The transport opens the factory PCM duet on a fresh visit. Select a different demo or imported VGM in Files to use Play VGM, Pause, Stop VGM and, for files with a loop point, Loop. **☰ → Import → Add factory demos** adds missing demos to an older cassette. **☰ → Export → Download selected VGM / VGZ** preserves individual downloads.

## Live coding

In the ADPCM tab, select Voice 2 and press **2** to follow the one-shot cursor. Shorten **End (exclusive)** and trigger again to hear the edited range. The waveform shows the decoded voice at its configured volume, scaled to fit the display. The caption gives its byte count and duration at the current chip clock.

Open Code and press Run to play the CH1 bass loop. Select CH2 and play the fretboard over the bass, or use 1–3 for ADPCM. Click outside the editor to use the musical keys. Select CH1 to watch its PCM and echo settings. Edit the notes or the echo send and press Apply to update the named loop. Stop ends the loops and keeps the instruments available for audition. Ctrl/Cmd+Enter runs the source; Ctrl/Cmd+Shift+Enter applies it.

Open **Files → /examples/preset-jam.js → Run** for a PCM bass on CH1 and an ADPCM backbeat on Voice 2. Change `round-bass` to `bright-bass` in the preset path and press **Apply**. The two basses loop different waveforms in the same factory ROM. The drum keeps its beat, and PCM CH3 is free for the keyboard. Existing cassettes can add the example and its three presets through **☰ → Import → Add factory demos**. If auditioning a song ROM, select the factory ROM in the ROM picker first.

Open **Files → /examples/sample-duet.js → Run** to play the bundled original `/samples/cabinet-pluck.wav`. CH1 loops the last 64 bytes of its first 256 bytes for the bass. CH2 uses all 2,048 bytes for the melody. Select the shared sample bank in ROM to see both intervals. Edit a note or loop length and press **Apply** while the duet plays.

Open **/examples/filter-groove.js → Run** for a bass and snare through a stereo low-pass filter. Change `cutoffHz` and press Apply, or set `bypass = true` and Apply to hear the dry groove. PCM CH3 keyboard notes pass through the same filter. The QSound chip mix (including its echo) feeds named Code effects, then Master and the output visualizer. Code Stop clears the effects and their DSP state.

Use `liveFx(name, {context, process(input, output, state, context) { … }})` to process stereo frames. Each synchronous callback runs in the AudioWorklet with its own persistent state and access to the audio output's `sampleRate`. Apply keeps state for the same name unless `resetState: true` is set. Omitting a declaration on a successful Apply removes that effect. `fx.updateContext(name, values)` changes parameters during playback.

Open **/examples/scheduled-bar.js → Run** to schedule one bar of PCM bass and ADPCM backbeats. Select PCM CH3 to play along. Edit the example’s `bpm` and press Apply to replace the named reservation at the new tempo. Both instruments use one AudioWorklet frame clock.

- `qsound.build(b => { … }, {referenceSampleRate: 48000})` records synchronously. Use `b.atSeconds(t)` or `b.atSample(n)` in nondecreasing order. Writes at one offset execute in recorded order on the same output frame.
- `b.noteOn(channel, midi, sample, pan?, volume?)` takes an explicit factory sample (0 or 1) or project WAV path. `b.noteOff(channel)`, `b.trigger(voice)` and `b.writeRegister(register, word)` are also available. Prepare an imported ADPCM pad with `await qsound.assignPad(voice, path)` before scheduling.
- `await qsound.compile(plan)` returns the register trace without playing it. `await qsound.schedule(plan, {name, repeatSeconds})` resolves on acceptance. Omit the repeat interval for a one-shot. Use `await qsound.clearSchedule(name)` to cancel a reservation. Code Stop clears repeating and pending writes. Register offsets and repeat intervals are in seconds; the example converts its tempo to seconds when building the bar.

Open **/examples/pad-groove.js → Run** for a bass on PCM CH1 and a backbeat on ADPCM Voice 2. Choose PCM CH3 and play along on the keyboard. Assign the factory snare slot with `await qsound.assignPad(2, '/samples/cabinet-snare.wav')` before the loop, then use `qsound.trigger(2)` on each hit. The default ROM already contains the encoded ADPCM slot. Other voices reuse that ROM range with independent pan and volume. Code changes the current audition voice.

Use `qsound.assignSample(channel, path, {offset, length, loop})` before a two-argument `qsound.noteOn(channel, midi)`. Channel numbers start at 1. All three options are optional and use ROM bytes. Offset is relative to the clip, length defaults to the remaining clip, and loop defaults to length. C4 uses the imported rate. The API controls the current audition session and reads the project's shared ROM. After playing a song with its own ROM, select the ROM containing those samples in the ROM picker.

With a captured instrument, `qsound.noteOn(1,60)` plays CH1 at its reference rate and `qsound.trigger(2)` retriggers the captured ADPCM voice 2. Passing a sample index explicitly addresses the generated pulse or waveform offsets in the current ROM. Starting Code during VGM playback pauses the song first. Switching Synth / Code leaves the performance running.

The editor uses the shared Synth Monaco integration with QSound declarations and a textarea fallback. Code runs in a dedicated worker using the Playground loop runtime. The Keyboard option **PCM note-off fade (8 ms)** is enabled by default and saved with the cassette. Releasing a PCM keyboard key or calling `qsound.noteOff(channel)` fades that voice to zero. Use `qsound.keyOff(channel)` for an immediate cut. Scheduled notes support the same distinction with `b.noteOff(channel)` and `b.keyOff(channel)`. Raw volume writes and imported VGM commands take effect immediately.

PCM channels are numbered 1–16, ADPCM voices 1–3, and sample indices start at zero. Use `qsound.noteOn(channel, midi, sample?, pan?, volume?)`, `qsound.noteOff(channel)`, `qsound.trigger(voice, sample?, pan?, volume?)`, or `qsound.writeRegister(register, word)` for raw 8-bit addresses and unsigned 16-bit words. Open Files in the Code tab to switch between `/index.js` and `/examples/pad-loop.js`, or choose New script to create another performance. Edits are saved as a local browser draft.

☰ → Export → Export cassette downloads a ZIP with all scripts, the selected file and PCM channel, the 16 PCM settings, the shared echo and the three pad assignments. Import cassette restores the project; press Run to play its selected script. New cassette restores the factory files and settings. The generated factory ROM is shared by all projects.

## VGM playback

In ☰ → Import, choose **VGM / VGZ…**. Select a song under `/songs` and use the transport above the PCM channels. The position bar shows elapsed time, first-pass duration, and a marker at the loop start. Release the slider to seek. Left/Right moves one second and Shift+Left/Right moves ten. Seeking from Stop or Pause leaves the song paused for inspection; seeking during playback resumes at the new position. A worker reconstructs the file’s register writes, PCM phase, ADPCM state and echo history with the current mix. Manual register edits from earlier playback are not replayed. Pause freezes the chip and song position. Select different channels to see their ROM waveforms, addresses, loops and echo sends while paused or playing. The song supplies its own sample ROM. During Pause the keyboard and Code use a separate audition chip sharing the current ROM. C4 (MIDI 60) retriggers the captured address at the captured rate, and the other note keys transpose from it. A released channel can reuse its last nonzero level. If the captured Rate is zero, keyboard audition uses 4096 at C4. A voice still needs sample data and an audible level. Resume continues the untouched song, including its PCM phase, ADPCM decoding and effect history. Stop retains the audition edits, ROM, bank, loop, pan and echo settings for further playing. These captured instruments are session-local. AUTO follows the selected VGM channel until you play a note or edit the AUTO voice. Imported VGM/VGZ bytes and the selected song travel in the cassette alongside your scripts. Local drafts use IndexedDB and can read earlier browser drafts.

Playback supports a single QSound stream with embedded 0x8F ROM blocks, 0xC4 writes and standard waits. The existing PCM, ADPCM and echo preview applies. Turn on Loop to repeat from the file’s loop command offset. It is available only when the offset points to a command followed by playback time. All four factory VGMs loop from their first musical command. The initial PCM duet plays on CH1 and CH2. Choose either channel in PCM and click **Save preset…** to capture its voice in Files. For a song with an intro before the loop, the intro plays once. Turning Loop off lets the current pass finish. Standard-mode PCM uses the spatial approximation described above.

## Sharing demo cassettes

☰ → Export → **Download factory demos** builds a project from the factory scripts, the default instrument settings and the generated demo VGMs. Each VGM contains the PCM and ADPCM sample bytes synthesized by `demoRom()`. This download is independent of the currently open project.

**Export cassette** includes all songs in the current Files tree, including their embedded sample data. The menu shows the song count. When sharing that ZIP, check redistribution permission for both the music and the samples in any imported song.

## Mixer

Open Mixer for master gain (0–380%) and independent Mute and Solo buttons on PCM CH1–16 and ADPCM 1–3. Solos can be combined. Mute takes priority on a soloed voice. Muting stops the voice's dry output and new echo input while playback advances and the shared echo tail decays. Master gain affects the whole stereo output. The keyboard, pads, Code, demos and imported VGMs share these controls. The local draft and project cassette retain the mix.

## Output

Switch between Waveform (amplitude over time) and Spectrum (level by frequency) above the Mixer. Both show the shared stereo output downmixed for display after voice mute/solo and Master gain. The PCM channel waveform below shows the selected sample ROM data. The output display refreshes at up to 30 Hz while visible.
