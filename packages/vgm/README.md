# tetorica-vgm

Analyze VGM/VGZ music, export scores and FM voices, and render WAV files from
Node.js. Experimental SPC analysis exports MIDI, MusicXML and LilyPond using
the same BRR pitch estimates and score algorithms as the browser Analyzer.

Requires **Node.js 22 or later**. WASM engines are included, with no npm runtime
dependencies; Emscripten is not required to use the package.

## Quick start

Run directly with npm:

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
npx tetorica-vgm render song.vgz --output song.wav --max-seconds 120
```

To test a local build, install its distribution tarball with
`npm install ./tetorica-vgm-0.2.15.tgz`, then use `npx tetorica-vgm --help`.

Try playback, Note-ish and sheet music in the
[browser VGM Analyzer](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html).

## Experimental SPC analysis and scores (0.2.12)

```sh
npx tetorica-vgm analyze song.spc --spc-seconds 30 --json
npx tetorica-vgm score-channels song.spc --spc-seconds 30 --json
npx tetorica-vgm export song.spc --spc-seconds 30 --format midi --output song.mid
npx tetorica-vgm export song.spc --spc-seconds 30 --format musicxml --bpm 120 --output song.musicxml
npx tetorica-vgm export song.spc --spc-seconds 30 --format lilypond --bpm 120 --output song.ly
```

SPC captures the sound CPU's state, so analysis runs the bundled CPU/DSP engine
silently to observe the chosen interval. Default: the first 120 seconds or the
shorter tagged duration. `--spc-seconds` accepts 0.1–600 seconds;
`--spc-control-step-ms` accepts 0–1000 (default 20, 0 retains all distinct controls).
Limits are 20,000 interpreted events and 256 BRR versions / 64,512 BRR bytes;
exceeding a limit produces an error rather than a partial output.

High-confidence BRR fundamental estimates are used at native 32,000 Hz / PITCH
4096; uncertain samples use an explicitly provisional C4 reference. Estimates
can be an octave off. To correct them, inspect the analysis sample IDs and pass
`--spc-references references.json`. For example:

```json
[
  {"sampleId": 0, "note": "C4", "cents": 0},
  {"sampleId": 1, "referenceHz": 125}
]
```

Each entry supplies either `note` with optional `cents`, or `referenceHz`.
`sampleId` identifies a captured BRR version, not its SRCN. IDs belong to the
file and capture settings; check them again after changing the input or interval.
Corrections change the exported notes, never the SPC program or raw PITCH.

MIDI preserves original timing and Pitch Bend on eight physical voice tracks,
with Program 0 and velocity 100. MusicXML/LilyPond round base pitches to
semitones on the existing 1/16 grid and assumed 4/4; BPM is suggested or set
manually. Scores support IDs `snes-voice-1` through `snes-voice-8` with
`--channels`, `--group` and `--merge-all` as for VGM.

Only the analyzed interval is exported. Initial notes and envelope state are
inferred; noise has no note, PMON shows base pitch, and audible release, echo,
original BRR timbres and later held-sample RAM edits are not reconstructed.
These are editable reference transcriptions, not original scores. SPC WAV
rendering, sample export and lossless VGM/JSON commands are not exposed by this
CLI. Use the browser Analyzer for SPC playback and BRR preview.

The additive Node API leaves existing VGM APIs synchronous and unchanged:

```js
import {readFile, writeFile} from 'node:fs/promises';
import {analyzeSpcSource, exportSpcAnalysis} from 'tetorica-vgm/spc';

