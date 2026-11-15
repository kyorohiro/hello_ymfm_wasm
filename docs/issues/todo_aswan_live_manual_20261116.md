# ASWAN Synth: manual controls during VGM playback

- [x] Apply sparse Wave / stereo volume / Sweep / Noise edits to the playing
      reference chip, retaining already-rendered PCM and original VGM bytes.
- [x] Add selected physical-channel keyboard note/pitch/gate writes on that
      same reference chip. Later VGM writes take ownership of their fields;
      old key releases must not cut a newer game/manual note.
- [x] Keep Auto, the authored instrument and paused private audition intact.
      Code and VGM stay mutually exclusive. Keep software-only Envelope/PCM
      controls explicit and unavailable on the running reference hardware.
- [x] Fence queued edits and keys across CH / Reference / source / transport
      changes, Stop, seek, project replacement, failure and EOF.
- [x] Keep Live display and Copy/Save aligned with heard frames and committed
      manual changes, without forcing Auto update on or replacing the UI.
- [x] Verify real WASM, register ownership, sparse edits, queued PCM, independent
      output/mutes, rapid mode changes and muted source/ZIP browser checks.
- [x] Update help, guide, CI fixtures, verification and completion record.

First scope: Wave / CH3 Sweep / CH4 Noise. A transient CH2 Voice DAC byte is
not a recovered PCM sample. No global AudioContext reset, extra sound source,
native core change, Looper/Event Rec, Tauri, commit, push, tag or publication.

## Completed behavior and verification

- Playing VGM → select CH1–CH4 → use the existing hardware controls and
  keyboard on that reference CH. Wave drawing, stereo volume, CH3 Sweep and
  CH4 Noise preserve the transport, already-generated PCM and source bytes.
- Live keys use ordinary MIDI pitches and the song clock. Later frequency
  writes take pitch ownership; full control-register writes take gate ownership.
  Old KeyUps cannot cut a newer driver/manual note. Unavailable queued notes
  are cancelled and their key highlight clears before KeyUp.
- Auto remains authored and paused audition remains private. Software-only
  Envelope/name/PCM loading are disabled on the playing reference CH.
  Auto update Off freezes observation while explicitly changed fields update.
- Hardware changes, Copy and Save flush current queued edits. CH, source,
  transport and project changes fence stale work. Author and reference Pitch
  remain separate, including delayed cold-start audio acknowledgements.
- `npm run test:aswan-synth`: 153 passed. Source and freshly extracted final
  ZIP pass 11 browser groups each in Chromium and WebKit (44 groups total).
  All physical output stayed muted, with one AudioContext and one destination.
- The existing ASWAN workflow already includes the new WonderSwan fixture
  paths and runs the full Node/ZIP browser suite; no CI configuration change
  was needed. The dev ZIP was updated with readable modules and the existing
  authenticated source kit. Native core, calibration and public API unchanged.

Transient PCM and incomplete Wave/settings remain unavailable for live manual
input. Private paused audition still requires the normal clock. Later VGM
writes override manual fields; already-buffered audio adds a small delay.
Human listening and real-game checks remain useful. No publication performed.

See [verification](verification_aswan_live_manual_20261116.json).
