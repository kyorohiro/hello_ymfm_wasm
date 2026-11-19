# HuC6280 shared channel output mixer — 2026-11-19

Authorized next slice of the
[HuC6280 alignment](todo_huc6280_synth_fm2612_alignment_20261119.md).

- [x] Make Mixer CH1–CH6 On/Off available without a VGM and use one session
  selection for Keyboard, Code and VGM output. Keep source-group volumes/mutes.
- [x] Reuse the native output-only channel mask. Do not emulate mute by
  changing registers, gate, volume/envelopes or keyboard allocation.
- [x] Keep Wave, Noise, software DDA feeding and CH2→CH1 LFO running internally;
  muted CH2 must continue modulating the audible CH1 carrier.
- [x] Apply the accepted mask to cold-start/recreated author engines and VGM
  playback/Seek candidates without starting audio or retiring Code. Preserve
  buffered VGM/Pause position and the existing Seek/cache rules.
- [x] Define paused-audition output behavior and retain clear UI/error ownership.
  Validate before changes; rejected/failed operations must not publish a false
  shared state or leave routes silently inconsistent.
- [x] Preserve session masks across transport, sound selection, Code sessions
  and project operations, independently of preset and Cassette formats.
- [x] Verify real muted source/ZIP browser audio, LFO/Noise/DDA state, Code
  context, VGM/Pause/Seek and layouts; update README/TODO/verification.

No per-channel volume automation, Solo, new native chip APIs, recording, PCM
editing, timed register API, npm publish, Tauri import or release is requested.

## Implementation boundaries

`channel_mix.js` owns the accepted session mask and six existing Mixer buttons.
No audio is acquired by a toggle. The author Worklet, existing private paused
audition and VGM preview receive the mask in order; a failure rolls attempted
routes back before publishing a changed selection. Failed native rollback marks
the mask unverified so even an unchanged-mask retry repairs all six flags.
An unrecoverable route is retired through the existing audio-error path.

Paused Wave/Noise trials follow their original logical song CH, although their
private instrument allocates another physical channel. Recorded LFO pairs keep
CH1/CH2 output flags distinct. No mute is written into a captured preset.
VGM changes affect the future render frontier after retained PCM; native masks
remain part of the existing Seek/checkpoint identity.

774 Node tests passed, including offline real-WASM phase/gate/register/DDA checks
at 44.1/48 kHz, packaging and native state tests. The two
legacy calibration-revision suites have four pre-existing failures: their SCSP
provenance chain expects an older `docs/synth/synth.js`. The same failure was
reproduced with all dependencies read from HEAD; no historical measurements or
unrelated FM2612 source were changed here.

The browser regression also exposed Capture invalidating its own selection
guard by selecting Auto before the author acknowledgement. Capture now keeps
the source CH view until the existing song controller commits and selects Auto;
normal sound loads retain their immediate Auto selection. A linked-guard
regression test covers the previously missed controller/app interaction.

## Completed verification

[Verification receipt](verification_huc6280_shared_channel_mixer_20261119.json):
774 Node tests; source/exact readable ZIP × Chromium/WebKit × real Monaco/fallback,
8 cases / 120 scenario groups / 40 settled layouts. The updated legacy Mixer
checker passed both browsers (16 groups). All output destinations were muted
before app boot; no human listening or long-duration test was performed.
No unexpected console errors, page errors or rejected promises remained, and
pagehide released contexts, Worklets and sources. The fallback cases retain the
explicitly intercepted Monaco-loader failure in their raw console records.

Final archive: `release/tetorica_huc6280_synth_shared_channel_mixer_check_20261119_3_itch.zip`.
The eight changed application modules match the editable source byte for byte.
This is a verification archive; commit/push/publication and Tauri import were
not performed.
