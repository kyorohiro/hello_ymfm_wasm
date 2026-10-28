# Experimental PlayStation SPU source and rebuilding

The complete BSD-3-Clause standalone C++17 core, C API, original MAME source files, revision, hashes, attribution and documented changes are included in [native/ps1/](native/ps1/README.md). This local experimental instrument port is **not** a fixed tetorica-soundchip-native SDK artifact. The low-level core uses an explicit factory; the Browser Playground exposes it separately as the experimental PS1 mode.

From this sources directory, run:

`sh scripts/build_ps1_spu_wasm.sh ../generated`

Emscripten and Python 3 are required. No SDK checkout, importer, network, MAME framework, CPU, BIOS, ROM or game recording is required. The unchanged recipe produces ps1_spu_wasm.js, ps1_spu_wasm.wasm and its source/build receipt. Native hosts compile ps1_spu.cpp, spu.cpp, spu_tables.cpp and spureverb.cpp under native/ps1, and include ps1_spu.h.

The ES-module helper Ps1Spu requires an explicit generated module factory. It renders at 44,100 Hz into caller-owned stereo PCM, with 24 voices and 512 KiB RAM. Sample uploads expect already encoded 16-byte / 28-frame PSX ADPCM packets. Instrument tuning, voice allocation and audio-device output belong to the host. Upstream interpolation, ADSR and reverb approximations are retained; this is not a hardware-exact timing or soundtrack-compatibility claim.

[PS1-SPU.json](PS1-SPU.json) preserves the exact local source/build receipt; generated/ps1_spu_build.json is also included beside the generated pair. Every core, upstream, notice and recipe byte is unchanged from the verified build inputs.
