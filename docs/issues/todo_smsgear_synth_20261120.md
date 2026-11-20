# Tetorica SMSGEAR Synth

Authorized 2026-11-20. PSG is the primary instrument; YM2413 is optional FM.
Use the adopted black/blue/red handheld icon and FM2612 interaction patterns.

## Basic application

- [x] Adopt icon as `docs/tetorica_smsgear_synth.webp` (1254 × 1254).
- [x] PSG-first `PSG / YM2413 / Mixer` tabs, compact keyboard, two Pitch controls and draggable numeric controls.
- [x] Fractional keyboard Pitch uses frequency writes for held and newly started PSG/OPLL notes (including Tone-3 Noise), without passing fractional MIDI to chip APIs. Keyboard Pitch stays on the left.
- [x] PSG: three tone voices, Noise, attenuation, Game Gear stereo; Auto and physical CH selection.
- [x] Keep physical CH button nodes stable during Live refresh so mouse/touch release and keyboard focus survive Play/Pause/Stop.
- [x] YM2413: 15 built-in instruments, shared editable two-operator User patch, Rhythm and five drum keys; identify shared hardware state and software performance controls.
- [x] Files working/saved, Auto apply, Save/Discard, Cassette, seeded examples and shared Code editor/runtime with persistent expanded view.
- [x] Fix expanded Code hiding its entire input section; show the real Monaco editor beside Files, retain Master and restore Code after selecting chip tabs. Verify both Monaco and the offline textarea fallback.
- [x] Code and keyboard use the same PSG / OPLL instrument. Switching input views and selecting a sound do not stop Code.
- [x] VGM/VGZ import: PSG-only, YM2413-only or both; preserve original files and extract static JSON presets.
- [x] Reference Play/Pause/Resume/Stop, Live CH inspection, paused keyboard audition and static Capture to Synth while keeping reference transport.
- [x] Independent calibrated output gains/mutes, post-Master RMS / Waveform / Spectrum. Preserve shared mixer policy.
- [x] Readable standalone itch ZIP, source/license kits, batch packaging entry and English/Japanese catalog links.
- [x] Local unit/render checks, muted Chromium/WebKit checks and actual ZIP extraction/browser checks. See [verification](smsgear_synth_verification_20261120.md).

## Remaining / next steps

- [x] Replace the two large OP parameter cards with compact horizontal parameter strips stacked as OP1/OP2 rows, matching FM2612; align shared headings and keep mobile overflow local.

- [x] Align Envelope handles to the rendered curve for zero-rate/EGT/Sustain states and resize; remove marker CSS offsets and shrink selector/handle buttons.

- [x] Start new FM sounds on User, clearly explain fixed-ROM editing limits and provide an explicit User switch; verify numeric +/- writes.
- [x] Merge OP1/OP2 Envelope into one colored canvas with OP selection and independent A/DR/SL/RR handles; test all controls in both browser engines.

- [x] Show CH7 Bass drum / CH8 Snare + Hi-hat / CH9 Tom + Cymbal and allow selecting those physical CHs in Rhythm mode; identify the shared mode switch.
- [x] Match FM2612's compact four-row computer keyboard. Auto Rhythm uses keys 1–5; reserved CHs expose only their assigned percussion. New Cassette defaults Rhythm On; retain saved choices.
- [x] Two editable OP1/OP2 User Envelope diagrams, using actual YM2413 AR/DR/SL/RR/EGT ranges (schematic timing, no invented D2R). Preserve fixed-ROM patch restrictions; reference controls now edit their physical song channel.

- [ ] User listening and interaction check with actual SMS / Game Gear VGMs, including optional FM and Noise/Tone-3 use. Synthetic tests are not a hardware accuracy claim.
- [x] Reference seek: replay chip history in bounded silent Worklet slices, keep Play/Pause, update Live registers at target, allow Stop during preparation.
- [x] Mixer: reference-only PSG CH1–3 / Noise and YM2413 CH1–9 output mute, without changing registers. Preserve choices through seek and replacement.
- [x] PSG-only reference seek cache, with bounded native checkpoints and an optional toggle.
- [x] YM2413-only and combined reference seek cache using native FM state and resampler checkpoints.
- [x] Direct selected-CH editing during reference playback / Pause; touched controls update the renderer without stopping the song. Capture keeps a separate static Synth copy.
- [ ] Improve extraction of driver-dependent dynamic sounds and Rhythm scenes; current snapshots do not reconstruct software automation.
- [ ] Consider a clearly labeled software PSG Envelope after hardware/basic interactions are confirmed.
- [ ] Timed operation APIs: audit existing PSG / OPLL API and ownership first; no new scheduling implementation in this consumer.
- [ ] Looper / Event Rec and Tauri only when requested.

