# Tetorica CPS1 Synth

Open `synth-cps1/index.html` from the docs HTTP server. Click **Start audio**, choose a YM2151 channel and play the guitar keyboard. A held note responds to operator edits. The central operator value supports horizontal dragging. Each operator row uses the Playground editor's logical M1, M2, C1, C2 order. The generated JavaScript uses the existing OPM client's register order M1, C1, M2, C2.

The browser combines the existing ymfm-backed YM2151 worklet and Tetorica's OKIM6295 renderer. The latter uses the BSD-3-Clause MAME/libvgm adaptation credited in [the core](../js/okim6295audioengine.js). This first configuration uses a 3,579,545 Hz OPM and 1 MHz OKI with pin 7 high. The two sources feed a common output with separate left/right FM routing for inspection. The original board's analog mix and per-game clock settings are outside this first version. [MAME CPS-1 machine configurations](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1.cpp)

MSM6295 reads an OKI sample table and ADPCM bytes from ROM. The built-in percussion is original. Import accepts one raw bank up to 256 KiB. Choose the sample, attenuation and voice, then compare the command bytes and busy bits. A start sent to a busy voice follows the existing chip behavior. Stop the voice before retriggering it.

Code runs in a dedicated worker. `opm` and `oki` share the instruments used by the panels. JavaScript uses zero-based channels and voices. For example, `oki.play(1, 2, 4)` plays sample 2 on voice 1 at attenuation 4. `oki.write(0x10)` stops that voice. Stop interrupts the running script and releases both chips. The edited script is saved in this browser.

## Next steps

- Add Files and cassette management for code, FM voices and sample banks using the Neo Geo workflow.
- Add per-voice OKI mixer mute, distinct from the chip's stop command.
- Add Analyzer instrument exchange and a longer original example performance.
