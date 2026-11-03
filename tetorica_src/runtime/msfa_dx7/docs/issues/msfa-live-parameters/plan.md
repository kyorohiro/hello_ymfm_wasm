# Plan

1. Record scope, patch identities and intended behavior change.
2. Add native select/edit paths and per-note state-preserving updates.
3. Route existing JS setters and add `setFeedback`, retaining validation/FIFO.
4. Rebuild WASM/native; test PCM, cohorts, silence, envelopes and load.
5. Sync browser/Playground runtime, types, hover, examples and documentation.
6. Verify real Worklet Main/Worker, isolated npm packages and static packaging.

Avoid changing the allocator, clock, mono signal path or output resampler.
Frequency/feedback discontinuities and clicks are accepted; add no automatic
parameter smoothing, interpolation, glide, crossfade or click suppression.
Verify direct application, retained phase/EG, rejection of non-finite input,
bounded valid output, recovery and normal release after abrupt repeated edits.
