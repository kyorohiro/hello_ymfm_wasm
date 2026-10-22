# Nuked OPN2 WASM source

Nuked OPN2 is LGPL-2.1-or-later. The exact core, wrapper, upstream provenance,
copyright notices and license used by this distribution are included here.
See third_party/nuked-opn2/README.md and LICENSE.

Install Emscripten, enter this sources directory, and run:

`sh scripts/build_nuked_opn2_wasm.sh ../generated`

This rebuilds generated/nuked_opn2_wasm.js and generated/nuked_opn2_wasm.wasm
beside the deployed runtime. The application loads this separate module using
the unchanged exported API, so an interface-compatible modified build can
replace both generated files. Keep the corresponding source and license when
redistributing a modified library.
