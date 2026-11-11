# Play! PSF1 machine subset

This directory contains the readable source subset used by Tetorica's independent
PSF song-preview renderer. The existing Tetorica keyboard SPU is unchanged.
Play!, Framework and CodeGen are licensed under BSD-2-Clause; their original
license texts are included in the corresponding directories.

- [Play!](https://github.com/jpd002/Play-), commit `1f27232772e484bfb79364b751b84f41f4c87481`.
- [Framework](https://github.com/jpd002/Play--Framework), pinned submodule `587f278917acc0026bf5fc34b39f995fc26bd015`.
- [CodeGen](https://github.com/jpd002/Play--CodeGen), pinned submodule `a5009f7dca062695b8e5aebbd71e67b4ddfa9251`.

The PS1 BIOS is Play!'s handwritten high-level emulation (`Source/psx/PsxBios.cpp`).
No Sony BIOS image, game executable, game sample or game music is included.

`sources.json` lists the compilation units. Included headers retain their upstream
paths. Tetorica's adapter lives in `tetorica_src/wasm/psf_player/psf_player.cpp`.
Rebuild with Emscripten installed:

```sh
node scripts/build_psf_player.mjs
```

The adapter runs synchronously, produces 44,100 Hz stereo PCM, and
uses the Wasm code generator. It needs neither SharedArrayBuffer nor a separate
BIOS file. Browser playback and scheduling are implemented separately in JS.

Local changes to upstream:

- `deps/CodeGen/src/WasmModuleBuilder.cpp`: import ordinary unshared Wasm memory
  in generated CPU blocks, matching the renderer without pthreads.

- `Source/Ps2Const.h`: select the PS1 2 MiB RAM size, retaining its four RAM mirrors.

- `Source/iop/Iop_SubSystem.cpp`: remove the PS2 `IopBios.h` dependency and reject
  PS2 construction; omit two unrelated PS2 SIO2 DMA callbacks. Only PSF1 is exposed.

PSF2, PSP PSF, RAR, native sound output, networking and the emulator GUI are not
part of this subset.

## Preview limits

This is a PSF1 reference-preview engine, not full PlayStation emulation. Its HLE
BIOS implements a subset of PS1 services; some game drivers may fail or differ.
The Play! SPU renderer is separate from the MAME-derived SPU used by Tetorica's
keyboard and Code modes. In this upstream renderer:

- PMON and Noise register writes are ignored.
- PS1 main-output and reverb-return volume register writes are ignored.
- Voice ADSR and reverb are the Play! approximations and may sound different.

The application Master control still scales preview playback. Sample/ADSR/reverb
settings in the Synth editor do not rewrite the running game driver. PSF2 is not
accepted. Loading a VAB bank alone cannot play a song; a PSF1 entry with its
required libraries and executable game sound driver is needed.
