# DMG Live changed-value highlighting — 2026-11-21

Recorded as a follow-up to [SID Live highlights](todo_sid_live_highlight_20261121.md).
**Deferred:** on 2026-11-21 the user clarified that incomplete timed operation
APIs and Code / Synth workspace rollouts take priority over highlighting.
See the [current priority](todo_synth_fm2612_alignment_20261119.md#current-priority--user-correction-2026-11-21).
Implementation has not started; this is not the next scheduled task.

- [ ] Reuse the shared bounded scalar highlighter and CSS pulse on the
      existing selected-CH VGM / Code controls, without creating another view.
- [ ] Highlight Pulse Duty and Envelope volume/direction/period, plus CH1-only
      hardware Sweep settings where displayed.
- [ ] Highlight CH3 Wave output level. Keep 32-nibble Wave RAM drawing and
      hardware upload/trigger behavior unchanged; do not compare waveform arrays.
- [ ] Highlight Noise clock parameters, sequence width and Envelope settings.
      Keep Noise distinct from a normally pitched PCM instrument.
- [ ] Add independent Highlight changes On/Off, default On, with a separate
      persistent DMG preference. Off clears pulses while Live and playback
      continue, and skips highlight value/availability comparisons.
- [ ] Establish fresh baselines on first display, source/session/CH changes,
      Pause/Seek/frame rollback, Live Off, waiting/error, hidden/folded controls
      and focused fields. Reopening or re-enabling must not flash every value.
- [ ] Use existing observation updates only. Retain bounded pulses and reduced
      motion support; add no polling, forced reflows, audio/register commands,
      waveform copying, mixer/gain changes or file/document mutations.
- [ ] Verify actual scalar bindings and reset/Off/disposal behavior, then real
      VGM/Code updates in source and readable ZIP with Chromium/WebKit. Mute
      physical destinations before startup and check normal/expanded/narrow
      layouts, keyboard focus and uninterrupted playback.
- [ ] Record verification and update the DMG alignment TODO and README.

This is a display aid over existing observations, not a complete register-write
history. Fast intermediate writes may be missed. Output-only channel switches,
Looper/Event Rec, timed/native API additions, npm/Tauri updates and publication
remain separate work.
