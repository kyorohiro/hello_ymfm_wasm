# Introducing tetorica-soundchip-native

I've published [tetorica-soundchip-native](https://github.com/kyorohiro/tetorica-soundchip-native): a collection of C/C++ sound-chip sources, native adapters, and WebAssembly build recipes for music players, synthesizers, games, and audio tools.

Collecting cores, carrying adaptations, putting build steps together, and tracking their licenses can take a lot of work before you hear the first note. This repository brings those pieces together, with source provenance and the differences between Native and WASM documented alongside them.

## Included sound chips and audio engines

The first standalone Native CMake target is **YM2612 using ymfm**. Other Native adapters are included as reference sources while standalone targets are added. WASM recipes cover the wider collection; independent builds have been verified for YM2612 and DX7.

The source collection covers:

- **Yamaha FM:** YM2612, YM2203 (OPN), YM2608 (OPNA), YM2610, YM2610B, YM2151 (OPM), YM2413 (OPLL), YM3526 (OPL), YM3812 (OPL2), Y8950, and YMF262 (OPL3).
- **PSG:** Sega PSG and AY-3-8910.
- **Console audio:** Game Boy DMG APU, NES APU with optional FDS audio, SNES S-DSP, a separate SPC700/S-DSP player, and HuC6280 PSG.
- **PCM and ADPCM:** RF5C164, OKIM6258, and Sega 32X PWM.
- **Synthesizer:** MSFA-based DX7, with six operators and 32 algorithms.
- **Alternative YM2612 engine:** Nuked-OPN2.
- **Additional WASM recipes:** YM3438, YMF276, YMF288, YMF278B (OPL4), Sega PCM, and K051649 (SCC/SCC+).

## Systems and instruments

These sources cover sound configurations associated with the following consoles, computers, and instruments. This is an audio source collection rather than a complete-system emulator.

| System or instrument | Sound sources |
| --- | --- |
| Sega Genesis / Mega Drive | YM2612 + Sega PSG |
| Mega-CD / Sega CD | Genesis audio + RF5C164 PCM |
| Sega 32X | Genesis audio + 32X PWM; the full Playground setup also includes Mega-CD's RF5C164 PCM |
| Sega Master System, with FM sound | Sega PSG + YM2413 OPLL |
| Sega Game Gear | Sega PSG with stereo routing |
| Nintendo Game Boy | DMG APU: pulse, wave, and noise channels |
| NES / Famicom + Famicom Disk System | NES APU + FDS audio |
| SNES / Super Famicom | S-DSP audio; a separate SPC700 + S-DSP player handles SPC files |
| PC Engine | HuC6280 PSG |
| NEC PC-98 sound configurations | YM2203 OPN or YM2608 OPNA |
| Neo Geo | YM2610; the collection also includes the six-FM-channel YM2610B variant |
| Sharp X68000 | YM2151 OPM + OKIM6258 ADPCM |
| MSX with MSX-MUSIC | AY-3-8910 PSG + YM2413 OPLL |
| MSX with MSX-AUDIO and MSX-MUSIC | AY-3-8910 + YM2413 + Y8950 |
| DOS PC sound-card configurations | YM3526 OPL, YM3812 OPL2, or YMF262 OPL3 |
| Yamaha DX7 | MSFA-based six-operator FM engine |

The additional recipes also include SCC/SCC+ audio through K051649 and arcade Sega PCM. These are separate sound sources, not additional Playground modes.

## Using the sources

Applications can vendor a snapshot pinned by version and SHA-256, then update when they choose. The sources and component licenses are kept together, without Git submodules or a neighboring application checkout. The archive manifests also connect compiled WASM artifacts to their matching sources.

[tetorica-fm2612](https://www.npmjs.com/package/tetorica-fm2612) continues to provide the JavaScript APIs, Synth helpers, and AudioWorklet integration. This new repository supplies the lower-level sources and build foundation.

Original Tetorica code uses BSD-3-Clause. Third-party components and files with existing explicit licenses retain their own terms and notices.

The repository's README has build examples, the source catalog, and the current verification results:

[Explore tetorica-soundchip-native on GitHub](https://github.com/kyorohiro/tetorica-soundchip-native)

---

Posting notes (exclude from the post):

- Draft date: 2026-10-24.
- Intended for an itch.io devlog; this task creates the draft only.
