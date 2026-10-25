# Native sources

This directory contains the existing chip-level C++/C ABI wrappers as bootstrap
references, without Rust, Tauri, CPAL, the application scheduler, Mixer, FX,
QuickJS, UI, or audio-device code. Existing applications still use their current
sources. Collecting them here does not yet switch those consumers to this SDK.

`reference/tauri/` preserves the existing exported functions and PCM behavior.
HuC6280 and Nuked include paths are relocated to the shared SDK source layout.
The YM2612, YM2151, YM2413, YM2203, YM2608 and YM2610/YM2610B adapters also
carry the recorded template-ownership amendments below.
`reference/SOURCES.json` records the original and packaged byte hashes.
The vendor cores have one canonical copy in `../vendor/`; they are not copied
again under `native/`.

[Per-chip differences](../docs/chip-differences.md) distinguish upstream
adaptations, SDK relocation, and existing Native/WASM API or rendering
differences. [MSFA details](../docs/research.md) describe all six Native
overrides, including slot-control APIs and panic behavior, not just portability.

The shared Game Boy header includes Tauri's
`friend struct NativeGameboyAccess` declaration for state observation and
gate-only Stop. This recorded SDK amendment changes access only; the shared
implementation, Native wrapper and WASM bridge remain unchanged. See the
per-chip document for the original/amended hashes and the NES/HuC6280
translation-unit constraints.

## Build support

Requirements: CMake 3.20 or newer, a C++17 compiler and a C compiler (C11 or newer for Nuked).

The independently buildable Native components are **ymfm YM2612, YM2151,
YM2413, YM2203, YM2608 and YM2610/YM2610B, plus Sega PSG, AY-3-8910, OKIM6258, RF5C164, Game Boy, HuC6280, NES with optional FDS, 32X PWM, MSFA DX7, SNES S-DSP, SPC700/S-DSP playback and YM3526/YM3812/YMF262/Y8950**.
These twenty-two chip IDs, including the alternative Nuked YM2612 engine, use nineteen static libraries; YM2610/YM2610B share one
library, and four OPL-family chips share another. Constructors explicitly select
the per-handle variant/kind. Twenty-four aliases/headers include generic OPL and the alternative Nuked engine:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release --parallel
ctest --test-dir build -C Release --output-on-failure
```

The same targets can be configured directly with `cmake -S native -B
build/native`. Neither build downloads dependencies.

| CMake target | Static library target | Public C++ header | Existing C ABI |
| --- | --- | --- | --- |
| `tetorica::ym2612` | `tetorica_native_ym2612` | `<tetorica/ym2612.hpp>` | `native_ym2612_*`, `NativeYm2612State` |
| `tetorica::nuked_ym2612` | `tetorica_native_nuked_ym2612` | `<tetorica/nuked_ym2612.hpp>` | `native_nuked_ym2612_*`, `tetorica_nuked_*`, `NativeYm2612State` |
| `tetorica::ym2151` | `tetorica_native_ym2151` | `<tetorica/ym2151.hpp>` | `native_ym2151_*`, `NativeYm2151State` |
| `tetorica::ym2413` | `tetorica_native_ym2413` | `<tetorica/ym2413.hpp>` | `native_ym2413_*`, `NativeYm2413State` |
| `tetorica::segapsg` | `tetorica_native_segapsg` | `<tetorica/segapsg.hpp>` | `native_game_gear_*`, `NativeGameGearState` |
| `tetorica::ay8910` | `tetorica_native_ay8910` | `<tetorica/ay8910.hpp>` | `native_ay8910_*`, `NativeAy8910State` |
| `tetorica::ym2203` | `tetorica_native_ym2203` | `<tetorica/ym2203.hpp>` | `native_ym2203_*`, `NativeYm2203State` |
| `tetorica::ym2608` | `tetorica_native_ym2608` | `<tetorica/ym2608.hpp>` | `native_ym2608_*`, `NativeYm2608State`, `NativeYm2608ExtraState` |
| `tetorica::ym2610`, `tetorica::ym2610b` | `tetorica_native_ym2610` | `<tetorica/ym2610.hpp>`, `<tetorica/ym2610b.hpp>` | `native_ym2610b_*`, `NativeYm2610BState`, `NativeYm2610BExtraState` |
| `tetorica::okim6258` | `tetorica_native_okim6258` | `<tetorica/okim6258.hpp>` | `native_extra_okim6258_*`, `NativeExtraOkim6258State` |
| `tetorica::rf5c164` | `tetorica_native_rf5c164` | `<tetorica/rf5c164.hpp>` | `native_rf5c164_*`, `native_extra_rf5c164_*`, `NativeExtraRf5c164State` |
| `tetorica::opl`, `tetorica::ym3526`, `tetorica::ym3812`, `tetorica::ymf262`, `tetorica::y8950` | `tetorica_native_opl` | `<tetorica/opl.hpp>` and matching chip forwarders | `native_opl_*`, `native_extra_opl_*`, `NativeOplState`, `NativeExtraOplState` |
| `tetorica::gameboy` | `tetorica_native_gameboy` | `<tetorica/gameboy.hpp>` | `native_gameboy_*`, `NativeGameboyState` |
| `tetorica::huc6280` | `tetorica_native_huc6280` | `<tetorica/huc6280.hpp>` | `native_huc6280_*`, `NativeHuc6280State` |
| `tetorica::nes` | `tetorica_native_nes` | `<tetorica/nes.hpp>` | `native_nes_*`, `NativeNesState` |
| `tetorica::pwm` | `tetorica_native_pwm` | `<tetorica/pwm.hpp>` | `native_pwm_*`, `NativePwmState` |
| `tetorica::dx7` | `tetorica_native_dx7` | `<tetorica/dx7.hpp>` | `native_dx7_*`; no public state snapshot |
| `tetorica::snes` | `tetorica_native_snes` | `<tetorica/snes.hpp>` | `native_snes_*`, `NativeSnesState` |
| `tetorica::spc` | `tetorica_native_spc` | `<tetorica/spc.hpp>` | `native_spc_*`, `NativeSpcState`, `NativeSpcEvent` |

The exported names and observational state layouts remain unchanged. These
headers expose the current reference C ABI to C++ hosts; they are not yet a new
versioned, portable C-only SDK header.

The YM2612 fixture exercises two independent instances, all six FM channels, DAC, timers,
status/IRQ, clock changes, observational snapshots, cancellation, retained Stop,
reset, mute, and deferred audition edges. It checks zero C++ allocation/free
during rendering and works in Release builds with assertions enabled. It opens
no audio device.

The YM2151 fixture covers eight FM channels, left/right pan, independent
instances, timers/status/IRQ, clock changes, non-advancing observations, separate
FM/CSM cancellation, audition, retained Stop and reset. Its rendering checks also
reject C++ allocation/free in the tested paths.

The Sega PSG fixture covers the independent three-tone/noise renderer, stereo
routing, mute, retained controls, Stop/reset, clock changes and observation.
The YM2413 fixture covers melodic channels, built-in/user instruments, rhythm
aliases, retained controls, clock conversion, Stop/reset, cancellation,
observation and deferred audition. Its five rhythm voices share physical FM
channels 6–8 rather than adding five independent melodic channels.
The AY fixture covers three independent tone/noise voices, the shared hardware
envelope, readback/observation, clock conversion, retained levels, Stop/reset
and audition. The YM2203 fixture exercises three FM plus three SSG voices,
prescalers, timers/status/IRQ, separate FM/CSM cancellation, retained Stop,
observation and primary/additional reset profiles. The YM2608 fixture covers
FM/SSG/rhythm/ADPCM-B, memory boundaries and retention, timers/status/IRQ,
cancellation, observation and its distinct primary/additional output profiles.
The YM2610 fixture covers both immutable FM variants and both constructor
profiles, FM/SSG/ADPCM-A/B, dense ROM boundaries/copies, sparse-page ownership,
retained controls, Stop/reset, cancellation, timers/status/IRQ and observation.
The OKIM6258 fixture covers sample borrowing/replacement, nibble/FIFO timing,
clock/divider guards, pan, repeat, retained Stop/reset and observation.
The RF5C164 fixture covers both profiles, eight voices, sign-magnitude PCM,
loop markers, RAM/bank access, clock conversion, reset retention and the
additional profile's immediate source cancellation and observation.
Twenty-three fixture executables supply twenty-four CTest tests, with assertions enabled
in Release builds. The SNES executable supplies two entries.
The three OPL-family fixtures exercise primary controls/PCM, additional source
ownership/held output, and Y8950 writable-page memory separately. The shared OPL
library covers four selected chip kinds; each handle constructs only one kind.
The Game Boy fixture covers both pulses, wave RAM and noise, asymmetric stereo
gains/routing, clock conversion, mute progression, retained Stop, per-channel
Stop, reset and repeated non-advancing state observations. It checks every
channel's Stop against foreign-voice reference PCM at 44.1/48/96 kHz and
100 kHz/base/100 MHz clocks, including retained outer samples below the base
clock, along with invalid controls, ABI layout and allocation-free rendering.
The HuC6280 fixture covers six audible sources, owned 5-bit wave RAM, selected
and explicit-channel writes, waveform-helper control/DDA restoration and phase
effects, stereo, noise/LFO, mute progression, Stop/reset, clock conversion,
non-advancing observation and rendering without allocation/free.
The NES fixture checks all six source gates/mutes, copied RAM boundaries and
DMC wrap/loop/IRQ/final-byte lifetime, protected host gates, FDS wave/modulation
and I/O gates, the 400-byte state ABI, independent instances, regional tables,
creation/clock guards, retained Stop/full reset and non-advancing observation.
It compares exact DMC PCM/lifetime during unrelated protected gate edits and
rejects allocation/free while rendering and applying tested controls.
The primary PWM fixture checks constructor/default bounds, FIFO depth/flags,
cycle/timer behavior, routing, integrated duty PCM, clock edits and Stop/reset.
The additional PWM fixture checks independent instances, pure observation,
64-bit owner-tag FIFO/latch cancellation and isolation, overflow, retained
Stop/reset and clock guards. Both compare reference PCM and reject C++
allocation/free on their tested rendering/control paths.
The DX7 fixture checks rate bounds, all 16 held slots, mask-protected free
slots and released tails, raw voice loading, matching-identity live edits and
foreign-identity isolation, invalid-slot no-ops, release/kill buffering,
independent instances and one-time initialization. Immediate panic silence
and 96 clean feedback restarts (32 algorithms at 44.1/48/96 kHz) compare with
fresh instances; tested rendering/control paths allocate/free no C++ memory.
The SNES fixture provides two CTest entries: instrument/Stop/reset checks and
extended RAM/timeline/protected-gate checks. It covers eight BRR voices with
direct GAIN, same-frame KON merging, KOFF, copied RAM and a stable owned
view, non-advancing observation, instance isolation and borrowed timeline
playback/restart/pause. Tested rendering/control paths reject C++ allocation/free.
The SPC fixture checks complete copied file loading, rate/header/size guards,
latched-error recovery, bounded incremental seek, cached mute, pause/resume,
independent instances, non-advancing analysis and bounded observer/overflow
semantics. Tested callback paths reject allocation/free; original SPC bytes
and replacement-handle handoff remain host responsibilities.
See the [verification record](../docs/verification.md)
for completed checks and platform results. These targets cover all 22 cataloged Playground chip IDs and the alternative Nuked YM2612 engine. Separate Analyzer-only chip references remain outside this standalone target set.

`src/ymfm_opn_provider.cpp` includes the unchanged shared ymfm provider and explicitly instantiates the Native OPN engine/channel/operator templates. The adapter declares those templates `extern`; optimized providers must emit their callable definitions even when the provider's own calls are inlined. This incorporates the Tauri link fix without changing DSP behavior or the exported ABI. The provider's origin and include relocation are recorded in the source inventories.

The YM2203, YM2608 and YM2610/YM2610B targets reuse this OPN provider and unchanged
SSG/ADPCM link dependencies. Each constructs only its selected chip. Linking YM2203 does
not allocate YM2608 rhythm/sample resources; a YM2608 handle allocates its own
fixed ROM and RAM buffers, whose contents the host supplies.

`src/ymfm_opm_provider.cpp` does the same for the OPM templates used by YM2151.
Both linkage changes come from Tauri commit
`83bfba8cbbc272a02279aba250b13e4c0f6ca57b`. The shared ymfm vendor files and WASM
recipes are unchanged. The YM2151 target is an independent OPM implementation;
it does not allocate an OKIM6258 core or provide a complete X68000 sound system.

`src/ymfm_opl_provider.cpp` supplies the existing Native OPL/OPLL explicit
template definitions. YM2413 and the shared OPL-family target link the unchanged
ADPCM/PCM support translation units required by that provider. YM2413 constructs
only OPLL; the separate OPL-family constructors select YM3526, YM3812, YMF262 or
Y8950. Shared vendor bytes and WASM recipes are unchanged.

## Alternative Nuked YM2612

Link `tetorica::nuked_ym2612` and include `<tetorica/nuked_ym2612.hpp>`.
This separate LGPL-2.1-or-later target keeps the vendor core, Browser bridge,
Native wrapper and source-policy include unchanged. CMake compiles the provider
as C and the wrapper as C++, renaming all eight exported `OPN2_*` provider
symbols on the C translation unit. The provider privately retains supported
`-fwrapv` signed-wrap semantics from the original Native build. The prefixed exports coexist with the
ordinary `tetorica::ym2612` / ymfm target; do not compile either provider twice.
The target links the platform thread dependency needed by `std::call_once`.

Two existing synchronous ABIs are available:

- `tetorica_nuked_*` creates a raw handle without an output-rate argument.
  `sample_rate(handle, clock)` returns integer `clock / 144`; `generate` writes
  planar source-rate PCM into caller arrays. Raw offsets 0/2 latch an address
  and offsets 1/3 write data. Each raw write clocks a full 24-slot rotation,
  and each generated frame sums 24 internal samples with the retained ×11
  reconstruction. Reads/status/IRQ are synchronous. The internal-envelope
  variant produces identical PCM and fills its four envelope arrays with zero.
- `native_nuked_ym2612_*` owns one raw handle and averages/holds frames to an
  immutable 8–384 kHz output rate, with an editable 100 kHz–100 MHz master clock.
  It retains the existing 528-byte observational `NativeYm2612State`, authored
  register/frequency-latch shadows, six channel mutes, timer/IRQ/status reads,
  ordinary release, immediate source cancellation, separate FM/CSM leases and
  deferred audition. Stop silences output immediately but retains authored
  controls, clock and mute; reset clears register/gate/phase history while
  retaining clock and mute. Valid key-on, CSM and DAC activity can reopen Stop.

The upstream chip type is process-global. The Native wrapper chooses YM2612
once before publishing the first handle; callers must not call the private
`OPN2_SetChipType` provider or mix another chip type into this provider instance.
Hosts must serialize all access to each handle, including raw and Native
control, observation, rendering and destruction. Separate independently owned
handles may be created/rendered concurrently; the cold-construction fixture
checks this without sharing a handle. Create/destroy outside the audio callback.
No sample memory is borrowed and no machine-level PSG mix, source gain, DC
filter or audio output device is supplied. Raw reset retains the model's DC
output; do not assume reset means numerical zero. Buffer sizes, valid handles
and raw register offsets are caller responsibilities, matching the existing ABI.

The Nuked fixture retains the original event CLI and Native state/ownership
checks, then checks raw block/single-frame continuity, zero-length rendering,
zero envelope output, reset and C/C++ allocation-free tested callbacks. A
separate fixture links ordinary YM2612, Nuked and Sega PSG together and checks
cold concurrent construction and cross-engine independence. The original
`tetorica_nuked_genesis_wav <output.wav>` example renders three seconds of
48 kHz stereo PCM16 using Nuked FM plus PSG with fixed gain and edge fades.
These tests do not establish hard real-time deadlines or hardware fidelity.

## Embed YM2151

Link the selected chip target from your application's CMake configuration:

```cmake
add_subdirectory(vendor/tetorica-soundchip-native)
target_link_libraries(your_application PRIVATE tetorica::ym2151)
```

This example configures a centered FM voice on channel 0 and renders 512 stereo
frames at the requested output rate:

```cpp
#include <tetorica/ym2151.hpp>

