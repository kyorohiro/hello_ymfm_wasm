# MSM5205 standalone source

This BSD-3-Clause component and its WASM bridge come from fixed tetorica-soundchip-native 0.1.5. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for terms and origin. The SDK's original source and bridge bytes are unchanged; only the standalone recipe's source/include paths are relocated.

The C11 core retains separate raw ADPCM/register/FIFO and PC Engine packed-RAM playback modes. Source storage is immutable and caller-owned until replacement or destruction. PC Engine RAM is limited to 64 KiB, decodes the high nibble first and addresses offsets/lengths in nibbles. Rate 0–15 selects clock / (48 * (16 - rate)). Controls and rendering share one audio clock; mute preserves decoder progression. Native hosts compile native/msm5205/msm5205_pcm.c and include msm5205_pcm.h. The fixed-memory WASM holds 64 KiB source RAM and at most 128 planar stereo frames per call. The Analyzer JavaScript decoder remains a separate behavioral reference; sample encoding, files, scheduling and mixing belong to the host.

From the containing sources directory, run `sh scripts/build_msm5205_wasm.sh ../generated` with Emscripten installed. No SDK checkout, importer, network, ROM or game disc is required. The output is msm5205_wasm.js plus msm5205_wasm.wasm. The ES module is an ABI/URL descriptor, not an Emscripten factory. The WASM has no host imports, fixed 128 KiB memory and no memory growth.

The [source receipt](../../MSM5205.json) records the fixed SDK archive/manifest, original input hashes and bundled-file hashes. The [bundle guide](../../MSM5205.md) describes rebuilding. This application-audio module remains separate from the SDK's generic sound-chip factory IDs.
