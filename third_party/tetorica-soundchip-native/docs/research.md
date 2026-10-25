# MSFA / DX7 origins and Native–WASM differences

This document describes the source snapshot included on 2026-10-24. See also the [chip-by-chip comparison](chip-differences.md). This location preserves the `../../docs/research.md` reference in `vendor/msfa/UPSTREAM.md`.

## Included versions

| Layer | Version or location | Relationship |
| --- | --- | --- |
| Upstream | Google music-synthesizer-for-android, `f67d41d313b7dc85f6fb99e79e515cc9d208cfff` | Original MSFA source; its Apache-2.0 text and copyright notices are retained |
| Shared Tetorica core | [vendor/msfa/](../vendor/msfa/) | Standalone adaptation with live controls; imported from `w/tetorica-msfa-dx7-wasm/vendor/msfa/` in the reference workspace |
| Native overrides | [native/reference/overrides/msfa/](../native/reference/overrides/msfa/) | The six files in Tauri's `src-tauri/native-dx7/` that differ from the shared core |
| WASM wrapper | [wasm/dx7/dx7.cc](../wasm/dx7/dx7.cc), [dx7.h](../wasm/dx7/dx7.h) | Existing standalone WASM interface using the shared core |
| Native wrapper | [native_genesis_dx7.cpp](../native/reference/tauri/native_genesis_dx7.cpp), [.h](../native/reference/tauri/native_genesis_dx7.h) | Slot control, output-rate conversion and panic; note-state observation belongs to the Tauri Rust host |

All 30 C/C++ files in the shared core match their import sources byte for byte. Five Native override files still match their Tauri originals; the SDK amendment to `synth_unit.cc` is described below and retains original/packaged hashes. The other 24 shared files match Tauri's copies. Individual origins and hashes are recorded in [source_inventory.json](../catalog/source_inventory.json) and [SOURCES.json](../native/reference/SOURCES.json).

In the reference Web repository, `web/msfa_dx7/vendor/msfa/` contains licensing and provenance documents. The C++ source comes from the standalone package checkout identified above. The reference Web implementation loads `web/msfa_dx7/wasm/msfa.wasm`.

## Changes from upstream to the shared core

The shared core includes existing Tetorica adaptations. This summary was checked against the import source's `docs/research.md`, `vendor/msfa/UPSTREAM.md` and current source files. A complete file-by-file comparison against Google's pinned commit was not repeated for this SDK snapshot.

- [synth.h](../vendor/msfa/synth.h): `MSFA_FORCE_SCALAR` selects the existing scalar path. This avoids comparing a Native ARM NEON approximation with a different WASM calculation.
- [synth_unit.h](../vendor/msfa/synth_unit.h) / [.cc](../vendor/msfa/synth_unit.cc): standalone includes, initialized state, ownership and destruction of 16 note objects, direct 155-byte voice loading, a null MIDI ring buffer and release-all support. The shared version already preallocates its 16 notes.
- `SynthUnit` also adds patch identities through `SelectVoice` / `EditVoice`. Live edits reach sounding notes and release tails belonging to the edited patch, while notes from a previously selected patch remain distinguishable.
- [dx7note.h](../vendor/msfa/dx7note.h) / [.cc](../vendor/msfa/dx7note.cc): operator output level, mode / coarse / fine / detune and feedback can change without reinitializing phase, envelopes or feedback history.
- [env.h](../vendor/msfa/env.h) / [.cc](../vendor/msfa/env.cc): a reference trajectory supports live level edits. Unedited notes keep the original envelope path; muting does not halt release progression or revive a completed release. General live editing of all envelope parameters is outside this implementation.
- [freqlut.cc](../vendor/msfa/freqlut.cc), [fm_core.cc](../vendor/msfa/fm_core.cc): shifts and phase wrap at extreme frequencies use defined arithmetic. Normal-range calculations are retained; ultrasonic frequencies are not clamped to an audible pitch.
- [aligned_buf.h](../vendor/msfa/aligned_buf.h): standard type includes support independent compilation with modern C++ toolchains.