int main() {
    void* chip = native_ym2151_create(48000);
    if (!chip) return 1;
    const auto write = [chip](unsigned reg, unsigned value) {
        native_ym2151_write(chip, reg, value);
    };
    for (unsigned op = 0; op < 4; ++op) {
        const unsigned offset = op * 8; // Channel 0 in each operator group.
        write(0x40 + offset, 1);
        write(0x60 + offset, op == 0 ? 24 : 127);
        write(0x80 + offset, 31);
        write(0xa0 + offset, 0);
        write(0xc0 + offset, 0);
        write(0xe0 + offset, 15);
    }
    write(0x20, 0xc7); // Left + right, algorithm 7.
    write(0x28, 0x4a); // Key code.
    write(0x30, 0);    // Key fraction.
    write(0x08, 0x78); // All four operators on channel 0.

    float left[512], right[512];
    for (unsigned i = 0; i < 512; ++i) {
        native_ym2151_sample(chip, &left[i], &right[i]);
    }
    // Send these buffers to your audio output or file renderer.
    native_ym2151_stop(chip);
    native_ym2151_destroy(chip);
}
```

Keep the chip alive between audio callbacks. Create/destroy it outside the
callback, serialize register writes with rendering, and schedule events in the
host. `native_ym2151_get_state()` observes authored registers, key gates and
status without advancing audio; it is not a transferable WASM save state.

## Embed Sega PSG

Link `tetorica::segapsg` and include `<tetorica/segapsg.hpp>`. The public ABI keeps
its existing `native_game_gear_*` names for compatibility. Despite those names,
this target owns only one Sega PSG: three tone channels and one noise channel,
without a Genesis FM or Master System OPLL core. The core is the Tetorica
SegaPSG implementation stored under `vendor/ymfm/`; it is not a Yamaha FM chip.

`native_game_gear_create(output_rate)` defaults to a 3,579,545 Hz chip clock and
stereo mask `0xff`. Retain that mask for Genesis/Master System PSG output on
both channels. Game Gear hosts can use `native_game_gear_set_stereo()` for
per-channel routing: bits 0–3 enable right output and bits 4–7 enable left output.

For a tone, calculate the 10-bit period as `round(clock / (32 * frequency_hz))`,
then write its latch low nibble, six high bits, and attenuation byte through
`native_game_gear_write()`. Periods 0/1 have constant-output behavior, so a
musical tone should use 2–1023. Attenuation 0 is loudest and 15 is silent.
`native_game_gear_sample()` renders one stereo frame at the requested output
rate. Stop, mute, audition, reset and observational state access retain their
existing Native semantics; host scheduling and synchronization stay outside
the library.

## Embed YM2413 / OPLL

Link `tetorica::ym2413` and include `<tetorica/ym2413.hpp>` for the existing
`native_ym2413_*` ABI. The target owns one YM2413 with nine melodic channels,
or six melodic channels plus BD/SD/TOM/CYM/HH rhythm voices sharing physical
channels 6–8. It supports the built-in instruments and the chip's one shared
user patch. Output is mono, copied to both stereo channels.

The Native voice APIs use logical IDs 0–8 for melodic channels and 9–13 for
BD/SD/TOM/CYM/HH. The host must account for rhythm's physical-channel sharing
when scheduling and managing ownership. Register writes, retained Stop,
forced release, deferred audition and observational snapshots keep their
existing adapter semantics. This chip can provide the FM part of an MSX-MUSIC
configuration. The separate AY target supplies the three-voice component; the
host still supplies scheduling and system integration.

At the default 3,579,545 Hz clock, musical pitch is
`clock * FNUM * 2^BLOCK / (72 * 2^19)`, with F-NUM 1–511 and BLOCK 0–7. The
OPN formula has a different block factor; do not reuse it for OPLL. The offline
example below shows register-level melody and rhythm configuration.

## Embed AY-3-8910

Link `tetorica::ay8910` and include `<tetorica/ay8910.hpp>` for the unchanged
`native_ay8910_*` ABI. The target owns one AY core independently of OPLL.
Its three voices each combine a tone gate and the shared noise generator,
then select a fixed volume or the one shared hardware envelope. The default
clock is 1,789,773 Hz; tone periods are `round(clock / (16 * frequency_hz))`
within 1–4095. Noise uses the shared five-bit period register, and writing the
envelope shape retriggers the shared envelope.

The Native wrapper retains AY type 0 and output flags 1 from the existing MAME
adaptation: three channel tables are averaged, then clock edits use outer
averaging/hold. Output is mono on both channels. Unlike the raw WASM wrapper,
this ABI has no YM2149/type/flags selector. This output model is not a claim
about an MSX motherboard's analog mixing circuit.

Register writes/readback and `native_ay8910_get_state()` remain synchronous.
State observation does not advance rendering. Zero-volume writes silence the
host voice while retaining its configured level; audition restores that level.
Stop/forced release clear the held output, while ordinary all-notes-off and
preview release retain their existing resampler timing. Create/destroy outside
the audio callback and serialize access with `native_ay8910_sample()`.

## Embed YM2203 / OPN

Link `tetorica::ym2203` and include `<tetorica/ym2203.hpp>` for the existing
`native_ym2203_*` ABI. One handle owns three FM channels and three SSG voices,
with shared SSG noise/envelope and a combined mono signal on both output
channels. The default master clock is 4,000,000 Hz. At the standard prescaler,
FM pitch is `clock * FNUM * 2^(BLOCK-1) / (72 * 2^20)`; write the high-frequency
register immediately before its low register because the OPN latch is shared.
The effective SSG clock is **master/2**, so its tone period is
`round(master_clock / (32 * frequency_hz))`, within 1–4095. YM2608 uses a
different SSG divider. Raw prescaler changes also change these pitch relations.

`native_ym2203_create(output_rate)` retains the primary adapter's reset
boundary: chip/register state resets, while output-rate remainder and held PCM
remain. `native_ym2203_create_extra(output_rate)` selects the additional-instance
profile, whose reset also clears that output history. These constructors are
intentional profiles of the same chip. Stop silences output while retaining
authored controls; ordinary register key-off preserves the FM release envelope.
Forced voice release, FM/CSM cancellation, retained SSG levels and deferred
audition keep their existing Native behavior. Voice IDs 0–2 are FM and 3–5 are
SSG. `read`, status/IRQ and `get_state` observe without advancing rendering;
the state structure is not a transferable WASM save state.

Create/destroy outside the audio callback, serialize writes and sampling, and
schedule events in the host. The PC-98 example below supplies register-level
notes without YM2608 rhythm or ADPCM data; it does not emulate a PC-98 machine.

## Embed YM2608 / OPNA

Link `tetorica::ym2608` and include `<tetorica/ym2608.hpp>` for the existing
`native_ym2608_*` ABI. One independent handle provides six FM channels, three
SSG voices, six fixed-address ADPCM-A rhythm voices and ADPCM-B playback.
Set port 0 register `0x29` to `0x9f` to enable all six FM channels while retaining
the default IRQ enables. At the default 8 MHz master clock and standard
prescaler, FM pitch is `clock * FNUM * 2^(BLOCK-1) / (144 * 2^20)`.
SSG's effective clock is master/4, so its tone period is
`round(master_clock / (64 * frequency_hz))`. This differs from YM2203.
FM, rhythm and ADPCM-B have stereo gates; SSG contributes equally to both sides.

Creation preallocates an initially zero **8 KiB rhythm ROM** and **2 MiB
ADPCM-B RAM**. `load_rom(chip, bytes, offset, size)` and
`load_memory(chip, bytes, offset, size)` synchronously copy encoded bytes into
those fixed buffers; the caller may release its input after a successful return.
Transfers reject ranges beyond their respective capacities and null pointers
for nonempty data. `copy_memory()` copies RAM back without reading the chip's
CPU data port, and `clear_memory()` zeros RAM. These APIs copy or change memory
without implicitly stopping playback: serialize them with sampling and stop the
affected decoder before replacing active data. They do not decode PCM/WAV or
supply a hardware rhythm ROM. ROM/RAM survive both reset and Stop profiles.

For ADPCM-B, stop with port 1 register `0x00=1`, then select eight-bit DRAM
addressing through register `0x01` low bits `2`. This mode uses 32-byte units;
write the start unit to `0x02/0x03` and the **inclusive last unit** to
`0x04/0x05`. Set `0x0c/0x0d=0xff` for the full RAM address limit. The stereo
gates are register `0x01` bits 7/6, volume is `0x0b` (0–255), and Delta-N is
`0x09/0x0a`. At the standard prescaler the decoded sample rate is
`DeltaN * clock / (144 * 65536)`. `0x00=0xa0` starts external-memory playback;
`0xb0` repeats the whole selected range. The offline example supplies both
ADPCM-A and ADPCM-B encoders for its own synthetic data.

`native_ym2608_create()` selects the primary profile, whose reset clears outer
output-rate remainder and held PCM. `native_ym2608_create_extra()` selects the
additional profile, whose reset retains that output history. This is the
**opposite reset-history choice to YM2203**. Both preserve uploaded memory,
clock and source mute settings. The additional profile also keeps independent
held buses for source cancellation. Voice IDs are FM 0–5, SSG 6–8, rhythm 9–14
and ADPCM-B 15. State observations through `get_state()` / `get_extra_state()`
do not advance audio, consume ADPCM data or propagate extended flags into IRQ
state. Raw `read()` can access CPU transfer data, and `read_status_hi()` updates
ADPCM status/IRQ propagation; those reads have hardware side effects and are
not substitutes for an observational snapshot. A snapshot is not a transferable
WASM save state. Keep access serialized and allocate/destroy outside callbacks.

## Embed YM2610 / YM2610B / OPNB

Link either `tetorica::ym2610` or `tetorica::ym2610b` and include
`<tetorica/ym2610.hpp>` or `<tetorica/ym2610b.hpp>`. Both aliases link the same
`tetorica_native_ym2610` library and both headers forward the unchanged
`native_ym2610b_*` ABI. The alias/header does not select the variant for you:
`native_ym2610b_create(output_rate, variant)` selects immutable variant **0** for
YM2610's four physical FM slots **1, 2, 4, 5**, or **1** for all six YM2610B FM
slots. A four-channel host must not use physical slots 0–3 as a compact mapping.
`native_ym2610b_create_extra_variant(output_rate, variant)` makes the same choice
for an additional-instance profile; the convenience `create_extra(output_rate)`
defaults to variant 0, unlike the raw WASM `ym2610b_create()` six-FM default.

Both variants include three SSG voices, six programmable ADPCM-A voices and one
ADPCM-B voice. The default master clock is 8 MHz. FM pitch uses
`clock * FNUM * 2^(BLOCK-1) / (144 * 2^20)`; SSG uses master/4, so its tone
period is `round(clock / (64 * frequency_hz))`. ADPCM-A decodes at clock/432;
ADPCM-B rate is `DeltaN * clock / (144 * 65536)`. FM and ADPCM have stereo
gates; SSG contributes equally to both sides.

The **primary constructor** owns two initially zero, dense **16 MiB ROM banks**:
type 0 is ADPCM-A and type 1 is ADPCM-B. `load_rom(chip, type, bytes, offset,
size)` validates the bank/range and synchronously copies data. The input buffer
may be released after success. `copy_rom()` copies bytes back; `clear_rom()`
zeros the selected bank without releasing its allocation. These memory APIs do
not stop a decoder: serialize access with sampling and stop affected playback
before replacing active bytes. No hardware or game ROM is supplied by the SDK.

The **additional constructor** instead exposes two 16 MiB address spaces through
externally owned, immutable **64 KiB pages**, with 256 page slots per bank.
`alloc_rom_page()` returns a zeroed page for control-side preparation. Fill it
before publication, then `install_rom_page(chip, bank, index, page)` publishes
the pointer without copying or freeing any page. Never mutate a published page.
The host must keep both current and replaced pages alive until rendering can no
longer reference them, then reclaim them with `free_rom_page()` on the control
side. Serialize publication/clearing/destruction with the renderer; the SDK
provides no thread synchronization, callback fence, retirement queue or budgets.
Destroying the chip does not free external pages. For additional instances,
nonempty `load_rom()` calls are rejected, `copy_rom()` reads mapped bytes (zero
for unmapped pages), and `clear_rom()` detaches the selected bank's pointers
without freeing them. A zero-length transfer is only a validated no-op.

Both A and B sample ranges use **256-byte units** with inclusive hardware end
units, unlike YM2608's 32-byte ADPCM-B RAM mode. ADPCM-A registers are on port 1:
start low/high `0x10+voice` / `0x18+voice`, end low/high `0x20+voice` /
`0x28+voice`, individual pan/level `0x08+voice`, total level `0x01` and trigger
mask `0x00`. Keep each A range shorter than 1 MiB because its end comparison
uses the low 20 address bits. ADPCM-B registers occupy port 0 `0x10–0x1b`:
start `0x12/0x13`, end `0x14/0x15`, stereo `0x11`, Delta-N `0x19/0x1a`, volume
`0x1b`, and control `0x10` (`1` stops, `0xa0` starts, `0xb0` repeats). B uses
fixed ROM addressing; OPNA's DRAM-mode/limit programming does not apply.

Both constructor profiles clear outer held PCM and output-rate remainder on
reset, while retaining ROM contents/page mappings, clock and source mute
settings. Stop retains authored controls and memory; the additional profile
preserves independent held buses for cancellation. Voice IDs remain physical
FM 0–5, SSG 6–8, ADPCM-A 9–14 and ADPCM-B 15; unsupported FM slots stay absent
in variant 0. Both status reads and state snapshots are observational, unlike
YM2608's extended-status IRQ propagation. They do not advance audio or expose
a transferable WASM save state. The host supplies all scheduling and output.

## Embed OKIM6258

Link `tetorica::okim6258` and include `<tetorica/okim6258.hpp>` for the unchanged
`native_extra_okim6258_*` ABI and `NativeExtraOkim6258State`. The target owns one
OKI decoder, independently of YM2151. It uses the existing additional-instance
adapter rather than the X68000 primary path's two sample staging banks. The
fixed format is **4-bit OKI ADPCM with 12-bit decoder output** (flags 12), packed
**low nibble first**, unlike Yamaha ADPCM-A/B. The default clock is 8 MHz,
divider 512, and pan 0 enables both outputs. Three-bit ADPCM, recording and a
Native 10/12-bit format selector are not provided.

`load_sample(chip, bytes, size)` accepts 1 byte through 16 MiB, stops playback
and **borrows the input without copying or taking ownership**. Keep the bytes
immutable and alive until a successful replacement or destruction of the core.
Stop and reset retain this pointer; neither ends the lifetime requirement.
Serialize binding, playback and rendering, and retire replaced buffers only
after no rendering call can still use them. The SDK supplies no callback
fence, ownership queue or reclamation. A C++ owner should declare the sample
buffer before the core's RAII handle so reverse destruction releases the core
first, including during exceptions. The X68000 example demonstrates this order.

`play(chip, repeat)` requires a bound sample and repeat 0/1. It resets the
decoder/FIFO and feed position, then streams the borrowed bytes at
`clock / divider` decoded samples per second, with two samples per byte.
Repetition restarts the complete sample. Register `12` low bits select
1024/768/512/512; there is no musical pitch register. Changing the rate changes
sample pitch and duration. Register `2` holds mute bits: bit 0 disables right,
bit 1 disables left. `set_clock()` validates 100 kHz–100 MHz and limits the
VCLK/output-rate ratio to at most 14, both at the selected divider and at the
reset divider 512. Check failure returns; creation accepts output rates
8–384 kHz. Raw clock bytes use registers 8–11, applying the assembled clock on
the final byte.

For a raw FIFO host, control register `0` selects play/stop and data register
`1` feeds encoded bytes. Writing register `0` leaves the convenience sample
streaming path, so the host then owns feed timing. The core has a bounded
eight-byte FIFO; this is not an unbounded PCM stream or a file loader. With no
new nibble, the raw decoder retains its last generated sample. Stop clears the
held output immediately and ends playback/streaming while retaining the sample,
clock, divider, pan and repeat setting. Reset also clears decoder/FIFO phase,
restores divider 512 and pan 0, and retains the edited clock and bound sample.
The next `play()` resets wrapper feed counters. `get_state()` is observational;
its progress fields are not a transferable WASM save state. Allocate/free
outside the callback and keep all chip access serialized.

## Embed RF5C164

Link `tetorica::rf5c164` and include `<tetorica/rf5c164.hpp>`. One static library
exposes both existing ABIs: `native_rf5c164_*` for the primary profile and
`native_extra_rf5c164_*` for independent additional instances. Each handle owns
one eight-voice PCM chip and **64 KiB of RAM**. Neither profile allocates FM or
PSG siblings. Common-operation PCM is checked between the two profiles;
direct Worklet/WASM comparisons exercise the additional API. Their
implementation, validation and control APIs remain distinct.

PCM bytes are sign-magnitude: bit 7 means positive, `0x80` is positive zero,
and bit-clear values are negative magnitudes. **`0xff` is a loop marker**, so
positive magnitude 127 cannot be ordinary sample data. A marker jumps to the
voice's byte-addressed loop start; a second marker there produces silence for
that tick. When large steps can skip bytes, pad the end with enough marker
bytes to catch them. Voice start register `6` uses **256-byte units**, while
loop registers `4/5` use byte units. Step registers `2/3` form a 16-bit value
with 11 fractional bits. At the reference **12.5 MHz** clock, source ticks run
at `clock/384`; for an N-sample waveform use approximately
`step = round(frequency_hz * N * 384 * 2048 / clock)`. Marker-loop quantization
and the chip's stepping still determine the actual period.

Register `7` bit 7 globally enables output; with bit 6 set, bits 0–2 select a
voice, otherwise bits 0–3 select a 4 KiB CPU RAM bank. Register `0` is envelope
level 0–255, and register `1` has left/right pan levels in its low/high nibbles.
Register `8` is an inverted gate mask: a set bit disables that voice and resets
its address to the configured start. `write_memory(offset, value)` follows the
original CPU window behavior **`bank | offset`**, not addition or an absolute
upload. Use offsets 0–4095 for the selected bank window. In contrast,
`load(chip, bytes, offset, size)` uses a bounded absolute RAM range and copies
the caller's bytes synchronously; the input may be released after success.

Both profiles preserve RAM on reset, while resetting voice/control/output
history. `clear_memory()` zeros RAM separately, without implicitly gating
voices or discarding a held output sample. Serialize memory edits with
rendering and disable affected voices before replacing active waveforms.
Creation/destruction and host synchronization remain outside the audio callback.

The primary profile constructs the shared vendor `RF5C164` core at 12.5 MHz.
Clock edits add outer averaging/hold of its canonical output. Its legacy
constructor rejects only an output rate of zero, and its clock setter is
**void and unbounded**; the host must validate suitable rates/clocks. Its
`load()` checks numeric bounds but does not explicitly reject a nonempty null
pointer: callers must provide valid source storage. Do not infer additional
validation from the other profile. The primary API does not expose the extra
profile's observational state/readback or immediate cancellation functions.

The additional profile uses an independent per-voice implementation, retaining
held contributions and outer resampling history to preserve reference PCM while
supporting source cancellation. It accepts output rates 8–384 kHz and clock
values 100 kHz–100 MHz, reports clock rejection, and rejects null pointers for
nonempty uploads. Ordinary register-8 gate writes retain the reference held
output until its normal update. `native_extra_rf5c164_key_off()` and `stop()`
instead clear only the relevant cached contributions and remix immediately,
without advancing foreign voices or sample addresses. Extra state and register
reads are observational; extra `read_memory()` / `read_memory_range()` inspect
absolute RAM, independent of the CPU bank. These views are not WASM save states.

## Embed the OPL family

`tetorica::opl`, `tetorica::ym3526`, `tetorica::ym3812`, `tetorica::ymf262` and
`tetorica::y8950` all link **one** `tetorica_native_opl` library. Include
`<tetorica/opl.hpp>` or a matching chip forwarder. Every header exposes the same
existing primary/additional ABIs. **Neither alias nor header selects the chip.**
Pass a kind to `native_opl_create(rate, kind)` or
`native_extra_opl_create(rate, kind)`; one chosen core/profile is constructed:

| Kind | Chip | Default clock | FM channels | Source sample rate |
| --- | --- | --- | --- | --- |
| 0 | YM3526 / OPL | 3,579,545 Hz | 9 | clock/72 |
| 1 | YM3812 / OPL2 | 3,579,545 Hz | 9 | clock/72 |
| 2 | YMF262 / OPL3 | 14,318,180 Hz | 18 | clock/288 |
| 3 | Y8950 / MSX-AUDIO | 3,579,545 Hz | 9 plus ADPCM-B | clock/72 |

At operator multiplier 1, pitch is `clock * FNUM * 2^BLOCK / (divider * 2^20)`,
with divider 72 or 288 above, F-NUM 1–1023 and BLOCK 0–7. OPL2 has four waveforms;
OPL3 has eight when NEW mode is enabled. OPL3 four-operator pairs share two
physical channels, and rhythm's five logical voices share channels 6–8. OPL3
NEW=0 folds upper bus writes according to the existing core; the additional
profile exposes authored/effective register views for this distinction. Its four
output buses fold A+C to left and B+D to right. Other kinds produce mono on both
channels. Voice IDs are FM 0–8 (OPL3 0–17), BD/SD/TOM/CYM/HH 18–22, and Y8950
ADPCM 23. Constructors accept 8–384 kHz; clock edits accept 100 kHz–100 MHz.

Primary Stop clears active voices/pending previews and silences output while
retaining controls. Additional `all_notes_off()` uses ordinary gate writes and
keeps release timing; `host_all_notes_off()` silences the host presentation,
while strong `stop()` also cancels CSM. The additional profile separates normal
FM cancellation from CSM and tracks held voice/drum contributions so runtime
cancellation does not advance foreign sources. Preview release/audition retains
its distinct held-output timing, with retrigger after an ordinary chip interval;
OPL3 source-preview functions also respect physical/effective state when NEW
mode has changed. These functions are not interchangeable generic key-offs.
Primary reset calls the core reset; additional reset restores its captured
power-on state and clears held caches. Both clear outer output history and
register controls, retaining the selected kind, edited clock and Y8950 page
bindings. See the existing headers for profile-specific functions.

### Y8950 writable ADPCM memory

Both profiles borrow **up to 2 MiB of writable RAM** as 512 caller-owned
**4 KiB pages**. `memory_page(chip, index, page)` publishes a pointer (or null)
without copying/owning/freeing it; `memory_length(chip, bytes)` publishes the
logical byte length, up to 2 MiB. A mapped page beyond that length still reads
as zero. Unmapped reads return zero and unmapped writes are ignored. Index/length
values outside capacity are ignored. These operations are inert for other kinds.
The raw ABI does not atomically stop playback on page/length edits: cancel ADPCM
first and serialize publication with the renderer. CPU transfer writes can
modify mapped pages, so immutable sample storage is not valid here.

Keep page storage stable and writable across reset and until replacement or
destruction has been synchronized with all rendering users. Stop/reset retain
page pointers, length and revision counters; destruction does not free pages.
The host owns preparation, synchronization, replacement and retirement; the SDK
does not include the Rust queue, copy-on-write manager, budgets or callback
fences. Declare the page owner before the chip's RAII handle so it is destroyed
after the chip. The MSX-AUDIO example maps one full page with a 2048-byte logical
sample, without an external allocator or application runtime.

Each accepted `memory_length()` sets
`upload_revision = ++memory_revision`; actual mapped CPU RAM writes increment
only `memory_revision`. Installing a page alone does not change either counter.
These are revision markers, not independent upload/write counts. To clear,
cancel ADPCM, zero or replace pages and publish the desired length; there is no
copy-owning bulk-memory API in this C ABI.

Y8950 ADPCM-B uses register `7` for control (`1` stop, `0xa0` start, `0xb0`
repeat), register `8` low bits `2` for eight-bit DRAM/32-byte units, start
`9/10`, inclusive end `11/12`, Delta-N `16/17` and volume `18`. Preserve the
FM CSM/note-select bits in register `8` when changing memory mode. Decoded rate
is `DeltaN * clock / (72 * 65536)`. Output is mono, with no ADPCM pan API.
Raw CPU-data reads/writes have transfer side effects. State snapshots do not
consume ADPCM data or advance audio, but their Y8950 status read can propagate
ADPCM flags into IRQ state; they are not universally IRQ-neutral observations.
No Native snapshot is a transferable WASM save state.

## Embed Game Boy DMG audio

Link `tetorica::gameboy` and include `<tetorica/gameboy.hpp>`. The header forwards
the unchanged `native_genesis_gameboy.h` ABI, including `NativeGameboyState`.
Each handle owns one DMG APU: pulse channels 0/1 (sweep on channel 0), wave
channel 2 with 16 bytes of owned RAM, and noise channel 3. There is no borrowed
sample storage or external ROM dependency. This is the existing MAME-derived
DMG adaptation; CGB/AGB variants, CPU execution, hardware register reads and
the wave-RAM corruption glitch are outside its scope.

```cmake
add_subdirectory(vendor/tetorica-soundchip-native)
target_link_libraries(your_application PRIVATE tetorica::gameboy)
```

```cpp
#include <tetorica/gameboy.hpp>

