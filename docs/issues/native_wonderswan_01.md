# WonderSwan: next Tauri Native Audio integration

Date: 2026-10-27. Read-only design review; the adapter is not implemented yet.
This follows the fixed [SDK 0.1.4 adoption](sdk_014_adoption_01.md).

## Scope and ownership

Enable both the selected `wonderswan` mode and independent
`createSoundChip('wonderswan')` instances through the Native backend. Reuse
the existing `WonderSwanSynth`, Keyboard and Inspector APIs. Browser playback
remains the reference for application output and scheduling behavior.

Keep the fixed SDK immutable. Its raw C++ core is already available at
`src-tauri/vendor/tetorica-soundchip-native/vendor/mame-wonderswan/`.
Place the application adapter in `src-tauri/src/native_genesis_wonderswan.{h,cpp}`
and compile that adapter and the pinned core once in `build.rs`, shared by
primary and additional instances. The existing source collector includes the
application adapter and SDK; regenerate and verify the matching source bundle.

## Audio contracts to preserve

- The raw core remains unipolar with its original `/1024` gain. Port the
  Browser speaker boundary's dynamic per-channel waveform midpoint correction,
  Noise/Voice PCM handling, native-tick alignment and first-fetch startup fence.
  A generic high-pass filter is not the same output policy.
- Keep the creation clock fixed inside the raw core. Subsequent application
  clock changes use the same outer average/hold resampler as
  `web/playground_chip_clock.js`, retaining core RAM, registers, phase and
  Noise/Sweep progress. Match the Browser's Float32 rounding before double
  resampler accumulation. Raw creation accepts clocks from 128 Hz; the
  Playground's existing musical/clock API accepts 100,000–100,000,000 Hz.
- Stop releases gates while retaining RAM, patch and clock. Reset follows the
  existing Browser cold-reset behavior. Source/channel mute must preserve the
  appropriate synthesis progression and speaker correction.
- Avoid heap allocation, large stack objects and payload destruction on the
  audio callback. Publish the 16 KiB RAM observation in bounded batches/dirty
  updates, rather than copying it after every register write.

## Commands, ownership and observations

Provide register writes (`0x80..0x9f`), RAM writes (`0..0x3fff`), channel
key-off, reset/stop, mute, clock, mixer and atomic manual-audition batches.
Primary and extra endpoints should use the existing Native scheduling,
session/generation, group cancellation, reservation and retirement policies.

The shared `0x90` control byte is critical: gate bits 0–3 belong to individual
voices; bit 5 is CH1 Voice PCM, bit 6 CH2 Sweep, and bit 7 CH3 Noise. Merge
explicit control masks when commands are applied. Releasing one channel must
preserve sibling gates and mode bits. Manual leases and other live loops must
not be overwritten by a full-byte shadow or a stale `finally` reset.

RAM ownership depends on the active bank at `0x8f`: the physical wave region
for channel `ch` begins at `((bank << 6) + ch * 16) & 0x3fff`. Protect held
voices' wave bytes and global controls according to the existing Browser
ownership rules. Reject manual-held clock changes recoverably.

Inspector snapshots need the applied authored registers/RAM, clock, held
channels, pending command IDs and frame/revision. Raw hardware reads can
advance Sweep/LFSR observations or force bits and are not interchangeable with
the authored projection. Applied readback must not erase future authored
commands on the JS side. No portable DSP save/load state is being added.

## Integration map

- Rust modules: primary `native_genesis_wonderswan.rs` and multi-instance
  `native_genesis_extra_wonderswan.rs`; use HuC6280's lifecycle/budget pattern.
- Central Rust: `native_genesis.rs` action/preparation/retention/status/render/
  owner dispatch; `native_genesis_extra_psg.rs` instance kind/core/payload,
  memory reservations, mixing and retirement; `main.rs` command registration.
- Web endpoints: separate Native WonderSwan primary/extra adapters, rather
  than adding WonderSwan to assumptions limited to Game Boy/HuC6280.
- Web integration: `native_genesis_synth.js`, `native_genesis_worker.js`,
  `native_genesis_extra_chip.js`, `playground_runtime.js` and
  `playground_native_primary.js`. Forward lifecycle guards and implement the
  existing Main owner-group hooks on extra instances.
- UI: enable mode/backend filtering in `playground_audio_engine.js` and
  additional-chip event routing in `playground.js`. Generate the `docs/js`
  mirrors through the established sync path. Existing public WonderSwan types
  already describe the musical functionality.

## Validation gates

1. C++ ABI/configuration/null/range tests; raw PCM against the pinned core;
   Browser speaker/resampler parity including cold start, Noise, Sweep, Voice
   PCM, mute, clock changes and irregular partitions. Allocation probe and
   ASan/UBSan for bounded rendering.
2. Rust primary/extra real-core tests: Stop versus reset/RAM, independent
   instances, shared control masks, groups/manual leases, stale cleanup,
   clock reservations, cancellation/retirement, sixteen-slot and byte budgets.
3. Main/Worker Native JS transport tests; Keyboard and Inspector manual play;
   mixed-source lifecycle, selected-mode filtering and source bundle checks.
4. Existing WASM/browser regressions and Tauri's five-platform CI after the
   final frontend and source bundle are imported.

Suggested split: one task owns C++ adapter/parity; another owns the Rust chip
modules and their tests; a third owns JS endpoints; the coordinating task owns
central Rust/JS wiring, final frontend packaging and validation. Confirm ABI
and snapshot layout before parallel implementation.
