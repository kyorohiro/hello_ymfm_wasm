# C64 RSID / PSID CIA / VBI machine source kit

BSD-3-Clause host and independently authored minimal boot/IRQ/NMI shim and
PSID CIA RAM driver, with pinned zlib chips C64/CPU/CIA/VIC/SID components.
No original C64 ROM, game file, or GPL player/stub is included.
See third_party/chips-c64/README.md.

With Node.js, Python 3 and Emscripten, from this directory:

```sh
sh scripts/build_sid_rsid_wasm.sh /tmp/tetorica-rsid-rebuild
```

The unmodified machine headers compile as C11; existing SID and host compile
as C++17. This separate WASM leaves the original Direct VBI/Synth backend and
SDK unchanged. PSID CIA play calls use the actual CIA1 Timer A IRQ; the new
C64 VBI entry uses VIC raster IRQs. Its 100k preflight keeps PCM, and pending
initialization streams through render with a 2M-cycle hard deadline and the
same 16384-frame queue. Mapped expansion I/O DE00..DFFF is unsupported.
A declared free driver page may hold the packed one-page driver. Tune payload
bytes and their load/init/play addresses are never relocated.
