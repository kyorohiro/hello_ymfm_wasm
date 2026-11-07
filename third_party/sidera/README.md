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
one existing internal chip-cycle update and its current output. Its default
preserves the original `clock()` API and DSP equations. [PATCHES.json](PATCHES.json)
records the exact changed-file hashes. The BSD wrapper samples those ticks
with an integer phase accumulator, producing `floor(cycles * rate / 985248)`
frames per reset epoch. Register reads and writes do not invent extra clocks.

The library implements selectable 6581/8580 voices, filter and offsets with
integer approximations. Combined waves and cutoff curves are approximations;
Native/WASM equality does not establish hardware fidelity. Only OSC3/ENV3
reads have a hardware-state implementation in the upstream core. The separate
BSD wrapper now models a data-bus latch with reference-measured lifetimes of
7,424/663,552 completed cycles for 6581/8580. Writes and OSC3/ENV3 reads refresh
the latch; write-only reads shorten its residual lifetime by half with a minimum
of one cycle. Completed clocks always expire it. This bounded approximation
intentionally avoids a reference edge case where a shortened latch can remain
visible indefinitely. These are software model parameters, not guaranteed
physical-chip timings. Unsupported POT reads return an explicit error without
inventing an ADC value. Analogue decay, external POT input and model fidelity
remain unverified.

The independent CPU probe clocks the unmodified zlib chips/m6502 together with
this SID in one Native/WASM module. Its original RAM programs branch on actual
bus/OSC3/ENV3 reads, record RAM signatures and write SID registers. ROM, CIA,
VIC, 6510 banking and game-file loading are outside this harness. No fixed read
values or write-trace replay replace CPU execution.

Build the standalone Native executable and WASM, without Cargo or downloads:

```sh
sh scripts/build_sid8580_probe.sh
node scripts/sid8580_probe_artifacts.mjs --check build/sid8580-probe
```

Run these commands from the repository root. Rust with the
`wasm32-unknown-unknown` target and Node.js are required. The Rust standard
library/compiler and a C11 clang with a WebAssembly backend are toolchain
dependencies. The build can reuse the LLVM compiler installed with Emscripten
when Apple's clang lacks that backend, or use `SID8_WASM_CC` explicitly. The C
shim is freestanding and links no Emscripten runtime. Standard-library notices
are retained in `toolchain-notices/`. No optional upstream player
feature or third-party Cargo dependency is compiled. In particular, `cpal`,
`clap`, `hound`, `mos6502`, the SID-file player and the crate's tests/examples
are retained as original sources but are outside the build closure. No GPL
reference engine is linked into this candidate. No game/ROM/recorded PCM is
included.

An explicitly selected research profile, `8580-resonance-logfit-v1`, changes
only the 8580 filter damping coefficient. It is **off by default**, has no
effect on 6581, and is not selected by the CPU probe or any product. Its
coefficients were derived from black-box transfer measurements, not copied
from the reference implementation. The data, fit equation and limitations are
recorded in [8580-resonance-calibration.json](8580-resonance-calibration.json).
This is a software-reference fit, not a calibration against physical hardware.
Cutoff, input gain, external RC, oscillators, ADSR and noise are unchanged.
`Sid::set_8580_resonance_calibration()` and the probe C ABI enable it per instance;
Stop/reset retain that explicit setting. Invalid C ABI values are rejected
without advancing audio or replacing the current setting.

The additional Native `sid8580-quality` executable accepts the versioned
`SID8QUALITY` text protocol. It clocks both captured and discarded intervals,
retains the integer sampler phase, and reports the exact global sample ranges
and register-read times. Pass `--8580-calibration` to opt into the profile.
The controlled checker uses the existing probe WASM for the same operations:

```sh
node --test test/sid8580_quality_metrics.test.mjs
node scripts/check_sid8580_quality.mjs --validation
node scripts/check_sid8580_quality.mjs --validation --calibrated-8580
```

The optional GPL oracle runs as a separate process at chip-rate sampling,
followed by the same public integer sample selection. It is never linked
or packaged with this candidate. The checker does not align, scale or modify
PCM to force a match. Each filtered transfer is divided by its own engine's
matching dry capture; peak gain and bandwidth-derived Q are reported separately.