int main() {
    void* chip = native_gameboy_create(48000);
    if (!chip) return 1;
    native_gameboy_write(chip, 0x16, 0x80); // NR52: power on.
    native_gameboy_write(chip, 0x14, 0x77); // NR50: equal output gains.
    native_gameboy_write(chip, 0x15, 0x11); // NR51: pulse 1 to both sides.
    native_gameboy_write(chip, 0x01, 0x80); // NR11: 50% duty.
    native_gameboy_write(chip, 0x02, 0xf0); // NR12: constant envelope, DAC on.
    native_gameboy_write(chip, 0x03, 0xd6); // NR13/14: approximately 440 Hz.
    native_gameboy_write(chip, 0x04, 0x86); // Trigger, length disabled.
    float left[512], right[512];
    for (unsigned i = 0; i < 512; ++i)
        native_gameboy_sample(chip, &left[i], &right[i]);
    // Send these buffers to your audio output or file renderer.
    native_gameboy_stop(chip);
    native_gameboy_destroy(chip);
}
```

Creation accepts output rates **1–384,000 Hz**, rejecting zero and higher rates.
The reference input clock is **4,194,304 Hz**. `set_clock()` accepts
100 kHz–100 MHz and reports rejection without changing the clock. The shared
core remains at its reference clock; the Native wrapper adds fractional
averaging/hold for edits. The first accepted edit initializes outer held PCM
and phase; later edits preserve them. Pulse frequency is
`clock / (32 * (2048-N))`; the 32-nibble wave frequency is
`clock / (64 * (2048-N))`, with eleven-bit N. Noise uses a 15-bit or short
7-bit LFSR with period `{8,16,32,48,64,80,96,112}[divisor] << shift` CPU cycles.

`write()` takes offsets **0x00–0x2f from CPU I/O 0xFF10**. For example, NR52 is
offset `0x16`, and wave RAM is `0x20–0x2f`; absolute CPU addresses are not this
ABI's address format. Unused offsets are inert. NR51 low bits route channels
0–3 right and high bits route them left. Preserve the existing NR50 convention:
**low three bits control left, bits 4–6 control right**; each scale is
`(1 + volume) / 480`, so volume zero is the minimum gain rather than silence.
VIN bits are unused. The core adds the centered DAC values and integrates
native ticks without a motherboard filter or automatic peak normalization.

Power NR52 on before normal configuration writes. While powered off, only
NR52 and length registers NR11/NR21/NR31/NR41 accept sound-register writes.
Wave RAM remains writable while the wave channel is off, including with APU
power off. During active wave playback, writes follow the existing narrow
sample-read access window and target the currently read byte. Disable the wave
DAC or Stop its channel before replacing a complete waveform.

`set_mute_mask()` bits 0–3 suppress presentation while synthesis, envelopes,
length/sweep and the noise LFSR keep progressing. `stop_channel()` clears only
that channel's gate and core contribution, retaining its registers and foreign
voices. At clocks below the reference, an already held outer mixed frame can
remain until the next source frame. `stop()` gates all four channels and clears
both core and outer held output immediately. Both retain wave RAM, registers,
power, routing, output gains, clock and mute. Reset instead powers off the APU,
clears gates/register controls and output phase, and restores the documented
16-byte DMG wave-RAM startup pattern; the edited clock and source mute survive.

`get_state()` copies the 48-byte register/wave view, active gate mask, clock and
source mute mask without ticking audio or triggering voices. Trigger bits are
stripped from NRx4 views; NR52 reconstructs power and active gates. Active gates
do not imply audible output when routing, DAC or mute suppresses a source.
This is an observational snapshot, not hardware readback or a transferable
WASM save state. The access-only friend declaration is recorded in the vendor
inventory; no synthesis algorithm is amended. Create/destroy outside the audio
callback, keep valid handles/output pointers, and serialize all chip access.

## Embed PC Engine HuC6280 audio

Link `tetorica::huc6280` and include `<tetorica/huc6280.hpp>`. This forwards the
existing `native_genesis_huc6280.h` ABI and `NativeHuc6280State` without renaming
exports. Each handle owns six audible channels 0–5, each with 32 unsigned 5-bit
wave samples and a DDA latch. Channels 4/5 also support noise; LFO modulates
channel 0 using channel 1. The eight-channel register/state storage retains
selection slots 6/7 for compatibility; those slots are not audible sources.
No external ROM or borrowed sample storage is needed. The existing MAME
adaptation retains its documented imperfect/unverified noise and LFO model.

```cmake
add_subdirectory(vendor/tetorica-soundchip-native)
target_link_libraries(your_application PRIVATE tetorica::huc6280)
```

```cpp
#include <tetorica/huc6280.hpp>
#include <cstdint>

