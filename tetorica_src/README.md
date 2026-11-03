# Tetorica source

Tetorica's shared implementations live here. The original ymfm
[`src/`](../src/) and [`examples/`](../examples/README.md) retain their upstream
layout. Runnable Tetorica examples are in [`tetorica_examples/`](../tetorica_examples/README.md),
and tests are in [`test/`](../test/).

| Directory | Contents |
| --- | --- |
| [`runtime/`](runtime/README.md) | Browser and shared JavaScript chip APIs, Synth helpers, audio engines, Worker/Worklet modules and generated WASM assets. |
| [`node/`](node/README.md) | Node audio output, Workers and transport adapters. |
| [`cli/`](cli/) | `tetorica-vgm` command-line and Node library adapters; see the [CLI reference](../CLI.md). |
| [`native/`](native/) | Application-side native audio effects. Reusable sound-chip cores come from the [fixed SDK](../third_party/tetorica-soundchip-native/README.md). |
| [`wasm/`](wasm/) | Application-local WASM bridges and reference implementations. Normal chip builds use the fixed SDK. |

The website keeps its published modules at `docs/js/` and assets at
`docs/generated/`. npm imports and installed package paths keep their existing
layout. Build and sync scripts adapt these distributions from the source tree.
See [release instructions](../README_RELEASE.md) and the
[WASM build guide](../docs/building_ym2612_wasm.md).
