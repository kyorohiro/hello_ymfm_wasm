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

- `to-json` / `from-json`: lossless, fixed-layout VGM/JSON conversion.
- `analyze`: chip configuration, metadata and command summaries; `--json` for structured output.
- `support`: check a file's render configuration and export availability; `--json` includes reasons and warnings.
- `export`: MIDI, MusicXML, LilyPond, MML formats, TFI/VGI/OPM voice snapshots and voice ZIPs.
- `score-channels`: list stable channel IDs for MusicXML/LilyPond `--channels` selection.
- `samples`: list embedded samples, export native data or render a selected sample to WAV.
- `render`: stereo PCM16 WAV, optional start time, duration limit and supported channel/chip mutes.

Start with `support` to inspect the recognized chips and available operations,
then choose a supported conversion. See [File support report](#file-support-report)
for version availability and interpretation of the results.

```sh
# Readable summary, or detailed JSON
npx tetorica-vgm support song.vgz
npx tetorica-vgm support song.vgz --json

# Run a conversion supported by the file
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
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

## NES APU

Standalone NTSC NES APU supports pulse 1/2, triangle, noise and DMC playback,
including embedded VGM C2 RAM blocks. Browser and Node use the same JavaScript
APU engine (JSNES, Apache-2.0; see `dist/licenses/jsnes/`). No extra WASM is needed.
`render --mute nes-ch-1` through `nes-ch-5` control these five channels.
MIDI, MusicXML and LilyPond export pulse/triangle base pitches; score IDs are
`nes-ch1`, `nes-ch2`, `nes-ch3`. Noise/DMC have no score pitch. Length, envelope,
sweep and linear-counter timing are not reconstructed in note extraction.
PAL, FDS, dual chips and expansion-chip combinations are not supported.

## File support report

```sh
npx tetorica-vgm support song.vgz --json
```

`support FILE` reports declared chip clocks separately from the shared render
engine selection, ignored header clocks, required ROMs and mute IDs. It also
probes all export formats through the actual exporters, and lists score channels
and sample metadata. The Node/Core API is `await inspectSourceSupport(source)`.
JSON uses `schemaVersion: 1`; unavailable features include a `reason`.
Sample listing reports `no-data` when no recognized samples are found.

Render status is `configuration-supported`, `requires-resources`, or `unsupported`.
This preflight does not initialize WASM or render the entire track, so it cannot
guarantee successful playback of every command. Export status `available` means
the exporter completed with BPM 120 (snapshots: time 0, channel 1), not full-fidelity
conversion of every chip. Outputs can be empty; inspect warnings and note/sample
counts. `unavailable` can also mean no convertible data. Probes discard generated
outputs and never write files, but may take time on large tracks.

This command is added after 0.1.1. Before the next publication, use
`npm run build` then `node dist/cli/main.js support song.vgz --json`.

### Example: check MusicXML availability, then convert

Suppose you have `song.vgz` and want a score for a notation editor.
The following commands assume a published version that includes `support`.
For the current repository build, replace `npx tetorica-vgm` with
`node dist/cli/main.js` after running `npm run build`.

1. Inspect the file before converting:

   ```sh
   npx tetorica-vgm support song.vgz --json
   ```

2. Check `exports.musicxml.status`. For example, an NTSC NES track might
   return this **illustrative excerpt** (other fields omitted):

   ```json
   {
     "declaredChips": [{ "id": "nesApu", "clockHz": 1789773, "rawClock": 1789773 }],
     "exports": {
       "musicxml": {
         "status": "available",
         "warnings": ["Quantized transcription; manual BPM, assumed 4/4, 1/16 grid. Not an original score."]
       }
     }
   }
   ```

   `available` means the MusicXML exporter completed its probe. Read the
   warnings and `scoreChannels.result.channels` note counts as well: NES
   pulse/triangle notes can be exported, but noise and DMC are omitted.
   An empty score can still be `available`. If the status is `unavailable`,
   read `exports.musicxml.reason` before proceeding.
   Use the MusicXML status for this decision, independently of `render.status`.

3. If MusicXML is available, export it:

   ```sh
   npx tetorica-vgm export song.vgz --format musicxml --bpm 120 --output song.musicxml
   ```

   This uses the same BPM as the support probe. Set `--bpm` to the track's
   intended tempo if known, or omit it to use the automatic suggestion.
   Open `song.musicxml` in a notation editor that supports MusicXML and check
   the notes and rhythm against the original. Existing output files are
   preserved; choose a new filename or explicitly pass `--force` to replace one.

## Lossless VGM / JSON round trip

These commands are new after 0.1.2. From the repository, run `npm run build`
and use `node dist/cli/main.js` in place of `npx tetorica-vgm` until published.

```sh
npx tetorica-vgm to-json song.vgz --output song.vgm.json
npx tetorica-vgm from-json song.vgm.json --output restored.vgm
```

This is different from `analyze --json`, which produces a summary. `to-json`
accepts VGM/VGZ and preserves the decompressed VGM byte-for-byte, including
header fields, PCM blocks, loop pointers, metadata and trailing bytes. `from-json`
produces uncompressed VGM, not VGZ. S98 is not accepted for this round trip.
Existing files are protected unless `--force` is supplied.

The versioned `tetorica-vgm-lossless` document contains:

- `headerHex`: original header bytes, including any extended header.
- `commands`: ordered `{ "offset": 256, "hex": "522a80" }` entries. This example
  writes YM2612 port 0 register `0x2a` with value `0x80`; the hex bytes are authoritative.
- `tail`: bytes after the end command, or from the first command whose length
  cannot be determined. Unknown/truncated command tails are retained with a warning.
- `byteLength`: decompressed file size; `schemaVersion`: JSON schema version.

Initial editing support is **fixed-layout**: change register values or PCM bytes
without changing entry lengths or offsets. Do not insert/delete commands or change
block sizes. Command boundaries and payload sizes are validated on import.
This is a byte-preserving tool, not a semantic VGM validator: header lengths,
loop/GD3 pointers and total/loop sample counts are preserved, not recalculated.
If you edit wait values, you must also update the corresponding header sample
counts yourself. Prefer register-value edits for the initial workflow.
Unknown tail bytes are opaque and are not interpreted as editable events.

Hex payloads use two characters per byte, plus JSON overhead; many tiny writes
can make the JSON substantially larger. PCM stays in a single hex string rather
than one JSON object per sample. The commands currently process the entire file
in memory. Unedited JSON round trips reproduce the decompressed VGM exactly;
the original gzip container is not preserved.

Node and environment-neutral Core exports:

```js
import { readSource, vgmToJson, jsonToVgm } from 'tetorica-vgm';
import { writeFile } from 'node:fs/promises';

const document = vgmToJson(await readSource('song.vgz'));
// Edit a known register value in document.commands here, keeping its byte length.
await writeFile('restored.vgm', jsonToVgm(document), { flag: 'wx' });
```

The Core functions consume/produce decoded bytes and plain objects. They do not
read files, compress data, initialize WASM or use audio devices.

### Annotated JSON

Add `--comments` to include a generated description on each recognized command:

```sh
npx tetorica-vgm to-json song.vgz --comments --output song.vgm.json
```

For example:

```json
{ "offset": 256, "hex": "522a80", "comment": "cmd=0x52 ym2612 port=0 register=0x2a value=0x80" }
```

Comments reuse the parser's command descriptions: chip/register/value where
recognized, waits, data-block details and end markers. They do not infer musical
intent or fully explain every register. Unknown commands may have only an opcode
description; opaque tails remain covered by `warnings`. Wait descriptions for
`0x62`/`0x63` show defaults, not stateful wait overrides.

`hex` remains authoritative. You can edit `comment` freely; `from-json` ignores
it. Comments are not stored in VGM, and do not update automatically after hex
edits. Keep the JSON to retain your notes. Omit `--comments` for smaller output.
The Node/Core equivalent is `vgmToJson(bytes, { comments: true })`.

### YMF262 Sheet Music

YMF262 (OPL3) supports MusicXML / LilyPond base-pitch scores for 2op and 4op.
Use `score-channels` to select IDs `ymf262-ch1`–`ymf262-ch18`. Four-operator
pairs use the leading channel, so paired notes are not duplicated. Rhythm
CH7–9 are omitted in rhythm mode; operator multipliers, routing/levels,
modulation and release are not represented. Dual/variant YMF262 and YMF262
MIDI export are not supported. Browser Sheet Music uses the same extraction.

### Combine physical channels into score groups

For music that spreads notes across channels, combine them manually:

```sh
npx tetorica-vgm score-channels song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --merge-all --output combined.musicxml
npx tetorica-vgm export song.vgz --format musicxml --group 'Piano=ymf262-ch1,ymf262-ch5' --group 'Bass=ymf262-ch2,ymf262-ch8' --output grouped.musicxml
```

Use IDs from `score-channels`. Each group becomes one score part; overlapping
notes remain in separate voices. Ungrouped channels remain separate. This does
not infer instruments or melodies. Grouping also works with `--format lilypond`.
Repeat `--group` as needed; it cannot be combined with `--merge-all`. A channel
can belong to only one group. With `--channels`, selection happens first, so
include every member of each group; `--merge-all` combines the selected channels.
These options do not change playback or MIDI exports.
