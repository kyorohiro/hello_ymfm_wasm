# Tetorica FM2612 (hello_ymfm_wasm)

Tetorica FM2612 is a browser toolkit for JavaScript music coding, VGM analysis,
and YM2612 FM sound design. Open a VGM, explore its instruments, and edit and
audition extracted TFI files in a folder-based workspace.

FM synthesis can be difficult at first.
It asks you to learn both parameter design and performance technique.

The Sega Genesis / Mega Drive is a retro game console, but it includes the YM2612,
a 4-operator, 6-channel FM sound chip.
Compared with modern synth setups, that may look small, but it created a huge amount of memorable music and sound.

A lot of that know-how still survives in VGM files made and preserved by enthusiasts.
By reading and replaying them, we can study how people actually used the chip and how they shaped its sound.

With Tetorica, we prepared an environment where you can try it directly from JavaScript.
If that sounds interesting, let&apos;s keep going.

![Tetorica FM2612 Playground](docs/tetorica_fm2612_playground_screen_shot.png)

[Tetorica FM2612 Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)

Playground VGM import also saves OPN FM key-on timbres as virtual files such as
`/presets/song/ym2612_ch1_001.tfi` and adds them to the Operator Preset list.
Repeated timbres within each channel are deduplicated; importing the same filename
again uses a new folder (`song-2`, etc.). TFI stores static FM parameters, not
pan, LFO, or pitch/volume automation.

## Project goals

This repository has four goals:

- To understand the YM2612 chip.
- To create documentation that helps anyone understand the YM2612 chip.
- To create documentation that helps anyone embed YM2612 audio in a browser app or game.
- To preserve older game music and sound chip technology as cultural heritage that people today can read, investigate, learn from, and reconstruct—not only archive and play back.

## What this repository provides

- YM2612 WebAssembly builds and JavaScript wrappers for browser-side use
- a reusable `Playground(...)` runtime layer for browser games and app embedding
- a browser playground for trying YM2612 control and live coding from JavaScript
- a browser synth app for hands-on YM2612 sound design
- a VGM analyzer for playback, inspection, and patch extraction, including YM2610 / YM2610B FM, SSG and ADPCM-A/B playback from embedded VGM ROM blocks

## Download

Release files are available here:

- WebAssembly (wasm) builds for YM2612
- JavaScript wrappers for browser-side use
- browser demos and app-style tools

