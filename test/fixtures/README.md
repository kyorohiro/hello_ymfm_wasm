These are original, minimal VGM 1.71 register streams, authored for this project
under the repository BSD-3-Clause license. They contain a half-second test note,
not music from a game. Each .vgz is gzip of its matching .vgm.
Run `node test/fixtures/generate.mjs` to regenerate them.
The OPN/OPM fixtures test note extraction; they do not program an audible FM patch.

The ym2203-fm, ym2203-ssg and ym2203-mix fixtures program audible voices
independently and together, for render and mix coverage. No external ROM is used.

YM2608 fixtures cover FM, SSG, rhythm key-on and an authored embedded ADPCM-B
pattern. Tests generate synthetic 8192-byte rhythm data in temporary memory/files.
No hardware rhythm ROM is included.

YM2610 and YM2610B fixtures exercise FM, SSG, embedded ADPCM-A/B and their mix.
Extra-FM fixtures use CH1 and CH4, which sound only on YM2610B. Sample bytes are
authored repeating patterns, not game ROM data.

OKIM6258 fixtures contain authored timed ADPCM byte writes; opm-oki-mix adds
a synthesized OPM voice. opm-audible is the independent FM reference.

Y8950 fixtures exercise FM, an authored repeating ADPCM memory pattern (block
0x88), their mix and optional Sega PSG. No game samples are used.

YMF278B fixtures use an authored sine wave and header for embedded PCM and
external-ROM playback, plus FM and PSG. External 2 MiB ROMs are synthesized
only in tests; proprietary wave ROMs are not included.

`segapcm-*` contains authored unsigned PCM ramps in two banks, asymmetric
stereo volumes and optional authored YM2151/Sega PSG voices. Tests check bank
selection, embedded sample bounds, reset and packaged CLI/Node rendering.
No game ROM data is used.

`msx-*` covers all 15 nonempty subsets of AY, OPLL, Y8950 and SCC.
It uses authored register sequences, an authored SCC ramp and the synthetic
Y8950 ADPCM pattern above. No game music or external ROM is included.

`pwm-*` uses authored 12-bit pulse values, equivalent timed direct writes and
16-bit stream data, stereo routing, and the authored Genesis voices above.
It contains no game music. PWM is the existing Browser sample-and-hold model.

`s98-*.s98` contains authored FM writes for the three supported devices, a fractional timer, loop boundary and UTF-8 tag. No game data.

`nes-tone` is an authored NTSC NES pulse A4 (timer 253), with no game data.

`huc6280-tone` is an authored one-second 32-step square wave on CH1, period 254,
clock 3579545 Hz. No game data; `generate_huc6280.mjs` regenerates it separately.

`ym3526-tone`, `ym3812-tone`, `ymf262-tone`, `ym2413-tone` and
`gameboy-tone` are standalone audible half-second voices. OPL3 uses bank 1
(CH10) to exercise second-bank dispatch. The other fixtures use CH1.
`test/standalone-chip-fixtures.test.mjs` checks VGM/VGZ equivalence,
deterministic audible rendering, channel mute, score channel counts and
MIDI / MusicXML / LilyPond export via the shared CLI/Analyzer entry points.

`wonderswan-tone` is an original half-second A4 square wavetable with unequal
left/right volumes. It writes waveform RAM at physical `0x1200` using the VGM
`0xC6` big-endian address and programs the sound ports with `0xBC` offsets.
`generate_wonderswan.mjs` regenerates the VGM and VGZ; no game, BIOS or ROM data
is included. Additional wave/Noise/Sweep/Voice PCM fixtures for browser tests
are generated in memory by `test/helpers/wonderswan_vgm_fixture.mjs`.

### Dual-chip playback probes

Regenerate the `dual-*.vgm` files with `node test/fixtures/generate_dual_chips.mjs`.
Each declares two identical chips and programs the same channel number on both.
The three one-second phrases use the first chip alone, the second an octave
higher, then both together. The Yamaha files use FM only, with different OP4
multipliers. Both DMGs use CH1 with 50% and 25% pulse duty respectively.

The additional `dual-ym2608-ssg.vgm` plays SSG A on chip 1, then chip 2 an octave higher, then both together.

`dual-ym2608-rhythm-delta.vgm` plays a snare on both chips for the first phrase and repeating ADPCM-B for the second. Chip 1 is on the left and chip 2 on the right. Load the bundled synthetic rhythm ROM for the snare. Both Delta-T sample memories are embedded in the VGM.

`dual-ym2610-adpcm.vgm` and `dual-ym2610b-adpcm.vgm` embed both sample ROM types for both chips. In the first second both play ADPCM-A CH1. In the second both play Delta-T. Chip 1 reads page 0 on the left and chip 2 reads page 1 on the right, with different sample bytes.

All four chip families now support dual playback and separate mixer strips. Instrument lists both instances. Run `node --test docs/vgm_analyzer/dual_playback.test.mjs` to check the rendered phrases and isolation.

Original browser observations at commit `399e19d4`:

| Fixture | Select files | Instrument | Play |
| --- | --- | --- | --- |
| dual-ym2612.vgm | Unsupported raw VGM command 0xa2 | Disabled | Disabled |
| dual-ym2608.vgm | Unsupported raw VGM command 0xa6 | Disabled | Disabled |
| dual-ym2610.vgm | Unsupported raw VGM command 0xa8 | Disabled | Disabled |
| dual-dmg.vgm | Parsed | Both DMG tabs expose their respective duty values | Dual/variant configuration is not supported |

In that earlier revision the Uses line omitted the chip count.
