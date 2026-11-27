# Tetorica CPS1 Synth

Open `synth-cps1/index.html` from the docs HTTP server. Click **Start audio**, choose a YM2151 channel and play the guitar keyboard. A held note responds to operator edits. The central operator value supports horizontal dragging. Each operator row uses the Playground editor's logical M1, M2, C1, C2 order. The generated JavaScript uses the existing OPM client's register order M1, C1, M2, C2.

The browser combines the existing ymfm-backed YM2151 worklet and Tetorica's OKIM6295 renderer. The latter uses the BSD-3-Clause MAME/libvgm adaptation credited in [the core](../js/okim6295audioengine.js). This first configuration uses a 3,579,545 Hz OPM and 1 MHz OKI with pin 7 high. The two sources feed a common output with separate left/right FM routing for inspection. The original board's analog mix and per-game clock settings are outside this first version. [MAME CPS-1 machine configurations](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1.cpp)

MSM6295 reads an OKI sample table and ADPCM bytes from ROM. The built-in percussion is original. Import accepts one raw bank up to 256 KiB. Choose the sample, attenuation and voice, then compare the command bytes and busy bits. A start sent to a busy voice follows the existing chip behavior. Stop the voice before retriggering it.

The MSM6295 panel shows the selected sample’s inclusive ROM range, duration and decoded waveform. Mute silences one voice while its decoder and busy bit continue normally. For example, `oki.setVoiceMuted(0,true)` mutes Voice 1 and `oki.setVoiceMuted(0,false)` restores its current output.

Code runs in a dedicated worker. `opm` and `oki` share the instruments used by the panels. JavaScript uses zero-based channels and voices. For example, `oki.play(1, 2, 4)` plays sample 2 on voice 1 at attenuation 4. `oki.write(0x10)` stops that voice. Stop interrupts the running script and releases both chips. The edited script is saved in this browser.

Files lists the eight current channel voices, saved FM presets, sample banks and imported VGM songs. Export Cassette saves those files with the current code and global LFO/noise settings in a Tetorica cassette ZIP. Import restores the project without running its code. The browser keeps a local project draft. Right-click a file or folder (or use Shift+F10) to duplicate, rename, delete, or create an instrument, script or folder. Drag to move, or hold Option/Ctrl while dropping to copy. Drop supported music, ROM, voice and JavaScript files into a folder to import them. Undo files restores the previous file operation. With Auto apply off, Save or Discard the selected file’s edits. Save all accepts every pending edit.

**Output → Waveform / Spectrum** switches between the mixed signal in time and its frequency spectrum while playing.

### Load an Analyzer OPM voice

In Analyzer’s Instrument tab, export the selected YM2151 voice as an `.opm` file. In the Synth, select the destination channel under YM2151, then use **☰ → Import → OPM voice…**. The first voice is applied immediately. For a text bank, choose another **OPM voice** in Files. The keyboard uses the imported SLOT mask. Code may override it with an explicit `opm.keyOn(ch, mask)`.

**Apply shared LFO / CH8 noise** applies the selected OPM voice’s global settings. Import leaves the running LFO and noise settings intact. Cassette retains the imported OPM texts and channel masks. The source clock, note pitch and playback position are not restored by voice import.

### Compare OPM algorithms

Open **Files → /examples/opm-algorithms.js**, select **Run**, then open **YM2151 → CH1**. The example sets CH1’s voice and plays four A3 notes. In Algorithm 7, listen to OP4 alone and then to OP3 adding an octave. Algorithm 4 repeats the same two key masks, this time with OP3 modulating OP4. During the final eight-second note, raise OP3 TL toward 127 to reduce modulation. To repeat this by hand, switch off OP1 and OP2 in the Key column, leave OP4 on, and toggle OP3 between key presses.

### Play Round Start

Choose **Use original kit** on the MSM6295 tab, open **Files → /examples/round-start.js**, then select **Run**. The 8-bar score lasts about 16 seconds. CH1 plays bass, CH2 and CH3 trade brass phrases, and OKI voices 1–3 play kick, snare and closed hat. Select CH4 on the YM2151 panel to play along on the guitar keyboard. During bars 3 and 7, select CH1 and drag OP1 TL to hear the sustained bass change. Use MSM6295 Voice 2 Mute to drop the snare.

