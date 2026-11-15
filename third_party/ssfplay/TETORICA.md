# SSF playback component

This directory contains pinned, unchanged source files from
`niekvlessert/ssfplay_tools`, commit
`a28e0d7e14a3dc04a486ea26f30bc52edad3dc4d`. Its reduced Mednafen core is
version 1.32.1 and is distributed under GPL-2.0-or-later. The full license is
in `mednafen/COPYING`. Original copyright and component notices remain in
the source files. `UPSTREAM.json` records the exact imported file hashes.

Upstream's development header symlink is represented by byte-identical plain
header files under `mednafen/include/mednafen/`. This allows a portable source
archive with ordinary files. The checksum manifest records their source paths.

Unused video font data and video-only helpers are omitted. The sound build
retains its required video interface declarations. The bundled `zlib/` source
is version 1.3.2 at commit `da607da739fa6047df13e66a2af6b8bec7c2a498`, under
the zlib license in `zlib/LICENSE`. Its hashes are recorded as a dependency in
`UPSTREAM.json`. The Tetorica recipe builds these files locally, with the
standard Emscripten system libraries supplied by the compiler installation.

The Tetorica C ABI wrapper lives at
`tetorica_src/wasm/ssf_player/ssf_player.cpp` and uses GPL-2.0-or-later.
Rebuild it with Emscripten and CMake using `node scripts/build_ssf_player.mjs`.
The build compiles this pinned source and leaves its files intact.

The player owns a separate Mednafen sound CPU / SCSP machine for each WASM
instance. It receives an already validated, merged SSF RAM image from the
browser's SSF / MiniSSF container loader. This preserves the existing Synth
editor's SCSP state and permits independent candidates during loading / seek.

Source repository and original Mednafen documentation are available at
[ssfplay_tools](https://github.com/niekvlessert/ssfplay_tools) and
[Mednafen SSF player](https://mednafen.github.io/documentation/ssfplay.html).
