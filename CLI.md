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
consumers do not need Emscripten. To rebuild YM2612/Sega PSG/RF5C164 from source, run
`scripts/build_ym2612_wasm.sh`, `scripts/build_segapsg_wasm.sh`, and
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
  is also supported, including embedded PCM RAM data. Unsupported dual/variant chip flags are rejected.
  Missing WASM factories/ROMs are reported separately from unsupported configurations.
  Browser playback additionally supports chips/combinations
  that are not yet wired into this CLI. No external ROMs or browser effects
  are included. Natural track endings can include one final partial block of silence.
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
and install/test the tarball in a clean directory. The existing analyzer suite
has 11 known baseline failures; do not mistake those for a fully green suite.

## Shared playback interface

Browser and CLI now use `selectPlaybackConfiguration` / `createPlaybackEngine`
from the shared Core. Platform adapters supply `getFactory(name)` and ROM bytes;
Core owns chip configuration, engine creation and PCM composition. Existing
`VgmPlayer.process(left, right, frames)` is the shared PCM interface; WebAudio and
WAV/file delivery stay outside engine creation.

These functions, `createPlaybackPlayer`, and `PlaybackError` are exposed through
`tetorica-vgm/core` and the Node API. Errors distinguish `UNSUPPORTED_CONFIGURATION`
from `MISSING_RESOURCE` and contain structured `details`. Factory I/O failures
retain their original error. Node currently supplies only the previously packaged
WASM factories. Shared recipes for other Browser engines do not imply that their
Node rendering has been validated. AY + YM2413 and Genesis PWM use already available
resources, but dedicated CLI combination testing remains follow-up work.

The repository document `docs/issues/analyzer_cli_02_architecture.md` records
ownership, ROM keys, the configuration table, validation and remaining limitations.
