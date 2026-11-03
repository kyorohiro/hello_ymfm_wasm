# Credits and implementation references

[Developer README](../README.md) | [日本語](attribution.ja.md)

Paths in code spans refer to the repository root. Component notices remain authoritative.

## License and Attribution

Unless otherwise noted, this repository uses the BSD 3-Clause License for both the upstream ymfm-derived parts and the original files added in this project. Vendored components and modifications to them retain their applicable licenses.
It uses [ymfm](https://github.com/aaronsgiles/ymfm) by Aaron Giles, and this repository also includes original work by kyorohiro under the same BSD 3-Clause License.
This repository includes the license text in `LICENSE`, and the packaged release files also include `LICENSE`.

The following files and directories in this repository are ymfm-originated works:

- `src/ymfm*` (the `src/segapsg.*` compatibility includes and `src/chip_state.h` are Tetorica additions)
- `examples/`
- [GeneralInfo.md](https://github.com/aaronsgiles/ymfm/blob/main/GeneralInfo.md)

### Tetorica Sega PSG

The original Sega PSG core is in [third_party/tetorica_sega_psg](../third_party/tetorica_sega_psg/README.md),
under its own BSD-3-Clause notice, copyright kyorohiro. It is separate from
upstream ymfm and credits [SMS Power!'s SN76489 documentation](https://www.smspower.org/Development/SN76489)
as a hardware reference. Its README describes embedding, provenance and the
unchanged pinned SDK layout.

### LilyPond export

The VGM Analyzer exports `.ly` files. Score preview uses MusicXML;
the LilyPond WASM engine and preview sources have been removed from the Analyzer.
The Analyzer, web runtime, and web runtime example packages do not include them.

The preserved LilyPond WASM experiment, Safari fixes, build instructions, and demo
are maintained separately in [kyorohiro/lilypond-wasm](https://github.com/kyorohiro/lilypond-wasm/tree/master/wasm).
LilyPond and its WASM port include **GPL-3.0-or-later** work;
the separate project retains the applicable licenses and third-party notices.

### MusicXML preview trial

The independent [MusicXML trial page](vgm_analyzer/osmd.html) uses
OpenSheetMusicDisplay 2.1.2 (BSD-3-Clause) and its bundled dependencies.
See [credits and licenses](vgm_analyzer/vendor/osmd/README.md).
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

### FM envelope editor inspiration: mmlx-lsp

The mouse-editable FM envelope UI was inspired by the FM Voice editing experience
in h1romas4's [mmlx-lsp](https://github.com/h1romas4/mmlx-lsp)
([VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=h1romas4.mmlx-lsp)).
The Playground and Synth envelope editors are original implementations for Tetorica's YM2612 controls.

### MAME / libvgm OKIM6295 (`third_party/mame-okim6295/`)

The JavaScript OKIM6295 ADPCM engine is adapted from BSD-3-Clause MAME/libvgm sources.
See [source notes](../third_party/mame-okim6295/README.md) and
[license](../third_party/mame-okim6295/LICENSE). No game ROMs are bundled.

### MAME OKIM6258 (`third_party/mame-okim6258/`)

The OKIM6258 decoder is adapted from Barry Rodewald's MAME implementation under BSD-3-Clause.
See the [license](../third_party/mame-okim6258/LICENSE) and
[pinned source and adaptation notes](../third_party/mame-okim6258/README.md).
Analyzer and runtime example packages include these notices in `licenses/mame-okim6258/`.

### MAME RF5C164 (`third_party/mame-rf5c164/`)

The RF5C164 PCM engine used for Mega-CD / Sega CD VGM playback is adapted from
[MAME's RF5C68 / RF5C164 implementation](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/devices/sound/rf5c68.cpp)
by Olivier Galibert and Aaron Giles. The adapted core and its generated
`rf5c164_wasm.wasm` build use the **BSD 3-Clause License**.
See [the license](../third_party/mame-rf5c164/LICENSE) and
[source and adaptation notes](../third_party/mame-rf5c164/README.md).
Packages containing this engine include these notices under `licenses/mame-rf5c164/`.

### MAME HuC6280 (`third_party/mame-huc6280/`)

The HuC6280 core is adapted from Charles MacDonald's BSD-3-Clause MAME implementation.
Pinned originals, license and adaptation notes are in `third_party/mame-huc6280/`.

### Nuked-OPN2 (`third_party/nuked-opn2/`)

`third_party/nuked-opn2/` vendors [Nuked-OPN2](https://github.com/nukeykt/Nuked-OPN2)
by Alexey Khokholov (Nuke.YKT), via [kyorohiro/Nuked-OPN2](https://github.com/kyorohiro/Nuked-OPN2)
(a pinned fork). It is an **optional, experimental alternate YM2612 engine**
you can switch to with `?engine=nuked` on the Playground, Synth, and VGM
Analyzer pages, alongside the default ymfm-based engine.

The Nuked core retains **GNU Lesser General Public License v2.1 or later**
terms. See `third_party/nuked-opn2/LICENSE` and its README for the pinned source
and provenance. Distributions offering this alternate engine include its
separate WASM module, complete modified source and standalone rebuild recipe
under `sources/`; see `sources/Nuked-OPN2.md` and `licenses/nuked-opn2/`.
The original Tetorica wrapper/build recipe's BSD-3-Clause notice is included
separately as `sources/LICENSE.tetorica`. The default ymfm core retains its
BSD-3-Clause terms.

### Sonic Pi sample assets (`docs/playground/samples/sonic-pi/`)

The audio files in `docs/playground/samples/sonic-pi/` are sample assets from
[Sonic Pi](https://github.com/sonic-pi-net/sonic-pi), used by the Playground for
sample playback and experiments. They are separate from the Tetorica source
code and are documented as **CC0 1.0** by Sonic Pi. See the upstream
[license](https://github.com/sonic-pi-net/sonic-pi/blob/stable/LICENSE.md),
[sample documentation](https://github.com/sonic-pi-net/sonic-pi/blob/stable/etc/samples/README.md),
and the local [sample notes](playground/samples/sonic-pi/README.md).

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
