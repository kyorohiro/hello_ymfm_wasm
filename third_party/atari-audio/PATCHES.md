# AtariAudio browser reference replay

AtariAudio 1.31 is pinned to commit `1dd9fca810a4f00b4b5e6a5348872ac0a21d88fb` from https://github.com/arnaud-carre/AtariAudio.

`upstream.json` records the original and checked-in SHA-256 for each vendored file. `local.patch` contains the local changes. The source headers retain their original notices.

The local patch adds read-only YM register getters through `Ym2149c`, `AtariMachine`, `YmRenderer`, `SndhRenderer` and `AtariAudioRenderer`. It also exposes the SNDH renderer's existing replay-valid flag. These accessors read the emulator state without advancing time or writing registers. Registers 0 through 13 contain the emulator's masked hardware values. The emulator omits YM I/O registers 14 and 15, which the host reports as unknown. The SNDH header parser returns to its length check after skipping a `#!SN` table. The LZH decoder receives header, Huffman code-length, table, zero-run and traversal bounds checks, and propagates malformed-table failures to its caller.

The BSD-3-Clause host in `tetorica_src/wasm/atari_audio_player_wasm.cpp` validates raw YM2/YM3/YM3b/YM5/YM6 and SNDH structures before invoking the native parser. It bounds file and expanded size to 8 MiB, and SNDH uploads to available Atari RAM. It checks strings, sample banks, frame counts, rates, clock and subsong tables. Its bounds-checked ICE decoder follows the public-domain Hans Wessels decoder included upstream. LHA level-0 `-lh5-` headers receive packed and expanded length checks before the upstream LZH decoder runs. Each module Worker has a 64 MiB WASM memory ceiling. The transport terminates Workers after a ten-second request deadline or cancellation and permits four simultaneous Workers. Render calls contain at most 4096 output frames.

SNDH runs the upstream Atari machine and may mix STE DAC audio with the YM signal. The reference UI observes three YM voices. The upstream output is signed 16-bit mono, duplicated to left and right by the browser adapter. Playback uses the upstream Atari timing conversion and deterministic YM reset.

Build with `sh scripts/build_atari_audio_player_wasm.sh`. Pass an output directory as the first argument to keep generated artifacts elsewhere. The build needs Emscripten and Node.js. `scripts/atari_audio_player_artifacts.mjs --check` verifies the checked-in source and WASM receipt.

## Included notices

AtariAudio uses the MIT license in `LICENSE`, copyright 2026 Arnaud Carré. Musashi retains Karl Stenerud's permissive license in `src/external/Musashi/m68k.h` and its other source headers. The ICE source records its public-domain dedication by Hans Wessels in 2007. LZH source credits Haruhiko Okumura (1991) and Kerwin F. Medina (1996). The upstream credits also identify Benjamin Gerard and the SNDH Community for the timing database, and Paulo Simoes for the real-hardware YM volume table. The upstream example music files are omitted.

Live editing adds `WriteYmRegister` forwarding to the native YM chip. The direct `WriteReg` path preserves the CPU address latch and performs normal register masking and Envelope retrigger side effects. The Worker serializes edits with rendering; later replay-program writes may replace host edits.
