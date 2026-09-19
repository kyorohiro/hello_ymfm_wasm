# tetorica-vgm

Node.js 22+ CLI and library for the existing Tetorica VGM Analyzer.
This package is prepared for npm publication; it has not been published by this change.

## From this repository

```sh
npm test
npm run build
node dist/cli/main.js analyze test/fixtures/psg-tone.vgz --json
node dist/cli/main.js export test/fixtures/psg-tone.vgz --format musicxml --output /tmp/tone.musicxml
node dist/cli/main.js render test/fixtures/psg-tone.vgz --output /tmp/tone.wav
npm pack --dry-run
npm pack
# Test the actual tarball without publishing:
npm exec --offline --package ./tetorica-vgm-0.1.0.tgz -- tetorica-vgm --help
```

After publication, the same commands work as `npx tetorica-vgm ...`.
There are no npm runtime dependencies. Committed WASM artifacts are included;
consumers do not need Emscripten. To rebuild YM2203/YM2608/YM2610(B)/YM2612/Sega PSG/RF5C164 from source, run
`scripts/build_ym2203_wasm.sh`, `scripts/build_ym2608_wasm.sh`, `scripts/build_ym2610b_wasm.sh`, `scripts/build_ym2612_wasm.sh`, `scripts/build_segapsg_wasm.sh`, and
`scripts/build_rf5c164_wasm.sh` with Emscripten installed.

## Commands

```sh
tetorica-vgm analyze song.vgz --json
tetorica-vgm export song.vgz --format midi --output song.mid --bpm 136
tetorica-vgm export song.vgz --format musicxml --output song.musicxml
tetorica-vgm export song.vgz --format lilypond --output song.ly
tetorica-vgm export song.vgz --format mgsdrv --output song.mml
tetorica-vgm render song.vgz --output song.wav --max-seconds 120
```

- `analyze`: header-declared chips/clocks, GD3 metadata, declared duration,
  command counts, data-block and PCM-RAM summaries, special-command details.
  JSON has `schemaVersion: 1`; declared chips are not a playback compatibility claim.
- `export`: `midi`, `musicxml`, `lilypond`, `mucom`, `opnavoid`, `mxdrv`, `mgsdrv`.
  Supported chips and approximation limits are those of the browser exporters.
  MUCOM/OPN-Avoid target OPN, MXDRV targets YM2151, MGSDRV targets AY/OPLL.
  BPM is an integer 4–999. Without `--bpm`, use the browser score suggestion,
  falling back to 120. This is not guaranteed musical beat detection.
- `render`: 16-bit stereo WAV, no loop expansion, up to 120 seconds by default.
  `--max-seconds` accepts >0 through 600; truncation is reported on stderr.
  Initial CLI adapters support standalone YM2612, YM2151, YM2413, YM3526,
  YM3812, YMF262 (each optionally with Sega PSG), standalone Sega PSG,
  AY-3-8910, and Game Boy DMG. YM2612 + RF5C164 (Mega CD), with optional Sega PSG,
  is also supported, including embedded PCM RAM data. Standalone YM2203 supports
  FM and internal SSG without external ROMs. YM2203 + Sega PSG / RF5C164 / other
  OPN chips are rejected; YM2203 + OKIM6258 requires a factory not yet supplied by Node. Unsupported dual/variant chip flags are rejected.
  Missing WASM factories/ROMs are reported separately from unsupported configurations.
  Browser playback additionally supports chips/combinations
  that are not yet wired into this CLI. External ROMs and browser effects are not bundled. Natural track endings can include one final partial block of silence.
- `--output` is required for export/render. Existing files are preserved unless
  `--force` is passed. Usage/input/output failures exit 1. JSON goes to stdout;
  errors, export notices and render warnings go to stderr.

The CLI accepts VGM/VGZ, not S98, directories, ZIPs or stdin in this initial version.
Patch ZIPs, sample extraction and interactive audition/editing remain browser features.

## Node API

```js
import { readSource, analyzeSource, exportSource, renderSource } from 'tetorica-vgm';
import { writeFile } from 'node:fs/promises';
const source = await readSource('song.vgz');
console.log(analyzeSource(source));
const midi = exportSource(source, { format: 'midi', bpm: 120 });
await writeFile('song.mid', midi.bytes);
const xml = exportSource(source, { format: 'musicxml', fileName: 'song' });
await writeFile('song.musicxml', xml.text);
```

`decodeSource(Uint8Array | ArrayBuffer)` asynchronously decodes VGM/VGZ without
filesystem access. `analyzeSource` and `exportSource` accept decoded bytes and
are synchronous. `renderSource` returns a Promise of `{bytes, seconds, truncated,
warnings}`. Export results contain either `bytes` or `text`, plus the underlying
exporter's diagnostics where available. Errors throw; there is no process exit in
these library functions.

