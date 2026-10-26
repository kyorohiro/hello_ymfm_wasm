# Tetorica FM2612 (hello_ymfm_wasm)

[English](README.md) | [日本語](README.ja.md) | [AI/SI](READMD.ai.md)

Tetorica is a tool for live coding retro game sounds in JavaScript, including
the sounds of the Sega Genesis / Mega Drive and Game Boy.

This project includes:

- `tetorica-fm2612`: an npm package for controlling retro game sound chips from JavaScript.
- `tetorica-vgm`: an npm package for analyzing retro game VGM files, rendering WAV with channel mutes, and exporting scores, voices and FM-only MDX files.
- A browser-based synthesizer app for extracting instruments from VGM files, editing instrument sets with a collapsible Files view, and sharing Cassette ZIPs with FM Playground.
- A browser-based Playground app for live coding with an API inspired by Sonic Pi.
- A browser-based analyzer app for inspecting and playing VGM files.

![Tetorica FM2612 Playground](docs/tetorica_fm2612_playground_screen_shot.png)

[Tetorica FM2612 Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)

## Project goals

This repository has four goals:

- To understand the YM2612 chip.
- To create documentation that helps anyone understand the YM2612 chip.
- To create documentation that helps anyone embed YM2612 audio in a browser app or game.
- To preserve older game music and sound chip technology as cultural heritage that people today can read, investigate, learn from, and reconstruct—not only archive and play back.

## Feature status

[機能対応状況 / Feature status](docs/feature-status.md): implementation coverage, verification records, limitations and release status across Analyzer, CLI and Playground.

