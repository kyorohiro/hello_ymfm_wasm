# Investigation

The observations below describe the pre-extension implementation.

- Base: Google MSFA `f67d41d313b7dc85f6fb99e79e515cc9d208cfff`, retained
  Apache-2.0 headers; see `vendor/msfa/UPSTREAM.md`.
- `Dx7Note::init` captures each operator's derived level, pitch and EG plus
  algorithm/feedback. Reusing init would reset phases and envelopes.
- `Env::init` resets stage/key/level. `setparam` only changes saved rates/levels;
  it cannot provide sustained live level control by itself.
- Level conversion includes original note, keyboard scaling and velocity.
  Live edits must preserve those per-note factors rather than change final mix gain.
- `ActiveNote` lacks patch identity. Slots remain live after release, so live
  refresh must distinguish patch ownership and ended envelope behavior.
- `SetVoice` copies future-note parameters and reconfigures shared LFO. Live
  operator edits must not touch the LFO when its parameters have not changed.
- Scalar kernels already interpolate operator gain across 64 internal frames.
  This provides short gain smoothing; arbitrary FM routing changes can still
  introduce discontinuities and are outside this increment.
- Ratio/fixed/detune can update captured base pitch while retaining phase.
  Feedback can update its shift while retaining feedback history. Algorithm
  changes affect routing/history; general EG edits require a separate stage,
  target, rate and end-of-release contract. Both are deferred.

External references: Dexed README and its current `source/msfa/` location,
and MiniDexed issue 80 confirm the relevance of voice refresh. They are not
PCM or implementation oracles. No external engine code was imported.

Verification found two implementation hazards and fixed both: a muted release
must not finish its underlying EG early, and first adopting a full-level EG
during a slow attack must not cause a downward jump on a tiny upward edit.
The implemented reference model adopts the exact current ordinary trajectory;
the precomputed full-level trajectory is reserved for initially clamped notes.

Extreme legal MIDI/ratio/pitch-EG combinations also exceed the old frequency
lookup's shift range. Defined unsigned modular phase shifts replace that
undefined case, with native shift-sanitizer and native/WASM PCM comparisons.
