# SNES SPC source

snes_spc 0.9.0, LGPL-2.1-or-later; see third_party/snes-spc/LICENSE and README.md for the pinned revision and changes. The complete modified library, upstream documentation and notices are included from the pinned SDK source release.

From this sources directory, rebuild with Emscripten: `sh scripts/build_spc_wasm.sh docs/generated`. The explicit argument writes the loader/binary under `docs/generated/`; the standalone recipe default is `dist/wasm/`. Only its five `vendor/snes-spc` paths are relocated to the existing `third_party/snes-spc` bundle layout. Compiler flags, assertions, accurate DSP selection and Perl cleanup are retained. No SDK checkout, Python importer or network access is required.

Assertion error strings embed the source layout, so a relocated build can have a different binary hash from the SDK-layout WASM while producing the same PCM.

No Nintendo IPL ROM or game music/sample files are included.