UI/reference base: FM2612 Synth. Reuse newer shared saving/editor adapters where
needed rather than carrying Genesis PCM/DAC/32X-specific code into this app.
Native cores and shared runtime APIs already exist and were not changed.
No commit/push, tag, npm publication, itch upload or Tauri release was performed.

- [x] Combine Envelope handles as AT (AR/level) and DS (DR/SL), and compact the upper OPLL controls.

- [x] Keep keyboard performance active while changing sound-source / Noise / instrument selections; test focus and held-key release.

- [x] Match FM2612 monitor Pitch position and direction: vertical wheel to the right of the display.

## Current follow-up: reference music and direct editing

- [x] Audit local SMS PSG / SMS FM / Game Gear VGMs at 44.1/48 kHz: finite output, Noise/Tone-3/Rhythm/stereo coverage, and exact post-seek PCM against linear playback. Keep game assets outside distribution.
- [x] Route selected physical CH control edits to the reference Worklet while Playing/Paused, without restarting transport or writing Synth/Files presets.
- [x] Send only changed parameters and resolve partial register edits against current renderer state; retain melody key/pitch, adjacent OPLL bits and original PSG stream latch semantics. Later VGM writes win normally.
- [x] Identify chip-wide User patch / Rhythm / Noise / stereo controls; preserve ROM instrument limitations and reject edits during seek.
- [x] Muted browser and native-render tests for direct edits, paused audition, untouched-state preservation and later original writes; keep human listening pending.

## Current follow-up: seek checkpoints

- [x] PSG-only songs: bounded in-memory checkpoints using the existing native PSG state API; retain decoder/latch/stereo/resampler timing and exact seek boundaries.
- [x] Keep only original-history checkpoints. Manual edits stop checkpoint creation until a seek/reset reconstructs clean history. Preserve current output mix/mutes on restore.
- [x] Optional Cache toggle, bounded memory, graceful fallback when native state is unavailable; clear per-song state on disposal.
- [x] Verify cached/uncached PCM at 44.1/48 kHz (white/periodic/Tone-3 Noise, stereo), backward/forward seeks, cancellation, edits, output controls and bounded eviction; audit local PSG game VGMs.
- [x] FM-inclusive cache prerequisite: add YM2413 native save/restore (including phase/Envelope/LFO/Noise, interface timers and mute mask), adopt a pinned SDK source candidate and build receipt, then expose opaque same-instance JS state and resampler state. Verify exact PCM before enabling FM checkpoints; do not synthesize checkpoints from registers alone.

## Current follow-up: YM2413-inclusive checkpoints

- [x] Isolated native YM2413 state ABI using ymfm field serialization plus interface timers/IRQ and mute mask; no raw heap/pointer snapshots. Verify normal PCM against previous WASM.
- [x] Opaque same-instance JS chip and resampler snapshots; foreign/malformed state rejection and exact restore of melody, User patch, Rhythm, Envelope/LFO/Noise at 44.1/48 kHz.
- [x] Adopt only the changed YM2413 recipe/source as an explicitly pinned unpublished SDK candidate; rebuild receipts/mirrors, preserve unrelated sibling SDK work, and validate source distributions.
- [x] Extend existing bounded clean-history seek cache to FM/combined plans; retain current output mutes/mix and original PSG latch semantics. Keep fallback for older runtimes.
- [x] Verify native/uncached/cached PCM, real game corpus and muted browsers; refresh any required calibration provenance before distribution.

## Separate existing test maintenance

- [ ] Repair archived historical calibration proof fixtures for the existing performance-queue / SPU CSS dependency changes without loosening production freshness guards. The broad suite has the same 157 failing test names before/after this feature (297 tests: 140 pass, 157 fail), confirmed using an isolated exact Git archive of the baseline commit. See `ym2413_state_baseline_test_comparison_01.json`. This is separate from the passing current-policy checks and the new native-state/cache tests.

## Pause audition / Stop follow-up

- [x] Apply paused selected-channel edits to the keyboard audition instrument as well as the frozen reference; keep reference time frozen.
- [x] Display configured PSG attenuation separately from hardware release mute (15); Stop returns to the editing Synth instead of displaying the idle audition registers.
- [x] Verify held-key edits, release/retrigger and Stop in muted Chromium / WebKit.
