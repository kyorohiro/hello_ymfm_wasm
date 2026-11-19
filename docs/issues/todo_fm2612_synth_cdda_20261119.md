# FM2612 Synth: Mega CD CD-DA — 2026-11-19

Add Mega CD's CD-DA playback beside RF5C164, reusing the existing PC Engine
CD-DA transport and common audio implementation. Keep the current instrument,
running Code, expanded workspace and unrelated sources intact while switching
tabs. VGM playback does not supply CD audio tracks; audio is loaded separately.

- [x] Add CD-DA between RF5C164 and 32X PWM in normal/expanded navigation.
- [x] Reuse WAV/manifest loading, Play/Pause/Resume/Stop/Seek, session WAVs and
  original-rate keyboard triggering. Include a generated test wave at startup.
- [x] Mix CD-DA once through its own source volume/mute and common Master/FX.
  Use existing calibrated defaults; do not change unrelated source gains.
- [x] Support `await useSoundChip("cdda")` with the same UI-owned source and
  track cursor, typed completion and a self-contained Code example.
- [x] Integrate Stop, New/Import/Undo workspace replacement, reload and disposal;
  cancel pending work and prevent retired Code clients from restarting audio.
- [x] Include readable dependencies in the standalone itch package and document
  supported inputs, separate VGM/audio tracks and session storage behavior.
- [x] Verify source/ZIP in muted Chromium/WebKit, numeric audio and relevant
  unit regressions, including Master, Mixer, Code/keyboard ownership and fades.

No commit, push, npm publication or release is requested.

## Implementation notes

- `synth_cdda.js` adapts the existing eight PC Engine media modules to this
  Synth's Files, AudioContext and performance bus. No shared PCE implementation
  or native core was changed. Default Sine is passive in memory; edited WAVs
  are saved under `/samples/`. Portable imports use `/audio/`, validate the
  complete batch before writes, preserve existing names and support Files Undo.
- CD-DA is one stereo track transport, not a pitched note instrument. Keyboard
  release uses the shared software 8 ms fade; raw Code transport remains CD-DA.
- Source gain and mute live before the existing FX/Master/Stop route. The four
  chip gains retain their measured defaults; CD-DA has no factory calibration
  entry and uses the shared unity fallback, without new normalization.
- VGM output receives only its four supported chip groups. CD-DA volume/mute
  and CD-DA-only Reset changes neither its queued audio nor seek checkpoints.
- First cold keyboard playback keeps the pending CD-DA key across audio setup.
  The Code runtime explicitly admits `cdda`, using the existing trusted audio
  loader and independent session/track ownership.
- All 737 Synth unit tests and eight runtime-artifact profile tests passed.
  Packaging validated 504 local module/asset references and includes the
  original CD-DA core, WASM and rebuild sources in readable form.

## Browser and package verification

- Source and the exact extracted ZIP passed nine CD-DA scenario groups in both
  Chromium and WebKit: cold keyboard, original-rate PCM and 8 ms fade, transport,
  WAV/manifest/session storage, shared Code cursor, source/Master/mute, Code FX,
  coexistence with FM/PSG/PCM/VGM, workspace lifecycle and exact binary recovery.
- `liveFx` gain 0.5 measured 0.49986–0.50014 times dry PCM; removing it restored
  0.99966–1.00053. Client/source identity and revision stayed fixed while the
  cursor advanced. Mute and volume zero likewise kept playback advancing.
- Eight-tab layout with fallback and real Monaco, plus actual five-source
  completion/type checks, passed both browsers. Desktop/mobile CD-DA and Mixer
  screenshots were inspected. There were no page/console errors or missing
  assets; all physical speaker routes were muted, with no listening performed.
- Package: `release/hello_ymfm_wasm_megacd-cdda-20261119_itch_synth.zip`.
  Browser receipts: `/private/tmp/fm2612-cdda-source-final.json`,
  `/private/tmp/fm2612-cdda-zip-final.json`,
  `/private/tmp/fm2612-cdda-monaco-types-final.json`,
  `/private/tmp/fm2612-cdda-expanded-source-fallback.json`, and
  `/private/tmp/fm2612-cdda-expanded-source-monaco.json`.