See [Memo.md](Memo.md#chip-playback-notes-english) for chip-specific playback details, limitations and implementation notes.

## Try it in the browser

You can try the WebAssembly build, the JavaScript wrapper, and the browser tools directly in the published pages.
This is the easiest way to test YM2612 control, sound design, and Genesis-oriented VGM analysis without setting up the full build flow first.

- Main page:
  [https://kyorohiro.github.io/hello_ymfm_wasm/](https://kyorohiro.github.io/hello_ymfm_wasm/)
- Sega Genesis / Mega Drive YM2612 FM Introduction with JavaScript:
  [https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html)
- Playground:
  [https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)
  Independent MSFA DX7 support is available through `await useSoundChip('dx7')`,
  including 16 voices, DX7 SysEx banks and Playground mixer/FX routing.
  Open `examples/dx7/dx7-init-sine.js` in FILES; the initial voice needs no external bank.
  Experimental SNES S-DSP is available through `await useSoundChip('snes')`: eight independent
  voices with BRR, explicit sample tuning and raw ADSR/GAIN controls.
  Try `examples/snes/snes-brr-melody.js`; its original BRR needs no game files.
  `Menu → Import → SPC…` offers **Song playback** (`useSoundChip('spc')`),
  **Instruments** (BRR, captured settings and editable SNES audition scripts),
  experimental **Song JavaScript** (readable BRR/instrument/note operations), and
  **Event trace** (a finite, editable DSP/RAM event timeline).
  All modes preserve the original SPC in a new Files folder. Instrument reference notes
  are assigned by the user; they are not inferred from BRR. Song playback runs until Stop.
  Song JavaScript records 0.1–600 seconds into `loadBRR`, `setPreset`, `setPitch`,
  `keyOn`, `timeline.waitUntil` and `keyOff` calls. The timeline starts after sample
  and preset loading; event times are elapsed seconds from that origin, so timer
  lateness does not slow all following events. PITCH remains in chip units, with no guessed
  original note names or loop structure. Song JavaScript automatically analyzes the
  BRR versions used in the chosen interval and lists their tuning reference notes.
  Reliable periodic sounds receive estimated fundamental/note/cents comments at
  32,000 Hz / PITCH4096; uncertain sounds retain provisional C4. You can correct
  each reference note and cents before converting, or use the defaults.
  Estimates can have octave errors and are not recovered original notes.
  Each confirmed reference configures both `loadBRR`'s `baseFrequencyHz` at
  `basePitch: 4096` and the generated note comments. Fractional cents are retained;
  unknown samples keep provisional `rootNote: "C4"`. This calibrates later
  `setNote`/`setFrequency` edits. The generated song itself keeps raw `setPitch`
  calls, BRR bytes, presets and timing, so its pitch does not change. No note-name
  playback calls are substituted. Reference edits reuse the capture; changing
  the duration or control step analyzes it again. Noise voices have no note label;
  pitch-modulated voices label the base pitch.
  The control step defaults to 20 ms
  (0 keeps all distinct changes; maximum 1000 ms). PITCH, volume and same-SRCN
  ADSR/GAIN updates are sampled; key and SRCN-change boundaries retain their
  original times. This is an editable approximation: initial envelope state,
  BRR snapshot timing and JavaScript timing can differ. Raw noise/pitch-modulation
  controls are retained; echo is omitted to protect relocated BRR. Warnings
  are saved with the source. Conversion rejects more than 20,000 musical events,
  256 BRRs or 64,512 total BRR bytes instead of saving partial data.
  Regenerate previously imported Song JavaScript from the original SPC to use
  the current timing and sample references; existing editable scripts are not rewritten.
  Event trace records 0.1–600 seconds, with a maximum of 1,000,000 writes.
  Edit its annotated `events` array to change raw chip values and timing; initial
  BRR/RAM and DSP bytes are saved alongside the code. It retains sample changes,
  echo, noise and pitch modulation. Note names, loops and tag fade are not inferred.
  Conversion first finds the RAM read by the DSP, then omits writes to unused CPU
  work RAM. All DSP writes remain. Generated rows include seconds and register
  labels, and the import status/source info report the retained DSP/RAM counts.
  This preserves the recorded playback; edits that reference other RAM regions
  may require additional original driver data that was not used in that interval.
  Song playback also supports opt-in `spc.onEvent(callback, {voices, types, intervalMs})`
  observations in Main and Worker. Callbacks receive distinct PITCH, signed stereo
  volume, instrument and key requests, plus raw global DSP writes. `clock` uses
  1,024,000 ticks per second; delivery is batched and is not an audio scheduling API.
  Initial notes are inferred, repeated KON requests retrigger, and a persistent KOFF
  is reported as `keyOffHeld`. The returned function unsubscribes. An `overflow`
  diagnostic reports interrupted observation; playback continues and observation
  resynchronizes without inventing missing history.
- Playground Runtime Embedded Demo:
  [https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html](https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html)
- Synth:
  [https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html)
  In `Envelope`, choose OP1–OP4 and drag the points to edit AR/TL,
  D1R/SL, D2R and RR while monitoring live chip-output RMS in cyan.
  Numeric controls and Cassette instruments update together.
  The graph shows relative register values; pitch, RS and SSG-EG affect actual timing.
- VGM Analyzer:
  [https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html)
  For SPC, open **Note-ish** to analyze the chosen interval in a background Worker.
  Eight SNES voices share Live History, Pitch, Song Timeline, keyboard and fretboard
  views. BRR reference notes/cents can be corrected without changing SPC playback.
  Estimates may have octave errors; uncertain samples use provisional C4, noise
  has no note, and pitch modulation shows its base pitch. Key requests are shown;
  audible envelopes, release tails, echo and later held-sample RAM edits are omitted.
  Analysis defaults to the first 120 seconds or the shorter tagged duration, up to
  600 seconds, 20,000 interpreted events and 256 BRRs / 64,512 BRR bytes.
  A 20 ms control step is adjustable down to 0.
  **Sheet Music** shares the same analysis controls. Once analysis completes,
  export MIDI, preview sheet music, or download MusicXML / LilyPond.
  Current BRR reference corrections apply to all note exports without changing
  SPC playback. Only the analyzed interval is exported; provisional references
  and other approximations are listed in each output. MIDI keeps timing and
  pitch bends on eight voice tracks with a fixed program / velocity. Scores use
  semitone pitches, a sixteenth-note grid and assumed 4/4 with an adjustable BPM;
  they are editable reference transcriptions. Original BRR timbres are not reproduced.

[VGM Analyzer sound chip support and limitations](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/support.html)

## npm packages

### tetorica-fm2612

[`tetorica-fm2612`](https://www.npmjs.com/package/tetorica-fm2612) lets you control retro game sound chips from JavaScript. Use it for browser playback or PCM/WAV generation in Node.js.

```sh
npm install tetorica-fm2612
```

Selected supported chips:

| Family | Chips |
| --- | --- |
| Yamaha OPN | YM2203, YM2608, YM2610 / YM2610B, YM2612 |
| Yamaha OPM | YM2151 |
| Yamaha OPL | YM2413, YM3812, YMF262 |
| PSG and console audio | AY8910, Sega PSG, Game Boy APU, NES APU + FDS, HuC6280 |
| PCM and ADPCM | RF5C164, Sega PCM, OKIM6258, OKIM6295 |

This browser example plays C4, D4 and E4 on the YM2612. Use a setup such as Vite that resolves npm module imports, then click the button.

```js
import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';
import {hzToBlockFnum} from 'tetorica-fm2612/pitch.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const button = document.createElement('button');
button.textContent = 'Do–Re–Mi';
document.body.append(button);

button.addEventListener('click', async () => {
  button.disabled = true;
  let chip;
  try {
    chip = await createSoundChip('ym2612', {execution: 'worklet'});
    const transport = new YM2612WorkletTransport(chip);
    const fm = new YM2612Synth({transport});
    fm.setPreset(0, FM_PRESETS.sine);
    await transport.start();

    for (const hz of [261.63, 293.66, 329.63]) { // C4, D4, E4
      const {block, fnum} = hzToBlockFnum(hz);
      fm.noteOn(0, block, fnum);
      await wait(300);
      fm.noteOff(0);
      await wait(100);
    }
  } finally {
    await chip?.dispose();
    button.disabled = false;
  }
});
```

See the [package README](packages/fm2612/README.md) for the complete chip list and APIs, and the [examples](https://github.com/kyorohiro/tetorica-fm2612-examples) for runnable Web/Node projects. High-level Synth API coverage varies by chip.

Version 0.2.21 updates the shared Playground runtime with native primary synth
configurations, applied-state voice inspection, channel-owned audition and
keyboard/sample-input hooks for embedding hosts. It also includes the HuC6280
and OKIM6258 high-level Synth modules. The website's mode selector, voice panels,
Guitar Keyboard widgets and Sample Editor dialog are separate from the npm
payload; hosts provide their own interface. See the
[runtime integration details](packages/fm2612/README.md#native-configurations-and-host-integration-0221).

### tetorica-vgm

The VGM Analyzer is also available as the [`tetorica-vgm` npm package](https://www.npmjs.com/package/tetorica-vgm)
for command-line analysis, export and WAV rendering (Node.js 22+).

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
npx tetorica-vgm render song.vgz --output song.wav
```

See the [CLI quick start](packages/vgm/README.md) and [full CLI / Node API reference](CLI.md).
For maintainers, see [release procedures](README_RELEASE.md).

OPL-family melodic voices can be exported as SBI (2op or OPL3 4op), individually
or as a ZIP. The browser's **SBI Info** tab displays extracted voice parameters
and provides keyboard audition.

Export the voice on channel 1 at 1.5 seconds (`--channel` is 1-based):

```sh
npx tetorica-vgm export song.vgz --format sbi --at 1.5 --channel 1 --output voice.sbi
```

Extract melodic voices from the whole track into a ZIP:

```sh
npx tetorica-vgm export song.vgz --format sbi-zip --output voices.zip
```

## Try it on itch.io

- [https://kyorohiro.itch.io](https://kyorohiro.itch.io)

## Building WASM from the fixed SDK

YM2612, YM2203, YM2608, YM2610/B, YM2151/YM2164, OKIM6258, YM2413,
YM3526, YM3812, YMF262, Y8950, AY-3-8910/YM2149, Sega PSG, RF5C164, 32X PWM,
HuC6280, Game Boy APU, NES APU/FDS, SNES SPC700/S-DSP, Sega PCM, K051649, YM3438 and YMF276 builds verify
and use the complete, pinned `tetorica-soundchip-native` source release
included in `third_party/`.
With Emscripten and Python 3 installed, run a chip recipe such as
`sh scripts/build_okim6258_wasm.sh`.
See the full recipe list and [build and SDK update instructions](docs/building_ym2612_wasm.md).

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

### FM envelope editor inspiration: mmlx-lsp

The mouse-editable FM envelope UI was inspired by the FM Voice editing experience
in h1romas4's [mmlx-lsp](https://github.com/h1romas4/mmlx-lsp)
([VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=h1romas4.mmlx-lsp)).
The Playground and Synth envelope editors are original implementations for Tetorica's YM2612 controls.

### MAME / libvgm OKIM6295 (`third_party/mame-okim6295/`)

The JavaScript OKIM6295 ADPCM engine is adapted from BSD-3-Clause MAME/libvgm sources.
See [source notes](third_party/mame-okim6295/README.md) and
[license](third_party/mame-okim6295/LICENSE). No game ROMs are bundled.

### MAME OKIM6258 (`third_party/mame-okim6258/`)

The OKIM6258 decoder is adapted from Barry Rodewald's MAME implementation under BSD-3-Clause.
See the [license](third_party/mame-okim6258/LICENSE) and
[pinned source and adaptation notes](third_party/mame-okim6258/README.md).
Analyzer and runtime example packages include these notices in `licenses/mame-okim6258/`.

### MAME RF5C164 (`third_party/mame-rf5c164/`)

The RF5C164 PCM engine used for Mega-CD / Sega CD VGM playback is adapted from
[MAME's RF5C68 / RF5C164 implementation](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/devices/sound/rf5c68.cpp)
by Olivier Galibert and Aaron Giles. The adapted core and its generated
`rf5c164_wasm.wasm` build use the **BSD 3-Clause License**.
See [the license](third_party/mame-rf5c164/LICENSE) and
[source and adaptation notes](third_party/mame-rf5c164/README.md).
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
