# Bounded browser PSID source kit

BSD-3-Clause host with pinned zlib chips/m6502 and chips/m6581 components.
No C64 ROMs, GPL playback engine or game music are included. This is a direct
init/play subroutine host, not a complete C64 emulator. Read the component
README for CPU, memory, timing and execution-limit details.

PAL RAM flag $02A6 is initialized to 1. Every init/play entry sets its required
bank ($37 below $A000, $36 through $CFFF). The unchanged 100k/16k cycle limits
report initialization/play separately; CPU JAM/KIL reports its opcode address.
Only exact discarded read phases of STA abs,X / abs,Y / (zp),Y crossing from
VIC mirrors to a SID write are admitted. Their data is unused, and CPU/SID
clocks still advance. Collision-register mirrors that clear on read are excluded.
Actual VIC/CIA/ROM dependencies remain unsupported.

With Node.js, Python 3 and Emscripten, from this source directory:

```sh
sh scripts/build_sid_player_wasm.sh /tmp/tetorica-sid-player-rebuild
```

The separate WASM/receipt does not change the existing SID Synth or fixed SDK.