int main() {
    void* chip = native_huc6280_create(48000);
    if (!chip) return 1;
    uint8_t wave[32];
    for (unsigned i = 0; i < 32; ++i)
        wave[i] = uint8_t(i < 16 ? 1 + 2 * i : 63 - 2 * i);
    native_huc6280_waveform(chip, 0, wave); // Synchronous copy; wave may now expire.
    native_huc6280_write(chip, 1, 0xff, -1); // Global left/right balance.
    native_huc6280_write(chip, 5, 0xff, 0);  // Channel 0 left/right balance.
    native_huc6280_write(chip, 2, 254, 0);   // round(3579545 / (32 * 440)).
    native_huc6280_write(chip, 3, 0, 0);
    native_huc6280_write(chip, 4, 0x9f, 0);  // Wave enabled, maximum level.
    float left[512], right[512];
    for (unsigned i = 0; i < 512; ++i)
        native_huc6280_sample(chip, &left[i], &right[i]);
    // Send these buffers to your audio output or file renderer.
    native_huc6280_stop(chip);
    native_huc6280_destroy(chip);
}
```

Creation accepts **8,000–384,000 Hz** inclusive. The reference chip clock is
**3,579,545 Hz**. `set_clock()` accepts **100,000–100,000,000 Hz** inclusive,
returning 1 on success or 0 without changing the clock on rejection. Clock
edits keep the shared core at its reference clock and apply outer fractional
averaging/hold; accepted edits preserve that outer phase/held PCM. At the
reference clock no outer conversion is enabled until `set_clock()` is called.
With LFO disabled, wave pitch is `clock / (32 * period)`, where the 12-bit
frequency in registers 2/3 encodes periods 1–4095 and zero means 4096. DDA
instead holds an unsigned 5-bit value until the host supplies another timed
register-6 write. Both wave samples and DDA use **16 as neutral**; zero is a
negative DAC extreme, not silence.

`write(handle, reg, value, channel)` accepts register offsets **0–9**, not CPU
addresses. Register 0 selects `value & 7`; register 1 is global balance;
registers 8/9 are global LFO frequency/control. Their channel argument is
ignored. For registers 2–7, an explicit channel 0–7 temporarily selects that
slot and restores the previous selection afterward. Any other channel value,
including the conventional `-1`, writes the currently selected slot. Offsets
above 9 are ignored. Register 4 uses bit 7 as enable, bit 6 as DDA mode and bits
0–4 as level. Register 5 and global balance use the high nibble for left and
low nibble for right. The retained logarithmic attenuation table is summed
without automatic peak normalization or an analog output filter. Register 7's
noise-enable bit 7 affects only channels 4/5; bits 0–4 select the noise rate.
LFO mode uses register 9's low two bits, with bit 7 resetting its source phase.
The retained model can also output channel 1 while it supplies LFO modulation.

`waveform(handle, channel, samples)` copies exactly 32 bytes immediately for
channels 0–5; each byte is masked to five bits. A null source or any other
channel is ignored. The caller may release or modify the source array after
the call. The helper preserves current channel selection, restores the
channel's control byte and, if DDA was selected, restores its prior DDA latch.
It temporarily disables playback and toggles DDA to reset the wave-write
index, then writes the complete wave. **It changes index/phase**: the final
index is zero and restoring an enabled control can retrigger its period
counter. It does not promise uninterrupted active playback. Raw register-6
wave writes use the current index, advancing it only while playback is off;
raw DDA writes update the latch instead. Serialize either operation with
rendering. There is no sample-buffer publication or retirement obligation.

`set_mute_mask()` bits 0–5 suppress output while enabled oscillators, noise and
LFO continue advancing. `key_off(channel)` accepts slots 0–7 and only clears
control bit 7; `stop()` does the same for all eight slots. They preserve waves,
frequency, levels, balance, noise/LFO, DDA mode/latch, clock and mute. **Stop
does not write neutral DDA**: re-enabling a DDA channel resumes its retained
value. Neither operation clears outer held PCM, so below the reference clock
an old mixed frame can remain until the next core frame. They do not provide
immediate source cancellation or advance other channels at the call itself.
Reset instead clears registers, wave RAM, DDA, selection, LFO/noise controls
and core/outer output phase, restoring the noise seeds; edited clock and mute
survive. Applications can fade output or explicitly supply neutral DDA when
that is their intended playback policy.

`get_state()` copies selection, authored register shadows, all eight wave,
index and DDA slots, and the edited clock without advancing audio. Shadows
record authored bytes, including helper writes; this is an observational
snapshot, not hardware readback or a portable save/load format. Keep valid
handles and output pointers, create/destroy outside the audio callback, and
serialize register writes, waveform copies, reset, observation and rendering.
The CMake target compiles only `native_genesis_huc6280.cpp`, which already
includes `huc6280.cpp`; do not compile the vendor implementation again as a
separate translation unit. No scheduler, audio device or machine runtime is
imported.

## Embed NES with optional FDS

Link `tetorica::nes` and include `<tetorica/nes.hpp>` for the unchanged
`native_nes_*` ABI and `NativeNesState`. FDS is a constructor flag in this one
library/header. The target compiles only `native_genesis_nes.cpp`: it is a
self-contained renderer. Do not add `vendor/tetorica-nes/nes_core.cpp`, whose
`native_nes_*` exports would collide. The two core sources differ only in their local header include; WASM adds
block generation and compiled state-layout descriptors. Neither core is
changed by this target.
The NES target selects C++17 and applies the original Tauri integer/aliasing/
floating-point flags when the compiler supports them; those private flags do
not affect other chip libraries or consumers.

```cmake
add_subdirectory(vendor/tetorica-soundchip-native)
target_link_libraries(your_application PRIVATE tetorica::nes)
```

```cpp
#include <tetorica/nes.hpp>

