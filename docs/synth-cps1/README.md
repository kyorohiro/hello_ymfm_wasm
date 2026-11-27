# Tetorica CPS1 Synth

Open `synth-cps1/index.html` from the docs HTTP server. Choose a YM2151 channel and play the guitar keyboard. The first note starts browser audio automatically. **Start audio** enables it in advance. A held note responds to operator edits. The central operator value supports horizontal dragging. Each operator row uses the Playground editor's logical M1, M2, C1, C2 order. The generated JavaScript uses the existing OPM client's register order M1, C1, M2, C2.

The browser combines the existing ymfm-backed YM2151 worklet and Tetorica's OKIM6295 renderer. The latter uses the BSD-3-Clause MAME/libvgm adaptation credited in [the core](../js/okim6295audioengine.js). This first configuration uses a 3,579,545 Hz OPM and 1 MHz OKI with pin 7 high. The two sources feed a common output with separate left/right FM routing for inspection. The original board's analog mix and per-game clock settings are outside this first version. [MAME CPS-1 machine configurations](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1.cpp)

MSM6295 reads an OKI sample table and ADPCM bytes from ROM. The built-in percussion is original. Import accepts one raw bank up to 256 KiB. Choose the sample, attenuation and voice, then compare the command bytes and busy bits. A start sent to a busy voice follows the existing chip behavior. Stop the voice before retriggering it.

The MSM6295 panel shows the selected sample’s inclusive ROM range, duration and decoded waveform. Mute silences one voice while its decoder and busy bit continue normally. For example, `oki.setVoiceMuted(0,true)` mutes Voice 1 and `oki.setVoiceMuted(0,false)` restores its current output.

The Code tab uses the shared Monaco JavaScript editor. Type `opm.` or `oki.` to see chip methods. The editor loads from the same CDN as FM2612 Synth and falls back to a textarea when unavailable. A new cassette starts with a named `liveLoop` in /index.js. Run starts the riff, Apply replaces its callback at the next cycle, and Stop releases the chips. Use Ctrl/Cmd+Enter for Run and Ctrl/Cmd+Shift+Enter for Apply.

Code runs in a dedicated worker. `opm` and `oki` share the instruments used by the panels. JavaScript uses zero-based channels and voices. For example, `oki.play(1, 2, 4)` plays sample 2 on voice 1 at attenuation 4. `oki.write(0x10)` stops that voice. Stop interrupts the running script and releases both chips. The edited script is saved in this browser.

Files lists the eight current channel voices, saved FM presets, sample banks and imported VGM songs. Export Cassette saves those files with the current code and global LFO/noise settings in a Tetorica cassette ZIP. Import restores the project without running its code. The browser keeps a local project draft. Right-click a file or folder (or use Shift+F10) to duplicate, rename, delete, or create an instrument, script or folder. Drag to move, or hold Option/Ctrl while dropping to copy. Drop supported music, ROM, voice and JavaScript files into a folder to import them. Undo files restores the previous file operation. With Auto apply off, Save or Discard the selected file’s edits. Save all accepts every pending edit.

**Output → Waveform / Spectrum** switches between the mixed signal in time and its frequency spectrum while playing.

### Load an Analyzer OPM voice

In Analyzer’s Instrument tab, export the selected YM2151 voice as an `.opm` file. In the Synth, select the destination channel under YM2151, then use **☰ → Import → OPM voice…**. The first voice is applied immediately. For a text bank, choose another **OPM voice** in Files. The keyboard uses the imported SLOT mask. Code may override it with an explicit `opm.keyOn(ch, mask)`.

**Apply shared LFO / CH8 noise** applies the selected OPM voice’s global settings. Import leaves the running LFO and noise settings intact. Cassette retains the imported OPM texts and channel masks. The source clock, note pitch and playback position are not restored by voice import.

### Use Files presets from Code

With `brass.opm` in Files under `/presets`, run:

```js
opm.loadVoice(0, '/presets/brass.opm');
opm.noteOn(0, 'C4');
await sleep(0.5);
opm.keyOff(0);
```

The first argument is the zero-based YM2151 channel. For a bank pass a third argument to select a voice by its zero-based position in the file. Loading applies the channel patch and operator mask. Shared LFO and noise settings remain under the Files control above.

**☰ → Export → Presets (.opm) · ZIP** downloads the channel and saved instrument files as individual OPM voices alongside the original imported OPM banks. Converted voices snapshot the current shared LFO and noise rate. Only a CH8 snapshot enables noise. Cassette continues to store channel and instrument files as JSON.

### Compare OPM algorithms