`tetorica-vgm/core` exposes the environment-neutral API without Node filesystem
or engine initialization. A future MCP adapter can call this API, validate its own
inputs, and impose its own execution/resource policy.

## Architecture and package boundary

- `docs/js/ym2612vgm.js`: parser, chip registers, command scanning.
- `docs/js/vgm_file.js`: VGM/VGZ decoding and GD3 metadata.
- `docs/vgm_analyzer/*notes.js`, `vgm_midi.js`, `vgm_lilypond.js`,
  `vgm_musicxml.js`, `*mml.js`: existing reusable analysis/export algorithms.
- `docs/vgm_analyzer/analyzer_core.js`: public facade and JSON summary. Browser
  score/MIDI imports and the Node adapter share these very same modules.
- `cli/`: Node filesystem/WASM adapter and argument/output handling.
- `scripts/build_cli.mjs`: follows relative imports to stage a distribution under
  `dist/`. Staging copies files mechanically; there is no forked algorithm.

A few existing monitor modules contain both pure register decoding and inert DOM
mount functions. Their decoders are reused; no DOM globals are required when
importing or using Core. Moving the mount functions is a future cleanup, not a
second implementation for Node.

The npm allowlist includes only staged dependencies, README/CLI documentation
and licenses. It excludes game files, fixtures, ROMs, HTML/CSS/images, OSMD,
LilyPond runtime, Nuked-OPN2, `w/`, caches and browser bundles. Included chip code
is BSD-3-Clause; third-party notices are shipped under `dist/licenses/`.
Before publication run `npm test`, `npm run test:analyzer`, `npm pack --dry-run`,
and install/test the tarball in a clean directory. The analyzer suite has one optional compiler integration test that requires
`MML2MDR_DIR`; without that external compiler it is skipped.

## Shared playback interface

Browser and CLI now use `selectPlaybackConfiguration` / `createPlaybackEngine`
from the shared Core. Platform adapters supply `getFactory(name)` and ROM bytes;
Core owns chip configuration, engine creation and PCM composition. Existing
`VgmPlayer.process(left, right, frames)` is the shared PCM interface; WebAudio and
WAV/file delivery stay outside engine creation.

These functions, `createPlaybackPlayer`, and `PlaybackError` are exposed through
`tetorica-vgm/core` and the Node API. Errors distinguish `UNSUPPORTED_CONFIGURATION`
from `MISSING_RESOURCE` and contain structured `details`. Factory I/O failures
retain their original error. Node supplies the WASM factories for the supported
render configurations listed above. Shared recipes for other Browser engines do not imply that their
Node rendering has been validated. AY + YM2413 and Genesis PWM use already available
resources, but dedicated CLI combination testing remains follow-up work.

The repository document `docs/issues/analyzer_cli_02_architecture.md` records
ownership, ROM keys, the configuration table, validation and remaining limitations.

## YM2608 rendering and rhythm ROM

```sh
tetorica-vgm render song.vgz --output song.wav --ym2608-rom /path/to/ym2608_adpcm_rom.bin
```

Standalone YM2608 supports FM, internal SSG, embedded ADPCM-B RAM data and
ADPCM-A rhythm. The rhythm ROM is required only when the VGM issues a rhythm
key-on; FM/SSG/ADPCM-B-only tracks do not need it. No ROM is downloaded or bundled.
`--ym2608-rom` is render-only and accepts a full 8192-byte ROM. Unreadable files,
wrong sizes and missing required ROMs fail before output is written. Partial ROM
loading is not exposed by this Node API. Dual/variant and other OPN/Sega PSG
combinations remain rejected; OKIM6258 still needs an unprovided Node factory.

```js
const wav = await renderSource(source, {
  maxSeconds: 120,
  roms: { ym2608AdpcmA: await readFile('/path/to/ym2608_adpcm_rom.bin') },
});
```

Import `readFile` from `node:fs/promises`. The API accepts `Uint8Array` (including
Node `Buffer`); paths are handled only by the CLI, never by the shared Core.

## YM2610 / YM2610B rendering

```sh
tetorica-vgm render song.vgz --output song.wav
```

The VGM clock's variant bit selects YM2610 (4 FM channels) or YM2610B
(6 FM channels). Both include internal SSG and ADPCM-A/B; sample ROM data must
be embedded in the VGM (blocks 0x82/0x83). No external ROM option is required
for these fixtures, and none is provided for this chip. Missing sample data
cannot be reconstructed. Dual chips and combinations with Sega PSG or other
OPN chips are rejected; OKIM6258 still requires an unprovided Node factory.