The internal rate is 44,100 Hz and the DSP block contains 64 frames. The original operator kernels, output filter and Int16 clipping remain in use. Output-rate conversion belongs to the wrapper. General envelope and algorithm edits affect subsequent notes; live frequency and feedback edits add no smoothing or crossfade.

Frequency lookup tables and the LFO / pitch-envelope rate constants are shared within a process. Native initializes them once at the fixed 44,100 Hz rate; applications must not overwrite active shared state by calling `SynthUnit::Init` at another rate. Each WASM memory has its own shared state.

Known MSFA limitations remain: operator amplitude-modulation sensitivity / LFO amplitude depth, voice transpose and oscillator-key-sync are not applied to note synthesis. The LFO is shared by the synth, and output-rate conversion uses stateful linear interpolation. This implementation does not reproduce DX7 firmware, its analog output stage or every hardware behavior.

## The six Native overrides

The six-file override set comes from the reference Tauri implementation. The SDK retains that selection and adds one narrow correction in Native `synth_unit.cc`: panic resets the 16 preallocated note objects in place to clear feedback history. Ordinary Note On, release and kill behavior is unchanged; no shared vendor or wrapper bytes change.

| File | Native change and reason | Audio or API effect |
| --- | --- | --- |
| [dx7note.cc](../native/reference/overrides/msfa/dx7note.cc) | Qualifies `min` / `max` as `::min` / `::max` to avoid GCC / libstdc++ name-resolution conflicts | Velocity, rate and level-scaling formulas remain the same |
| [env.cc](../native/reference/overrides/msfa/env.cc) | Qualifies `::min` / `::max` in the same way | The envelope model is unchanged |
| [ringbuffer.cc](../native/reference/overrides/msfa/ringbuffer.cc) | Replaces POSIX `nanosleep` with standard C++ `sleep_for(1ms)` | Supports Windows; ordinary Native DX7 uses a null ring buffer and does not normally enter this wait path |
| [synth.h](../native/reference/overrides/msfa/synth.h) | Replaces the undefined-platform `#warning` and empty barrier macro with `atomic_thread_fence(seq_cst)` | Provides a barrier and supports MSVC C++17; existing Apple / GNU branches remain |
| [synth_unit.cc](../native/reference/overrides/msfa/synth_unit.cc) | Adds partial-construction cleanup, `NativeNoteOn[Mask]`, slot release / kill and `NativePanic` without reallocation; the SDK also resets preallocated notes in place during panic | Supports separate performance owners / Keyboard leases and immediate silence with a clean feedback-state restart, without heap allocation/free or changed note addresses |
| [synth_unit.h](../native/reference/overrides/msfa/synth_unit.h) | Declares these Native APIs | Must replace the corresponding shared header when building the Native variant |

All six files retain Google's copyright notices and explicit Apache-2.0 headers. Their existing license remains in effect. Tetorica-authored SDK wrappers and headers without a separate explicit license use the SDK's [BSD-3-Clause default](../LICENSE); a missing per-file declaration is covered by that default. See [LICENSES.md](../LICENSES.md) and [native_inventory.json](../catalog/native_inventory.json) for the component records.

## Panic and note release

Native `NativePanic` ends all 16 note slots and clears pending PCM, controllers, filter and LFO within the existing storage while preserving the selected voice. The Native wrapper also discards its prefetched PCM, so subsequent samples are immediately silent until a new note. The original Native override retained per-note feedback caches across panic, unlike the WASM wrapper's fresh notes; a feedback-heavy restart could therefore differ. The SDK corrects this by value-initializing and assigning each `Dx7Note` within its existing allocation during panic, preserving all 16 addresses and avoiding heap allocation/free. This correction applies only to panic; ordinary note reuse, release and kill retain their original behavior. Original and amended hashes are recorded in the inventories.

The WASM wrapper implements panic by deleting and recreating `SynthUnit`, then restoring the selected voice. Ordinary Note On uses the 16 preallocated note objects in both versions.

Native slot release keeps its envelope tail; kill stops future computation for that slot. Both can leave samples in an already generated 64-frame block, wrapper interpolation prefetch or the shared filter. These APIs support host ownership control; they have different semantics from a full panic that clears the instance's pending output.

