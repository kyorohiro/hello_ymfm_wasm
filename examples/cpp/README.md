# C++ examples

These examples use the local ymfm sources in [`src/`](../../src/). Run the commands
below from the repository root with a C++14 compiler such as Clang or GCC. The
current browser and native SDK builds use the fixed source release in
[`third_party/tetorica-soundchip-native/`](../../third_party/tetorica-soundchip-native/README.md);
these examples are small, independent ways to explore the local C++ core.

| Example | Purpose |
| --- | --- |
| [`tutorials/ex01_hello_world.cpp`](tutorials/ex01_hello_world.cpp) | Check headers and compilation. |
| [`tutorials/ex02_ym2612.cpp`](tutorials/ex02_ym2612.cpp) | Create and reset YM2612, then print its native sample rate. |
| [`tutorials/ex03_beep.cpp`](tutorials/ex03_beep.cpp) | Write YM2612 registers and generate a three-second stereo WAV. |
| [`buildall/buildall.cpp`](buildall/buildall.cpp) | Exercise reset, save/restore and audio generation for the local Yamaha cores. |
| [`vgmrender/vgmrender.cpp`](vgmrender/vgmrender.cpp) | Render a supported Yamaha-chip VGM or VGZ file to WAV. |

For the explanations, see the [tutorial index](../../docs/tutorials/README.md).
The downloadable C++ files under `docs/tutorials/` mirror `tutorials/` here so their
published URLs remain available.

After editing a canonical tutorial source, refresh its public copy with
`node scripts/sync_tutorial_sources.mjs`. Verify the copies with
`node scripts/sync_tutorial_sources.mjs --check`.

## Compile and run the tutorials

Keep executables and generated WAV files in a temporary directory:

```sh
CPP_EXAMPLES_OUT=$(mktemp -d "${TMPDIR:-/tmp}/tetorica-cpp-examples.XXXXXX")

for lesson in ex01_hello_world ex02_ym2612 ex03_beep; do
  c++ -std=c++14 -Isrc "examples/cpp/tutorials/$lesson.cpp" src/*.cpp \
    -o "$CPP_EXAMPLES_OUT/$lesson"
done

"$CPP_EXAMPLES_OUT/ex01_hello_world"
"$CPP_EXAMPLES_OUT/ex02_ym2612"
(cd "$CPP_EXAMPLES_OUT" && ./ex03_beep)
```

The first program prints `ymfm loaded`; the second prints a sample rate of
`53267`. The third writes `$CPP_EXAMPLES_OUT/wavlog-00.wav` at that rate.

## Build-all smoke check

Reuse `CPP_EXAMPLES_OUT` from above:

```sh
c++ -std=c++14 -Isrc examples/cpp/buildall/buildall.cpp src/*.cpp \
  -o "$CPP_EXAMPLES_OUT/buildall"
"$CPP_EXAMPLES_OUT/buildall"
```

A successful run prints `Done`.

## Render a VGM file

```sh
c++ -std=c++14 -Isrc examples/cpp/vgmrender/vgmrender.cpp \
  examples/cpp/vgmrender/em_inflate.cpp src/*.cpp \
  -o "$CPP_EXAMPLES_OUT/vgmrender"

"$CPP_EXAMPLES_OUT/vgmrender" test/fixtures/opm-audible.vgm \
  -o "$CPP_EXAMPLES_OUT/opm-audible.wav" -r 44100
```

The checked-in fixture is synthetic. Replace its path with your own compatible
VGM or VGZ file. This upstream example supports fewer chips and file features
than the [Tetorica VGM CLI](../../packages/vgm/README.md).

## Emscripten

With Emscripten and Node.js installed, the same tutorial can generate a WAV
through WebAssembly. `NODERAWFS` enables writing the file from Node.js:

```sh
EM_CACHE="$CPP_EXAMPLES_OUT/emcache" em++ -std=c++14 -Isrc \
  examples/cpp/tutorials/ex03_beep.cpp src/*.cpp -sNODERAWFS=1 \
  -o "$CPP_EXAMPLES_OUT/ex03_beep.js"
(cd "$CPP_EXAMPLES_OUT" && node ./ex03_beep.js)
```

## Sources and licenses

- `buildall/` and `vgmrender/` originate from Aaron Giles's
  [ymfm examples](https://github.com/aaronsgiles/ymfm/tree/main/examples), under the
  repository's [BSD-3-Clause license](../../LICENSE).
- `tutorials/` contains the Tetorica learning examples, under the same license.
- `vgmrender/em_inflate.cpp` and `em_inflate.h` retain Emmanuel Marty's
  [em_inflate](https://github.com/emmanuel-marty/em_inflate) license notices,
  including the additional checksum implementation credits in the source.

See the [full attribution list](../../docs/attribution.md) for the other cores and
dependencies.
