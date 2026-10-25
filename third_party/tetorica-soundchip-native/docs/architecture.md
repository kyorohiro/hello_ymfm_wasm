# Architecture and adoption

`tetorica-soundchip-native` distributes sound-chip cores and their low-level Native and WASM bridges as versioned source snapshots. It incorporates changes developed and verified in `tetorica-fm2612` and Playground Tauri, with provenance, component licenses and backend differences recorded alongside the code.

| Project | Responsibility |
| --- | --- |
| `tetorica-soundchip-native` | Source snapshots, low-level bridges, standalone build targets, provenance and license records, verification and release archives |
| `tetorica-fm2612` source repository; prospective `tetorica-fm` | Core improvements, WASM bridges, JavaScript APIs, Synth, AudioWorklet and adapter development and testing |
| Playground / Tauri | Native bridge development and testing, configuration and UI, Native IPC, playback scheduling, owner and voice management, CPAL and host effects |

Original Tetorica code is licensed under BSD-3-Clause, matching `tetorica-fm2612`. Third-party components and files with existing explicit licenses retain those terms. See [LICENSES.md](../LICENSES.md) for component exceptions and notices.

## Development sources and release snapshots

Changes developed in the application repositories enter the SDK after verification. When Native and WASM need different implementations, both versions and the reasons for their differences are retained. Each update records its source revision, file hashes and [chip-specific differences](chip-differences.md), then produces a new versioned release.

Consumers vendor a selected release and update on their own schedule. Record downstream patches separately so a later import preserves them and distinguishes them from SDK changes. Development repositories and consuming applications do not need to update together.

The SDK is the distribution source for these snapshots. Moving shared-core development into this repository is possible later; the current workflow also supports development and verification in the application repositories.

## Adoption stages

1. Collect the chip sources, component licenses and existing bridges while preserving the dependency paths used by current applications.
2. Build the YM2612, YM2151, YM2413, YM2203, YM2608, YM2610/YM2610B, Sega PSG, AY-3-8910, OKIM6258, RF5C164, Game Boy, HuC6280, NES with optional FDS, 32X PWM, MSFA DX7, SNES S-DSP, SPC700/S-DSP playback and YM3526/YM3812/YMF262/Y8950 Native libraries and representative WASM recipes using only a source ZIP extracted outside the original repositories, then verify PCM, observation and state operations appropriate to each ABI. Render the offline Genesis, Master System FM, MSX, both PC-98, NeoGeo, X68000, Mega-CD, DOS OPL, MSX-AUDIO, Game Boy, PC Engine, NES with FDS, 32X PWM, DX7, SNES S-DSP and SPC700 playback examples to check small hosts.
3. Switch one application's YM2612 dependency to a release pinned by version and archive hash, and compare its build and output with the existing implementation.
4. Adopt further targets incrementally, documenting Native/WASM differences and host integration requirements before switching each consumer.

`native/reference/tauri/` contains captured Native provider implementations. These sources retain backend-specific resampling, mute, audition and cancellation behavior. Their presence alone does not establish a stable SDK API; completed targets and checks are recorded separately. DX7's Native-specific changes are also retained separately. Nineteen standalone Native libraries cover twenty-two chip IDs: YM2612/ymfm, YM2151/ymfm, YM2413/ymfm, YM2203/ymfm, YM2608/ymfm, YM2610/YM2610B/ymfm, Sega PSG, AY-3-8910, OKIM6258, RF5C164, Game Boy, HuC6280, NES with optional FDS, 32X PWM, MSFA DX7, SNES S-DSP, SPC700/S-DSP playback and YM3526/YM3812/YMF262/Y8950. The alternative Nuked YM2612 engine uses a separate library without adding a chip identifier. YM2610/YM2610B share one library; the four OPL-family chips share another. Twenty-four aliases/headers include generic `opl` and alternative `nuked_ym2612`; neither alias nor header selects a constructor kind/variant. See the [verification record](verification.md) for completed checks and platform coverage.

