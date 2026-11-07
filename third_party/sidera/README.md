# sidera 1.1.1 — isolated 8580 research candidate

Source: <https://codeberg.org/sbechet/sidera>, revision
`15041709d26c2bc36667ba27f729332c9f523696`, published crate `1.1.1`.
The original MIT [license](LICENSE), all 28 crate files and their hashes are
retained under `upstream/` and in [SOURCES.json](SOURCES.json). Archive SHA-256:
`b043512b891bdb03ad21b0205723dabb88ada23e3043c21f6a7f88b26defba35`.

This is a research candidate, not an adopted SID Player / Synth / SDK backend.
The existing chips/m6581 artifacts and calibrated output remain independent.
The browser player's 8580 rejection remains in place.

The original library's public `Sid::clock()` produces one audio sample and
advances several chip cycles. The marked copy under `adapted/` adds access to
one existing internal chip-cycle update and its current output. It preserves
the original `clock()` API and DSP equations. [PATCHES.json](PATCHES.json)
records the exact changed-file hashes. The BSD wrapper samples those ticks
with an integer phase accumulator, producing `floor(cycles * rate / 985248)`
frames per reset epoch. Register reads and writes do not invent extra clocks.

The library implements selectable 6581/8580 voices, filter and offsets with
integer approximations. Combined waves and cutoff curves are approximations;
Native/WASM equality does not establish hardware fidelity. Only OSC3/ENV3
reads have a hardware-state implementation in this upstream core; its other
reads return zero. In particular, a SID write-only data-bus latch/decay is
missing. Do not connect that behavior to a production C64 player as though
it were verified hardware readback. Read comparisons with a separate external
reference must remain diagnostic and expose any differences.

Build the standalone Native executable and WASM, without Cargo or downloads:

```sh
sh scripts/build_sid8580_probe.sh
node scripts/sid8580_probe_artifacts.mjs --check build/sid8580-probe
```

Run these commands from the repository root. Rust with the
`wasm32-unknown-unknown` target and Node.js are required. The Rust standard
library/compiler are toolchain dependencies; no optional upstream player
feature or third-party Cargo dependency is compiled. In particular, `cpal`,
`clap`, `hound`, `mos6502`, the SID-file player and the crate's tests/examples
are retained as original sources but are outside the build closure. No GPL
reference engine is linked into this candidate. No game/ROM/recorded PCM is
included.
