# ymfm examples

These examples retain the directory layout of Aaron Giles's
[ymfm examples](https://github.com/aaronsgiles/ymfm/tree/main/examples) and use
the local core under [`src/`](../src/).

| Example | Purpose |
| --- | --- |
| [`buildall/buildall.cpp`](buildall/buildall.cpp) | Exercise reset, save/restore and audio generation for the Yamaha cores. |
| [`vgmrender/vgmrender.cpp`](vgmrender/vgmrender.cpp) | Render a supported Yamaha-chip VGM or VGZ file to WAV. |

Run these commands from the repository root with a C++14 compiler:

```sh
YMFM_EXAMPLES_OUT=$(mktemp -d "${TMPDIR:-/tmp}/ymfm-examples.XXXXXX")
c++ -std=c++14 -Isrc examples/buildall/buildall.cpp src/*.cpp \
  -o "$YMFM_EXAMPLES_OUT/buildall"
"$YMFM_EXAMPLES_OUT/buildall"

c++ -std=c++14 -Isrc examples/vgmrender/vgmrender.cpp \
  examples/vgmrender/em_inflate.cpp src/*.cpp \
  -o "$YMFM_EXAMPLES_OUT/vgmrender"
"$YMFM_EXAMPLES_OUT/vgmrender" test/fixtures/opm-audible.vgm \
  -o "$YMFM_EXAMPLES_OUT/opm-audible.wav" -r 44100
```

The build-all check prints `Done`. The VGM fixture is synthetic; replace its
path with a compatible VGM or VGZ file. This upstream renderer supports fewer
chips and file features than the [Tetorica VGM CLI](../packages/vgm/README.md).

These examples retain their [BSD-3-Clause license](../LICENSE).
`vgmrender/em_inflate.cpp` and `em_inflate.h` retain Emmanuel Marty's
[em_inflate](https://github.com/emmanuel-marty/em_inflate) notices, including
the additional checksum implementation credits in the source.

Tetorica's Node.js, browser and teaching examples are maintained separately in
[`tetorica_examples/`](../tetorica_examples/README.md).