The Native-owned OPN and OPM providers under `native/src/` explicitly instantiate the templates used by those adapters. They incorporate the Tauri linkage fix while preserving the shared vendor bytes and existing chip ABI. YM2151 is an independent eight-channel OPM target, and OKIM6258 is a separate decoder target; neither allocates the other chip. Adding a chip target does not import the Tauri scheduler, device output or ownership system.

The YM2203 target reuses the OPN provider and unchanged SSG/ADPCM link dependencies, exposing only one YM2203 with three FM plus three SSG voices. FM and SSG combine to mono on both output channels. Its existing primary constructor preserves held PCM/output-rate remainder across reset; the additional-instance constructor clears that history on reset. The host selects the intended profile explicitly. The PC-98 example uses the default 4 MHz clock and standard prescaler; it does not require or provide YM2608 rhythm/ADPCM resources.

The separate YM2608 target uses the same provider infrastructure for six FM channels, SSG, fixed-address rhythm and ADPCM-B. Each handle preallocates zeroed 8 KiB ROM and 2 MiB RAM buffers; synchronous memory APIs copy caller bytes, so the host retains no input-buffer lifetime obligation after a successful transfer. The host must serialize transfers with rendering and supply suitable encoded data. Both reset profiles retain memory: primary reset clears outer output history, while additional reset retains it, opposite to YM2203. Observational snapshots avoid ADPCM data/status-read side effects; the raw hardware reads remain distinct APIs.

The YM2610/YM2610B library selects four physical FM slots 1/2/4/5 or all six, plus SSG and programmable ADPCM-A/B. Primary handles own two dense 16 MiB ROM banks and accept bounded synchronous copies. Additional handles instead borrow immutable 64 KiB pages across two 16 MiB address spaces; the host prepares, publishes and retires those pages, and nonempty dense uploads are rejected. The SDK supplies neither callback lifetime fences nor queues/budgets. Both profiles retain ROM data/page mappings while clearing outer output history on reset. Both OPNB status reads are observational, unlike OPNA's extended-status read.

The YM2413 target uses the imported cached OPLL adapter and the full Native OPL template provider, including its unchanged ADPCM/PCM link dependencies. Only YM2413 is constructed by this target; the separate OPL-family library selects YM3526/YM3812/YMF262/Y8950 through an explicit constructor kind. OPLL's nine melodic channels become six FM channels plus five logical drum voices in rhythm mode, sharing physical channels 6–8. A host can combine this MSX-MUSIC FM component with the separate AY target to build an MSX sound configuration.

The OPL-family library preserves primary and additional profiles with different Stop/reset, CSM, source cancellation and preview-held semantics. OPL3 also retains separate authored/effective views for NEW mode and four-operator pairing. Y8950's ADPCM memory is borrowed writable RAM, up to 512 caller-owned 4 KiB pages plus a logical length. Page installation does not copy, allocate, free or synchronize storage; the host owns lifetime and retirement even across reset. CPU writes update memory revisions. State views avoid consuming ADPCM data or advancing audio, but Y8950 status inspection can propagate ADPCM flags into IRQ. The SDK does not include the reference host's copy-on-write page manager, scheduling queue or budgets.

Sega PSG uses the independent Game Gear wrapper and the existing Tetorica SegaPSG core. Its `native_game_gear_*` ABI is preserved rather than renamed; the target owns no FM or OPLL core. Stereo `0xff` retains Genesis/Master System PSG output on both channels, while Game Gear hosts can select per-channel stereo.

The AY-3-8910 target preserves the existing `native_ay8910_*` ABI and independent three-channel adapter, including shared noise/envelope, retained levels, Stop, audition and observation. It fixes the core configuration to AY type 0 / flags 1, averages three channel outputs and retains outer clock averaging/hold. Unlike raw WASM, this Native ABI does not select YM2149 or other type/flag combinations. Its mono signal is copied to both channels; motherboard analog mixing remains a host concern.

