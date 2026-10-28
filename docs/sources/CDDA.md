# CD-DA PCM source and rebuilding

The complete C11 renderer, header, fixed-memory WASM bridge and BSD-3-Clause notices are included under [native/cdda](native/cdda/README.md). These are application-audio modules distributed by the fixed sound-chip SDK, separately from generic chip IDs.

From this sources directory, run:

`sh scripts/build_cdda_wasm.sh ../generated`

Emscripten is required. No SDK checkout, Python importer, network, ROM or external sample is needed. The generated descriptor and WASM preserve the existing ABI and may replace the pair beside the host JavaScript modules. Compiler flags, exported functions, core, header and bridge are unchanged. Only three source/include paths in the standalone recipe move to this bundle's native/cdda layout.

[CDDA.json](CDDA.json) records the fixed SDK 0.1.6 pin, source archive/manifest hashes, original inputs and bundled files. A local-candidate marker, when present in the pin, is retained rather than claiming a published SDK release. JavaScript parsing, scheduling, Mixer routing and audio-device output remain host responsibilities.