- [https://github.com/kyorohiro/hello_ymfm_wasm/releases](https://github.com/kyorohiro/hello_ymfm_wasm/releases)

GitHub Releases is the primary download entry point for packaged wasm and browser-side runtime files.

## Try it in the browser

You can try the WebAssembly build, the JavaScript wrapper, and the browser tools directly in the published pages.
This is the easiest way to test YM2612 control, sound design, and Genesis-oriented VGM analysis without setting up the full build flow first.

- Main page:
  [https://kyorohiro.github.io/hello_ymfm_wasm/](https://kyorohiro.github.io/hello_ymfm_wasm/)
- Sega Genesis / Mega Drive YM2612 FM Introduction with JavaScript:
  [https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html)
- Playground:
  [https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)
- Playground Runtime Embedded Demo:
  [https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html](https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html)
- Synth:
  [https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html)
- VGM Analyzer:
  [https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html)

## First session: explore a VGM instrument

1. Open [Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html) and import a supported VGM/VGZ file.
2. Expand `presets/<filename>/` in the file explorer and open a `.tfi` file.
3. Edit its FM parameters and use the number and letter keys to audition it. Text and number fields keep normal typing behavior; leave the field before playing.
4. Use **Export Cassette** to download your project, including its virtual files, before leaving the page. TFI editor changes update the virtual file; they do not write back to your original disk file.

## CLI / Node.js

The VGM Analyzer is also available as the [`tetorica-vgm` npm package](https://www.npmjs.com/package/tetorica-vgm)
for command-line analysis, export and WAV rendering (Node.js 22+).

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
npx tetorica-vgm render song.vgz --output song.wav
```

See the [CLI quick start](cli/README.md) and [full CLI / Node API reference](CLI.md).
For maintainers, see the [npm release procedure](READMD_RELEASE.md).

## Help and bug reports

Start with the [interactive introductions](https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html).
For a reproducible problem, [open a bug report](https://github.com/kyorohiro/hello_ymfm_wasm/issues/new?template=bug_report.md).
Include the page URL, browser/OS, steps, and expected versus actual behavior.
A small exported Cassette or a minimal code example helps us reproduce the issue.

## Try it on itch.io

- [https://kyorohiro.itch.io](https://kyorohiro.itch.io)

## License and Attribution

Unless otherwise noted, this repository uses the BSD 3-Clause License for both the upstream ymfm-derived parts and the original files added in this project. Vendored components and modifications to them retain their applicable licenses.
It uses [ymfm](https://github.com/aaronsgiles/ymfm) by Aaron Giles, and this repository also includes original work by kyorohiro under the same BSD 3-Clause License.
This repository includes the license text in `LICENSE`, and the packaged release files also include `LICENSE`.

The following files and directories in this repository are ymfm-originated works:

- `src/` except `src/segapsg.h` and `src/segapsg.cpp`
- `examples/`
- [GeneralInfo.md](https://github.com/aaronsgiles/ymfm/blob/main/GeneralInfo.md)

### LilyPond export

The VGM Analyzer exports `.ly` files. Score preview uses MusicXML;
the LilyPond WASM engine and preview sources have been removed from the Analyzer.
The Analyzer, web runtime, and web runtime example packages do not include them.

The preserved LilyPond WASM experiment, Safari fixes, build instructions, and demo
are maintained separately in [kyorohiro/lilypond-wasm](https://github.com/kyorohiro/lilypond-wasm/tree/master/wasm).
LilyPond and its WASM port include **GPL-3.0-or-later** work;
the separate project retains the applicable licenses and third-party notices.

### MusicXML preview trial

The independent [MusicXML trial page](docs/vgm_analyzer/osmd.html) uses
OpenSheetMusicDisplay 2.1.2 (BSD-3-Clause) and its bundled dependencies.
See [credits and licenses](docs/vgm_analyzer/vendor/osmd/README.md).
LilyPond `.ly` export remains available. Score preview uses MusicXML.
To try locally, run `python3 -m http.server 38088 --directory docs` from the
repository root and open `http://localhost:38088/vgm_analyzer/osmd.html`.
Choose a VGM/VGZ file, select channels and BPM, then press Preview. Sample notes
and MusicXML download are also available. The Analyzer includes an **Export Music Sheet** button with BPM/channel selection,
score preview and MusicXML download, using the same dialog layout as LilyPond.
The independent trial page is also packaged.
MIDI and MML dialogs use the same suggested BPM as LilyPond; manual adjustments
are preserved while reopening a dialog for the same track.

### Prior work and implementation references: libymfm.wasm

We acknowledge [libymfm.wasm](https://github.com/h1romas4/libymfm.wasm)
by Hiromasa Tanaka (h1romas4) as a preceding project bringing ymfm and other
sound-chip emulation to WebAssembly. Its work overlaps with this project's
browser sound-chip playback and provides a useful implementation reference.

For OKIM6258 support, we reviewed
[`chip_okim6258.rs` at `bb006894793c573b33a79a211e2769d021556aec`](https://github.com/h1romas4/libymfm.wasm/blob/bb006894793c573b33a79a211e2769d021556aec/src/rust/sound/chip_okim6258.rs).
That file identifies itself as Hiromasa Tanaka's Rust port of Barry Rodewald's
MAME implementation, based on MAME revision
`70743c6fb2602a5c2666c679b618706eabfca2ad`, under BSD-3-Clause.
See the [libymfm.wasm license at the reviewed revision](https://github.com/h1romas4/libymfm.wasm/blob/bb006894793c573b33a79a211e2769d021556aec/LICENSE).

The C++ OKIM6258 decoder here is adapted directly from the pinned MAME source;
libymfm.wasm's Rust port was reviewed as prior work and is not copied here.

### MAME OKIM6258 (`third_party/mame-okim6258/`)

Analyzer playback includes OKIM6258 4-bit ADPCM, alone or mixed with the primary
engine (including YM2151). VGM direct writes and DAC streams supply sample data;
no external sample ROM is required. The decoder is adapted from Barry Rodewald's
MAME implementation under BSD-3-Clause. See the
[license](third_party/mame-okim6258/LICENSE) and
[pinned source and adaptation notes](third_party/mame-okim6258/README.md).
Analyzer and runtime example packages include these notices in
`licenses/mame-okim6258/`.

3-bit ADPCM, recording, and a second OKIM6258 instance are not implemented.
Unsupported header configurations report a playback error; second-instance
writes/streams are warned about and skipped. This adds playback, not OKI
instrument analysis or sample export. Verification uses synthetic VGM and
real WASM cores; real-track listening remains to be checked.

Build: `sh scripts/build_okim6258_wasm.sh`.
Test: `node --test web/okim6258.test.mjs`.

### MAME RF5C164 (`third_party/mame-rf5c164/`)

The RF5C164 PCM engine used for Mega-CD / Sega CD VGM playback is adapted from
[MAME's RF5C68 / RF5C164 implementation](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/devices/sound/rf5c68.cpp)
by Olivier Galibert and Aaron Giles. The adapted core and its generated
`rf5c164_wasm.wasm` build use the **BSD 3-Clause License**.
See [the license](third_party/mame-rf5c164/LICENSE) and
[source and adaptation notes](third_party/mame-rf5c164/README.md).
Packages containing this engine include these notices under `licenses/mame-rf5c164/`.

### Nuked-OPN2 (`third_party/nuked-opn2/`)

`third_party/nuked-opn2/` vendors [Nuked-OPN2](https://github.com/nukeykt/Nuked-OPN2)
by Alexey Khokholov (Nuke.YKT), via [kyorohiro/Nuked-OPN2](https://github.com/kyorohiro/Nuked-OPN2)
(a pinned fork). It is an **optional, experimental alternate YM2612 engine**
you can switch to with `?engine=nuked` on the Playground, Synth, and VGM
Analyzer pages, alongside the default ymfm-based engine.

Unlike the rest of this repository, `third_party/nuked-opn2/` (and the
`nuked_opn2_wasm.wasm` build produced from it) is licensed under the
**GNU Lesser General Public License v2.1 or later**, not BSD 3-Clause. See
`third_party/nuked-opn2/LICENSE` and `third_party/nuked-opn2/README.md` for
details. It is not included in the packaged release/embed builds
(`scripts/package_*.sh`), so anyone embedding only the default ymfm build is
unaffected.

### Sonic Pi sample assets (`docs/playground/samples/sonic-pi/`)

The audio files in `docs/playground/samples/sonic-pi/` are sample assets from
[Sonic Pi](https://github.com/sonic-pi-net/sonic-pi), used by the Playground for
sample playback and experiments. They are separate from the Tetorica source
code and are documented as **CC0 1.0** by Sonic Pi. See the upstream
[license](https://github.com/sonic-pi-net/sonic-pi/blob/stable/LICENSE.md),
[sample documentation](https://github.com/sonic-pi-net/sonic-pi/blob/stable/etc/samples/README.md),
and the local [sample notes](docs/playground/samples/sonic-pi/README.md).

## Links

- `ymfm` repository:
  - https://github.com/aaronsgiles/ymfm
- `Nuked-OPN2` (original, and the pinned fork vendored in `third_party/nuked-opn2/`):
  - https://github.com/nukeykt/Nuked-OPN2
  - https://github.com/kyorohiro/Nuked-OPN2
- `MAME`:
  - https://www.mamedev.org/
- `retropc.net`:
  - http://retropc.net/cisc/m88/
- `ymfm` examples:
  - https://github.com/aaronsgiles/ymfm/tree/main/examples
- `libymfm.wasm`:
  - https://github.com/h1romas4/libymfm.wasm
- `ymfm` source for YM2612 registers and behavior:
  - `src/ymfm_opn.h`
  - `src/ymfm_opn.cpp`
- YM2612 pin reference:
  - http://www.chipdir.nl/pinusr/ym2612.txt
- YM2612 overview:
  - https://www.vgmpf.com/Wiki/index.php?title=YM2612
- Genesis development discussion and practical notes:
  - https://gendev.spritesmind.net/forum/viewtopic.php?start=585&t=386
- YM2612 music uploads:
  - https://chipmusic.org/music#s=ym2612
- GENajam:
  - https://github.com/jamatarmusic/GENajam
- megatoy:
  - https://github.com/ulalume/megatoy
- Maple's Garden article:
  - https://another.maple4ever.net/archives/3027/
- Aidan Lawrence's Sega Genesis video game music player:
  - https://www.aidanlawrence.com/hardware-sega-genesis-video-game-music-player/
- VGM specification:
  - https://vgmrips.net/wiki/VGM_Specification
- SMS Power:
  - https://www.smspower.org/

### AY-3-8910 / YM2149 VGM playback

The VGM Analyzer supports AY-3-8910 and YM2149 playback, standalone or with
YM2413, using a pinned MAME adaptation. Operator Info shows AY register settings
and tone pitch, with channel and source mute controls. Instrument editing and
MIDI/MML export for these chips are not yet available. See the
[AY implementation notes](third_party/mame-ay8910/README.md) for supported flags
and limitations. Build with `sh scripts/build_ay8910_wasm.sh`.

### YM2151 VGM playback

The VGM Analyzer supports YM2151 playback, including stereo output and optional
Sega PSG. Instrument analysis/editing and MIDI/MML export remain unavailable.
YM2164, a second YM2151, DAC streams and combinations with other chips such as
Sega PCM are not supported by this engine.
Build with `sh scripts/build_ym2151_wasm.sh`.

### OPL2 / OPL3 VGM playback

YM3812 and YMF262 VGM/VGZ files can be played in the Analyzer, with optional Sega
PSG. OPL3 supports both register ports; its four output buses are folded into
stereo (A+C left, B+D right). Analysis and instrument editing remain unavailable.
Second chips, OPL DAC streams and other chip combinations are not supported.
This does not emulate Sound Blaster PCM/DMA hardware. Build with
`sh scripts/build_ym3812_wasm.sh` and `sh scripts/build_ymf262_wasm.sh`.

Y8950 (MSX-Audio, FM + ADPCM) and YMF278B (OPL4/Moonsound, FM + PCM)
are also supported for VGM/VGZ playback. Sample data can be embedded in the
VGM (blocks 0x88 for Y8950, 0x84/0x87 for YMF278B). For Moonsound logs such as
Sonyc that omit the built-in samples, import your `yrw801.rom` (2 MiB) through
the file selector or drag and drop, then press Play. The ROM remains loaded
for track changes and seeking in the current page session; no wave ROM is bundled. Each supports optional Sega PSG; second chips, DAC streams and other
chip combinations other than the MSX configuration below are not supported. Build with `sh scripts/build_y8950_wasm.sh`
and `sh scripts/build_ymf278b_wasm.sh`.

YM3526 (OPL) VGM/VGZ playback is supported, including melodic and rhythm modes,
with optional Sega PSG. No sample ROM is required. This uses `ymfm::ym3526`,
including its fixed sine waveform, rather than substituting the OPL2 core.
Second YM3526 chips, DAC streams and other chip combinations remain unsupported;
instrument editing and note extraction are not yet available.

To inspect and reconstruct this playback path:

- `web/ym2612vgm.js` reads the VGM 1.51+ clock at `0x54` and decodes `0x5B rr vv`
  into a YM3526 register-write event. `0xAB` identifies the unsupported second chip.
- `web/vgmplayer.js` sends writes to `web/ym3526audioengine.js`, which advances
  the chip during VGM waits and resamples its mono output to stereo buffers.
- `web/ym3526.js` exposes register writes, reads, IRQ hooks and sample generation
  through `wasm/ym3526_wasm.cpp`; the chip implementation is in `src/ymfm_opl.*`.
- Rebuild with `sh scripts/build_ym3526_wasm.sh` (Emscripten required). Generated
  browser assets go to `docs/generated/`; sync JavaScript with
  `sh scripts/sync_web_js_to_docs.sh`.
- Run `node --test web/opl.test.mjs` to verify register delivery, audible output,
  rhythm mode, timers, waveform behavior and reproducible resets/seeks.

### MSX multi-chip playback

The Analyzer now plays Y8950 + AY-3-8910/YM2149 + YM2413 together, including
Y8950 ADPCM data embedded in VGM blocks. Y8950 plus either AY or YM2413 is also
accepted. This path uses the existing chip cores; no additional MAME core is
introduced. The combined mode currently offers playback and parsed events,
not instrument analysis or editing.

`web/multichipaudioengine.js` registers engines by chip type and instance index.
Each owns its register state, sample memory and resampling state. Parser targets
route writes and sample blocks to that instance; the mixer advances every engine
by the same duration, sums outputs and applies master volume once. Muted engines
continue advancing. `web/msxaudioengine.js` constructs the MSX chip adapters.

The programmatic `chips` option accepts descriptors `{type, index, options}`,
so the registry can represent repeated types without sharing chip state.
Dual-chip playback is **not verified** and is still rejected in the Analyzer UI.
Other combinations need adapters and validation before being offered there.
AY, YM2413 and Y8950 DAC streams remain unsupported; they are skipped with a visible warning while other playback continues.

Run `node --test web/ay8910.test.mjs` for three-chip mixing against independent
renders, embedded ADPCM, reset/seek repeatability and sample clearing between
songs. These fixtures are synthetic; real-game playback remains to be checked.
