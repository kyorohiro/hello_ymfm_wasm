# Live DX7 parameters

Adopted scope, 2026-10-16: live operator output level and oscillator
mode/coarse/fine/detune; additive `setFeedback(0..7)`. General EG, algorithm,
keyboard/velocity scaling, and pitch-envelope editing remain future-note-only.
No external engine replacement, channel API, event scheduler or voice allocator.

## Contract

- `setOperator` / `setOperators` retain their validated partial-patch API.
  Changed live fields affect sounding notes originating from the edited patch,
  including release tails; other fields are stored for future notes.
- A bank slot has a private identity, retained across selection changes.
  `setPreset` replaces that identity and uses INIT defaults. `loadSysex` gives
  every new bank slot a new identity. Old notes retain their previous patch.
- `selectVoice`, `setPreset`, and `loadSysex` do not rewrite old operators/EGs.
  Their shared-LFO behavior remains documented separately.
- Live changes do not restart notes, phases, key state, or envelope stages.
  Captured velocity and keyboard scaling are retained. Ended notes stay ended.
- Same-value and empty edits preserve PCM; validation remains atomic.
- Abrupt frequency/feedback changes apply directly at the next ungenerated
  block. Waveform discontinuities and clicks are explicitly accepted. Add no
  automatic parameter smoothing, glide, feedback interpolation, crossfade or
  click suppression. Retain phase/EG state, upstream gain interpolation and
  output-rate resampling. NaN/Infinity reject; corrupted/unbounded output,
  divergence and crashes are unacceptable and require regression tests.
- Application is at the next ungenerated 64-frame internal block, after already
  rendered leftovers / resampling lookahead. Acknowledgement means applied
  state, not that buffered/device audio has already been heard.
- Core setters are synchronous; browser/Playground setters return Promises.
  `tween` callbacks should return/await those Promises. Numeric tween duration
  is seconds: `await tween(1, p => dx7.setOperator(2, {outputLevel: Math.round(99*p)}))`.

Intentional behavior change from npm 0.2.0: supported operator edits now affect
held notes of that patch. API signatures remain compatible. No-edit PCM must
match the previous engine. Release versions: standalone 0.3.0 / bundled FM 0.2.16.

Completion: native/WASM PCM regressions, 44.1/48 kHz, voice isolation,
attack/sustain/release, actual browser audio, Main/Worker, packaged types and
representative update load. See investigation, progress and result records.