OKIM6258 preserves the `native_extra_okim6258_*` adapter and its fixed 4-bit/12-bit decoder configuration. Unlike the owned OPNA buffers, its convenience feeder borrows up to 16 MiB of immutable encoded bytes, including across Stop/reset. The host owns buffer lifetime, replacement, synchronization and retirement. The feeder schedules bytes into the same bounded FIFO used by raw-register hosts; it supplies no asynchronous streaming transport. See the Native guide for clock/divider guards and lifetime requirements.

RF5C164 exposes two profiles from one library/header, each owning 64 KiB of copied PCM RAM and eight voices. Primary `native_rf5c164_*` wraps the canonical vendor core plus outer clock resampling; `native_extra_rf5c164_*` keeps an independent implementation with per-voice held contributions for immediate source cancellation without advancing foreign voices. Ordinary bus writes retain reference held-output timing in both paths. Their legacy validation differs: primary accepts any nonzero rate and has a void unbounded clock setter; extra enforces the documented rate/clock ranges and null-upload checks. Reset retains RAM; clearing RAM is a separate operation. CPU bank-window writes and absolute bulk uploads are distinct APIs.

Game Boy links the unchanged Native adapter with the shared MAME-derived DMG
core. The sole vendor amendment adds `friend struct NativeGameboyAccess` for
state observation and gate-only Stop; original/amended hashes are retained,
and the synthesis implementation and WASM bridge are unchanged. Each handle
owns two pulses, wave/noise and 16 wave-RAM bytes, with the Native 4,194,304 Hz
reference and outer clock conversion. Register offsets, NR50's retained
left/right convention, wave-write restrictions and held output are documented
in the Native guide. Per-channel Stop clears the gate/core contribution while
a sub-base-clock outer frame may remain until the next source frame; global
Stop also clears the outer frame immediately. Reset restores the DMG wave
startup pattern and powers off, retaining edited clock and mute. The host
serializes events/rendering and supplies output; no machine/device runtime is
imported.

HuC6280 links the unchanged Native wrapper with the shared MAME-derived core.
The wrapper includes `huc6280.cpp` directly, so CMake compiles only the wrapper
translation unit. Each handle owns six audible sources and their 32-sample
unsigned 5-bit waves, DDA latches, channel-4/5 noise and LFO; no sample bytes
are borrowed. Explicit channel writes and the copying waveform helper restore
selection, but the helper resets the wave index and can retrigger its phase
while restoring control/DDA. Source mute preserves synthesis progression.
Key-off/Stop clear enable bits while retaining DDA mode/latches and outer held
PCM; sub-reference clocks can retain that mixed frame until the next core
frame. Reset clears waves/registers and core/outer phase, retaining clock and
mute. The Native guide records the 8–384 kHz / 100 kHz–100 MHz guards and
3,579,545 Hz reference. State observation does not advance audio.

NES links only the self-contained `native_genesis_nes.cpp` renderer: the vendor/WASM implementation exports the same ABI and must not be linked beside it. `tetorica::nes` retains both pulse channels, triangle/noise/DMC and constructor-selected FDS, with owned 64 KiB DMC RAM and wave/modulation tables. Loads copy synchronously. The immutable base clock chooses NTSC/PAL tables; clock edits change outer averaging/hold. Source mute keeps synthesis progression, and mono output retains nonlinear APU mixing, the FDS low-pass/DC filters and the outer DC remover. Stop preserves memory and filter/held history; global Stop obeys the FDS I/O gate, while per-source FDS Stop can halt with I/O disabled. Reset clears DMC RAM, wave/modulation tables and phase while retaining clock, mute and the FDS flag. This explicitly licensed renderer remains Apache-2.0 AND MIT; the public forwarder and integration retain their default BSD terms.

