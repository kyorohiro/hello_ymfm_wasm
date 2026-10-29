# POKEY source and rebuilding

This bundle contains the BSD-3-Clause standalone POKEY adaptation, exact explicitly licensed upstream libvgm pokey.c, component notice and snapshot manifest. See third_party/libvgm-pokey/README.md and LICENSE for authorship, the pinned revision, documented changes and deliberately omitted unmarked framework files.

From this sources directory, run `sh scripts/build_pokey_wasm.sh ../generated` with Emscripten installed. No SDK checkout, importer, network, CPU, ROM or external sample is needed. The source and build inputs are checked against fixed SDK 0.1.7; POKEY-SDK.json preserves its archive hash and provenance, including whether this is an unpublished local source candidate.

Only include/source paths in the standalone recipe are relocated. Compiler flags, exports, adaptation, bridge and upstream source bytes are retained. Each core handle owns one mono four-channel POKEY. Two independent handles provide dual POKEY; routing and speaker DC correction belong to the host.
