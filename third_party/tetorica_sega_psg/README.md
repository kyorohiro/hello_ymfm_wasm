# Tetorica Sega PSG

Tetorica's original C++ Sega PSG implementation, copyright 2026 kyorohiro,
under the [BSD 3-Clause License](LICENSE). It provides three tone channels,
noise, attenuation, Game Gear stereo routing, muting and state serialization
through the existing `SegaPSG` class.

This core was previously stored in `src/segapsg.cpp` and `src/segapsg.h`, next
to ymfm. It is a Tetorica addition, rather than an upstream ymfm source file.
Those paths now contain compatibility includes. Compile either the old `.cpp`
or the new `.cpp`, once, using the include paths documented below. The relocation and copyright headers do not change
the synthesis, output gain or public API.

## Hardware documentation credit

The implementation references [SN76489 documentation on SMS Power!](https://www.smspower.org/Development/SN76489),
written by Maxim with research and corrections from SMS Power! contributors.
Thank you for documenting register writes, tone periods, attenuation and noise
behavior. This credits hardware documentation separately from software-source
provenance; the Tetorica license applies to this implementation.

## Build and shared dependency

The header includes Tetorica's shared serialization helper
[`../../src/chip_state.h`](../../src/chip_state.h), also covered by this BSD
license. Keep both include directories when embedding the core:

```sh
c++ -std=c++14 -Ithird_party/tetorica_sega_psg -Isrc \
  -c third_party/tetorica_sega_psg/segapsg.cpp
```

The C bridge is [`../../wasm/segapsg_wasm.cpp`](../../wasm/segapsg_wasm.cpp).
The authoritative SDK also provides this core in `vendor/tetorica_sega_psg`,
with a standalone WASM recipe and the `tetorica::segapsg` Native target:
[tetorica-soundchip-native](https://github.com/kyorohiro/tetorica-soundchip-native).

The application's pinned SDK 0.1.1 retains its original source layout until a
subsequent SDK release is imported. Its existing WASM/Native build paths and
generated runtime files are unchanged by this source reorganization.

## Provenance review

The local creation commit (`54e2aa8d`, 2026-08-15) and subsequent changes were
reviewed against MAME's official `sn76496.cpp`/`.h`, at both a current pinned
revision and the last master revision before local creation. No distinctive
copied MAME code or comments were found in that review. This is a finding
within the inspected history and sources, rather than proof that no external
implementation was ever consulted. See the
[review and validation record](../../docs/issues/segapsg_provenance_layout_01.md).
