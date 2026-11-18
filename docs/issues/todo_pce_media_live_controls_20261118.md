# PC Engine media live controls — 2026-11-18

User requests quieter MSM5205 / CD-DA defaults, immediate test-wave parameter
updates and a short software release for keyboard-triggered media.

- [x] Set this Synth's MSM5205 / CD-DA default source faders to 30%, retaining
  explicit user values, HuC output correction and shared library calibration.
- [x] Apply Frequency / PCM level / Length while Auto load is enabled, including
  held keyboard playback, without requiring Reload. Coalesce gestures and keep
  Cassette writes out of the per-event preview path. Retain manual loading.
- [x] Add an app-owned short release on keyboard key-up; raw UI / Code transport
  remains immediate. Fence newer key, UI/Code takeover and pending readiness.
- [x] Verify actual media rendering, parameter changes, ownership/cancellation,
  persisted generated WAVs and browser UI in muted tests. Record limitations.

No common native/WASM change, publication, npm/version change, Tauri work,
staging or commit. Record implementation decisions here before continuing.

## Implementation decisions

The common Mixer defaults and native/WASM media implementations are unchanged.
Only this app's MSM5205 / CD-DA default faders become 0.30; HuC stays at 0.44
with the existing source-only output factor of four.

Auto load coalesces input into one in-flight conversion plus the latest pending
draft, with a 120 ms preview interval. Frequency, PCM level, Length and canvas
edits use the existing WAV / MSM encoder / native-player paths. Transient
previews do not write Files; gesture-end, shape selection and explicit Load
save the portable WAV. Auto Off retains explicit manual loading.

Preparing a replacement leaves the old sample playing. An app-only preview
commit uses a short endpoint-local fade, installs the prepared data and
restarts only an unchanged, still-playing source. A successful edit preserves
the accepted playback generation so the held keyboard key can still release
it. An idle/paused/ended source is never started by preview. This is bounded
software reload/retrigger, not phase-continuous hardware modulation.

Keyboard key-up requests an 8 ms software release on its source endpoint.
Cancellation, retrigger, UI/Code handoff and raw Stop retain immediate behavior.
Gain automation does not touch source Mixer values or another audio source.

The widget also observes accepted playback generations / ordinary source loads:
a queued 120 ms edit is cancelled when a newer keyboard, UI or Code intent
arrives. This covers work still waiting for its first preview call or Files
readiness, before the source-level snapshot can exist.

Unit validation: **640/640 PCE tests** (including 91 source/output and 11 widget
cases), plus **2/2 deterministic readable-package tests**, passed. Browser
source / extracted-archive verification passed **40 groups** across Chromium /
WebKit; 128 served non-HTML assets match between source and ZIP. See
[the verification record](verification_pce_media_live_controls_20261118.md).
The previous historical verification records remain unchanged.
