# CD-DA PCM standalone source

This BSD-3-Clause component and its WASM bridge come from fixed tetorica-soundchip-native 0.1.6. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for terms and origin. The SDK's original source and bridge bytes are unchanged; only the standalone recipe's source/include paths are relocated.

The input is raw little-endian interleaved stereo PCM16 at 44,100 Hz, without a WAV header. The caller retains immutable source storage until replacement or destruction. Output rates are 8,000–384,000 Hz. Controls and rendering share one audio clock. Pause freezes the source cursor; mute preserves playback progression; EOF produces exact silence. Native hosts compile native/cdda/cdda_pcm.c and include cdda_pcm.h. The fixed-memory WASM uses a 4 KiB borrowed source window and at most 128 planar stereo frames per call. File decoding, track lists, scheduling and mixing belong to the host.

From the containing sources directory, run `sh scripts/build_cdda_wasm.sh ../generated` with Emscripten installed. No SDK checkout, importer, network, ROM or game disc is required. The output is cdda_wasm.js plus cdda_wasm.wasm. The ES module is an ABI/URL descriptor, not an Emscripten factory. The WASM has no host imports, fixed 128 KiB memory and no memory growth.

The [source receipt](../../CDDA.json) records the fixed SDK archive/manifest, original input hashes and bundled-file hashes. The [bundle guide](../../CDDA.md) describes rebuilding. This application-audio module remains separate from the SDK's generic sound-chip factory IDs.