int main() {
    void* chip = native_nes_create(48000, 1789773.0, true); // NTSC, FDS enabled.
    if (!chip) return 1;
    native_nes_write(chip, 0x4017, 0x40); // Four-step frame clock, no frame IRQ.
    native_nes_write(chip, 0x4015, 0x01); // Pulse 1 gate.
    native_nes_write(chip, 0x4000, 0xbf); // 50%, held length, constant level 15.
    native_nes_write(chip, 0x4001, 0x08); // No sweep; negate mode.
    native_nes_write(chip, 0x4002, 253);  // round(1789773/(16*440)) - 1.
    native_nes_write(chip, 0x4003, 0xf8); // Timer high bits + length reload.
    float left[512], right[512];
    for (unsigned i = 0; i < 512; ++i)
        native_nes_sample(chip, &left[i], &right[i]);
    native_nes_stop(chip);
    native_nes_destroy(chip);
}
```

Creation accepts 8,000–384,000 Hz output and a finite base clock from
1,600,000–1,900,000 Hz. Choose, for example, 1,789,773 Hz NTSC or 1,662,607 Hz
PAL; base clocks below 1,700,000 select PAL noise/DMC/frame tables. The base
clock and FDS flag are immutable. `native_nes_set_clock` accepts integer
100,000–100,000,000 Hz and returns success/failure. It changes outer
averaging/hold relative to the base clock, preserving phase/remainder and the
original regional tables; it does not rebuild the APU for a new region.
At the base clock, pulse pitch is `base_clock / (16 * (period + 1))` and
triangle pitch is `base_clock / (32 * (period + 1))`; periods above 7 are the
usable range in this renderer. With zero FDS sweep gain, wave pitch is
`base_clock * frequency / 4194304`. Clock edits scale these pitches by
`clock / base_clock`.

Writes use absolute CPU addresses: pulses `$4000–$4007`, triangle
`$4008/$400A/$400B`, noise `$400C/$400E/$400F`, DMC `$4010–$4013`, gates
`$4015` and frame control `$4017`. DMC starts at `$C000 + 64*$4012`, plays
`16*$4013 + 1` bytes, consumes bits least significant first and wraps from
`$FFFF` to `$8000`. The copied memory API addresses the entire 64 KiB CPU
space: `native_nes_load(chip, bytes, offset, size)` returns 1 on success and
0 when `offset > 65536`, `size > 65536-offset`, or nonempty data has a null
pointer. A zero-byte upload may use null and offset 65536. Successful uploads
copy immediately; the input can expire on return. `native_nes_read_memory`
reads this RAM, not registers or hardware status. The host supplies encoded
DMC data and serializes uploads with rendering; no ROM parser, memory bus or
asynchronous loader is included.

FDS I/O must be enabled through `$4023` bit 1. The owned 64-byte wave table at
`$4040–$407F` accepts writes only when `$4089` bit 7 opens its write window;
audio uses each byte's low six bits. Close the window for playback. `$4080`
controls volume envelope/fixed gain, `$4082/$4083` hold the 12-bit frequency,
`$4083` bit 7 halts/restarts wave phase and bit 6 gates envelopes. `$4084`
controls sweep envelope/fixed gain, `$4085` writes a signed 7-bit modulation
counter, and `$4086/$4087` set modulation frequency/control. `$4088` writes
3-bit modulation entries only while `$4087` bit 7 disables modulation; each
write advances the doubled index by two through 32 owned entries. `$4089`
also selects master attenuation, and `$408A` sets envelope speed. Disabling
I/O blocks subsequent wave/control writes but does not stop a running FDS
oscillator. The state register mirror records submitted writes even when an
FDS gate rejects their hardware effect; inspect applied FDS fields/tables too.

Source IDs and mute bits are pulse 1/2 = 0/1, triangle = 2, noise = 3,
DMC = 4 and FDS = 5. `native_nes_enable` is the legacy APU `$4015` helper;
ordinary enable writes can refill an exhausted DMC sample. For independent
host gates, `native_nes_enable_channel` accepts APU IDs 0–4 and preserves
DMC decoder state when editing IDs 0–3. `native_nes_write_enable` merges
protected gate bits from the current mask; protecting bit 4 also preserves
the complete DMC state rather than refilling its final shifting byte.
`native_nes_active_mask` observes gates/lengths/DMC data-in-flight and FDS
oscillator enable without advancing synthesis; it is not an amplitude meter.
`native_nes_core_size` reports the retained C++ allocation including RAM.

The APU mixes pulses and triangle/noise/DMC through the retained nonlinear
lookup model and integer high-pass history. FDS has a 2 kHz low-pass and
20 Hz DC-removal filter before addition; the Native mix then passes through
its 10 Hz DC remover. Output is mono duplicated to left/right. Mute bits 0–5
preserve progression: APU mutes act before nonlinear mixing, FDS mute after
its own filters. `get_state`, `active_mask` and memory reads neither advance
audio nor acknowledge IRQ. State reports raw timer/rate quantities, not
hertz; DMC frequency is eight times its CPU-cycle bit period. It includes
frame/DMC IRQ flags, applied FDS fields, wave/modulation bytes and clock data.
The 400-byte snapshot omits RAM and internal filter/resampler history; it is
not a resumable save-state.

Global Stop gates off the APU and submits FDS halt/zero-gain writes through
the I/O gate; if FDS I/O is disabled, that FDS oscillator can remain active.
`stop_channel(5)` deliberately halts it even with I/O disabled while restoring
the authored I/O setting and retaining wave/envelope data. APU source Stop
preserves foreign DMC state; DMC Stop also clears its current DAC sample while
retaining the authored `$4011` and decoder level. Stop is not a PCM-buffer
clear: DAC latches, filter tails and sub-base-clock held output can persist.
Both Stop forms retain RAM, waves, clock and mute. Full reset clears the
64 KiB DMC RAM, FDS wave/modulation tables, registers, gates, phases and
filter/outer output history, retaining current/base clocks, mute and FDS flag.
Serialize every handle operation on its owning audio thread; state snapshots
are copied, with no imported host scheduler, lock or ownership queue.

The public forwarder and SDK integration use the default BSD-3-Clause terms.
The existing Native NES/FDS renderer explicitly retains **Apache-2.0 AND MIT**,
including the JSNES and fixNES notices; see [LICENSES.md](../LICENSES.md).

## Embed 32X PWM

Link `tetorica::pwm` and include `<tetorica/pwm.hpp>` for the unchanged
`native_pwm_*` ABI and `NativePwmState`. Each handle owns the shared
`wasm/pwm32x_core.h` core, two three-entry FIFOs, output latches and Native
owner-tag metadata. CMake compiles only `native_genesis_pwm.cpp`; the core is
header-only. No sample storage is borrowed, and no SH2, DMA, video, analog PWM
filter, audio device or application scheduler is included.

```cmake
add_subdirectory(vendor/tetorica-soundchip-native)
target_link_libraries(your_application PRIVATE tetorica::pwm)
```

`native_pwm_create(output_rate)` accepts 1–1,000,000 Hz and returns null for
invalid rates. Native defaults are **23,011,361 Hz, duty mode, gain 1**.
The standalone reference JavaScript defaults to DAC mode/gain 0.4 instead;
its VGM comparison path uses duty/gain 1. This Native ABI has no gain,
output-mode or mute setter. `native_pwm_set_clock` accepts integer
100,000–100,000,000 Hz and returns success/failure, preserving FIFO contents,
latches and timer phase; rejected edits leave the handle unchanged.

Write register indices 0–4, rather than machine bus addresses:

| Index | Function |
| --- | --- |
| 0 | 16-bit control: left FIFO route in bits 0–1, right FIFO route in bits 2–3, interrupt cadence in bits 8–11 |
| 1 | 12-bit cycle register; a written zero has effective cycle 4095, while readback retains zero |
| 2 | Push the left FIFO |
| 3 | Push the right FIFO |
| 4 | Push the same value to both FIFOs |

Route 1 sends a FIFO to its matching output; route 2 crosses it to the opposite
output. Routes 0/3 consume entries without updating a latch. Thus control
`0x05` gives ordinary left/right routing and `0x0a` swaps them. Every timer tick
pops each nonempty FIFO, left first and right second, so a right-FIFO write wins
when both target the same latch on one tick. A full FIFO drops its oldest entry
when pushed. FIFO register reads in `get_state().registers[2/3]` are `0x4000`
when empty, `0x8000` when full and zero otherwise; register 4 is their bitwise
AND. The snapshot also provides sizes and raw queue contents.

The timer runs when effective cycle is not 1 and the control low nibble is
nonzero. Its interval is **cycle minus one chip clocks**, so the FIFO source
rate is `clock/(cycle-1)`. An active control/cycle write clears both FIFOs,
resets the cadence tick and starts a fresh full interval, while retaining
already latched output and the cumulative interrupt count. Configure these
registers before filling the FIFOs. Deactivation retains latches and queues;
empty queues retain the previous output. Cadence zero represents 16 ticks;
other values represent 1–15. Interrupts are reported only as a count, with no
host callback or CPU IRQ/DMA system.

FIFO writes copy the low 16 bits immediately; synthesis uses each latched
value's low 12 bits. Native duty PCM is
`((raw & 4095)/(effective_cycle/2.0) - 1)`, with no clipping. An invalid latch
is silent, but a valid raw zero is **negative full scale**. Center counts on
`cycle/2`, and keep counts between 0 and cycle for the nominal [-1,+1] range;
counts larger than cycle can exceed full scale. For example, cycle 960 has
neutral count 480, source interval 959 clocks and about 23,995.163 ticks/s at
the default clock. `native_pwm_sample` integrates the held duty output over
one output frame, including any ticks within it. It is not a one-pop-per-call
PCM queue: hosts must feed according to actual tick timing and queue capacity.

A small raw-count host can configure, prime and render as follows:

```cpp
#include <tetorica/pwm.hpp>