The example programs the FM voices on CH1–3. Export a cassette first if you want to keep their current patches. The Code file selector switches between both examples and your own `/index.js`. Each keeps its own edits in the browser, and all three are included in a cassette export.

Open the **Mixer** tab to adjust the two chips independently (0–380%) before Master. Mute silences the whole chip. The CH and Voice buttons show which channels are on. Switching a channel off leaves its sound engine running, so switching it back on reveals the current point in the note or sample. MSM6295 voice switches also follow the PCM panel and Code.

**Synth** keeps the selected chip above a separate Keyboard / Code panel. **Code** opens a larger editor and puts the chips and Keyboard in the same tab row. Switching views keeps the current script, audio and keyboard channel. The computer keyboard plays the selected FM channel while the on-screen keyboard is hidden. Focus the editor to type code.

**☰ → New → Cassette · ZIP** stops playback and starts again with the eight factory FM voices, original percussion kit and all three bundled scripts. Export Cassette first to keep the current project. The confirmation can be cancelled to continue editing.

The YM2151 tab and the keyboard share **AUTO / CH1–CH8**. AUTO copies the current editor sound to successive idle physical channels as you play chords. If all eight are busy it can reuse the oldest AUTO key. Selecting a CH targets that physical voice. Algorithm, Feedback, AMS/PMS, operator and LFO values use the same minus / drag / plus controls as the FM2612 Synth. Pan and other switches toggle directly. Use − / + or drag the Octave value horizontally to transpose new notes by up to two octaves in either direction. Held keys release on the channel where they started.

**Files** beside the mode buttons opens the shared cassette file tree on the left (above the panels on narrow screens). **☰ → Import → VGM / VGZ…** adds a song to this cassette. Select it in the VGM playback bar above Output and use **Play**, **Pause / Resume** or **Stop**. Playback runs one pass on separate YM2151 / MSM6295 instances using the file clocks, embedded OKI ROM blocks and the shared Mixer. The chip editors continue to show the live instruments. Dual chips, QSound and other sound-chip commands are outside this player.

**Hit · Voice 4** on the guitar keyboard plays the original kit’s arcade impact while Round Start uses voices 1–3. Its light follows the actual busy bit, including during mute. Older or imported banks without the arcade hit disable this pad.

Pause freezes both VGM chips at an audio block boundary. For YM2151 tracks, select a source channel to inspect its four operators. The channel indicator shows the last key-on state. **Copy to → Use voice** copies the channel patch and the last nonzero operator mask to the live keyboard channel you choose. Global LFO and CH8 noise settings remain shared live-chip controls. Resume continues from the paused frame.

YM2151 keeps its channel selectors above three equal-height pages: Voice, LFO / Noise and Registers. Voice shows Algorithm, Feedback and all four operator rows together for editing while a keyboard note sounds. The Key button in each operator row selects that operator for the next keyboard or audition note. Register 0x08 uses bits 3–6 for OP1–OP4 and bits 0–2 for the channel. A held note keeps its current key state when you edit the selection. Presets and cassettes store the selected mask. In **Voice → Envelope**, select OP1–OP4 to edit one of the four colored guides. Drag points horizontally for AR, D1R, D2R or RR. Drag the attack and decay points vertically for TL and D1L. The plot and the operator table edit the same registers, including while a key is held. Curves show relative time and level. Pitch / gate and Audition also open from Voice. Registers shows 32 bytes at a time, with the channel JavaScript available alongside the range selector.

For MSM6295 tracks, Pause shows all four busy flags and each voice’s last requested sample and attenuation. A busy voice can ignore a new start, so the inspector identifies the last accepted sample separately when they differ. Select a voice to view its waveform and **Preview** the full sample at the paused clock, divider and attenuation. Preview uses the ROM mapping at pause and the PCM mixer. The song stays at its paused frame. An incomplete embedded sample has no preview.
