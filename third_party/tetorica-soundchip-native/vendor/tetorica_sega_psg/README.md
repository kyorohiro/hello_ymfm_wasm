# Tetorica Sega PSG

This directory contains Tetorica's original C++ Sega PSG implementation, under
the [BSD 3-Clause License](LICENSE), copyright 2026 kyorohiro. It provides three
tone channels, noise, attenuation, optional Game Gear stereo routing, muting and
state serialization through the existing `SegaPSG` class.

The implementation was previously stored as `vendor/ymfm/segapsg.cpp` and
`vendor/ymfm/segapsg.h`, reflecting the source application's `src/` layout.
It is a Tetorica addition, rather than an upstream ymfm source file. This
relocation adds explicit copyright and SPDX headers; the synthesis and public
API are unchanged.

## Hardware documentation credit

The implementation references [SN76489 documentation on SMS Power!](https://www.smspower.org/Development/SN76489),
written by Maxim with research and corrections from SMS Power! contributors.
Thank you to the authors and contributors for documenting register writes,
tone periods, attenuation and noise behavior. This is a hardware-documentation
reference, recorded separately from software-source provenance.

## Build and shared dependency

`segapsg.h` also includes Tetorica's shared serialization helper
[`../ymfm/chip_state.h`](../ymfm/chip_state.h). That helper is original Tetorica
code covered by the repository's [BSD license](../../LICENSE); its historical
location does not make it an ymfm-originated file. Keep both include directories
when embedding this implementation:

```sh
c++ -std=c++14 -Ivendor/tetorica_sega_psg -Ivendor/ymfm \
  -c vendor/tetorica_sega_psg/segapsg.cpp
```

The SDK provides `tetorica::segapsg` / `<tetorica/segapsg.hpp>` for its existing
Native adapter, and `sh scripts/build-wasm.sh segapsg /path/to/output` for the
WASM bridge. The Native adapter retains the `native_game_gear_*` C ABI and its
own output-rate conversion and Stop policy; see
[chip differences](../../docs/chip-differences.md).