int main() {
    void* chip = native_pwm_create(48000);
    if (!chip) return 1;
    native_pwm_write(chip, 1, 960);
    native_pwm_write(chip, 0, 0x05);
    native_pwm_write(chip, 2, 600); // Left +0.25 duty after the first tick.
    native_pwm_write(chip, 3, 480); // Right neutral, not raw zero.
    float left[512], right[512];
    for (unsigned frame = 0; frame < 512; ++frame)
        native_pwm_sample(chip, &left[frame], &right[frame]);
    // Empty FIFOs hold the last value; a streaming host must refill them.
    native_pwm_stop(chip); // Invalidates both latches and empties both queues.
    native_pwm_destroy(chip);
}
```

Ordinary `native_pwm_write` is tag zero, the unowned primary path.
`native_pwm_write_tagged` associates a nonzero 64-bit owner with FIFO entries
and the output latches they later update. The tag changes no PCM or timing.
`native_pwm_has_tag` reports queued or valid latched ownership, not signal
amplitude. `native_pwm_cancel_tag` removes only matching queued entries,
compacts each FIFO in order and immediately invalidates any matching output
latch without advancing the timer or unrelated queued/latching state. It does
not restore a value that was overwritten earlier. Tag zero is never reported,
and cancellation of zero is a no-op. Overflow, route collisions and active
timer reconfiguration follow the same physical queue/latch behavior as
ordinary writes; active reconfiguration drops queued tags while retaining
latched ownership. These are ownership controls for a host's existing event
policy, not a new scheduler, timestamp queue, owner lease or lifetime manager.

Stop empties the active queues, invalidates/zeros the audible latches and
clears ownership tags immediately. It retains control/cycle, edited clock,
timer phase and interrupt count; an enabled empty timer can continue counting.
Reset additionally clears registers, effective cycle and timer/count history,
retaining output rate and edited clock. Reset also clears all tags.
`native_pwm_get_state` copies register readback, effective cycle, raw latches,
validity, FIFO contents/sizes, timer phase/count and clock without advancing
PCM. The snapshot omits owner tags and is observational, not a save/load API.
`native_pwm_core_size` reports the owned C++ allocation including metadata.
Create/destroy outside the callback and serialize every write, observation,
clock edit, cancellation, Stop/reset and sample on the owning audio thread.

The [32X WAV host](examples/sega32x_wav.cpp) demonstrates bounded FIFO feeding
with original locally generated PCM/percussion, keeping the default clock
and adding separate YM2612/PSG handles after a left/right PWM-only audition.

## Embed DX7

Link `tetorica::dx7` and include `<tetorica/dx7.hpp>` to use the unchanged
`native_dx7_*` ABI. One handle owns a six-operator MSFA synthesizer with 32
algorithms and 16 preallocated notes. The public header forwards the Native
declarations; internal `SynthUnit` and `Dx7Note` classes are not public SDK APIs.

```cmake
add_subdirectory(vendor/tetorica-soundchip-native)
target_link_libraries(your_application PRIVATE tetorica::dx7)
```

`native_dx7_create(output_rate)` accepts 8,000–384,000 Hz and returns null for
invalid rates or allocation failure. Create/destroy outside the audio callback.
Creation initializes process-wide lookup tables once at **44,100 Hz**; every
instance keeps that internal rate and generates 64-frame source blocks. At
44.1 kHz, `native_dx7_sample` directly consumes those source samples. Other
output rates use stateful linear interpolation, including two-source-sample
prefetch. There is no clock or output-rate setter. Each call returns one mono
float converted from the core's filtered, clipped Int16 output; a stereo host
can copy it to both channels. No extra host gain or normalization is applied.

`native_dx7_voice(chip, voice, identity, live)` requires a nonnull pointer to
**155 validated, unpacked single-voice bytes**. It copies those bytes immediately;
the input can expire on return. This API does not accept packed 128-byte bank
voices, a SysEx header/checksum or a bank. It has no byte count, parser or range
validation. The six 21-byte operator blocks are ordered **OP6, OP5, …, OP1**.
Within each block, offsets 0–3 are EG rates, 4–7 EG levels, 8–12 key scaling,
13 rate scaling, 14 AM sensitivity, 15 velocity sensitivity, 16 output level,
17 mode, 18 coarse, 19 fine and 20 detune. Global offsets 126–133 hold pitch
EG rates/levels, 134 the zero-based algorithm 0–31, 135 feedback 0–7,
136 oscillator sync, 137–142 LFO parameters, 143 pitch-modulation sensitivity,
144 transpose and 145–154 the name.
The core does not apply AM sensitivity/depth, transpose or oscillator-key-sync;
see the [MSFA research notes](../docs/research.md) for retained limitations.

With `live=false`, the call selects the copied voice for subsequent notes and
updates the shared LFO. Existing notes keep their captured operator parameters.
With `live=true` and the same identity as the current selection, edits to
operator output level, mode/coarse/fine/detune and feedback reach all live notes
with that identity, including released tails, without restarting their phase
or envelopes. General EG, algorithm, scaling and name edits are future-note
fields. LFO speed, delay, key-sync and waveform remain shared; note pitch-
modulation depth/sensitivity are captured for subsequent notes. A different
identity acts as selection;
use a new identity when replacing a bank entry and retain an identity when
reselecting that same entry. The SDK does not allocate or manage identities.

`native_dx7_note_on(chip, midi_note, velocity)` uses MIDI pitch units (60 is C4,
69 is A4 at 440 Hz) and requires 0–127 note/velocity values from the caller.
Velocity zero still allocates a Native note; it is not a MIDI Note Off command.
The return value is the allocated **slot 0–15**, or `-1` when every eligible
slot is held. Allocation scans round-robin for a slot whose key is no longer
down; it may reuse a released tail. `native_dx7_note_on_mask` additionally skips
each set bit in its 16-bit preserve mask, even if that slot is released.
Maintain slot ownership in the host and protect tails that must not be reused.
There is no public note-off-by-pitch or active-slot query.

`native_dx7_release_slot(chip, slot)` releases that slot's envelope while
retaining its tail. `native_dx7_kill_slot` disables future computation for that
slot, but up to the already mixed 64-source-frame block, interpolation prefetch
and the shared output-filter tail can remain audible. These are caller-owned
slot controls, not immediate per-slot silence. Out-of-range slots are ignored.
`native_dx7_panic` instead clears every gate, source/output buffering, filter,
controllers and LFO in existing storage, and resets the preallocated
notes in place to clear feedback history for a clean panic restart. The selected
voice, output rate and note storage addresses are preserved; subsequent
samples are immediately silent until another note.
`native_dx7_core_size` reports owned C++ storage, including the 16 note objects,
not serialized state. This ABI has no portable snapshot/save/load or
observational note-state API; reference Tauri observation is host-specific.

Call voice, note, slot and sample functions serially on the caller's thread.
They run synchronously and use preallocated storage; creation/destruction own
allocation. The SDK supplies no audio callback, scheduler, ownership queue or
thread synchronization. Build-time scalar selection and supported
`-fwrapv`, `-fno-strict-aliasing`, `-ffp-contract=off` flags preserve the Native
integer/aliasing/floating-point behavior without imposing flags on consumers.
C++17 remains the SDK minimum.

CMake assembles 13 `.cc` and 17 `.h` files under its binary directory's `msfa/`
(`build/native/native/msfa/` for a root build into `build/native`). It copies
24 shared files and selects the same six Native files from
`reference/overrides/msfa/`: `dx7note.cc`, `env.cc`, `ringbuffer.cc`, `synth.h`,
`synth_unit.cc` and `synth_unit.h`. Quoted local includes must resolve inside
this complete Native tree; an include-directory preference alone cannot
replace a same-directory shared header. Only the selected `.cc` files compile;
do not add duplicate shared implementations. The vendor tree and WASM recipe
remain unchanged. The SDK amends only Native `synth_unit.cc` panic to clear
per-note feedback history in existing storage; original/packaged hashes record
this correction. Ordinary Note On/release/kill behavior is preserved.
MSFA and the overrides retain Apache-2.0, and the Native
wrapper retains its explicit Apache-2.0 notice. The public forwarder and SDK
integration use the default BSD-3-Clause terms.

`examples/dx7_wav.cpp` is a complete small host with original 155-byte voices,
explicit note-slot release and mono-to-stereo output; no SysEx or assets are
needed.

## Embed SNES S-DSP

Link `tetorica::snes` and include `<tetorica/snes.hpp>`. This separate static
target compiles the unchanged `native_genesis_snes.cpp` wrapper and accurate
`SPC_DSP.cpp`. It does not compile `SNES_SPC.cpp` or an SPC700 CPU, load SPC
files or need a Nintendo IPL ROM. The existing wrapper/header and DSP retain
their LGPL-2.1-or-later notices. The new public forwarder/integration use the
SDK BSD-3-Clause default; they do not change the linked component's terms.
Retain the component sources/notices when distributing this target.

`native_snes_create(output_rate)` accepts integer **8,000–384,000 Hz** and
returns null on a rejected rate or failed allocation. Each handle owns its DSP
and zero-initialized **65,536-byte RAM**. Create/destroy outside the callback.
The DSP always generates stereo Int16 PCM at **32,000 Hz**. Each
`native_snes_sample(chip, &left, &right)` returns one normalized stereo float
frame, using the retained two-frame prefetch and integer-phase linear output
interpolation. There is no clock or rate setter and no SDK mixer gain.
No audio device, host callback, scheduler or thread synchronization is supplied.
Serialize every write, upload, timeline control, observation and sample call;
keep handles and output pointers valid. Apart from `load`'s documented guards,
these low-level functions do not provide general null-pointer validation.

The eight physical voices are numbered **0–7**. Voice `ch` uses registers
`ch*16 + 0/1` for signed left/right volume, `+2/3` for 14-bit PITCH, `+4` for
SRCN, `+5/6` for ADSR and `+7` for GAIN. PITCH `4096` advances one decoded
BRR sample per native frame, not one frame at the host output rate. For an
original periodic waveform of `N` decoded samples, use
`round(frequency_hz * N * 4096 / 32000)`, checked within `1..16383`; arbitrary
recordings need their own declared root tuning. No voice allocator, BRR
encoder or musical-note parser is included in this C ABI.

Set master volume and FLG deliberately before key-on: reset initially
mutes/resets the DSP. For a dry instrument, FLG `0x20` disables echo RAM writes;
set echo volumes, echo sends and feedback to zero as well. DIR selects the
256-byte page for the 256 four-byte sample-directory entries. Each entry has
little-endian start/loop pointers into the same 64 KiB RAM. Reserve directory,
sample and any enabled echo regions explicitly. Supply valid BRR blocks and
END/LOOP flags with block-aligned loop pointers; disabling echo writes alone
does not arrange RAM or sample tuning for the host.

`native_snes_load(chip, data, address, size)` validates the handle and nonempty
input pointer and rejects ranges outside `0..65536`; it copies immediately,
so a successful input buffer can expire on return. Use a valid data pointer
even for a zero-length upload. The input range must not overlap the destination
RAM range. It does not allocate or validate BRR/directory contents.
`native_snes_get_ram(chip, output)` copies all 65,536 bytes to a caller-provided
buffer. `native_snes_ram_data` instead returns a stable
read-only view of the Core-owned allocation, valid until destruction; mutation
and concurrent rendering must be excluded while reading it.
`native_snes_read_memory` reads one 16-bit RAM address. These observations do
not advance synthesis; the view is not an independent snapshot.

`native_snes_write` accepts raw registers `0..127`; out-of-range register
numbers are ignored. It tracks raw KON writes for the key helper.
`native_snes_key_on(chip, ch)` clears that voice's KOFF and merges key-on bits
only within the same native DSP frame. Consecutive calls can start a chord
without replacing earlier bits. `native_snes_key_off` removes a same-frame
pending KON bit and sets KOFF; the hardware release tail remains audible.
Invalid voice indices are ignored. `native_snes_write_protected` preserves
masked host-owned bits for KON/KOFF; for other registers it behaves like a raw
write. This is a bit-preservation helper, not host ownership management.

`native_snes_stop` discards a prepared timeline, resets active DSP state and
output interpolation, and restores authored register settings except the
KON/KOFF and ENVX/OUTX registers; ENDX is cleared by its write semantics. It
sets KON to zero and KOFF to `255`, retains all RAM including sample/echo
contents and resets the frame count. Retained
echo RAM can still sound when echo is enabled; Stop does not guarantee
immediate silence for every configuration. Re-keying uses the retained
instrument. `native_snes_reset` also discards the timeline
and resets output/history, but clears all RAM and restores DSP reset defaults;
the host must upload/configure the instrument again. The output rate is fixed
for the handle. `native_snes_get_state` copies 128 readable DSP registers,
the native frame count and timeline status/position without advancing PCM.
It is observational data, not a portable save/load format.

### Optional borrowed timeline

`native_snes_prepare_timeline(chip, ram, dsp, events, event_count,
duration_clocks)` loads captured initial state and leaves playback paused.
`ram` must point to **65,536 bytes**, `dsp` to **128 bytes**, and `events` to an
aligned array of **four `uint32_t` words per event**:
`{clock, kind, address, value}`. Kind `0` writes a DSP register `0..127`; kind
`1` writes a RAM address `0..65535`. Values must fit one byte. Provide events
in nondecreasing clock order within the duration; equal-clock events retain
array order. Use a duration of at least `32` divisible by `32`, and
`event_count <= UINT32_MAX/4` so four-word indexing does not overflow. Clocks use
**1,024,000 Hz**, with 32 clocks per native audio frame. These are caller
preconditions; the C wrapper does not validate arrays, event ordering or
addresses before copying/indexing them.

All three input arrays are **borrowed immutable storage**. Although preparation
copies initial RAM/register bytes into the core, play/replay copies them
again and event playback reads the borrowed event array. Retain every array,
including while paused or ended, until `native_snes_reset`,
`native_snes_stop`, replacement preparation or destruction; exclude mutation
and concurrent access. An empty event list has count zero and may use a null
event pointer; RAM/DSP pointers must still be valid.

`native_snes_play_timeline` restarts from the initial capture and begins
playback. `native_snes_stop_timeline` pauses, clears interpolation history and
retains the prepared arrays; the next play starts again from the beginning,
rather than resuming. While paused, sampling returns zero without advancing
the timeline. Playback preserves the captured four-native-frame initial
output delay and produces zero after the duration. State positions/totals use
32 kHz native frames, not host-rate samples. Timeline mode is exclusive with
authored instrument controls at the host level; reset/Stop before switching
back. A timeline replays DSP/RAM events without executing an SPC700 program;
SPC loading/seeking and trace capture remain separate APIs outside this target.

`examples/snes_wav.cpp` is a complete instrument host. It generates three
original 64-sample BRR loops, reserves directory/sample RAM, auditions a sine
left and an ADSR triangle right, then plays all eight voices with alternating
stereo balance and ADSR/direct GAIN. All voices receive KOFF and retain their
hardware release tails. It uses no timeline buffers, ROM or external assets.

## Embed SPC700 file playback

Link `tetorica::spc` and include `<tetorica/spc.hpp>` for the existing
`native_spc_*` ABI. Unlike `tetorica::snes`, this target executes an SPC700
program together with the accurate stereo S-DSP. It adds file playback, pause,
source mute, analysis snapshots and a bounded DSP-write observer. It does not
add an audio device, metadata-based duration/fade, tempo conversion or the
Nintendo IPL ROM. Programs that depend on the full IPL are outside the supplied
snapshot's coverage. The core, wrapper and included ABI header retain
LGPL-2.1-or-later notices; the new public forwarder and SDK integration use the
repository's BSD default.

```cmake
add_subdirectory(vendor/tetorica-soundchip-native)
target_link_libraries(your_application PRIVATE tetorica::spc)
```

Prepare a handle before installing it in the render callback. For example,
this helper accepts complete SPC bytes and a position expressed in **32 kHz
native frames**, prepares a fresh paused player, and returns ownership to the
caller:

```cpp
#include <tetorica/spc.hpp>
#include <algorithm>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <vector>

