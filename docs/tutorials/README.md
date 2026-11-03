# YM2612 Tutorials

Small tutorial files for learning the YM2612 step by step.

Edit the Markdown notes here in `docs/tutorials/`. This is their canonical
location and their public URL; there is no separate top-level `tutorials/` copy.
The C++ examples are maintained in `tetorica_examples/cpp/tutorials/`. The `.cpp` files
here are public download mirrors of those examples.

## Notes

- [ex00.md](./ex00.md)
  English notes about pins, ports, register groups, and YM2612 basics.
- [ex00_ja.md](./ex00_ja.md)
  日本語で YM2612 の基本を読む。
- [ex03.md](./ex03.md)
  English walkthrough for how `ex03_beep.cpp` generates a YM2612 beep.
- [ex03_ja.md](./ex03_ja.md)
  `ex03_beep.cpp` の beep を日本語で追うためのメモ。
- [ex00_vgm.md](./ex00_vgm.md)
  Notes about VGM, YM2612-related commands, and the current browser path.

## Example source files

- [ex01_hello_world.cpp](./ex01_hello_world.cpp)
  Minimal compile/load check for ymfm.
  [Edit source](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/tetorica_examples/cpp/tutorials/ex01_hello_world.cpp).
- [ex02_ym2612.cpp](./ex02_ym2612.cpp)
  Small example that creates a YM2612 instance and checks the sample rate.
  [Edit source](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/tetorica_examples/cpp/tutorials/ex02_ym2612.cpp).
- [ex03_beep.cpp](./ex03_beep.cpp)
  Direct YM2612 register writes that generate a simple beep.
  [Edit source](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/tetorica_examples/cpp/tutorials/ex03_beep.cpp).

## Build and update

For the C++ examples, install Emscripten (`em++`) and Node.js, then run the
compiler command in each source file's final comment from the repository root.
The command uses `tetorica_examples/cpp/tutorials/` for the example and `src/` for the
local ymfm teaching code. It does not replace the fixed SDK used by the
[production WASM builds](../building_ym2612_wasm.md).

After editing a C++ example, update its matching `docs/tutorials/*.cpp` mirror
from the repository root:

```sh
node scripts/sync_tutorial_sources.mjs
# Verify that the public mirrors match without changing files:
node scripts/sync_tutorial_sources.mjs --check
```

Keep the three filenames unchanged so existing download links continue to
work. Markdown changes need no copy step.