Open **Files → /examples/opm-algorithms.js**, select **Run**, then open **YM2151 → CH1**. The example sets CH1’s voice and plays four A3 notes. In Algorithm 7, listen to OP4 alone and then to OP3 adding an octave. Algorithm 4 repeats the same two key masks, this time with OP3 modulating OP4. During the final eight-second note, raise OP3 TL toward 127 to reduce modulation. To repeat this by hand, switch off OP1 and OP2 in the Key column, leave OP4 on, and toggle OP3 between key presses.

### Play Round Start

Choose **Restore default bank** on the MSM6295 tab, open **Files → /examples/round-start.js**, then select **Run**. The 8-bar score lasts about 16 seconds. CH1 plays bass, CH2 and CH3 trade brass phrases, and OKI voices 1–3 play kick, snare and closed hat. Select CH4 on the YM2151 panel to play along on the guitar keyboard. During bars 3 and 7, select CH1 and drag OP1 TL to hear the sustained bass change. Use MSM6295 Voice 2 Mute to drop the snare.

The example programs the FM voices on CH1–3. Export a cassette first if you want to keep their current patches. The Code file selector switches between both examples and your own `/index.js`. Each keeps its own edits in the browser, and all three are included in a cassette export.

Open the **Mixer** tab to adjust the two chips independently (0–380%) before Master. Mute silences the whole chip. The CH and Voice buttons show which channels are on. Switching a channel off leaves its sound engine running, so switching it back on reveals the current point in the note or sample. MSM6295 voice switches also follow the PCM panel and Code.

**Synth** keeps the selected chip above a separate Keyboard / Code panel. **Code** opens a larger editor and puts the chips and Keyboard in the same tab row. Switching views keeps the current script, audio and keyboard channel. The computer keyboard plays the selected FM channel while the on-screen keyboard is hidden. Focus the editor to type code.

**☰ → New → Cassette · ZIP** stops playback and starts again with the eight factory FM voices, original percussion kit and all three bundled scripts. Export Cassette first to keep the current project. The confirmation can be cancelled to continue editing.

Use **Load preset…** on the YM2151 tab to copy a Files instrument, an individual OPM bank voice, or another channel’s patch onto the selected channel. The shared LFO and noise settings stay under the separate Files control.

The FM keyboard uses the FM2612 fretboard controls. Select Guitar, Bass or Ukulele, the Open, 5th or 12th fret, and a window of four strings. Left/right arrows move by one fret and up/down arrows select the next string window. The octave offset applies to new notes. The MSM6295 keyboard uses its four fixed voice pads.

The YM2151 tab and the keyboard share **AUTO / CH1–CH8**. AUTO copies the current editor sound to successive idle physical channels as you play chords. If all eight are busy it can reuse the oldest AUTO key. Selecting a CH targets that physical voice. Algorithm, Feedback, AMS/PMS, operator and LFO values use the same minus / drag / plus controls as the FM2612 Synth. Pan and other switches toggle directly. Use − / + or drag the Octave value horizontally to transpose new notes by up to two octaves in either direction. Held keys release on the channel where they started.

**Files** beside the mode buttons opens the shared cassette file tree on the left (above the panels on narrow screens). **☰ → Import → VGM / VGZ…** adds a song to this cassette. Select it in the VGM playback bar above Output and use **Play**, **Pause / Resume** or **Stop**. Playback runs one pass on separate YM2151 / MSM6295 instances using the file clocks, embedded OKI ROM blocks and the shared Mixer. Play automatically switches the YM2151 and MSM6295 panels to the chips in the song. Select a channel to follow or edit its FM settings while playing or paused. Edits go to the playback chip. Later writes by the song can replace the same register. During Code playback, changing a PCM voice assignment or attenuation overrides subsequent script starts for that run. The display refreshes up to eight times per second. Stop and natural completion keep the displayed FM patches, the selected channel, and the current standalone PCM bank and voice assignments for keyboard use. The computer and on-screen keyboards can play along during VGM playback or pause. Keyboard notes use independent voices with the selected channel’s current FM patch or the selected PCM voice’s sample, through the same Mixer. During Code playback the keyboard and script share the synth channels. In Code mode the keyboard follows the most recently selected chip, including on the Code tab. Focus the editor to type. Dual chips, QSound and other sound-chip commands are outside this player.

**Hit · Voice 4** on the guitar keyboard plays the original kit’s arcade impact while Round Start uses voices 1–3. Its light follows the actual busy bit, including during mute. Older or imported banks without the arcade hit disable this pad.

Pause freezes both VGM chips at an audio block boundary. For YM2151 tracks, select a source channel to inspect its four operators. The channel indicator shows the last key-on state. **Copy to → Use voice** copies the channel patch and the last nonzero operator mask to the live keyboard channel you choose. The LFO and CH8 noise controls show the song’s global register settings. Resume continues from the paused frame.

