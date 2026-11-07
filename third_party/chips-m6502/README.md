# chips / m6502 — bounded browser PSID host CPU

Upstream: https://github.com/floooh/chips

Pinned revision: `9e88298ce56319953ac7a43213a1120359f7a3a6`, the same revision
used by Tetorica's m6581 SID component. `upstream/m6502.h` is the unchanged
generated upstream header; no CPU source patches are applied. Its zlib/libpng
notice and Andre Weissflog credit remain in the header. The exact upstream
repository LICENSE is also included. The surrounding host is BSD-3-Clause.

| Original file | SHA-256 |
| --- | --- |
| `upstream/m6502.h` | `b3fc32a01f1f7cdc62f919ccba06cc20c2a333e7ca30c38189e31aa65868d46e` |
| `LICENSE` | `0c692ece632a8ec6d2a566c9234fdabda655644e6abc70027da9ff7c35e48634` |

## Environment and limits

`tetorica_src/wasm/sid_player_core.h` uses the cycle-stepped CPU to execute
explicit PSID init/play subroutines. Every CPU bus cycle advances the existing
adapted m6581 exactly once. SID writes commit after that cycle's audio step;
SID reads return real emulated bus readback on the same cycle. The single SID
at $D400 includes its $D400..$D7FF register mirrors.

This is **not a complete C64 machine**. It has 64 KiB of initialized RAM,
standard $00/$01 memory-configuration bytes, PAL flag $02A6=1, the usual
I/O-visible bank maps $35/$36/$37, the CPU stack, and a small host-owned JSR
trampoline at $0200. Every init/play call writes the bank required by the PSID
environment: $37 for an entry below $A000, or $36 for an entry at $A000..$CFFF.
The bank left by the preceding routine is not substituted for that requirement.
Init receives the zero-based subtune in A, X/Y are zero, interrupt-disable is
set, and the stack starts at $01FD. Play calls receive A/X/Y zero. A normal
top-level RTS must return to the trampoline; arbitrary IRQ/BRK entry is rejected.
The standard CPU's decimal and undocumented instruction behavior is retained.

Program bytes and init/play entries must lie in RAM $0800..$CFFF. Mapped
BASIC/KERNAL ROM reads, unsupported VIC/CIA/expansion I/O, unsupported banking
and invalid host returns report an error and address. No ROM dump, Kernal stub,
CIA timer, VIC raster/steal timing or interrupt controller is guessed. A header
that passes the supported PSID format subset does not prove its program avoids
these unsupported devices; such a program can fail during execution.

Ordinary `STA abs,X`, `STA abs,Y` and `STA (zp),Y` instructions perform a
discarded read before their write. A page-crossing write to SID can put that
read in the VIC mirror area $D300..$D3FF (for example, `STA $D3FF,X` with
X=$19 reads $D318 before writing $D418). The host admits only those exact
pinned-CPU instruction phases, checks the computed following target is SID,
and returns an unused $FF for the side-effect-free dummy read. CPU/SID clocks
still advance for the bus cycle. Sprite-collision register mirrors $1E/$1F
are excluded because reading them clears hardware latches. Actual VIC reads,
CIA/ROM dependencies and other unsupported I/O remain errors; real SID dummy
reads still use the SID chip. This narrow rule is not a VIC implementation.

Init runs synchronously for at most 100,000 cycles. Its audio is retained in a
fixed 16,384-frame queue (enough at the maximum 96 kHz sample rate). The first
Play is the first strict 19,656-cycle PAL VBI boundary after init completes;
initially elapsed boundaries are counted but not replayed. Subsequent calls
start every 19,656 cycles, each with a 16,000-cycle budget. There is no claim
that these absolute call times match libsidplayfp's full C64 driver.
Rendering advances the program only as needed for the requested PCM frames,
so splitting a render request does not change the write sequence or PCM.
These are host safety limits, not SID format limits. Timeout diagnostics keep
error code 5 and identify initialization or play separately. The twelve CPU
JAM/KIL opcodes fail immediately with code 10 at their actual opcode address.

The SID is the existing **6581 approximation** with its existing 12 Hz output
DC blocker and unity chip magnitude. Sample rate is 8..96 kHz, PAL clock is
985,248 Hz. The output buffer accepts up to 4096 mono float frames. Stop or an
execution error flushes CPU activity, chip state, queued samples and output.
Stop preserves elapsed counters for inspection; replay loads a new instance.
The first 4096 bus writes can be inspected with cycle stamps; excess events
only increase a saturating drop counter, never an unbounded allocation.

## Separate reproducible build

```sh
sh scripts/build_sid_player_wasm.sh
node scripts/sid_player_artifacts.mjs --check
```

An explicit destination keeps a rebuild isolated:
`sh scripts/build_sid_player_wasm.sh /tmp/tetorica-sid-player-rebuild`.
The separate `sid-player.wasm` and source-hash receipt live under
`tetorica_src/runtime/generated/sid-player/`, with public copies under
`docs/generated/sid-player/`. Matching build inputs and licenses are copied
to `docs/sources/sid-player/`. No fixed SDK, calibrated gain, existing SID
WASM, or external GPL reference executable is changed or linked into this build.
