# Tetorica examples

Runnable examples of the reusable sound-chip APIs, grouped by execution environment.
Start with the [project goals and API choices](../README.md).

For standalone Web and Node.js projects using the published `tetorica-fm2612`
npm package, see **[tetorica-fm2612-examples](https://github.com/kyorohiro/tetorica-fm2612-examples)**.

| Environment | Examples |
| --- | --- |
| Node.js | [PCM/WAV examples](nodejs/README.md), [small sound-color experiment](nodejs/sound-color/README.md) |
| Browser | [YM2612 DAC sample](browser/ym2612_dac_sample.html) |
| C++ | [YM2612 tutorials](cpp/README.md) |
| Guided learning | [YM2612 tutorial notes](../docs/tutorials/README.md) |

Run command-line examples from the repository root unless their README says
otherwise. Node examples use the checked-in JavaScript and generated WASM;
the C++ tutorials compile the local ymfm core under `src/`. Component licenses
and source notices remain applicable. Normal product WASM builds use the
pinned SDK under `third_party/tetorica-soundchip-native/`.

The original [ymfm examples](../examples/README.md) remain under `examples/`.
The [Playground examples](../docs/playground/examples/README.md) run inside the
Playground's live-code context. Its supplied globals and runtime differ from
standalone Node and browser modules.