32X PWM links the unchanged Native wrapper and shared header-only FIFO/timer
core through `tetorica::pwm`. Each handle owns its two three-entry FIFOs and
output latches, plus 64-bit owner tags for additional-instance cancellation.
Tagged writes do not change synthesis; cancellation compacts matching entries
and invalidates matching latches without advancing foreign state. No host
scheduler or ownership queue is imported. Native retains its 23,011,361 Hz,
duty/gain-1 defaults, unlike the standalone reference JavaScript's DAC/gain-0.4
defaults. Stop clears queued/latched output and ownership while retaining
routing, cycle, clock and timer history; reset clears chip/timer state and tags
while retaining the edited clock. Snapshots omit tags and are observational.
Hosts feed raw counts at `clock/(cycle-1)`, center duty around `cycle/2` and
serialize access. The Native guide gives the rate/clock guards and exact
control/FIFO behavior; no sample buffer is borrowed.

DX7 links the unchanged `native_genesis_dx7.cpp` wrapper with a generated Native MSFA tree under the CMake binary directory. Explicit copy-only assembly selects the same six Native override files and the other 24 shared files, so quoted local includes resolve against matching Native headers. The SDK narrowly corrects `synth_unit.cc` panic to reset preallocated notes in place, clearing feedback history without allocation/free or slot-address changes; shared vendor files, the wrapper and WASM build remain unchanged. Each handle owns 16 preallocated six-operator notes, copied 155-byte voices, a shared LFO/filter and pending PCM; the core stays at 44.1 kHz while the wrapper accepts 8–384 kHz output. Caller-serialized voice/note/slot controls retain identity-scoped live edits, released tails, mask-protected allocation and kill buffering; panic clears all pending output immediately. No scheduler, ownership queue or portable snapshot is imported. The core, overrides and explicitly licensed wrapper retain Apache-2.0, while the public forwarder/integration use the BSD default. See the [Native guide](../native/README.md#embed-dx7) for voice validation and ownership contracts.

SNES S-DSP links the unchanged Native wrapper with only the accurate `SPC_DSP.cpp` in `tetorica::snes`; SPC700 execution, IPL and SPC-file loading stay outside this target. Each handle owns 64 KiB RAM and eight stereo BRR voices with ADSR/GAIN, noise, pitch modulation and echo. Bounded uploads copy synchronously; a read-only RAM view requires the caller to exclude mutation. Native synthesis stays at 32 kHz with integer-phase output interpolation. Stop restores instrument registers and clears gates/history while retaining RAM; echo contents can remain audible. Reset clears RAM and DSP state. The optional timeline borrows validated immutable initial RAM, 128 DSP bytes and four-word clocked events through pause/end until replacement/reset/global Stop/destruction. Hosts validate ordering/bounds, retain buffers and serialize access. The SDK supplies no player CPU, trace capture, scheduler or lifetime manager. The core, wrapper and included ABI header retain LGPL-2.1-or-later notices in this separate library; the new public forwarder/integration use the SDK BSD default.

SPC700 playback is a separate `tetorica::spc` target using the unchanged Native wrapper, accurate DSP and CPU/load/state translation units. It covers the remaining `spc` ID without changing the instrument-only `snes` target. Loading copies input state; the host retains original file bytes for rewinding/reconstruction. A control thread prepares a fresh paused handle and seeks in at most 16,000 native frames per call before callback installation; there is no internal lifetime/handoff queue. Callback pause freezes cached state without rewinding; output mute applies to future 128-frame source blocks and may leave cached PCM/echo. Latched errors require a successful reload. Fixed 32 kHz synthesis is interpolated to 8–384 kHz output. Snapshots are analysis workspaces, not transferable saves; bounded DSP-write events are borrowed handle storage, drained with mutation excluded. No full IPL ROM or metadata-controlled end/fade is supplied. The independent CPU-program/BRR WAV host requires no external data. Core/wrapper/included-header LGPL notices remain distinct from the public forwarder's BSD default.

The small `tetorica_genesis_wav`, `tetorica_master_system_wav` and `tetorica_msx_wav` hosts mix YM2612+Sega PSG, YM2413+Sega PSG and AY-3-8910+YM2413, respectively, into synthetic WAVs. `tetorica_pc98_ym2203_wav` uses a single YM2203's FM and SSG voices. `tetorica_pc98_ym2608_wav` adds synthetic rhythm-ROM percussion and ADPCM-B RAM playback to one OPNA's FM/SSG mix. `tetorica_neogeo_wav` uses one four-FM YM2610 with SSG and programmable ADPCM-A/B ROM samples. `tetorica_x68000_wav` combines YM2151 and OKIM6258, keeping its borrowed ADPCM sample alive until the decoder is destroyed. `tetorica_megacd_wav` combines YM2612, Sega PSG and the primary RF5C164 with a looping sign-magnitude waveform. `tetorica_dos_opl_wav` selects three DOS OPL-family cores in turn; `tetorica_msx_audio_wav` mixes Y8950 FM/ADPCM-B with AY and OPLL, retaining writable sample RAM beyond the decoder's lifetime. `tetorica_gameboy_wav` uses both pulses, an original wave-RAM triangle and noise, first separating them left/right and then combining all four. `tetorica_pcengine_wav` uses triangle/sine/pulse waves, host-fed DDA and both noise channels, first splitting voices left/right and finally mixing all six at 3,579,545 Hz. `tetorica_nes_fds_wav` uses all five APU sources, an original FDS wave and a final six-source phrase at the NTSC base clock, with copied original DMC bytes and mono duplicated to stereo. `tetorica_32x_wav` first auditions original PWM PCM/percussion left and right, then adds YM2612/PSG; its cycle-960 feeder follows 959-clock ticks at the exact Native default clock with neutral count 480. `tetorica_dx7_wav` builds three original unpacked voices to demonstrate six operators, algorithms 1/5/32, matching-identity live timbre edits, a chord and released tails; its interpolated mono output is duplicated to stereo. `tetorica_snes_wav` copies original sine/triangle/pulse BRR loops into owned RAM, auditions left/right voices, then plays an eight-voice stereo chord with ADSR/direct GAIN and KOFF releases. Its pitch conversion uses the fixed 32 kHz native rate, echo writes stay disabled and host output is 48 kHz. `tetorica_spc_wav` creates a complete SPC with an original timer-driven CPU program that configures the DSP and schedules stereo melody/chord notes using original BRR loops, verified with bounded DSP-write observation. The sample examples generate their own data rather than distributing hardware/game ROM contents. Their fixed example gains do not define SDK-wide mixing defaults or emulate complete machines.

`reference/javascript/` preserves the Analyzer's MSM5205 and OKIM6295 engines as synchronous JavaScript references, with their own provenance, component notices and offline example. SDK Native/WASM integrations are not provided for these engines. Separately pinned, explicitly BSD-licensed upstream C/C++ references live in their vendor directories and are cataloged as `upstreamReferences`. Their manifests document omitted framework dependencies; they are not part of the existing build targets.

Synchronous WASM primitives used to implement `read()` and `generateStereo()` remain part of the low-level interface. The asynchronous Native IPC path does not replace the synchronous calls needed by AudioWorklet consumers. JavaScript APIs and host transport selection remain responsibilities of the consuming projects.

The alternative Nuked library compiles the unchanged C provider separately from
its C++ wrapper, with only the eight provider symbols prefixed. The wrapper
selects its process-global YM2612 type once. It exposes raw source-rate and
Native output-rate ABIs without the application's Genesis mix, filters or rack.
Each handle remains serially owned by its host; distinct handles are independent.
The audit-only wrapper object is test code and is not part of the product library.
