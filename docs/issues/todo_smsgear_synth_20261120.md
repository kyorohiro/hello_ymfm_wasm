# Tetorica SMSGEAR Synth

Authorized 2026-11-20. PSG is the primary instrument; YM2413 is optional FM.
Use the adopted black/blue/red handheld icon and FM2612 interaction patterns.

## Basic application

- [x] Adopt icon as `docs/tetorica_smsgear_synth.webp` (1254 × 1254).
- [x] PSG-first `PSG / YM2413 / Mixer` tabs, compact keyboard, two Pitch controls and draggable numeric controls.
- [x] PSG: three tone voices, Noise, attenuation, Game Gear stereo; Auto and physical CH selection.
- [x] YM2413: 15 built-in instruments, shared editable two-operator User patch, Rhythm and five drum keys; identify shared hardware state and software performance controls.
- [x] Files working/saved, Auto apply, Save/Discard, Cassette, seeded examples and shared Code editor/runtime with persistent expanded view.
- [x] Code and keyboard use the same PSG / OPLL instrument. Switching input views and selecting a sound do not stop Code.
- [x] VGM/VGZ import: PSG-only, YM2413-only or both; preserve original files and extract static JSON presets.
- [x] Reference Play/Pause/Resume/Stop, Live CH inspection, paused keyboard audition and static Capture to Synth while keeping reference transport.
- [x] Independent calibrated output gains/mutes, post-Master RMS / Waveform / Spectrum. Preserve shared mixer policy.
- [x] Readable standalone itch ZIP, source/license kits, batch packaging entry and English/Japanese catalog links.
- [x] Local unit/render checks, muted Chromium/WebKit checks and actual ZIP extraction/browser checks. See [verification](smsgear_synth_verification_20261120.md).

## Remaining / next steps

- [ ] User listening and interaction check with actual SMS / Game Gear VGMs, including optional FM and Noise/Tone-3 use. Synthetic tests are not a hardware accuracy claim.
- [ ] Reference seek/cache and per-channel output mute, following the FM2612 design.
- [ ] Direct selected-CH editing during reference playback; currently song view is read-only and Capture copies a static sound into the editable Synth route.
- [ ] Improve extraction of driver-dependent dynamic sounds and Rhythm scenes; current snapshots do not reconstruct software automation.
- [ ] Consider a clearly labeled software PSG Envelope after hardware/basic interactions are confirmed.
- [ ] Timed operation APIs: audit existing PSG / OPLL API and ownership first; no new scheduling implementation in this consumer.
- [ ] Looper / Event Rec and Tauri only when requested.

UI/reference base: FM2612 Synth. Reuse newer shared saving/editor adapters where
needed rather than carrying Genesis PCM/DAC/32X-specific code into this app.
Native cores and shared runtime APIs already exist and were not changed.
No commit/push, tag, npm publication, itch upload or Tauri release was performed.
