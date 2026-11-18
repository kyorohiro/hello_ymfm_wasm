# Code / SSF parameter change highlighting - 2026-11-18

Base `8f25b37f`; initially clean worktree. Make changes to the already displayed
Frequency, modulation, Envelope, LFO and mix controls easier to follow.

- [x] Reuse FM2612's bounded scalar highlighter without modifying that helper
  or its callers. Cache SCSP control bindings once; no extra sound-engine reads,
  polling/frame loops, forced layout or animation restarts during a pulse.
- [x] Highlight changed displayed values during Code / live SSF playback.
  Establish a silent baseline on first display, source/CH/operator/session/
  engine/view changes, Pause/Resume/seek, Live Off and Stop. Do not highlight
  ENV meters, activity flags or a whole newly selected instrument as edits.
- [x] Add a compact On/Off control, default On, with a separate local preference.
  Off clears pulses and skips additional value reads/diff work; re-enable starts
  from a clean baseline. Keep explanations behind `?` and respect reduced motion.
- [x] Preserve focused/dragged controls, keyboard input, PCM drafts, allocation
  shortcuts, Code continuity, SSF editing/audition/Capture and narrow layouts.
- [x] Verify adapter/binding transitions, real muted Code/SSF updates and the
  extracted ZIP; refresh exact source proofs and record results.

Completed results and artifact hashes:
[verification](verification_scsp_live_parameter_highlight_20261118.md).

No runtime/public API/audio/core/WASM/observer/allocator/gain/preset changes,
new activity measurement, npm/release/version/commit/push/tag or Tauri work.
