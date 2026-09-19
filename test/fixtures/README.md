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
