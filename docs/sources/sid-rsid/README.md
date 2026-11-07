# RSID machine source kit

BSD-3-Clause host and independently authored minimal boot/IRQ/NMI shim, with
pinned zlib chips C64/CPU/CIA/VIC/SID components. No original C64 ROM, game
file, or GPL player/stub is included. See third_party/chips-c64/README.md.

With Node.js, Python 3 and Emscripten, from this directory:

```sh
sh scripts/build_sid_rsid_wasm.sh /tmp/tetorica-rsid-rebuild
```

The unmodified machine headers compile as C11; existing SID and host compile
as C++17. This separate WASM does not change the PSID/Synth backend or SDK.