YM2151 keeps its channel selectors above four equal-height pages. Voice, LFO and Registers use the selected keyboard channel or AUTO. Noise appears for AUTO and CH8. While that page is open, new keyboard notes go to CH8, where the noise generator replaces OP4 when enabled. Leaving Noise restores the previous keyboard target. Voice shows Algorithm, Feedback and all four operator rows together for editing while a keyboard note sounds. The Key button in each operator row selects that operator for the next keyboard or audition note. Register 0x08 uses bits 3–6 for OP1–OP4 and bits 0–2 for the channel. A held note keeps its current key state when you edit the selection. Presets and cassettes store the selected mask. Expand **Envelope** above Algorithm in the Voice tab and select OP1–OP4 to edit one of the four colored guides. Drag points horizontally for AR, D1R, D2R or RR. Drag the attack and decay points vertically for TL and D1L. The plot and the operator table edit the same registers, including while a key is held. Curves show relative time and level. Pitch / gate and Audition also open from Voice. Registers shows 32 bytes at a time, with the channel JavaScript available alongside the range selector.

During VGM playback the MSM6295 tab uses the same ROM selector, slot grid, waveform and four voice rows. Select a slot to inspect the extracted ROM. The voice rows show the last accepted sample and busy state. Hover over a voice for its last request and attenuation. Pause and select a voice’s last played sample to preview its audio through the PCM mixer. Changing Attenuation overrides the low nibble of subsequent MSM6295 start commands and applies to the next paused preview. Use VGM attenuation returns control to the song. While playing or paused, change a voice’s sample number or select Follow to use the current grid slot. The next start on that voice uses the assignment. Use VGM samples restores the song’s assignments.

In the MSM6295 tab, computer and on-screen keys trigger the selected sample at its original chip pitch and current attenuation. F triggers Voice 1, G triggers Voice 2, H triggers Voice 3 and J triggers Voice 4, matching the first four pads in FM2608 Rhythm and FM2610 ADPCM-A. The four on-screen pads use the same mapping. Reusing a voice restarts it, and releasing a key lets the sample finish.

**Import WAV / FLAC…** accepts one or more clips and builds a new sample bank in selection order. The browser mixes the audio to mono, resamples it to the kit’s playback rate (about 7.58 kHz), and encodes it as MSM6295 ADPCM. The bank fits up to 128 samples and 256 KiB including the address table. Export Cassette includes the playable bank and sample names.

Each Voice has a numeric sample control. Follow uses the selected grid slot. Use the ROM list to choose a bank or Import ROM to add one. Load a phrase into a numbered slot inside the ROM editor, then assign that number to a Voice below the editor. Keyboard triggers use these assignments. JavaScript commands still specify the sample number directly.

Compare the sample count in the bank with the live playing-voice count. The voice rows retain the last accepted sample after it ends. The range under the waveform shows where the selected phrase begins and ends in ROM.

New banks assign the first four playable sample IDs to Voices 1–4. Extra voices follow the Sample selector when fewer than four phrases are present. Select a number in the 16 × 8 grid or drag the Sample slot value. Filled cells contain playable PCM. Load writes WAV or FLAC to the selected number. Del clears that entry and releases its space for reuse. The capacity display counts the reserved table and distinct sample bytes. The Voice number controls assign slots independently. Replacing a slot changes the phrase for every Voice and script referring to that ID. Undo files restores the previous bank.

The [OKI datasheet](https://consolemods.org/wiki/images/1/1b/MSM6295.pdf) documents phrase numbers 1–127 and reserves zero. Tetorica also plays slot 0 for existing kits and cassettes. Numbered imports edit the virtual ROM image. External bank switching depends on the board wiring. For example, [MAME’s CPS1 bootleg PIC driver](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1bl_pic.cpp) maps a banked window at 0x38000–0x3FFFF. Selecting a bank file in this Synth loads a whole image.

New cassettes start with three banks under /banks. 0_default.rom contains the percussion used by the examples. 1_sample.rom contains four synthesized arcade cues in slots 1–4. 99_empty.rom starts with an empty phrase table for importing your own audio.

Importing a supported VGM or VGZ extracts complete samples into editable banks under Files → banks. The importer examines each populated 256 KiB window of the final ROM image, even when the declared ROM is larger. For sparse windows it requires a supplied table entry and the full phrase at or above 0x400. Each standalone window with usable data gets its own ROM. A track saved by an earlier version is checked the next time it plays. NMK mappings that assemble a phrase across physical windows are supported by playback and paused preview, but do not produce a standalone bank through this extractor.
