# PC Engine media live controls

This task follows the media keyboard / test-wave work and addresses quieter
media defaults, responsive test-wave parameters and keyboard release edges.
Historical verification records were not rewritten.

- This Synth starts MSM5205 and CD-DA at 30%. HuC6280 remains 44% with its
  existing software output factor of four. Explicit source settings and the
  shared Playground / library / native Mixer defaults remain unchanged.
- Auto load previews Frequency, PCM level, Length and drawing every 120 ms,
  coalescing events into one in-flight conversion and the latest queued draft.
  Transient previews do not write Files. Gesture end, shape selection and
  explicit Load save the generated WAV through the existing budget/ownership
  checks. Auto Off retains manual loading.
- Preview preparation keeps the old audio playing. An unchanged playing source
  uses 4 ms endpoint-local fade-out/in around sample replacement and starts the
  new data at zero. This is a software reload, not phase-continuous oscillator
  control. Successful previews preserve the keyboard's playback generation;
  paused/ended/idle sources do not start playing (a paused replacement becomes
  Ready). MSM preserves active Rate/Loop and encodes at that active Rate.
- Key-up uses an 8 ms endpoint-local AudioParam fade. Cleanup waits for the
  audio clock; suspended/interrupted output is silenced immediately. Raw UI /
  Code Stop and controller cancellation remain immediate. Newer key/UI/Code
  playback cannot receive an obsolete Stop, fade or queued waveform edit.
- Generation notifications also cancel widget work waiting before its first
  preview call or Files readiness. Native media renderers, shared worklets,
  public Code clients and their sample clocks are unchanged.

Unit validation passed **640/640 PCE tests**, including source/output races,
widget coalescing/cancellation, ownership, shared native player paths and the
existing Synth features. **2/2 readable deterministic package tests** passed.
The actual local ZIP is
`release/tetorica_huc6280_synth_media-live-20261118_itch.zip` (201 files,
six browser entry points; SHA-256
`401da0da68d0c68d32d3ae0186e6ec8079b8516462ba35b9ee874a29298542d2`).

The frozen browser checker is
`771c205cc4f368faeacfc1e8a8a36e89a88b2b661d17abe7120413b72bb38ea8`.
Source checks passed 10 groups per Chromium / WebKit, including actual
440 → 880 Hz / half-level PCM changes while a real key remains held, Length,
no Files writes during input, final WAV persistence, manual loading, key-up
silence, screen keys, UI/Code handoffs, cancelled older queued edits, Stop and
390px layout. Initial loads and idle previews stay silent.

The same frozen checker passed the same 20 groups on the independently
extracted ZIP: **40 groups / four browser runs** in total, with no page errors,
missing files or unexpected external requests. All **128 non-HTML served
assets** match source; the package's rewritten `/index.html` was exercised
directly. Both media editors fit at 390px without clipping or overflow.

Final browser evidence and source/archive bindings are recorded in the
[machine record](verification_pce_media_live_controls_20261118.json), under
`build/pce-media-live-20261118/`. Browser checks permanently mute the physical
output and measure actual rendered PCM; human listening was not performed.
No commit, staging, push, version/npm publication, release upload or Tauri work.
