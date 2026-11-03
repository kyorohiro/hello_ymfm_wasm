# Tetorica examples

Runnable examples of the reusable sound-chip APIs, grouped by execution environment.
Start with the [project goals and API choices](../README.md).

| Environment | Examples |
| --- | --- |
| Node.js | [PCM/WAV examples](nodejs/README.md), [small sound-color experiment](nodejs/sound-color/README.md) |
| Browser | [YM2612 DAC sample](browser/ym2612_dac_sample.html) |
| C++ | [Compile checks, YM2612 tutorials and offline VGM renderer](cpp/README.md) |
| Guided learning | [YM2612 tutorial notes](../docs/tutorials/README.md) |

Run command-line examples from the repository root unless their README says
otherwise. Node examples use the checked-in JavaScript and generated WASM;
the C++ examples compile the local comparison cores under `src/`. Component
licenses and source notices remain applicable. Normal product WASM builds use
the pinned SDK under `third_party/tetorica-soundchip-native/`.

The [Playground examples](../docs/playground/examples/README.md) run inside the
Playground's live-code context. Its supplied globals and runtime differ from
standalone Node and browser modules.
