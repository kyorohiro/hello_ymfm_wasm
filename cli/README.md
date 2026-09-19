# tetorica-vgm

Analyze VGM/VGZ music, export scores and FM voices, and render WAV files from
Node.js. Uses the same analysis and playback core as the Tetorica browser analyzer.

Requires **Node.js 22 or later**. WASM engines are included, with no npm runtime
dependencies; Emscripten is not required to use the package.

## Quick start

After npm publication:

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
npx tetorica-vgm render song.vgz --output song.wav --max-seconds 120
```

Before publication, install the distribution tarball with
`npm install ./tetorica-vgm-0.1.0.tgz`, then use `npx tetorica-vgm --help`.

## Commands

- `analyze`: chip configuration, metadata and command summaries; `--json` for structured output.
- `export`: MIDI, MusicXML, LilyPond, MML formats, TFI/VGI/OPM voice snapshots and voice ZIPs.
- `score-channels`: list stable channel IDs for MusicXML/LilyPond `--channels` selection.
- `samples`: list embedded samples, export native data or render a selected sample to WAV.
- `render`: stereo PCM16 WAV, optional start time, duration limit and supported channel/chip mutes.

```sh
npx tetorica-vgm score-channels song.vgz --json
npx tetorica-vgm samples song.vgz --json
npx tetorica-vgm render song.vgz --start 10 --max-seconds 20 --output excerpt.wav
npx tetorica-vgm export song.vgz --format tfi-zip --output voices.zip
```

Existing output files are protected unless `--force` is supplied. Each command
accepts one input file. WAV rendering does not expand loops; the default output
limit is 120 seconds, and start time plus duration must not exceed 600 seconds.
S98 support is limited to the supported single-chip YM2203/YM2608/YM2612 configurations.
Unsupported chip combinations and missing required ROMs produce errors.
External ROMs and music files are not included.

Score export is a quantized transcription, not an original score. BPM can be
specified with `--bpm`; the automatic suggestion is not guaranteed beat detection.

See [CLI reference](CLI.md) for supported chips, format restrictions, ROM options,
channel IDs, sample export details and API contracts.

## Node API

```js
import { readSource, analyzeSource, exportSource, renderSource } from 'tetorica-vgm';
import { writeFile } from 'node:fs/promises';

const source = await readSource('song.vgz');
console.log(analyzeSource(source));
const score = exportSource(source, { format: 'musicxml', fileName: 'song' });
await writeFile('song.musicxml', score.text);
const wav = await renderSource(source, { maxSeconds: 30 });
await writeFile('song.wav', wav.bytes);
```

`tetorica-vgm/core` exposes the environment-neutral analysis/export API.
The main entry point adds Node file access and WASM initialization for rendering.

## License and source

BSD-3-Clause. See [LICENSE](LICENSE) and the included `dist/licenses/` notices.
The package excludes the browser score display libraries, LilyPond runtime and ROMs.

Source and browser project: [hello_ymfm_wasm](https://github.com/kyorohiro/hello_ymfm_wasm).
