# CD-DA PCM transport

This is original Tetorica code by kyorohiro, licensed under BSD-3-Clause.
`cdda_pcm.c`, `cdda_pcm.h` and `LICENSE` are copied byte-for-byte from the
`hello_ymfm/native/cdda` application module. The Native SDK exposes the same
C ABI and compiles this implementation as C11, without a Tauri/Rust dependency.

The module consumes borrowed, immutable 44.1 kHz stereo PCM16LE and renders
planar Float32 output at a host-selected sample rate. It provides transport,
linear interpolation, source windows, gain and mute. The host supplies source
storage, track/file decoding, scheduling and final mixing. It is a PCM transport,
not a chip-register API, disc controller, CUE/BIN parser or CD-ROM emulator.
No third-party audio recordings, game data, ROMs or BIOS are included.
