# WonderSwan: Tauri Native Audio integration

Date: 2026-10-27. Implemented and locally verified on macOS ARM64.
This follows the fixed [SDK 0.1.4 adoption](sdk_014_adoption_01.md).
Hashes and machine-readable results: [native_wonderswan_01.json](native_wonderswan_01.json).

## Result

The selected `wonderswan` mode and independent `createSoundChip('wonderswan')`
instances now use Native Audio when that backend is selected. The existing
`ws`, `useSoundChip`, `WonderSwanSynth`, four-channel Keyboard and Inspector
APIs work through both Main and Worker execution. Web Audio remains the default.
Native mode filtering now includes WonderSwan; Atari ST remains Web Audio only.

The Inspector supports waveform/RAM editing, pitch, stereo volume, Noise,
Sweep and manual Keyboard audition. Additional instances get their own Mixer
strip, RAM, clock and lifecycle. Stop releases notes and pending commands while
retaining the primary patch, RAM and clock. Reset clears RAM. Additional
instances are retired through the existing rack lifecycle.

The SDK stays pinned at 0.1.4: the same 395 files, source commit
`6f8b872b6f35f5df619b2468d58da57037c96e07`, source ZIP SHA-256
`f173092241badd27c84d6846a69bd175375f080a57fdaf4983c56751c201f65e`.
Neither its sources, the 55 generated WASM outputs nor Mixer calibration values
were changed. WonderSwan's existing uncalibrated unity Mixer default remains.

## Audio and ownership contracts

The application adapter `src-tauri/src/native_genesis_wonderswan.{h,cpp}`
compiles once with the SDK raw core, shared by primary and additional instances.
The raw core remains unipolar with its original `/1024` gain. At the speaker
boundary the adapter matches the actual Browser Worklet's waveform midpoint
correction, Noise/Voice PCM handling, native-tick alignment and cold first-fetch
fence. Float32 rounding occurs before the outer double resampler accumulation.

The initial clock stays fixed inside the raw core. Later clock changes use
Browser-equivalent average/hold conversion without clearing registers, RAM,
phase, Noise or Sweep state. Creation accepts the raw minimum of 128 Hz;
the musical API retains its existing 100,000–100,000,000 Hz range. A queued
clock change prevents conflicting manual audition; a held manual voice rejects
a clock change recoverably. Cancelling a clock command releases its reservation.

Shared register `0x90` is merged using explicit masks when commands apply.
Individual gate and Voice/Sweep/Noise bits preserve siblings, other live loops
and manual leases. Wave RAM protection follows the actual physical bank/channel
addresses, including commands with misleading channel metadata. Stale `finally`
cleanup cannot reset another owner or release a newer manual voice.

Rust observes applied authored registers separately from hardware reads, which
may force bits or advance Sweep observations. JS preserves future authored
commands when applied readback arrives. Periodic publication copies 32 register
bytes and bounded metadata; RAM updates copy touched bytes, with a full 16 KiB
copy only on reset. No full RAM copy is added to each audio callback and no
portable DSP save/load state is introduced.

C++ rendering uses fixed storage. The measured adapter is 33,160 bytes and its
C ABI observation is 16,428 bytes. A Rust assertion keeps the actual instance,
shared state, renderer and C++ core within the existing 64 KiB instance allowance.
Queued payloads, manual leases, cancellation and retirement use the existing
Native reservations and 16-instance / 64 MiB admission rules.

## Integration map

In the Tauri repository:

- `src-tauri/build.rs`: application adapter plus one pinned SDK raw core.
- `src-tauri/src/native_genesis_wonderswan.rs` and
  `native_genesis_extra_wonderswan.rs`: primary and independent real-core state,
  scheduling, ownership, observations and lifecycle.
- `native_genesis.rs`, `native_genesis_extra_psg.rs`, `main.rs`: action dispatch,
  renderer mixing, status, creation, cancellation and command registration.