## Build combinations

[build_dx7_wasm.sh](../scripts/build_dx7_wasm.sh) compiles the shared `vendor/msfa/` core with `wasm/dx7/`. It uses `MSFA_FORCE_SCALAR`, `-fwrapv`, `-fno-strict-aliasing` and `-ffp-contract=off`.

The standalone SDK Native target is **`tetorica::dx7`**, backed by `tetorica_native_dx7`; `<tetorica/dx7.hpp>` forwards the existing `native_dx7_*` declarations. CMake 3.20+ and C++17 suffice. The target uses `MSFA_FORCE_SCALAR` and supported target-private `-fwrapv`, `-fno-strict-aliasing` and `-ffp-contract=off` flags, preserving the existing Native integer/aliasing/floating-point behavior.

The reference Tauri build uses its Native `native-dx7/` tree from `src-tauri/build.rs`. The SDK assembles the equivalent complete tree using explicit `configure_file(COPYONLY)` calls under `${CMAKE_CURRENT_BINARY_DIR}/msfa`: `build/native/native/msfa/` for `cmake -S . -B build/native`, or `build/native/msfa/` for `cmake -S native -B build/native`. Of the 13 `.cc` and 17 `.h` files, 24 come from the shared tree and the same six come from the Native overrides above, including the recorded panic correction. Quoted local includes must resolve within this Native tree: an include-directory preference alone cannot replace a header beside a shared `.cc` file. Only selected Native translation units compile; do not link both versions of a same-name `.cc` file. Shared vendor bytes, the Native wrapper and the WASM recipe remain unchanged; the one Native panic amendment is recorded separately.

The public ABI accepts an already validated, unpacked **155-byte single voice** and copies it synchronously; it does not parse SysEx or packed bank voices. The six 21-byte blocks are stored OP6 through OP1. Selection affects subsequent notes and the shared LFO; matching-identity live edits update the documented operator-level/frequency/feedback fields of that identity's sounding notes and release tails. Note On returns one of 16 preallocated slots, or `-1` if none is eligible. A preserve mask can protect released tails from reuse. The caller serializes control/render access and manages identities and slot ownership. There is no host scheduler or portable snapshot. See the [Native API guide](../native/README.md#embed-dx7) and original-voice [`tetorica_dx7_wav`](../native/examples/dx7_wav.cpp) host.

## Verification scope

- The SDK now builds DX7 as its own Native library and runs `tetorica.dx7.self_test`; the complete Native suite contains 22 CTest tests from 21 fixture executables across 18 static libraries covering all 22 chip IDs (23 aliases/headers). The DX7 fixture covers raw voice loading, identities/live edits, 16-slot allocation and preserve masks, released tails, invalid controls, output rates, independent instances, allocation-free controls/rendering and immediate panic silence. Its 96 feedback restart cases span all 32 algorithms at 44.1/48/96 kHz and compare exactly with fresh instances after the SDK panic correction.
- `tetorica_dx7_wav` is one of 17 offline WAV examples. It creates three original unpacked six-operator voices, algorithms 1/5/32, a live timbre edit, a chord and explicit releases, producing 144,000 frames of 48 kHz stereo PCM16 with duplicated mono, fixed gain and fades. Completed SDK build/platform evidence is recorded in [verification.md](verification.md).
- The SDK's standalone DX7 WASM build succeeded and matched the reference Web `msfa.wasm` SHA-256: `f5de761e82ea303420fb3aac79a0a59dd053773b81453b955254dd13aac77d6f`.
- A fresh comparison of the actual Tauri sources with the reference Web WASM passed 114 cases and 792,576 stereo frames at 44.1 / 48 / 96 kHz, with maximum difference 0.
- That comparison used `node scripts/check_native_dx7.mjs --out <report.json>` in the reference repository. It did not build a Native SDK DX7 target. The 96 kHz result applies output-rate conversion over the same WASM exports; it does not establish public JavaScript API support for 96 kHz.

These checks did not exercise physical audio output, compilers on other operating systems or real DX7 hardware.