const analysis = await analyzeSpcSource(await readFile('song.spc'), {
  durationSeconds: 30,
  controlStepMs: 20,
  // references: [{sampleId: 0, note: 'C4', cents: 0}],
});
const midi = exportSpcAnalysis(analysis, {format: 'midi', fileName: 'song'});
await writeFile('song.mid', midi.bytes);
const score = exportSpcAnalysis(analysis, {format: 'musicxml', bpm: 120});
await writeFile('song.musicxml', score.text);
```

`isSpcSource`, `analyzeSpcSource`, `exportSpcAnalysis` and
`listSpcScoreChannels` are also exported from `tetorica-vgm`.
Analysis note positions use 44,100-Hz reference ticks, SPC events use
1,024,000-Hz clocks, and `durationSeconds` is elapsed seconds independent of BPM.
An optional AbortSignal cancels analysis; `onProgress` receives bounded progress
updates. The existing `readSource` / `exportSource` APIs remain VGM/VGZ/S98 APIs.

## Sound chip support

The following chip families have playback implementations in the shared core
used by the CLI. Playback coverage does not imply score or voice export support.
Some tracks need sample ROMs; dual chips, variants and combinations have limits.

<!-- chip-list:start -->
| Chip | Playback in the shared core |
| --- | --- |
| YM2612 | FM + DAC |
| YM2203 | FM + SSG |
| YM2608 | FM + SSG + Rhythm + ADPCM-B |
| YM2610 / YM2610B | FM + SSG + ADPCM-A/B |
| YM2151 / YM2164 (OPM / OPP) | 8 FM CH |
| Sega PSG | Tone + noise |
| RF5C164 | PCM (Mega-CD) |
| 32X PWM | MAME-derived PWM |
| YM2413 | OPLL |
| YMF262 (OPL3) | 2OP / 4OP / rhythm |
| YM3526 / YM3812 | OPL / OPL2 |
| Y8950 | FM + ADPCM |
| YMF278B | OPL4 FM + PCM |
| AY-3-8910 / YM2149 | Tone + noise + envelope |
| K051649 / K052539 (SCC / SCC+) | 5-channel wavetable; mixed with MSX AY/YM2413/Y8950 |
| WonderSwan | 4-channel wavetable, Voice PCM, sweep, noise (MAME) |
| HuC6280 / PC Engine CD | 6-channel wavetable, DDA, noise, LFO (MAME); optional MSM5205 ADPCM |
| MSM5205 | 3/4-bit ADPCM; VGM 1.72 command 0x32 |
| OKIM6295 | 4-voice ADPCM; standalone or with YM2151 / YM2164 (CPS-1 sound configuration), or YM3812 |
| OKIM6258 | 4-bit ADPCM; standalone or mixed |
| Sega PCM (315-5218) | 16-voice 8-bit PCM; standalone, mixed with Sega PSG, or mixed with YM2151 / YM2164 |
| NES APU + FDS (NTSC) | 2 pulse + triangle + noise + DMC; optional FDS wavetable |
| Game Boy DMG (LR35902) | 2 square + wave + noise |
<!-- chip-list:end -->

- [Sound chip support table](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/support.html): the shared browser Analyzer reference, with playback/export coverage and limitations.
- [CLI chip support and restrictions](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/CLI.md): Node rendering, chip combinations and ROM requirements.

Browser and CLI coverage can differ. For the exact operations available for a
file in your installed CLI version, run:

```sh
npx tetorica-vgm support song.vgz --json
```

## Commands

- `to-json` / `from-json`: lossless, fixed-layout VGM/JSON conversion.
- `analyze`: chip configuration, metadata and command summaries; `--json` for structured output.
- `support`: check a file's render configuration and export availability; `--json` includes reasons and warnings.
- `export`: MIDI, MusicXML, LilyPond, MML formats, FM-only MDX files, SBI/TFI/VGI/OPM voice snapshots and voice ZIPs.
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
External ROMs and music files are not included. An original BSD-3-Clause
synthetic YM2608 rhythm replacement is bundled at
`web/tetorica_ym2608_adpcm_rom.bin` inside the installed
package. Pass its path to `--ym2608-rom` to use it; it sounds different from
the original Yamaha ROM. `assets/opna-rhythm/LICENSE` covers the data and generator.

Score export is a quantized transcription, not an original score. BPM can be
specified with `--bpm`; the automatic suggestion is not guaranteed beat detection.

See [CLI reference](CLI.md) for supported chips, format restrictions, ROM options,
channel IDs, sample export details and API contracts.

## OPL SBI voices

```sh
npx tetorica-vgm export song.vgz --format sbi --at 1.5 --channel 1 --output voice.sbi
npx tetorica-vgm export song.vgz --format sbi-zip --output voices.zip
```

Supports YM3526, YM3812, Y8950 FM, YMF262 and YMF278B FM. Two-operator
voices use DOS SBI; four-operator voices use UNIX 4OP SBI. A single voice
requires a time in seconds and a 1-based channel; select the leading channel
of a 4op pair. ZIP export collects distinct keyed voices per channel across
the track, including changes while keys are held.

Rhythm, CSM, PCM/ADPCM, dual/variant and mixed FM chips are excluded.
Static operator parameters and TL are preserved; clock, pan, global modulation
depth and performance are not. Available since 0.1.9.

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

Tetorica code is BSD-3-Clause. The bundled snes_spc 0.9.0 component is
LGPL-2.1-or-later; its notices, modified sources, WASM wrapper and rebuild recipe
are included in `licenses/snes-spc/` and `sources/`. See [LICENSE](LICENSE) and
the other included `licenses/` notices. No Nintendo IPL ROM or game data is bundled.
The package excludes the browser score display libraries, LilyPond runtime and
external ROMs; the Tetorica synthetic rhythm replacement is included.

Source and browser project: [hello_ymfm_wasm](https://github.com/kyorohiro/hello_ymfm_wasm).

## NES APU

Standalone NTSC NES APU supports pulse 1/2, triangle, noise and DMC playback,
including embedded VGM C2 RAM blocks. Browser and Node use the same JavaScript
APU engine (JSNES, Apache-2.0; see `licenses/jsnes/`). No extra WASM is needed.
`render --mute nes-ch-1` through `nes-ch-5` control these five channels.
MIDI, MusicXML and LilyPond export pulse/triangle base pitches; score IDs are
`nes-ch1`, `nes-ch2`, `nes-ch3`. Noise/DMC have no score pitch. Length, envelope,
sweep and linear-counter timing are not reconstructed in note extraction.
The NES header FDS flag enables FDS wavetable playback and the `nes-ch-6`
mute control. PAL and dual configurations are not supported.

## PC Engine CD ADPCM (0.2.10)

HuC6280 + MSM5205 playback includes the CD system's ADPCM audio. The shared
core reads VGM 1.72's MSM5205 clock/flags and packed `0x32` writes, including
reset, FIFO, prescaler, 3/4-bit data and external VCLK. No extra ROM is needed.
`render --mute msm5205` suppresses ADPCM while retaining HuC6280 playback.
Normal seeking and WAV output include ADPCM; score exports remain HuC6280
base pitches. MSM6585 and dual MSM5205 configurations are not supported.

Game Boy DMG and NES APU with optional FDS also support opaque playback state
snapshots in the shared engines. This enables Analyzer seek checkpoints;
the CLI's `render --start` uses normal silent replay.

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

For a repository build, run `npm run build` then
`node dist/vgm/cli/main.js support song.vgz --json`.

### Example: check MusicXML availability, then convert

Suppose you have `song.vgz` and want a score for a notation editor.
For the current repository build, replace `npx tetorica-vgm` with
`node dist/vgm/cli/main.js` after running `npm run build`.

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

From the repository, run `npm run build` and use
`node dist/vgm/cli/main.js` in place of `npx tetorica-vgm`.

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

## HuC6280

Single HuC6280 supports playback and six-channel wavetable base-pitch export to
MIDI, MusicXML and LilyPond. PCM/DDA, noise and LFO CH1/CH2 intervals are omitted
from notes; original timbres are not reproduced. MIDI uses pitch bends;
MusicXML/LilyPond use the existing sixteenth-note grid. Score channel IDs are
`huc6280-ch1` through `huc6280-ch6`. Dual-chip and instrument exports are unsupported.

## Y8950 scores

Y8950 FM supports MIDI, MusicXML and LilyPond, including optional Sega PSG tones.
Score channel IDs are `y8950-ch1` through `y8950-ch9`. ADPCM, rhythm-mode CH7–9
and CSM intervals are omitted; original timbres and envelope release are not
reconstructed. MusicXML/LilyPond use the existing sixteenth-note grid.

## Version 0.2.6

32X PWM playback now defaults to the MAME-derived FIFO/timer core with
cycle-normalized amplitude. The PWM clock is taken from the VGM header.
The package includes the BSD-3-Clause license and source provenance.
YM2151 S98 normalization is also included in this release.

## Version 0.2.7

Adds npm discovery keywords for VGM/VGZ/S98, sound chips and supported score exports.

## Version 0.2.8

The shared playback engine now uses the common chip-mixer PCM implementation.
The npm payload includes `soundchip_mixer.js` and its complete dependency path,
so CLI and Node rendering load the same playback core as the Analyzer.
Existing render defaults and mute options retain their behavior.

## Version 0.2.9

Adds direct FM-only MDX export for YM2151 / YM2164 sources and Sega PSG
per-channel mute controls (`psg-ch-1` through `psg-ch-4`, with CH4 for noise).
PSG muting preserves register writes, oscillator phase and Tone 3-linked noise.

## Version 0.2.10

- MSM5205 ADPCM playback, normal seeking, independent mute/mixer and WAV
  output, including HuC6280 + MSM5205 PC Engine CD tracks (VGM 1.72).
- Game Boy DMG and NES APU/FDS playback state snapshots for shared-core seek
  checkpoints. The CLI continues to replay silently for `render --start`.
- Bounded cooperative audio generation for interactive playback, preserving
  partially consumed waits and exact sample timing.

## Version 0.2.11

Optimizes the bundled YM2612, Sega PSG, YM2203, YM2608, YM2610 / YM2610B,
YM2413 and RF5C164 WASM cores used by WAV rendering. Tested PCM matches
the previous builds; runtime assertions remain enabled. Analysis and export
command interfaces are unchanged.

## Version 0.2.12

Adds experimental SPC CPU/DSP observation and BRR pitch estimation to the Node
API and CLI, with MIDI / MusicXML / LilyPond exports and manual BRR references.
The shared MIDI writer retains bends and timing; score algorithms and
limitations match the browser Analyzer. Existing VGM APIs remain unchanged.
SPC engine sources, license notices and rebuild instructions are bundled.

## Version 0.2.13

WAV rendering now uses the Analyzer's measured chip output levels, with
Sega PSG, AY-3-8910 and NES APU defaults based on single-voice AC RMS.
Existing OPN FM/SSG/rhythm/ADPCM ratios are preserved. This is a fixed output
balance, not track loudness normalization; waveform, instrument and channel
count still affect the result.

YM2608's borrowed PCM path now passes through the shared playback Mixer, so
its gain, pan and mute settings also reach rendered audio. Analysis, export
formats and low-level chip PCM units are unchanged.

## Version 0.2.14

WAV rendering adopts the shared listening levels: Sega PSG `0.35`,
AY-3-8910 `0.85`, NES APU `1.16`, Game Boy `0.36`, and HuC6280 `0.44`.
Mixer values now use source units, so Genesis FM/PSG do not receive an extra
machine-balance multiplier. Genesis and standalone PSG both use `0.35`.
OPN internal FM/SSG/rhythm/ADPCM ratios remain unchanged; analysis and score
exports are unchanged. This fixed balance does not normalize individual
tracks, waveforms, instruments, or polyphony.

## Version 0.2.15

WonderSwan VGM playback, channel mute and wavetable note exports are now
included. Sample extraction exports written Wave RAM and timed CH2 Voice PCM
through the API and CLI. Voice captures retain their original write timing,
output routing and native-tick phase for JSON / ZIP export and preview WAVs.
Wave metadata distinguishes played intervals from unused RAM candidates.
The bundled WASM core, component notices and sample format documentation are
included; external ROMs are not required.

## MDX export

The new `--format mdx` option writes a compiled `.mdx` file for YM2151 FM A–H.
Using the installed CLI:

```sh
tetorica-vgm export song.vgz --format mdx --bpm 120 --output song.mdx
```

The same conversion is available in the browser's **MML / MDX** dialog.
It uses a sixteenth-note grid and sampled voices, with rounded semitone pitch.
No PDX is produced. CH8 noise, partial keys, CSM, live register changes,
pan, LFO, audible release and loops are not reproduced. Warnings are printed
on stderr and returned by `exportSource()`. See [CLI.md](CLI.md#mdx-file-export).
MDX export is available starting with version 0.2.9.


## WonderSwan

Single-chip WonderSwan VGM 1.71 playback supports four wavetable channels,
Noise, Sweep and direct/streamed Voice PCM. Register commands (`0xBC`) and
big-endian physical RAM writes (`0xC6`) use the shared WASM core. No external
ROM is required. Normal seeking replays the chip state; there are no DSP seek
checkpoints. Hyper Voice / DMA and dual-chip / variant headers are unsupported.

Channel mute IDs are `wonderswan-ch-1` through `wonderswan-ch-4`. The source
Mixer default is unity (`1.0`), matching Playground; this chip is not calibrated.
Live/Song Note-ish and MIDI / MusicXML / LilyPond export use wavetable base
pitches. CH2 Voice PCM, CH3 Sweep and CH4 Noise intervals are omitted from
notes, as are waveform harmonics and RAM rewriting. Score channel IDs are
`wonderswan-ch1` through `wonderswan-ch4`. Timed Voice PCM capture is available through the samples API / CLI; instrument conversion and TFI/VGI/SBI export are unavailable.
Written wave RAM snapshots are available as described below.

```sh
node cli/main.js render test/fixtures/wonderswan-tone.vgz --output wonderswan.wav
node cli/main.js export test/fixtures/wonderswan-tone.vgz --format midi --output wonderswan.mid
```

The original fixture contains no game or ROM data. This repository's shared
Browser/Node paths share this support, available in `tetorica-vgm` 0.2.15.


## WonderSwan waveform snapshots

Sample Explorer can extract complete 16-byte wave RAM snapshots as 32 unsigned
4-bit points, low nibble first. Identical wave contents share one definition;
observations retain the written time, channel, physical bank/address and base
pitch. Missing bytes remain unknown and incomplete waveforms are omitted.
These are RAM snapshots, not recovered instrument boundaries or Voice PCM.

The Browser provides a waveform graph, reusable `ws.setWaveform(channel, [...])`
code, JSON, a one-second isolated preview and preview WAV. Preview uses the
selected observation's fixed base pitch (A4 when no active pitch was written),
centered volume 9/9 and short fades. Original pan, volume automation, Sweep,
Noise, Voice PCM and song timing are not replayed. WAV is an audition of the
looping waveform, not a detected original sample length.

```sh
node cli/main.js samples song.vgz --json
node cli/main.js samples song.vgz --id 1 --output wave.json
node cli/main.js samples song.vgz --all --output waves.zip
node cli/main.js samples song.vgz --id 1 --format wav --occurrence 1 --output wave.wav
```

JSON uses `schemaVersion: 1`, `chip: "wonderswan"`, `kind: "wave"`,
`representation: "written-wave-ram"`, `waveform`, `packedBytes` and
`observations` in original 44,100 Hz VGM sample time. The ZIP includes a shared
manifest. This support is available in `tetorica-vgm` 0.2.15.

## WonderSwan timed Voice PCM captures

Sample analysis also captures CH2 Voice PCM, including original byte times,
CH2 gating and live headphone output / sample-routing settings. Captures split
at Voice disable, CH2 key-off, end of file or 10-second display windows. These
are timed channel-output captures, not inferred original instruments.

```sh
node cli/main.js samples song.vgz --json
node cli/main.js samples song.vgz --id 1 --output voice.json
node cli/main.js samples song.vgz --id 1 --format wav --output voice.wav
node cli/main.js samples song.vgz --all --output samples.zip
```

Voice JSON uses `kind: "voice-pcm"` and `representation: "timed-voice-pcm"`,
with source start, duration, current/held register snapshots, and timed writes.
The 44.1 kHz stereo WAV follows the captured hardware routing and source DAC
phase, before the playback Mixer. Prior wavetable output is excluded.

Wave RAM definitions remain available separately. `usedInPlayback` and each
observation's `audible` fields distinguish enabled, nonzero-volume headphone
playback intervals from unplayed RAM candidates; they do not simulate waveform
audibility or infer note boundaries. Wave preview remains an isolated,
fixed-pitch audition.
