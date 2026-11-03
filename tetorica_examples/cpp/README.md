# Tetorica C++ tutorials

These examples use the local ymfm sources in [`src/`](../../src/). Run the
commands below from the repository root with a C++14 compiler such as Clang
or GCC. The current browser and native SDK builds use the fixed source release
in [`third_party/tetorica-soundchip-native/`](../../third_party/tetorica-soundchip-native/README.md).

| Example | Purpose |
| --- | --- |
| [`tutorials/ex01_hello_world.cpp`](tutorials/ex01_hello_world.cpp) | Check headers and compilation. |
| [`tutorials/ex02_ym2612.cpp`](tutorials/ex02_ym2612.cpp) | Create and reset YM2612, then print its native sample rate. |
| [`tutorials/ex03_beep.cpp`](tutorials/ex03_beep.cpp) | Write YM2612 registers and generate a three-second stereo WAV. |

For the explanations, see the [tutorial index](../../docs/tutorials/README.md).
The downloadable C++ files under `docs/tutorials/` mirror `tutorials/` here so
their published URLs remain available. Aaron Giles's original build-all check
and VGM renderer remain in [`examples/`](../../examples/README.md).

## Compile and run

Keep executables and generated WAV files in a temporary directory:

```sh
TETORICA_CPP_OUT=$(mktemp -d "${TMPDIR:-/tmp}/tetorica-cpp-examples.XXXXXX")

for lesson in ex01_hello_world ex02_ym2612 ex03_beep; do
  c++ -std=c++14 -Isrc "tetorica_examples/cpp/tutorials/$lesson.cpp" src/*.cpp \
    -o "$TETORICA_CPP_OUT/$lesson"
done

"$TETORICA_CPP_OUT/ex01_hello_world"
"$TETORICA_CPP_OUT/ex02_ym2612"
(cd "$TETORICA_CPP_OUT" && ./ex03_beep)
```

The first program prints `ymfm loaded`; the second prints a sample rate of
`53267`. The third writes `$TETORICA_CPP_OUT/wavlog-00.wav` at that rate.

With Emscripten and Node.js installed, the same tutorial can generate a WAV
through WebAssembly. `NODERAWFS` enables writing the file from Node.js:

```sh
EM_CACHE="$TETORICA_CPP_OUT/emcache" em++ -std=c++14 -Isrc \
  tetorica_examples/cpp/tutorials/ex03_beep.cpp src/*.cpp -sNODERAWFS=1 \
  -o "$TETORICA_CPP_OUT/ex03_beep.js"
(cd "$TETORICA_CPP_OUT" && node ./ex03_beep.js)
```

After editing a canonical tutorial source, refresh its public copy with
`node scripts/sync_tutorial_sources.mjs`. Verify the copies with
`node scripts/sync_tutorial_sources.mjs --check`.

These tutorials use the repository's [BSD-3-Clause license](../../LICENSE).
See the [full attribution list](../../docs/attribution.md) for the other cores
and dependencies.
