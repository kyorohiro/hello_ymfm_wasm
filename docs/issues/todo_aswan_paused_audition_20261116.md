# ASWAN Synth: paused-channel audition and editing

- [x] Prepare complete Wave / Sweep / Noise voices from the paused audible
      snapshot, with explicit reasons for unknown Wave RAM and transient PCM.
- [x] Add a bounded audition lease on the existing Synth AudioContext/output.
      Keyboard notes use the selected physical CH and edited settings without
      replacing Auto or modifying original VGM bytes. Release old leases on
      channel/source changes, Resume, Stop, seek, workspace replacement and Code.
- [x] Allow paused edits in the normal editor; keep per-CH edits while switching
      channels. Apply sparse hardware changes to the reference engine, so Resume
      continues from the same position and later recorded writes can take over.
      Preserve already-rendered audio and mark authored Software Envelope as a
      preview tool, separate from recorded hardware automation.
- [x] Copy / Save the edited selected voice through existing preset routes.
- [x] Verify actual WASM, stale async loads/key releases, cancellation, exact
      transport continuity, authored preset isolation and muted Chromium/WebKit
      checks of both source and standalone ZIP.
- [x] Update the guide, help, verification and completion record.

First scope: Wave / Sweep / Noise; no invented PCM sample from a DAC byte.
No new AudioContext, native core rewrite, Looper/Event Rec, Tauri, commit,
push, tag or publication. Use self-authored VGM fixtures and mute speakers.

## Completed behavior and verification

- Pause → select a complete CH → audition/edit using the existing controls.
  Wave, CH3 Sweep and CH4 Noise use the recorded base frequency at Reference
  key C4; its key can be moved to C2–C6. Hardware pitch bounds still apply.
- The private preview uses a second native handle in the same compiled WASM
  module, Worklet, AudioContext, calibrated path and Master. Auto is unchanged.
- Per-CH hardware edits are sparse and retained; Software Envelope/name remain
  host preview fields. The default short keyboard release is software.
- Resume keeps queued PCM and the original song position. Later VGM writes
  take over. Failed Seek keeps committed edits; successful Seek uses source VGM.
- Context/CH/Reference/source changes fence old loads, KeyUps, queued edits and
  Copy/Save. Selection generations also fence failed-seek A→B→A transitions.
- The full ASWAN Node suite passes 135 tests. Source and the actual standalone
  ZIP pass eight browser groups each in Chromium and WebKit (32 groups total).
  All physical output stayed muted, with one AudioContext and one destination.
- Actual WASM tests prove frame-partition invariance, native phase/Auto
  isolation, unchanged queued PCM, right-channel preservation during a left-only
  edit, and recorded-driver ownership after Resume.

Transient PCM, incomplete required settings/Wave RAM and nonstandard source
clocks show an unavailable reason. The first paused preview supports the normal
3,072,000 Hz clock; other-clock song playback is unchanged. Hardware oscillator,
Sweep and noise phase are not captured. Human listening and real-game VGM
checks remain useful. No publication was performed.

See [verification](verification_aswan_paused_audition_20261116.json).

The [live manual follow-up](todo_aswan_live_manual_20261116.md) adds direct
hardware edits and same-CH keyboard input while reference playback continues.
The normal-clock restriction above applies only to the private paused preview.
