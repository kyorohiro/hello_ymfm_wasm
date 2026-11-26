# Tetorica CPS1 Synth

Open `synth-cps1/index.html` from the docs HTTP server. Click **Start audio**, choose a YM2151 channel and play the guitar keyboard. A held note responds to operator edits. The central operator value supports horizontal dragging. Each operator row uses the Playground editor's logical M1, M2, C1, C2 order. The generated JavaScript uses the existing OPM client's register order M1, C1, M2, C2.

The browser combines the existing ymfm-backed YM2151 worklet and Tetorica's OKIM6295 renderer. The latter uses the BSD-3-Clause MAME/libvgm adaptation credited in [the core](../js/okim6295audioengine.js). This first configuration uses a 3,579,545 Hz OPM and 1 MHz OKI with pin 7 high. The two sources feed a common output with separate left/right FM routing for inspection. The original board's analog mix and per-game clock settings are outside this first version. [MAME CPS-1 machine configurations](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1.cpp)

MSM6295 reads an OKI sample table and ADPCM bytes from ROM. The built-in percussion is original. Import accepts one raw bank up to 256 KiB. Choose the sample, attenuation and voice, then compare the command bytes and busy bits. A start sent to a busy voice follows the existing chip behavior. Stop the voice before retriggering it.

The MSM6295 panel shows the selected sample’s inclusive ROM range, duration and decoded waveform. Mute silences one voice while its decoder and busy bit continue normally. For example, `oki.setVoiceMuted(0,true)` mutes Voice 1 and `oki.setVoiceMuted(0,false)` restores its current output.

Code runs in a dedicated worker. `opm` and `oki` share the instruments used by the panels. JavaScript uses zero-based channels and voices. For example, `oki.play(1, 2, 4)` plays sample 2 on voice 1 at attenuation 4. `oki.write(0x10)` stops that voice. Stop interrupts the running script and releases both chips. The edited script is saved in this browser.

Files lists the eight current channel voices, saved FM presets and sample banks. Export Cassette saves those files with the current code and global LFO/noise settings in a Tetorica cassette ZIP. Import restores the project without running its code. Export before closing the page to keep the voices and banks.

### Load an Analyzer OPM voice

In Analyzer’s Instrument tab, export the selected YM2151 voice as an `.opm` file. In the Synth, select the destination channel under YM2151, then use **Files → Import OPM**. The first voice is applied immediately. For a text bank, select another name and use **Load voice on selected CH**. The keyboard uses the imported SLOT mask. Code may override it with an explicit `opm.keyOn(ch, mask)`.

**Apply shared LFO / CH8 noise** applies the selected OPM voice’s global settings. Import leaves the running LFO and noise settings intact. Cassette retains the imported OPM texts and channel masks. The source clock, note pitch and playback position are not restored by voice import.

### Play Round Start

Choose **Use original kit** on the MSM6295 tab, open **Files → /examples/round-start.js**, then select **Run**. The 8-bar score lasts about 16 seconds. CH1 plays bass, CH2 and CH3 trade brass phrases, and OKI voices 1–3 play kick, snare and closed hat. Select CH4 on the YM2151 panel to play along on the guitar keyboard. During bars 3 and 7, select CH1 and drag OP1 TL to hear the sustained bass change. Use MSM6295 Voice 2 Mute to drop the snare.

The example programs the FM voices on CH1–3. Export a cassette first if you want to keep their current patches. The Code file selector switches between the example and your own `/index.js`. Each keeps its own edits in the browser, and both are included in a cassette export.

Open **Output → Mixer** to adjust the two chips independently (0–380%) before Master. Mute silences the whole chip. The CH and Voice buttons show which channels are on. Switching a channel off leaves its sound engine running, so switching it back on reveals the current point in the note or sample. MSM6295 voice switches also follow the PCM panel and Code.

**Synth** keeps the selected chip or Files above a separate Keyboard / Code panel. **Code** opens a larger editor and puts the chips, Files and Keyboard in the same tab row. Switching views keeps the current script, audio and keyboard channel. The computer keyboard plays the selected FM channel while the on-screen keyboard is hidden. Focus the editor to type code.

**☰ → New → Cassette · ZIP** stops playback and starts again with the eight factory FM voices, original percussion kit and both bundled scripts. Export Cassette first to keep the current project. The confirmation can be cancelled to continue editing.
