# NES + FDS WASM source

The default NES/FDS renderer is a C++ port of the deployed JSNES APU and fixNES FDS adaptation. It shares the core used by Native NES.

From this sources directory, run `sh scripts/build_nesapu_wasm.sh` with Emscripten installed. The canonical C++ core, wrapper and build script are included at their original relative paths. The generated loader and binary are written under `docs/generated/`.

JSNES portions use Apache-2.0; FDS portions use MIT. See `third_party/tetorica-nes/README.md`, its two license files and the original JSNES authors in `../licenses/jsnes/AUTHORS.md`. The preserved JavaScript renderer is a compatibility/reference path. No instrument ROM, game ROM or third-party voice bank is bundled.
