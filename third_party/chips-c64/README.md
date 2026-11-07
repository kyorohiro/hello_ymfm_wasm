# Pinned chips C64 devices for the RSID host

Upstream: https://github.com/floooh/chips

Revision: `9e88298ce56319953ac7a43213a1120359f7a3a6`, matching the existing
m6502/m6581 components. The ten headers under `upstream/` are unchanged
upstream files, with their zlib/libpng notices retained. Exact sizes/hashes
are recorded in [SOURCES.json](SOURCES.json); the original repository LICENSE
is included. The host and small boot/interrupt shim are independently authored
BSD-3-Clause code, not copied or adapted from a GPL player or Commodore ROM.

The C64 system integrates the CPU, both CIA devices, VIC raster timing, RAM
banking, SID read/write bus, and hardware IRQ/NMI lines. Upstream itself records
unfinished areas such as CIA TOD/serial features and some VIC/DMA/interrupt
timing tests. This is not a claim of complete C64 compatibility or real-chip
analog accuracy. The existing simplified 6581 and 12 Hz software DC blocker
are reused without changing their source or gain.

## Host execution and ROM modes

`sid_rsid_core.h` clocks the pinned machine one cycle at a time. There is no
periodic host play call. IRQ/NMI counters count rising hardware line assertions,
not accepted interrupt entries. `ram_read` and bounded SID-write traces allow
tests to verify what the emulated handlers executed independently of those
counters. Genuine busy loops and nonreturning initialization routines are
valid. Each render advances only far enough to produce the requested samples;
there is no unbounded instruction loop waiting for an RTS.

Minimal mode supplies an original small reset/IRQ/NMI shim and blank/trapping
ROM regions of the exact lengths expected by the upstream machine. It sets
PAL byte $02A6, bank $37, CIA1 timer A $4025 running with IRQ enabled, other
timers $FFFF disabled, and VIC raster $137 with its IRQ disabled, following the
RSID environment specification. The init/idle caller is copied to RAM $0700,
below RSID's minimum load address $07E8, so init may bank out KERNAL before
returning. The mapped IRQ entry saves A/X/Y and follows $0314; mapped NMI follows
$0318, whose installed handler must preserve its own registers. The small
shim supports its own default CIA acknowledgement and register restore paths,
including the documented $EA31/$EA81/$FEBC continuation conventions.
Other mapped BASIC/KERNAL/character-ROM CPU reads fail with an address instead
of returning invented ROM contents. Blank character bytes used by VIC are not
a replacement for an original font ROM. Minimal mode is a tested, limited
ROM-independent RSID environment; it is not the original C64 power-on ROM.

Optional ROM mode accepts a user-owned 20 KiB in-memory set, ordered character
ROM 4096 bytes, BASIC 8192 bytes, KERNAL 8192 bytes. No ROM dump is shipped,
fetched or written into the source/ZIP/report. The machine boots for a bounded
2,000,000 cycles, discarding boot PCM; counters and audio/DC queues are reset
for the tune while the machine's hardware state remains. Program bytes are
loaded into physical RAM, BASIC pointers and SYS parameter bytes are updated,
then upstream's keyboard-buffer RUN/SYS helpers start BASIC or machine-code
tunes. This path expects compatible C64 ROMs; arbitrary, corrupt or incompatible
ROM bytes are not certified by a size check. Runtime CPU JAM/KIL stops with
an error. BASIC playback requires this ROM mode.

Both modes perform a bounded 100,000-cycle preflight, retain its generated PCM
in a 16,384-frame queue (sufficient at 96 kHz), then execute continuously during
render. Stop/error flushes queued audio and returns zeros. The first 4096 SID
writes are retained for inspection; excess events increment a saturating drop
counter. Sample rate is 8..96 kHz, PAL clock 985,248 Hz, mono output magnitude
is unchanged. The separate RSID WASM does not replace the existing PSID/Synth
backend, Native SDK, or calibrated assets.

## Build

```sh
sh scripts/build_sid_rsid_wasm.sh
node scripts/sid_rsid_artifacts.mjs --check
```

The upstream system headers use C compound literals and are compiled unchanged
as C11 in `sid_rsid_machine.c`. The existing SID implementation remains C++ in
`sid_rsid_chip.cpp`, retaining its thread-safe shared-table initialization.
The C++ host and WASM bridge link those units. Native tests must likewise
compile the machine with a C compiler and link its object with the two C++ units.
An explicit output directory keeps a rebuild isolated. Matching source and
licenses are mirrored under `docs/sources/sid-rsid/`.

Primary format reference: [HVSC SID file format, RSID and environment sections](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt).
