# Tetorica OPNA rhythm sounds

`tetorica_ym2608_adpcm_rom.bin` is an original, synthesized replacement for the
8,192-byte YM2608 ADPCM-A rhythm ROM used by emulators. It has the same memory
layout and encoding, but **sounds different from Yamaha's original ROM**.
It does not contain Yamaha ROM data, recorded samples, or samples from other
replacement ROM projects. Compatibility here concerns emulator ROM loading;
physical chip replacement is not tested.

Both the generator and generated sample data are covered by the adjacent
[BSD-3-Clause LICENSE](LICENSE). Include that license when redistributing them.
The encoder's decoding parameters follow this repository's BSD-licensed
`src/ymfm_adpcm.cpp`; the fixed address layout follows `src/ymfm_opn.cpp`.

## Generate and verify

From the repository root:

```sh
node assets/opna-rhythm/generate.mjs
node assets/opna-rhythm/generate.mjs --check
node --test web/opna_rhythm_rom.test.mjs
```

The generator uses sine waves, pitch envelopes and seeded noise. No input ROM
or external sample is read. Each voice starts with a fresh ADPCM-A decoder
state, uses high nibble first, and fades toward zero before its fixed end.
The checked-in binary is the distribution artifact; `--check` compares it
byte for byte with regenerated data.

## Use

Open `docs/demos/opna-rhythm-compare.html` through your local HTTP server
to compare two ROMs. A defaults to the bundled Tetorica ROM; select a local
original ROM for B. Both slots accept replacement 8 KiB files. The page offers
six individual voices, A/B sequential playback and waveforms at the same
scale. Selected files stay in the browser and are not uploaded.

The page also edits pitch, decay, noise, attack and peak level per voice.
Generate to replace A with all six synthesized voices, audition the encoded
ROM through YM2608, and download the 8 KiB binary. Settings can be saved and
reloaded as JSON. Imported ROMs are comparison references; synthesis does not
extract or modify their samples. Waveform zoom is shared by A/B and does not
change playback gain. `synthesis.mjs` is the shared browser/Node generator;
its default parameters reproduce the checked-in binary exactly.

The rhythm example uses these sounds by default:

```sh
node examples/nodejs/main_ym2608_rhythm_wave.js rhythm.wav
```

An explicit ROM path still overrides the default:

```sh
node examples/nodejs/main_ym2608_rhythm_wave.js rhythm.wav /path/to/ym2608_adpcm_rom.bin
```

The existing CLI can load the replacement directly:

```sh
npx tetorica-vgm@0.2.1 render music.vgm --ym2608-rom web/tetorica_ym2608_adpcm_rom.bin --output music.wav
```

For software that requires the filename `ym2608_adpcm_rom.bin`, copy the file
under that name into its ROM directory. Loaders that require an original ROM
checksum may reject a replacement. This data is for ADPCM-A rhythm voices,
not the independently loaded ADPCM-B sample memory.

The canonical binary is `web/tetorica_ym2608_adpcm_rom.bin`. Release locations:

- npm: `dist/web/tetorica_ym2608_adpcm_rom.bin`.
- Analyzer, Synth, Playground and browser examples ZIPs: `js/tetorica_ym2608_adpcm_rom.bin`.
- Flat web runtime ZIP: `tetorica_ym2608_adpcm_rom.bin` at the archive root.
- GitHub Pages: `docs/js/tetorica_ym2608_adpcm_rom.bin` (synchronized using
  `node scripts/copy_opna_rhythm.mjs docs` or `scripts/sync_web_js_to_docs.sh`).

The license, README and generator remain under `assets/opna-rhythm/`
(under `dist/` for npm and `docs/` for Pages). Run regeneration commands in
the source repository; packaged copies of the generator are for reference.

The CLI and Analyzer still use explicitly supplied ROM data; bundling does not
change playback defaults. The Analyzer provides a download link; import the
downloaded `.bin` using its file selector or drag and drop. For an installed
CLI, pass the installed `dist/web/tetorica_ym2608_adpcm_rom.bin`
path to `--ym2608-rom`. Version 0.2.1 predates this bundled asset.

The YM2608 browser RuntimeSynth (including Playground) loads this synthetic
ROM by default at startup. Select YM2608 and run `chip-saw/ym2608-rhythm.js` in
Playground to hear all six voices. Browser API callers can override the default
using `new YM2608RuntimeSynth({rhythmRom: bytes})` or `{rhythmRomUrl: url}`;
after startup, `synth.fm.rhythm.loadRom(bytes)` replaces the loaded data.
The Node.js rhythm example also uses the bundled ROM by default.

## Layout

Addresses are byte offsets with inclusive ends. Rates and durations assume
an 8 MHz YM2608 clock; tom and rim shot run at half the other voices' rate.

| Voice | Start–end | Bytes | Samples | Rate (Hz) | Duration (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| Bass drum | 0000–01BF | 448 | 896 | 18518.52 | 48.384 |
| Snare | 01C0–043F | 640 | 1280 | 18518.52 | 69.120 |
| Cymbal | 0440–1B7F | 5952 | 11904 | 18518.52 | 642.816 |
| Hi-hat | 1B80–1CFF | 384 | 768 | 18518.52 | 41.472 |
| Tom | 1D00–1F7F | 640 | 1280 | 9259.26 | 138.240 |
| Rim shot | 1F80–1FFF | 128 | 256 | 9259.26 | 27.648 |
