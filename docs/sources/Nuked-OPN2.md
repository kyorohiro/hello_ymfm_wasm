# Nuked OPN2 WASM source

Nuked OPN2 is LGPL-2.1-or-later. The complete modified core, wrapper, upstream provenance,
copyright notices and license used by this distribution come from the pinned SDK source release.
See third_party/nuked-opn2/README.md and LICENSE. Original version comments are retained.
The original Tetorica wrapper and build recipe use BSD-3-Clause; their notice
is included as LICENSE.tetorica. The Nuked core retains its separate LGPL terms.

Install Emscripten, enter this sources directory, and run:

`sh scripts/build_nuked_opn2_wasm.sh ../generated`

The explicit argument rebuilds the loader/binary beside the deployed runtime;
the standalone recipe default is dist/wasm/. Its two vendor/nuked-opn2 paths
are relocated to this bundle's third_party/nuked-opn2 layout. C11, O2,
assertions, exports and runtime options are unchanged. No SDK checkout,
Python importer or network access is required to build this bundle.

The application loads this separate module using the unchanged exported API,
so an interface-compatible modified build can replace both generated files.
Keep the corresponding source and license when redistributing a modified library.
