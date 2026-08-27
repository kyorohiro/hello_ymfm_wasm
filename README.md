# About hello_ymfm_wasm

This repository has three goals:

- To understand the YM2612 chip.
- To create documentation that helps anyone understand the YM2612 chip.
- To create documentation that helps anyone embed YM2612 audio in a browser app or game.

## What this repository provides

- YM2612 WebAssembly builds and JavaScript wrappers for browser-side use
- a browser playground for trying YM2612 control from JavaScript
- a browser synth app for hands-on YM2612 sound design
- a Genesis-oriented VGM analyzer for playback, inspection, and patch extraction

## Download

Release files are available here:

- WebAssembly (wasm) builds for YM2612
- JavaScript wrappers for browser-side use
- browser demos and app-style tools

- [https://github.com/kyorohiro/hello_ymfm_wasm/releases](https://github.com/kyorohiro/hello_ymfm_wasm/releases)

## Try it in the browser

You can try the WebAssembly build, the JavaScript wrapper, and the browser tools directly in the published pages.
This is the easiest way to test YM2612 control, sound design, and Genesis-oriented VGM analysis without setting up the full build flow first.

- Main page:
  [https://kyorohiro.github.io/hello_ymfm_wasm/](https://kyorohiro.github.io/hello_ymfm_wasm/)
- Playground:
  [https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)
- Synth:
  [https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html)
- VGM Analyzer:
  [https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html)

## Try it on itch.io

- [https://kyorohiro.itch.io](https://kyorohiro.itch.io)

## Reference

This project uses [ymfm](https://github.com/aaronsgiles/ymfm) by Aaron Giles under the BSD 3-Clause License.
See `LICENSE` for the license text included with this repository.

- `ymfm` repository:
  - https://github.com/aaronsgiles/ymfm
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
- VGM specification:
  - https://vgmrips.net/wiki/VGM_Specification
- SMS Power:
  - https://www.smspower.org/
