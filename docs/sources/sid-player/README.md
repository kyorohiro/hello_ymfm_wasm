# Bounded browser PSID source kit

BSD-3-Clause host with pinned zlib chips/m6502 and chips/m6581 components.
No C64 ROMs, GPL playback engine or game music are included. This is a direct
init/play subroutine host, not a complete C64 emulator. Read the component
README for CPU, memory, timing and execution-limit details.

With Node.js, Python 3 and Emscripten, from this source directory:

```sh
sh scripts/build_sid_player_wasm.sh /tmp/tetorica-sid-player-rebuild
```

The separate WASM/receipt does not change the existing SID Synth or fixed SDK.
