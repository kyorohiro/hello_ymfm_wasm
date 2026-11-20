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
- [x] Two editable OP1/OP2 User Envelope diagrams, using actual YM2413 AR/DR/SL/RR/EGT ranges (schematic timing, no invented D2R). Preserve fixed-patch and reference-view read-only behavior.

- [ ] User listening and interaction check with actual SMS / Game Gear VGMs, including optional FM and Noise/Tone-3 use. Synthetic tests are not a hardware accuracy claim.
- [x] Reference seek: replay chip history in bounded silent Worklet slices, keep Play/Pause, update Live registers at target, allow Stop during preparation.
- [x] Mixer: reference-only PSG CH1–3 / Noise and YM2413 CH1–9 output mute, without changing registers. Preserve choices through seek and replacement.
- [ ] Reference seek cache (separate follow-up; first implement correct history reconstruction).
- [ ] Direct selected-CH editing during reference playback; currently song view is read-only and Capture copies a static sound into the editable Synth route.
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