using Spc = std::unique_ptr<void, void (*)(void *)>;

Spc prepare_spc(const std::vector<uint8_t>& original, uint32_t skip_frames) {
    if (original.size() > 16u * 1024u * 1024u)
        throw std::runtime_error("SPC file exceeds the Native size limit");
    Spc player(native_spc_create(48000), native_spc_destroy);
    if (!player) throw std::runtime_error("Could not create SPC player");
    if (!native_spc_load_control(player.get(), original.data(),
                                 uint32_t(original.size())))
        throw std::runtime_error(native_spc_error(player.get()));
    while (skip_frames) {
        const uint32_t block = std::min(skip_frames, 16000u);
        if (!native_spc_seek_control(player.get(), block))
            throw std::runtime_error(native_spc_error(player.get()));
        skip_frames -= block;
    }
    return player;
}
```

After a host-controlled handoff, `native_spc_set_playing(player, 1)` starts
playback and `native_spc_sample(player, &left, &right)` renders one stereo
output frame. The output rate is fixed at creation and must be 8–384 kHz.
The internal source remains 32 kHz, rendered in **128-frame blocks**, followed
by two-sample integer-phase interpolation. There is no master-clock setter.

### Control operations, pause and host Stop

Create, destroy, load and seek on the **control side**, never on a handle
already installed in an audio callback, including while that handle is paused.
These operations initialize or run the CPU and are not callback preparation
shortcuts. Prepare a separate handle, synchronize its publication, retire the
old one after the callback stops accessing it, and destroy it on control.
The SDK supplies no handoff queue, locking or reclamation manager. Serialize
all rendering, controls and observations for each handle.

`native_spc_load_control` accepts a recognized SPC header, a size of at least
`0x10180` bytes and no more than 16 MiB. Successful loading copies the file's
RAM, DSP and CPU state into the player; the input pointer is not borrowed.
It leaves playback paused, clears failure, resets playback counters and
interpolation, disables/clears observation and retains the source mute mask.
The wrapper does **not** retain the original file. Keep an immutable host copy
if you need Stop-to-start or absolute seeking later. Load failure latches an
error and is not a transactional replacement: previous `loaded`/`playing`
flags can remain set, but failed sampling returns zero until a successful
reload. Check return values and `native_spc_error`, not just those flags.

`native_spc_seek_control(player, frames)` advances a loaded, paused,
non-observing handle by **0–16,000 native frames per call**. It discards rendered
audio, resets output interpolation and updates the base position. Repeated
bounded calls after a fresh load prepare a longer position. This operation is
relative advancement, not an absolute file-position setter. A previously
played handle can have CPU/DSP state ahead of audible output because of
128-frame render-ahead and interpolation; prepare absolute seeks from the
original file in a fresh player. Invalid load/seek operations latch failure;
a successful reload is required to clear it.

There is no separate Native Stop or reset function. `set_playing(player, 0)`
**pauses**: subsequent samples return zero without advancing CPU, DSP or output
counters, preserving cached PCM and interpolation for resumption. It does not
rewind. Implement Stop-to-start by preparing a replacement from the retained
original file. Pausing a callback-installed handle does not make control-only
load or seek safe on that handle.

`native_spc_set_mute_mask(player, mask)` accepts bits 0–7 for the eight voices,
where a set bit mutes output without stopping CPU/DSP progression. It changes
future DSP output, retaining already rendered 128-frame PCM and interpolation
samples; echo history can also remain audible. Do not assume an immediate
all-channel silence boundary. Pause provides silent output while frozen.
Playback and mute setters and tested rendering paths require no allocation,
destruction or internal locks; the caller still serializes access.

### Analysis and DSP-write observation

`native_spc_get_state` copies the 56-byte observational `NativeSpcState`.
`native_frames` counts source frames already rendered, which can be ahead of
playback. `base_native_frames` records prepared seek advancement;
`output_frames` counts output since the last load/seek. The derived
`playback_native_frames` is `base + output_frames * 32000 / sample_rate`, not a
CPU execution position. Error text is borrowed from the handle's current
error state; copy it if the host needs to retain it across later operations.

`native_spc_snapshot` writes into a caller-owned buffer of at least
**`0x10200` bytes**; zero-initialize the workspace before use because file-header
fields are not supplied. Public RAM is `[0x100, 0x10100)` and the 128 DSP bytes are
`[0x10100, 0x10180)`. This analysis workspace is **not a resumable save state or
a complete exportable SPC file**: the operation does not supply a valid file
header or preserve every internal DSP/CPU/timer/interpolation field. A snapshot
does not retain an input-buffer lifetime after returning. For DSP-only reads,
provide 128 writable bytes to `native_spc_read_dsp_registers`. These observations
do not advance audio; exclude concurrent mutation while reading.

`native_spc_observe(player, enabled, capacity)` configures a preallocated
DSP-write observer, with capacity **16–8192 events**. It clears the buffered
event count and overflow counter on each configuration. Each 16-byte
`NativeSpcEvent` contains an emulated clock, register and byte value. Clocks use
**1,024,000 Hz** (32 clocks per 32 kHz frame); CPU block render-ahead also affects
when events become visible to the host. It is not the full WASM trace/RAM
read-discovery interface or a host wall-clock event stream.

`native_spc_event_data` returns **borrowed handle-owned storage**; read or copy
only `native_spc_event_count` entries while excluding core mutation. Consume
before further rendering, reconfiguration, clearing or destruction.
`native_spc_events_clear` clears the count without clearing overflow.
`native_spc_overflow_take` retrieves and clears the saturating lost-event
counter without draining events. The host supplies bounded capture storage
and a draining policy; an observer overflow loses writes rather than allocating
more memory. Disable observation before control-side seeking.

`examples/spc_wav.cpp` is a complete original-data player host. It builds a
full SPC file in memory, including an original SPC700 program and three
64-sample sine/triangle/pulse BRR loops. The **emulated CPU** configures the DSP,
polls timer 0 at 100 Hz, alternates a stereo melody, plays a three-voice
C-major chord and releases all notes through `$F2/$F3` writes. The host only
loads, starts and samples it; a bounded observer verifies CPU-driven note
writes. Pitch uses the fixed 32 kHz DSP rate and echo writes are disabled.
No Nintendo IPL bytes, game music, ROM, external file or audio device is used.

## Offline WAV examples

`examples/sega32x_wav.cpp` links `tetorica::pwm`, `tetorica::ym2612` and
`tetorica::segapsg` in `tetorica_32x_wav`. The first half-second auditions
PWM only on the left, and the next half-second only on the right; the final
two seconds mix original PWM PCM bass/percussion with FM and PSG. It retains
the Native 23,011,361 Hz clock and cycle 960 (neutral 480, 959 clocks/tick),
primes each three-entry FIFO and refills only free slots using sequential
source-tick time. Fixed gains, bounded duties and fades preserve headroom.
`examples/genesis_wav.cpp` links `tetorica::ym2612` and `tetorica::segapsg` in
`tetorica_genesis_wav`. `examples/master_system_wav.cpp` links
`tetorica::ym2413` and `tetorica::segapsg` in `tetorica_master_system_wav`.
`examples/msx_wav.cpp` links `tetorica::ay8910` and `tetorica::ym2413` in
`tetorica_msx_wav`. The Master System FM example uses OPLL's built-in piano,
light rhythm and PSG tones; the MSX-style example uses AY tones/noise, a roughly
200 ms plucked envelope and an OPLL flute melody.
`examples/pc98_ym2203_wav.cpp` links only `tetorica::ym2203` in
`tetorica_pc98_ym2203_wav`, rendering all three FM and three SSG voices with
noise and a roughly 200 ms shared envelope at the standard prescaler.
`examples/pc98_ym2608_wav.cpp` links `tetorica::ym2608` in
`tetorica_pc98_ym2608_wav`. It uses FM voices 0/3/5, all three SSG voices,
synthetic ADPCM-A percussion uploaded into the fixed rhythm regions and an
ADPCM-B pluck uploaded into RAM. Both encoded datasets are generated locally;
the rhythm data does not reproduce the chip's original ROM sounds.
`examples/neogeo_wav.cpp` links `tetorica::ym2610` in `tetorica_neogeo_wav`.
It creates the four-FM primary variant, uses all four physical FM slots and
three SSG voices, and uploads original synthetic ADPCM-A percussion and an
ADPCM-B pluck into the two dense ROM banks. These are programmable sample
ranges rather than OPNA's fixed rhythm layout.
`examples/x68000_wav.cpp` links `tetorica::ym2151` and `tetorica::okim6258` in
`tetorica_x68000_wav`. It compensates OPM KC/KF pitch for the selected 4 MHz
clock and plays a locally encoded percussion sample through OKI at
8 MHz/divider 512 (15,625 decoded samples/s). Its immutable sample vector
outlives both core handles, including on errors. This is an offline sound
configuration, without device drivers or a complete X68000 emulation.
`examples/megacd_wav.cpp` links `tetorica::ym2612`, `tetorica::segapsg` and
`tetorica::rf5c164` in `tetorica_megacd_wav`. It uses the primary RF profile,
uploads an original sign-magnitude looping waveform and plays three PCM voices
alongside FM/PSG. A marker-filled tail handles skipped bytes safely; positive
sample magnitudes avoid the reserved `0xff` encoding.
`examples/dos_opl_wav.cpp` renders YM3526, YM3812 and YMF262 in three one-second
sections, exercising sine/half-sine waveforms, rhythm, an OPL3 four-operator pair
and left/right routing. `examples/msx_audio_wav.cpp` combines one Y8950's FM and
original ADPCM-B with AY8910 and YM2413. The writable sample page is declared
before the Y8950 handle so the decoder never outlives its RAM.
`examples/gameboy_wav.cpp` links only `tetorica::gameboy` in
`tetorica_gameboy_wav`. The first second isolates pulse 1 left and pulse 2
right; the second isolates an original triangle in wave RAM left and short
noise hits right; the last combines all four with pulse sides reversed.
It derives musical pitches from the 4,194,304 Hz clock and uses equal NR50
gains, fixed output headroom and short per-note fades.
`examples/pcengine_wav.cpp` links only `tetorica::huc6280` in
`tetorica_pcengine_wav`. Its first second separates original triangle/sine
waves left/right; the next uses a pulse bass, host-fed 5-bit DDA melody and
both noise channels; the last combines all six audible sources and reverses
the first two voices' sides. It uses the 3,579,545 Hz clock, unsigned DAC
neutral 16, fixed gain and short per-note fades without external sample data.
`examples/nes_fds_wav.cpp` links only `tetorica::nes` in
`tetorica_nes_fds_wav`. At the 1,789,773 Hz NTSC base clock, its first second
uses both pulses, triangle, noise and 65 original DMC bytes copied into RAM;
the next uses an original 64-sample FDS triangle; the last mixes all six.
It disables modulation for musical pitch conversion and checks timer
quantization within one percent. The retained mono output is duplicated
into stereo, using fixed gain and per-note fades.
`examples/dx7_wav.cpp` links only `tetorica::dx7` in `tetorica_dx7_wav`.
It constructs three original 155-byte voices with all six operators: algorithm
1 and a matching-identity live timbre edit, algorithm 5 FM pairs, then an
algorithm 32 C-major chord. MIDI notes return slots for explicit release,
leaving envelope tails. Fixed gain and edge fades reserve output headroom;
the fixed 44.1 kHz core is interpolated to 48 kHz and copied to both channels.
`examples/snes_wav.cpp` links only `tetorica::snes` in `tetorica_snes_wav`.
It creates original 64-sample sine/triangle/pulse BRR loops and copies their
directory and data into owned RAM. A left sine and right ADSR triangle are
followed by an eight-voice stereo chord using ADSR/direct GAIN, with explicit
KOFF releases. Pitch uses 32 kHz source frames rather than the 48 kHz output;
echo writes are disabled. Fixed gain/fades preserve headroom.
`examples/spc_wav.cpp` links only `tetorica::spc` in `tetorica_spc_wav`.
Its original SPC700 timer-driven program plays a stereo melody and chord
through the DSP using three original BRR loops; the host does not schedule
raw DSP notes. A bounded observer confirms CPU writes, with fixed gain/fades
and no IPL, game data, external file or audio device.
From the SDK root:

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --config Release --target tetorica_32x_wav tetorica_genesis_wav tetorica_master_system_wav tetorica_msx_wav tetorica_pc98_ym2203_wav tetorica_pc98_ym2608_wav tetorica_neogeo_wav tetorica_x68000_wav tetorica_megacd_wav tetorica_dos_opl_wav tetorica_msx_audio_wav tetorica_gameboy_wav tetorica_pcengine_wav tetorica_nes_fds_wav tetorica_dx7_wav tetorica_snes_wav tetorica_spc_wav
# Single-configuration generators:
./build/native/native/tetorica_32x_wav "32x demo.wav"
./build/native/native/tetorica_genesis_wav "genesis demo.wav"
./build/native/native/tetorica_master_system_wav "master system demo.wav"
./build/native/native/tetorica_msx_wav "msx demo.wav"
./build/native/native/tetorica_pc98_ym2203_wav "pc98 ym2203 demo.wav"
./build/native/native/tetorica_pc98_ym2608_wav "pc98 ym2608 demo.wav"
./build/native/native/tetorica_neogeo_wav "neogeo demo.wav"
./build/native/native/tetorica_x68000_wav "x68000 demo.wav"
./build/native/native/tetorica_megacd_wav "megacd demo.wav"
./build/native/native/tetorica_dos_opl_wav "dos opl demo.wav"
./build/native/native/tetorica_msx_audio_wav "msx audio demo.wav"
./build/native/native/tetorica_gameboy_wav "gameboy demo.wav"
./build/native/native/tetorica_pcengine_wav "pcengine demo.wav"
./build/native/native/tetorica_nes_fds_wav "nes fds demo.wav"
./build/native/native/tetorica_dx7_wav "dx7 demo.wav"
./build/native/native/tetorica_snes_wav "snes demo.wav"
./build/native/native/tetorica_spc_wav "spc demo.wav"
# Visual Studio on Windows:
./build/native/native/Release/tetorica_32x_wav.exe "32x demo.wav"
./build/native/native/Release/tetorica_genesis_wav.exe "genesis demo.wav"
./build/native/native/Release/tetorica_master_system_wav.exe "master system demo.wav"
./build/native/native/Release/tetorica_msx_wav.exe "msx demo.wav"
./build/native/native/Release/tetorica_pc98_ym2203_wav.exe "pc98 ym2203 demo.wav"
./build/native/native/Release/tetorica_pc98_ym2608_wav.exe "pc98 ym2608 demo.wav"
./build/native/native/Release/tetorica_neogeo_wav.exe "neogeo demo.wav"
./build/native/native/Release/tetorica_x68000_wav.exe "x68000 demo.wav"
./build/native/native/Release/tetorica_megacd_wav.exe "megacd demo.wav"
./build/native/native/Release/tetorica_dos_opl_wav.exe "dos opl demo.wav"
./build/native/native/Release/tetorica_msx_audio_wav.exe "msx audio demo.wav"
./build/native/native/Release/tetorica_gameboy_wav.exe "gameboy demo.wav"
./build/native/native/Release/tetorica_pcengine_wav.exe "pcengine demo.wav"
./build/native/native/Release/tetorica_nes_fds_wav.exe "nes fds demo.wav"
./build/native/native/Release/tetorica_dx7_wav.exe "dx7 demo.wav"
./build/native/native/Release/tetorica_snes_wav.exe "snes demo.wav"
./build/native/native/Release/tetorica_spc_wav.exe "spc demo.wav"
```

