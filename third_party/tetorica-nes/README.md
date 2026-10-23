# Tetorica NES APU + FDS core

`nes_core.cpp` and `nes_core.h` are the canonical C++ implementation shared by
the Browser WASM and Native backends. The initial extraction is from
`tetorica-fm2612-playground-tauri` commit
`0e96d50e835305a19dc48b074009db71ff260548`, files
`src-tauri/src/native_genesis_nes.cpp` and `.h`. Only the local include name and
the provenance comment changed during extraction; no DSP behavior changed.

The source is a direct port of the existing Tetorica JavaScript implementation:

- JSNES APU, revision `b8a45d088e922b6abcd87c4eb1b7237919e9d3d2`, Apache-2.0.
  See `LICENSE-JSNES`, `AUTHORS-JSNES.md` and `UPSTREAM-JSNES.md`.
- FIX94 fixNES FDS, revision `156fcaca9f4cd9c23d423737994c45cfb05d16ca`, MIT,
  through Tetorica's JavaScript adaptation. See `LICENSE-FDS` and
  `UPSTREAM-FDS.md`. No NSFPlay code or voice bank is included.

The preserved JavaScript baseline and source notices are in the Native
repository's `src-tauri/native-nes/snapshot/`, hashed by `sources.json`.
`core.json` there separately records the canonical C++ and mirrored source
hashes. The Native repository remains buildable by itself: its `src/` mirror
does not include files outside that repository.

The core retains the baseline's NTSC/PAL channel/frame-counter behavior,
nonlinear lookup mixing, JavaScript int32 shift/floor behavior, float32 rounding
before the outer 10 Hz DC filter, FDS wave/modulation/envelope behavior, 2 kHz
low-pass and 20 Hz DC removal. This preserves the existing implementation; it
does not claim a calibrated hardware analog balance. Clock changes preserve the
base-region core and use the existing average/hold clock-resampler semantics.

Creation allocates the fixed core outside rendering. Writes, 64 KiB RAM copies,
reset, gate-off, snapshots and frame generation allocate no memory. Public reset
clears DMC RAM and FDS wave/modulation memories; gate-off retains authored
parameters, wave, RAM and clock. The callback-owning host remains responsible
for timestamped commands, owner/voice leases, output mixing and lifetime.

The additive Native host helpers `native_nes_stop_channel`,
`native_nes_write_enable`, `native_nes_enable_channel`,
`native_nes_active_mask` and `native_nes_core_size` support independent rack
instances without changing the 31-field Browser snapshot ABI. Individual gate
release retains FDS gain/wave/modulation and also halts an oscillator whose
register IO was disabled by `$4023`. DMC gate release clears a latched DAC
output while retaining the authored `$4011` level. Independent and protected
channel-enable updates preserve a DMC final prefetched byte without truncating
it or refilling DMA. Read-only activity observations do not advance the core. DMC activity includes the final prefetched byte, and triangle
activity retains a pending linear-counter reload. Additional Native RAM uploads
use bounded copies into each core's existing 64 KiB RAM; the host accounts and
limits queued payloads before admission.

Browser build, from the root repository:

```sh
sh scripts/build_nesapu_wasm.sh
```

Native mirror synchronization, from the Native repository:

```sh
python3 scripts/sync_native_nes.py --source ../..
python3 scripts/sync_native_nes.py --check --source ../..
```

Ordinary synchronization preserves the pinned JavaScript reference. Changing
that baseline requires the explicit `--refresh-reference` flag and a fresh PCM
parity review. Native `--check` without `--source` verifies its retained notices,
reference snapshot and local C++ mirror without requiring the root repository.

The small WASM ABI adapter is `wasm/nesapu_wasm.cpp`. It exposes the same
`native_nes_*` C functions plus block rendering and compiled state-layout
descriptors. The state buffer is a fixed snapshot, not a save-state format:
it does not contain the RAM, filters or internal resampler history needed to
resume an opaque synthesis state.
