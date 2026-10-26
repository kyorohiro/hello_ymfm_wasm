# NES + FDS WASM source

The default NES/FDS renderer is a C++ port of the deployed JSNES APU and fixNES FDS adaptation. It shares the core used by Native NES.

From this sources directory, run `sh scripts/build_nesapu_wasm.sh docs/generated` with Emscripten installed. The explicit output argument writes the loader and binary under `docs/generated/`; the standalone recipe default is `dist/wasm/`. The core, wrapper, recipe and provenance come from the pinned SDK source release. Only the recipe's two `vendor/tetorica-nes` paths are relocated to the existing `third_party/tetorica-nes` bundle layout. Compiler flags and source contents are retained. No SDK checkout, Python importer or network access is needed to rebuild this bundle.

JSNES portions use Apache-2.0; FDS portions use MIT. See `third_party/tetorica-nes/README.md`, its two license files and the original JSNES authors in `../licenses/jsnes/AUTHORS.md`. The preserved JavaScript renderer is a compatibility/reference path. No instrument ROM, game ROM or third-party voice bank is bundled.