- `native_genesis_wonderswan_fixture.cpp` and
  `scripts/check_native_wonderswan.mjs`: ABI, real Worklet/raw WASM parity,
  allocation probe and sanitizer verification.

In the main repository:

- `web/native_genesis_wonderswan.js` and `native_genesis_extra_wonderswan.js`:
  Native primary/additional transports and authored observation.
- Native synth/worker/rack and Playground runtime/primary/logic-worker wiring:
  Main ownership guards, source selection and Inspector events.
- `web/wonderswansynth.js` and `playground_wonderswan.js`: partial author edits,
  manual guards and state handoff without erasing future commands.
- Generated `docs/js` mirrors, package requirements and cache version
  `wonderswan-native-1`.

The SDK's BSD-3-Clause license, original source and provenance remain under
`vendor/mame-wonderswan/`. The application adapter and full SDK are included in
the regenerated matching Native source ZIP. No submodule or build-time source
fetch is needed.

## Validation

- Actual Browser Worklet source/scheduler/Inspector/clock resampler with real
  WASM against Native: **204 cases, 995,328 stereo frames, exact PCM match**.
  Covers 44.1/48/96 kHz, two initial clocks, regular/irregular partitions,
  RAM/pan/banks/output, masked controls, all eight Noise settings, signed Sweep,
  Voice PCM, cold output, Stop/reset, clock bounds/fractional conversion and fuzz.
- Raw WASM against Native: **9 cases, 73,728 frames, exact match**.
  C++ self-test: **377,424 checks**. ASan + UBSan passed.
  C++ `new`/`delete` probe: zero calls across 2,048 hot 128-frame blocks.
- New Rust real-core tests: **15 passed**. Complete Cargo suite:
  **741 passed, 0 failed, 4 explicitly ignored**.
- Native stability: **23 modes, 631,488 frames, 92 Run/Stop transitions**;
  fixed/variable block output matches, pending commands and retained test guards
  return to zero. Additional rack: **4 mixed scenes, 8 solo sources**, 16-slot
  rotation, 17th-instance rejection, reservation rollback and Stop budget zero.
- Web focused Native WonderSwan tests: 10 passed; creation lifecycle: 12 passed.
  Related Native/runtime unit run: 1,276 passed. Playground page plus focused
  tests: 1,106 passed. These runs overlap and must not be added together.
- Final WASM regression: **28 artifacts, 55 outputs, 40,360 comparisons, zero
  difference**, unchanged repository input snapshot. Reused the previously
  actually rebuilt SDK 0.1.4 artifacts; no new WASM build was needed.
- npm package install/runtime/assets/declarations and mode type checks passed.
- Final flat ZIP: Chromium and WebKit Native UI checks passed for primary and
  additional Main/Worker playback commands, wave editing, Keyboard, Stop and
  mode filtering. Native RPC was mocked; neither AudioContext nor Worklet was
  created on that path. Separate real Web Audio checks passed in both browsers.
- Tauri frontend import: **920 files** verified; Python **22** / Node **31**
  tests passed. Fixed SDK and matching Native source bundle checks passed.

The first all-WASM comparison reached all 28 artifacts but its final immutable
input check detected a concurrently updated package checker. A fresh run after
all source edits stopped passed completely; no verification guard was relaxed.

## Limits and next step

These are local offline PCM/lifecycle tests and automated browser checks.
They do not verify physical output, perceived noise, real-time deadlines or
hardware accuracy. The Browser Worklet has no source-mute command; Native mute
was checked separately for silence, continued phase and register/raw parity.
The C++ allocation probe intercepts `new`/`delete`, not every allocator.

The new implementation is uncommitted and has not been exercised by the
five-platform CI. Previous SDK 0.1.4 CI results cover the earlier consumer code,
not this addition. Next: commit the main and Tauri changes together with the
imported frontend, run Tauri's five-platform CI, then audition WonderSwan in the
actual application. No npm/SDK publication, tag, commit or push was performed.
