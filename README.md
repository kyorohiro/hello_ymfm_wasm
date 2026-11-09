# Tetorica — Retro sound chips for JavaScript, WebAssembly and C/C++

[English](README.md) | [日本語](README.ja.md) | [AI/SI](READMD.ai.md)

Tetorica is a toolkit for learning, playing and embedding many retro sound chips:
Yamaha FM, Sega PSG, Game Boy / NES APUs, SNES S-DSP, PlayStation SPU, Saturn SCSP, C64 SID and more.
[Try the chips immediately in the browser Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html), with no installation.

For your own apps and games, the **[`tetorica-fm2612` npm package](https://www.npmjs.com/package/tetorica-fm2612)**
provides **high-level Synth APIs** for musical notes, presets and chip-specific sound controls,
alongside **low-level register / RAM / PCM APIs**, TypeScript declarations and **prebuilt WASM**.
Reusable **native C/C++ cores** and build recipes are available through
[`tetorica-soundchip-native`](https://github.com/kyorohiro/tetorica-soundchip-native).

## Project goals

These four goals began with YM2612 and now guide the wider sound-chip toolkit:

- To understand the YM2612 chip.
- To create documentation that helps anyone understand the YM2612 chip.
- To create documentation that helps anyone embed YM2612 audio in a browser app or game.
- To preserve older game music and sound chip technology as cultural heritage that people today can read, investigate, learn from, and reconstruct—not only archive and play back.

Distributions should also be easy to read and modify. Ship authored JavaScript
and CSS as original modules, with comments and names intact, without minification
or obfuscation. Desktop wrappers follow the same rule. Generated WASM and its
loaders are accompanied by their corresponding sources and rebuild instructions.

## Playground

[Open the Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)

[![Tetorica FM2612 Playground screenshot](docs/tetorica_fm2612_playground_screen_shot.png)](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)

<a id="feature-status"></a>

## Start with what you want to do

| I want to… | Start here |
| --- | --- |
| Try the tools without installing anything | [Browser home](https://kyorohiro.github.io/hello_ymfm_wasm/) · [itch.io](https://kyorohiro.itch.io/) |
| Get prebuilt WASM and low-level JavaScript | [`tetorica-fm2612` on npm](https://www.npmjs.com/package/tetorica-fm2612) · [API entry points](packages/fm2612/README.md#api-entry-points) · [WASM and source layout](tetorica_src/runtime/README.md) |
| Use high-level npm APIs for notes, presets and audio playback | [Synth / transport API catalog](packages/fm2612/README.md#api-entry-points) · [runnable Web / Node examples](https://github.com/kyorohiro/tetorica-fm2612-examples) |
| Embed live coding in my app | [Playground Runtime](tetorica_src/runtime/README.md#playground-runtime) |
| Inspect music files or extract instruments / scores | [VGM Analyzer](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html) · [`tetorica-vgm` CLI / Node API](packages/vgm/README.md) |
| Reuse the C / C++ cores or build a native plug-in | [`tetorica-soundchip-native`](https://github.com/kyorohiro/tetorica-soundchip-native) · [SPU plug-in source / previews](https://github.com/kyorohiro/tetorica-spu-plugin) |
| Add virtual files, Shell or Git to an editor | [`tetorica-virtual-files`](packages/virtual-files/README.md) · [npm](https://www.npmjs.com/package/tetorica-virtual-files) |
| Check implementation coverage and limits | [Feature status](docs/feature-status.md) · [Analyzer chip support](docs/vgm_analyzer/support.html) · [chip playback notes](Memo.md#chip-playback-notes-english) |

<a id="try-it-in-the-browser"></a>
<a id="try-it-on-itchio"></a>

## Browser tools

| Tool | Use it for |
| --- | --- |
| [Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html) | JavaScript live coding, chip registers, musical APIs, sample editing and FILES / Shell. Select a sound-chip mode. |
| [FM2612 Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html) | FM operators / envelopes, keyboard audition, VGM instrument import and TFI / VGI editing. Files / Cassette retain original VGM / VGZ files; select a Mega Drive / Mega CD / 32X reference song (YM2612 + Sega PSG + DAC + RF5C164 + PWM) to play, pause or resume. Select CH1–CH6 to observe and audition a paused FM voice; Copy creates a new editable Synth instrument while keeping your previous sound. Click the OP1–OP4 row numbers to select hardware Key On / Off for any instrument, including all Off; held notes update without restarting the other operators. Files / Cassette, Looper and Event Rec retain these gates and CH3 tuning; special mode uses CH3 alone. VGM playback stops and disables recording. Live (default On) follows the audible position; Off freezes the view. Mix provides per-channel Mute and independent YM2612 / Sega PSG / Mega CD PCM volumes (0–380%): 100% means raw source gain 1; initial and Reset levels use the shared calibrated System preset. PWM uses its shared fixed System level. Live highlight is optional (default On). |
| [SPU Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-spu/index.html) | PlayStation samples, PCM drawing, ADSR, PMON, noise, SPU reverb and PSF / VAB instrument extraction. |
| [DMG Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-dmg/index.html) | Game Boy DMG Pulse / Wave / Noise on one APU, round-robin keyboard, waveform drawing, presets and JavaScript export. English UI; [guide](docs/synth-dmg/README.md). |
| [2A03 Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-2a03/index.html) | Play Pulse / Triangle / Noise / DMC / FDS with hardware envelopes, Pulse / Triangle / Noise counter gates and live chip-state meters, draw DMC target curves or edit bits with DAC preview and Undo / Redo, draw FDS waves / modulation, import voices and samples from VGM / VGZ, then save presets, export DPCM or copy JavaScript. English UI; [guide](docs/synth-2a03/README.md). |
| [HuC6280 Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-huc6280/index.html) | PC Engine wavetable PSG, Noise, paired LFO, waveform drawing, five-bit DDA PCM audio, software ADSR, VGM / VGZ Wave / Noise / LFO / DAC-stream and direct-DAC PCM import and portable presets / JavaScript. English UI; [guide](docs/synth-huc6280/README.md). |
| [S-DSP Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-snes/index.html) | SNES eight-voice BRR / hardware Noise, ADSR / GAIN and shared Echo / FIR. Four-note hardware PMON uses a drawn Wave or BRR modulator with independent tuning / envelope on one shared canvas. Import SPC voices, optional isolated PMON pairs and Echo; load WAV / raw BRR into either sample target. Save both samples in portable v5 presets (strict v1–v4 migration) or copy JavaScript using existing APIs. [Guide](docs/synth-snes/README.md). |
| [SCSP Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-scsp/index.html) | Experimental Saturn PCM instruments, waveform drawing / import, envelopes and LFO. |
| [SID Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-sid/index.html) | Compare 6581 / PAL 8580 Preview: three-voice keyboard, Pulse width, hardware ADSR, shared filter and one-note Sync / Ring pair. Open a supported SID directly, preview the song and capture a voice for this keyboard. Portable v2 presets remember the model; v1 presets load as 6581. Player snapshots also load, including independent pairs with no selected source waveform. Edit and copy readable Playground JavaScript. [Guide](docs/synth-sid/README.md). |
| [C64 SID Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html?mode=c64) | Three voices, ADSR, Sync / Ring and shared filter through readable Main / Worker code, with an applied-state SID tab. Primary SID defaults to 6581; create an independent PAL 8580 Preview instance for comparison. [Guide](docs/sid.md) · [standalone 6581 filter lab](docs/playground/sid-lab/README.md). |
| [SID Player](https://kyorohiro.github.io/hello_ymfm_wasm/sid-player/index.html) | Play supported PAL PSID v2 / RSID v2 tunes with Auto / 6581 / 8580 Preview selection and live voice / filter settings. Capture a single-wave voice or isolated Sync / Ring pair as a SID Synth preset. VBI and CIA use C64 hardware interrupts, safe driver RAM and a limited built-in environment or your own ROMs. Direct VBI remains a 6581 option. Original demos and readable sources included. [Guide and limits](docs/sid-player/README.md). |
| [VGM Analyzer](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html) | Playback, chip/channel inspection, supported sample / FM voice extraction and reference transcriptions. |
| [MIDI Playground](https://kyorohiro.github.io/tetorica-midi-playground/index.html) | A separate macOS MIDI live-coding app; [source and releases](https://github.com/kyorohiro/tetorica-midi-playground). |
| [YM2612 introduction](https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html) | Learn FM synthesis and the chip through JavaScript. |

[Playground screenshot](docs/tetorica_fm2612_playground_screen_shot.png) ·
[Detailed browser / SPC workflows](docs/browser_workflows.md) ·
[Embedded runtime demo](https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html)

## Which games, systems and file formats?

Coverage follows **sound chips and input formats**, rather than a list of supported game titles.
This is an audio toolkit; it does not run game ROMs or emulate complete consoles.
These are representative systems, not a guarantee that every game's music or instrument bank can be recovered.

| System / sound family | What to look for |
| --- | --- |
| Mega Drive / Genesis, Mega-CD / Sega CD, 32X | YM2612 + Sega PSG, RF5C164 PCM, PWM; VGM analysis and programmable instruments. CD-DA is a separate audio source. |
| PC-88 / PC-98, Neo Geo | YM2203 / YM2608 / YM2610/B; FM, SSG and the relevant rhythm / ADPCM paths. |
| X68000 and arcade FM / PCM | YM2151, OKIM6258 / OKIM6295, Sega PCM; supported VGM configurations vary. |
| Master System / Game Gear, MSX, AdLib / OPL | Sega PSG, AY8910, YM2413, Y8950, SCC / SCC+, OPL / OPL2 / OPL3 / OPL4. |
| Famicom / NES + FDS, Game Boy | APU instruments and supported VGM playback / analysis. Region and expansion limits are chip-specific. |
| PC Engine / CD-ROM² | HuC6280, MSM5205 ADPCM and CD-DA APIs; supported VGM playback / analysis. |
| Super Famicom / SNES | SPC song playback, BRR instruments, experimental note analysis / editable JavaScript. |
| PlayStation 1 | SPU instruments and static VAB extraction from PSF1 / MiniPSF sets; **not PSF song playback**. |
| Sega Saturn | Experimental SCSP instruments / register APIs; **no SSF song playback or 68000 execution**. |
| Commodore 64 | npm 0.2.37+: `SidCore`, `Sid8580Core` and `SidSynth` ([examples](packages/fm2612/README.md#c64-sid-6581-and-8580-preview)). Experimental 6581 / PAL 8580 Preview instruments, shared filter and Main / Worker APIs. Playground's primary SID defaults to 6581; 8580 uses an independent instance. The [browser SID Player](docs/sid-player/README.md) runs PAL, single-SID PSID VBI / CIA and RSID v2 with **6581 / 8580 Preview** selection. Direct VBI is a 6581 option; the unchanged [reference CLI](docs/sid-reference.md) writes comparison WAVs. NTSC / multi-SID and accurate volume-DAC digi remain outside Player coverage. ROM-dependent / BASIC startup needs user firmware and further compatibility checks; no C64 ROM is bundled. |
| Atari 8-bit, WonderSwan | POKEY and WonderSwan sound cores; see the Analyzer table for file / analysis limits. |

| Input | Supported workflow |
| --- | --- |
| VGM / VGZ | Browser Analyzer and CLI playback / inspection; chip-specific voice, sample and score exports. Some Playground modes import editable JavaScript. |
| S98 | Supported single Yamaha-device configurations; compressed / multi-device input is outside the current scope. Check the [input specification](CLI.md#s98-input-and-source-documents). |
| SPC / BRR | SPC CPU / DSP playback and analysis; independent BRR instrument authoring. [Conversion details and limits](docs/browser_workflows.md). |
| VAB or matching VH + VB | Standard Sony v6 / v7 banks; choose and audition a Tone in Playground / SPU Synth. |
| PSF1 / MiniPSF + PSFLib | Select files or a folder, resolve dependencies and statically extract recognized VAB banks. No game-driver execution, PSF2 or universal instrument recovery. [SPU import guide](docs/synth-spu/README.md#ps1-sound-banks). |
| Audio / instrument files | PCM authoring and chip-specific sample conversion; TFI / VGI, OPM, SBI and DX7 SysEx have separate import / export coverage. |

For a particular VGM, run `npx tetorica-vgm support song.vgz --json`.
Read the [Analyzer support table](docs/vgm_analyzer/support.html) for combinations, external ROM requirements and export limitations.
Playback support, instrument editing and note transcription are separate capabilities; transcriptions are editable references, not recovered original scores.

## Which sound chips can I use?

| Family | Included cores / APIs |
| --- | --- |
| Yamaha OPN | YM2203, YM2608, YM2610 / YM2610B, YM2612, YM3438, YMF276, YMF288 |
| Yamaha OPM / OPP | YM2151 / YM2164 |
| Yamaha OPLL / OPL | YM2413, YM3526, YM3812, Y8950, YMF262, YMF278B |
| PSG / wavetable / console | AY-3-8910 / YM2149, Sega PSG, Game Boy APU, NES APU + FDS, HuC6280, K051649 / K052539, POKEY, WonderSwan |
| PCM / ADPCM | RF5C164, Sega PCM, OKIM6258, OKIM6295, MSM5205 |
| Standalone instruments / players | [PS1 SPU](docs/ps1_spu.md), [Saturn SCSP](docs/scsp.md), SNES S-DSP / SPC700, MSFA DX7, [experimental SID 6581 / 8580 Preview](docs/sid.md) |

The package-root `createSoundChip()`, Playground's `createSoundChip()` / `useSoundChip()`,
standalone classes and high-level Synth APIs have different entry points and coverage.
For example, PS1 and SCSP have explicit npm subpath imports; their Playground names are not package-root factory names.
[Choose an API by task](packages/fm2612/README.md#api-entry-points).
YM2612 defaults to ymfm; the optional Nuked-OPN2 backend has separate licensing.

<a id="download"></a>
<a id="npm-packages"></a>
<a id="tetorica-fm2612"></a>
<a id="get-wasm-and-low-level-javascript"></a>

## Use the npm APIs, WASM and native cores

```sh
npm install tetorica-fm2612
```

The `tetorica-fm2612` npm package includes many sound chips.
Use its [high-level Synth APIs](packages/fm2612/README.md#api-entry-points) for notes,
presets and instruments, or its low-level APIs for registers, RAM and PCM.
Available controls and import paths vary by chip.

The package contains ES modules, TypeScript declarations, prebuilt `generated/*_wasm.js`
loaders and matching `.wasm`, source archives and component notices. Browser and Node.js
use the same direct PCM cores; Node.js requires version 22 or later.

| Distribution / source | Where to find it |
| --- | --- |
| npm imports and asset URLs | [Package README](packages/fm2612/README.md), including `runtimeAssetUrl()` and custom WASM loading. |
| Source checkout | [JavaScript source map](tetorica_src/runtime/README.md), [`tetorica_src/runtime/generated/`](tetorica_src/runtime/generated/) for the complete prebuilt loader / WASM catalog, [`tetorica_src/node/`](tetorica_src/node/README.md) for Node audio. |
| Standalone web runtime ZIPs | [Packaging and artifact names](README_RELEASE.md); these contain runtime modules, generated assets and notices. |
| C / C++ and reproducible WASM builds | [Native SDK](https://github.com/kyorohiro/tetorica-soundchip-native) and [pinned SDK build guide](docs/building_ym2612_wasm.md). |

## Usage examples

This low-level example programs one YM2612 FM channel and generates a short WAV in memory.
It uses direct rendering: it opens no speaker or audio device. Run it as an ES module in
Node.js 22+, or use a browser bundler that resolves npm imports.

```js
import {createSoundChip, encodeWav} from 'tetorica-fm2612';

const chip = await createSoundChip('ym2612');
try {
  chip.reset();
  for (const offset of [0, 4, 8, 12]) {
    chip.writeRegister(0x30 + offset, 0x01); // Operator multiplier.
    chip.writeRegister(0x40 + offset, offset === 12 ? 32 : 127);
    chip.writeRegister(0x50 + offset, 0x1f); // Fast attack.
    chip.writeRegister(0x60 + offset, 0x00);
    chip.writeRegister(0x70 + offset, 0x00);
    chip.writeRegister(0x80 + offset, 0x0f);
  }
  chip.writeRegister(0xb0, 0x07); // Algorithm 7; only one audible carrier.
  chip.writeRegister(0xb4, 0xc0); // Left + right.
  chip.writeRegister(0xa4, 0x24); // BLOCK / high FNUM, approximately A4.
  chip.writeRegister(0xa0, 0x3b); // Low FNUM.
  chip.writeRegister(0x28, 0xf0); // Key on channel 1.
  const pcm = chip.generateStereo(4096);
  chip.writeRegister(0x28, 0x00); // Key off.
  const wav = encodeWav({...pcm, sampleRate: chip.sampleRate()});
  console.log(wav.byteLength); // Save these bytes or pass PCM to your output.
} finally {
  chip.dispose();
}
```

For musical note names and presets, use a chip's Synth helper. For browser speakers,
use an AudioWorklet transport after a user gesture; Node device output uses optional Audify.
See [runnable Web / Node projects](https://github.com/kyorohiro/tetorica-fm2612-examples),
[local Node examples](tetorica_examples/nodejs/README.md), [Playground scripts](docs/playground/examples/README.md),
and the [package's browser / PCM examples](packages/fm2612/README.md).

<a id="tetorica-vgm"></a>

For file analysis and export, install `tetorica-vgm` or run it directly:

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm render song.vgz --output song.wav
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
```

[CLI / Node API reference](CLI.md) · [Voice export examples](docs/browser_workflows.md#cli-voice-and-score-exports)

## Reuse in your own project

Use only the layer you need: raw chips for registers / RAM / PCM, Synth helpers for
musical controls, transports for audio output, or the Playground Runtime for live coding.
The npm audio package does not include the full Playground / Synth editor UI.
`tetorica-virtual-files` is a separate reusable filesystem / Shell / Git package.
The native SDK and [SPU DAW plug-in](https://github.com/kyorohiro/tetorica-spu-plugin)
provide separate C / C++ integration examples; desktop host support varies by project.

<a id="building-wasm-from-the-fixed-sdk"></a>

For a source build, install Emscripten and Python 3, then run a chip recipe such as
`sh scripts/build_ym2612_wasm.sh`. Recipes verify the pinned SDK under `third_party/`.
[Build / SDK updates / isolated artifact verification](docs/building_ym2612_wasm.md).

## License and Attribution

Original project files and ymfm-derived components use [BSD-3-Clause](LICENSE) unless
otherwise noted. Reuse and modification are permitted under the applicable licenses;
retain copyright notices and include each selected component's required notices / sources.
The repository is not uniformly BSD: SNES-SPC and optional Nuked-OPN2 are **LGPL-2.1-or-later**;
MSFA DX7 and relevant NES components have **Apache-2.0** terms. Sonic Pi samples are **CC0-1.0**.
Game ROMs, game music, PSF sets and commercial sound banks are not granted a license by this project.

The [complete credits and implementation references](docs/attribution.md) retain upstream
attribution, reviewed revisions, UI inspiration and asset provenance. Also consult the
[component notices](docs/licenses/), [DX7 notices](docs/licenses/tetorica-msfa-dx7-wasm/THIRD_PARTY_NOTICES.md),
and source / license files shipped with the runtime you redistribute.

<a id="links"></a>

## Repository map and reference links

| Directory / document | Contents |
| --- | --- |
| [`tetorica_src/`](tetorica_src/README.md) | Shared JavaScript runtime, Node / CLI adapters, native audio effects and WASM bridges. |
| [`docs/`](docs/index.html) | Published tools, generated WASM, guides, examples, licenses and detailed design notes. |
| [`packages/`](packages/) | npm package manifests / READMEs for audio, VGM tools and virtual files. |
| [`tetorica_examples/`](tetorica_examples/README.md) | Tetorica's runnable Node, browser and C++ examples. |
| [`src/`](src/), [`examples/`](examples/README.md) | ymfm-derived cores and upstream examples, retaining their original directory layout. |
| [`third_party/`](third_party/), [`scripts/`](scripts/) | Pinned upstream / SDK sources, builders and packaging / verification scripts. |
| [Feature status](docs/feature-status.md), [Memo](Memo.md), [CLI](CLI.md) | Implementation coverage, chip notes and analysis API details. |
| [Release procedures](README_RELEASE.md), [itch.io ZIP verification](docs/itch_web_release.md) | Maintainer build / packaging workflows. |

Hardware / upstream references: [ymfm](https://github.com/aaronsgiles/ymfm),
[MAME](https://www.mamedev.org/), [VGM specification](https://vgmrips.net/wiki/VGM_Specification),
[SMS Power!](https://www.smspower.org/), [libymfm.wasm](https://github.com/h1romas4/libymfm.wasm).
The [full reference list](docs/attribution.md#links) includes YM2612 register notes and related projects.
