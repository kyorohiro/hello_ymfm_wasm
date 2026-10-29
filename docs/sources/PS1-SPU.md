# PlayStation SPU source and rebuilding

The complete BSD-3-Clause standalone C++17 SPU, C API, pristine upstream MAME sources, revision, checksums, attribution and documented changes are included in [native/ps1/](native/ps1/README.md). The source is taken from fixed tetorica-soundchip-native SDK 0.1.7. [PS1-SPU.json](PS1-SPU.json) retains the complete SDK pin, including whether it represents an unpublished local candidate, and hashes every distributed input. [sdk/RELEASE-MANIFEST.json](sdk/RELEASE-MANIFEST.json) is the genuine release manifest authenticated by that pin.

From this sources directory, run:

`sh scripts/build_ps1_spu_wasm.sh ../generated`

Emscripten is required. This self-contained recipe builds ps1_spu_wasm.js and ps1_spu_wasm.wasm without an SDK checkout, importer, network, MAME framework, CPU, BIOS, ROM or game recording. Only its five vendor/mame-ps1-spu paths are relocated to native/ps1. Compiler flags and exports are unchanged. The exact original recipe is retained in [sdk/scripts/build_ps1_spu_wasm.sh](sdk/scripts/build_ps1_spu_wasm.sh). The distributed generated/ps1_spu_build.json records the original SDK build; the standalone recipe does not rewrite that provenance record.

Native hosts compile ps1_spu.cpp, spu.cpp, spu_tables.cpp and spureverb.cpp under native/ps1, and include ps1_spu.h. The SDK forwarding header is retained unchanged in sdk/native/include/tetorica/ps1_spu.h for provenance; its original relative include expects the full SDK layout. Standalone consumers use native/ps1/ps1_spu.h directly. The C API renders 44,100 Hz into caller-owned stereo PCM, with 24 fixed voices and 512 KiB RAM. Samples use 16-byte / 28-frame PSX ADPCM packets. Tuning, voice allocation, output resampling and device output belong to the host.

Voice interpolation uses the documented PS1 four-point Gaussian hardware coefficients. Upstream ADSR and reverb approximations are retained. This instrument API does not implement a PlayStation CPU, BIOS, PSF playback, XA/CD streaming or hardware-exact timing. The JavaScript Ps1Spu helper takes an explicit generated module factory and does not open an audio device.