The one required argument selects the output WAV; the parent directory must
exist. Each example generates exactly 144,000 frames of stereo PCM16 at 48 kHz
from synthetic notes/percussion, with no audio device or external assets.
They use MIDI notes for DX7 and their chips' respective pitch equations, fixed mix headroom
and short output fades. Sega PSG stereo remains `0xff`; AY, OPLL, YM2203, NES/FDS and DX7
output is mono on both channels. Their fixed example gains are not motherboard mix
ratios or SDK-wide defaults. Rendering and file writing happen offline,
rather than inside an audio callback.

`TETORICA_NATIVE_BUILD_EXAMPLES` defaults to `ON`. Disable it with
`-DTETORICA_NATIVE_BUILD_EXAMPLES=OFF` for a library-only integration; tests are
controlled separately by `TETORICA_NATIVE_BUILD_TESTS`.

## Collected component references

| Public component | Reference wrapper or support | Native CMake build |
| --- | --- | --- |
| Sega PSG | `native_genesis_psg.h`, independent `native_genesis_game_gear.cpp` wrapper | Standalone PSG target and fixture; no OPLL core |
| YM2612 | `native_genesis_ym2612.cpp`; Nuked alternative in `native_genesis_nuked.cpp` and `.inc` | ymfm and alternative Nuked built and tested |
| YM2203 | `native_genesis_ym2203.cpp` | Standalone OPN+SSG target and fixture; both constructor profiles |
| YM2608 | `native_genesis_ym2608.cpp` | Standalone OPNA target and fixture; both constructor profiles |
| YM2610 / YM2610B | `native_genesis_ym2610b.cpp`, selected immutable variant | One standalone OPNB library and fixture; both constructor profiles |
| YM2151 | `native_genesis_ym2151.cpp` | Standalone OPM target and fixture; separate from the OKI handle |
| YM2413 | `native_genesis_ym2413.cpp`, `native_genesis_opll.h` | Standalone OPLL target and fixture |
| AY-3-8910 | `native_genesis_ay8910.cpp` | Standalone AY target and fixture; fixed Native type/flags |
| YM3526 / YM3812 / Y8950 / YMF262 | `native_genesis_opl.cpp`, `native_genesis_extra_opl.cpp` | One kind-selected library; primary, additional and Y8950 memory fixtures |
| RF5C164 | `native_genesis_rf5c164.cpp`, `native_genesis_extra_rf5c164.cpp` | One standalone library and fixture; distinct primary/additional profiles |
| OKIM6258 | `native_genesis_extra_okim6258.cpp` | Standalone ADPCM target and fixture; borrowed immutable sample |
| Game Boy | `native_genesis_gameboy.cpp` | Standalone DMG APU target and fixture; owned wave RAM, gate-only Stop and observation |
| NES + optional FDS | `native_genesis_nes.cpp` | Standalone APU/FDS target and fixture; copied DMC RAM, wave/modulation tables and observation |
| PC Engine / HuC6280 | `native_genesis_huc6280.cpp` | Standalone six-source target and fixture; copied wave RAM, DDA/noise/LFO and observation |
| DX7 | `native_genesis_dx7.cpp`, generated Native MSFA tree | Standalone six-operator/16-slot target and fixture; original-voice WAV host |
| 32X PWM | `native_genesis_pwm.cpp`, shared `pwm32x_core.h` | Standalone PWM target, primary/additional-tag fixtures and 32X WAV host |
| SNES S-DSP | `native_genesis_snes.cpp`, accurate `SPC_DSP.cpp` | Standalone eight-voice target, instrument/timeline CTest entries and original-BRR WAV host; no SPC700 CPU |
| SPC700 file player | `native_genesis_spc.cpp`, accurate `SPC_DSP.cpp`, `SNES_SPC.cpp`, `SNES_SPC_misc.cpp`, `SNES_SPC_state.cpp` | Standalone player target and fixture; original CPU-program/BRR WAV host |

The grouped rows cover 22 public components. Component origins and notices are
kept with the shared vendor inventory; these adapters do not replace the
per-component notices. The Native DX7 snapshot has six host portability/API
variants under `reference/overrides/msfa/`. Unchanged MSFA files are shared from
`vendor/msfa/`; the overrides are explicitly recorded rather than silently
substituted into the WASM build.

## Licensing

Original Tetorica adapters, headers, and integration code are covered by the
BSD 3-Clause License in [LICENSE](../LICENSE), matching tetorica-fm2612, unless
a file carries an explicit different declaration. This repository-wide default
also covers original files without a separate file-level declaration.

Existing declarations and third-party terms are retained. In particular,
the MSFA sources and DX7 Native overrides retain Apache-2.0, the NES/FDS port
retains its Apache-2.0 and MIT notices, and the SNES/SPC and Nuked-derived
adapters retain their LGPL notices. See [LICENSES.md](../LICENSES.md) and
[catalog/native_inventory.json](../catalog/native_inventory.json) for the
component-specific records. `LICENSE.tools` is a compatibility copy of the
same BSD 3-Clause text, not a separate restriction on the original adapters.

## Boundaries to preserve during migration

The vendor chip cores implement chip behavior. Existing reference wrappers also
contain application policies such as source-rate resampling, authored register
shadows, mute, forced release, audition, and Stop. A later shared ABI must decide
which of these policies are common before consumers are switched.

The Y8950 page table in `native_genesis_y8950_memory.h` describes memory supplied
by a host. In the reference Tauri application, Rust owns preparation, COW pages,
budget accounting, retirement and final reclamation; standalone consumers must
supply their own lifetime and synchronization policy. None of the Native wrappers supplies the
Playground's 16-instance/64 MiB rack, timestamp queue, owner leases, or thread
coordination by itself. Each host must keep chip access serial and satisfy the
existing pointer-lifetime contract.
