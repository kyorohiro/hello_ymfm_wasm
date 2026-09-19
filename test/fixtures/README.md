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
