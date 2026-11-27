# Tetorica CPS2 Synth · PCM preview

Serve the repository's docs directory over localhost or HTTPS and open
`/synth-cps2/`. Select CH1–16, then hold A S D F G H J K or a screen key.
Pitch follows the key. The sample selector can switch the held note; volume
and pan can change during a held note. Play demo and Download demo VGM use
the selected score and generated ROM. PCM duet uses two pitched PCM channels. ADPCM trio triggers three one-shot samples, panned left, center and right.

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
| 0x80–0x8f | Per-channel pan. The preview uses a linear dry mix across 0x110–0x130. |

For ADPCM voice index `i` (0–2), the four registers at `0xca + 4*i` set the start byte, exclusive end byte, bank and signed volume. Write a nonzero word to `0xd6 + i` to trigger the sample. The voice latches volume at the start of the next high nibble. Pan uses `0x90 + i`. Each voice decodes one nibble every third DSP tick, high nibble first. The decoder follows MAME HLE and the step coefficients in [libvgm](https://github.com/ValleyBell/libvgm/blob/master/emu/cores/qsound_ctr.c).

PCM echo comparison plays a short note twice. The second note feeds a shared delay line for an audible tail. Registers `0xba–0xc9` set each PCM voice’s signed send, `0x93` controls signed feedback, and `0xd9` sets the delay end. Subtract the mode base (0x554 or 0x53c) for the delay in DSP ticks, up to 1024. ADPCM has no send register. Muting a PCM voice stops new input while the existing tail decays. The line and its two-sample average follow MAME HLE. The preview centers the return and applies mode requests immediately. Spatial filtering and DSP state timing remain approximate.

The DSP sample rate is 60 MHz / 2 / 1248. The audio worklet holds each sample
until the next DSP tick. The VGM export uses the conventional 4 MHz QSound
header, ROM block 0x8f, and big-endian 16-bit register data in command 0xc4.
See the [VGM specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt).

The exported demo plays in VGM Analyzer and renders in tetorica-vgm with the same PCM and ADPCM core. Each PCM or ADPCM voice can be muted independently.

## Remaining work

- Compare generated PCM with an independent renderer, including bank boundaries.
- Implement spatial pan/filter tables, stereo output delays, DSP initialization and host timing. Dry panning is an approximation.
- Extend the code-file workspace with editable sample ROMs and sound presets.

The MAME-derived PCM code uses the [BSD 3-Clause license](../../third_party/mame-qsound/LICENSE).

## PCM waveform editor

Select a PCM channel and hold a keyboard note. The shaded region runs from End minus Loop length to the exclusive End byte. The amber cursor samples the actual channel address at 20 Hz. A zero loop length allows the address to continue past the sample window. End and Loop length are bounded to the selected 256-byte instrument in this editor. Rate is the 4.12 register word for the current note. Editing Rate retunes the keyboard relative to that note. Each channel retains its settings. The controls also follow the selected PCM channel during demo playback.

Below the waveform, Echo send applies to the selected PCM channel. Delay (DSP ticks and milliseconds) and signed Feedback apply to all 16 PCM channels. Drag a value for large changes or use the buttons for single steps. The controls follow demo writes and return to the keyboard settings after playback.

## ADPCM pads

Keys 1, 2 and 3 and the matching on-screen pads trigger ADPCM voices 1–3. Each pad can use any of the three generated pulse samples. Trigger several pads together, or retrigger one while the other voices finish. Key release leaves the one-shot running to its end address. Sample and volume take effect on the next trigger. Pan also works during playback. The A–K note keys continue to play the selected PCM channel.

## Live coding

Open Code and press Run to play the CH1 bass loop. Select CH2 and play A–K over the bass, or use 1–3 for ADPCM. Click outside the editor to use the musical keys. Select CH1 to watch its PCM and echo settings. Edit the notes or the echo send and press Apply to update the named loop. Stop resets playback on the shared chip. Ctrl/Cmd+Enter runs the source; Ctrl/Cmd+Shift+Enter applies it.

The editor uses the shared Synth Monaco integration with QSound declarations and a textarea fallback. Code runs in a dedicated worker using the Playground loop runtime. PCM channels are numbered 1–16, ADPCM voices 1–3, and sample indices start at zero. Use `qsound.noteOn(channel, midi, sample?, pan?, volume?)`, `qsound.noteOff(channel)`, `qsound.trigger(voice, sample?, pan?, volume?)`, or `qsound.writeRegister(register, word)` for raw 8-bit addresses and unsigned 16-bit words. Open Files in the Code tab to switch between `/index.js` and `/examples/pad-loop.js`, or choose New script to create another performance. Edits are saved as a local browser draft.

Files → Cassette → Export cassette downloads a ZIP with all scripts, the selected file and PCM channel, the 16 PCM settings, the shared echo and the three pad assignments. Import cassette restores the project; press Run to play its selected script. New cassette restores the factory files and settings. The generated factory ROM is shared by all projects.

## VGM playback

In Code → Files, choose **Import VGM / VGZ…**. Select a song under `/songs` and use the transport above the PCM channels. The position bar shows elapsed time, first-pass duration, and a marker at the loop start. Release the slider to seek. Left/Right moves one second and Shift+Left/Right moves ten. Seeking from Stop or Pause leaves the song paused for inspection; seeking during playback resumes at the new position. A worker reconstructs the file’s register writes, PCM phase, ADPCM state and echo history with the current mix. Manual register edits from earlier playback are not replayed. Pause freezes the chip and song position. Select different channels to see their ROM waveforms, addresses, loops and echo sends while paused or playing. The song supplies its own sample ROM. Stop restores the keyboard instruments. Imported VGM/VGZ bytes and the selected song travel in the cassette alongside your scripts. Local drafts use IndexedDB and can read earlier browser drafts.

Playback supports a single QSound stream with embedded 0x8F ROM blocks, 0xC4 writes and standard waits. The existing PCM, ADPCM and echo preview applies. Turn on Loop to repeat from the file’s loop command offset. It is available only when the offset points to a command followed by playback time. The intro plays once. Turning Loop off lets the current pass finish. Spatial filtering remains future work.

## Sharing demo cassettes

Files → Cassette → **Download factory demos** builds a project from the factory scripts, the default instrument settings and the three generated demo VGMs. Each VGM contains the PCM and ADPCM sample bytes synthesized by `demoRom()`. This download is independent of the currently open project.

**Export cassette** includes all songs in the current Files tree, including their embedded sample data. The menu shows the song count. When sharing that ZIP, check redistribution permission for both the music and the samples in any imported song.

## Mixer

Open Mixer for master gain (0–380%) and independent Mute and Solo buttons on PCM CH1–16 and ADPCM 1–3. Solos can be combined. Mute takes priority on a soloed voice. Muting stops the voice's dry output and new echo input while playback advances and the shared echo tail decays. Master gain affects the whole stereo output. The keyboard, pads, Code, demos and imported VGMs share these controls. The local draft and project cassette retain the mix.

## Output

Switch between Waveform (amplitude over time) and Spectrum (level by frequency) above the Mixer. Both show the shared stereo output downmixed for display after voice mute/solo and Master gain. The PCM channel waveform below shows the selected sample ROM data. The output display refreshes at up to 30 Hz while visible.
