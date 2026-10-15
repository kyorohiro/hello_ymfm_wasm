# Progress

2026-10-16: inspected local Apache MSFA and adopted the contract in README.
Native DSP, JS/Worklet routing, public types, examples and docs are complete.
Two live-EG regressions found by native/real-browser tests were fixed; the final
75 standalone / 49 parent tests, six zero-difference cross-build PCM cases,
browser engines and isolated package checks passed. Performance was measured
with 16 voices at 0/60/240 updates per second. Details and deferred work are in
`result.md`. Prepared for standalone 0.3.0 / bundled FM 0.2.16 publication.

2026-10-16 policy clarification: abrupt frequency/feedback clicks are accepted;
no automatic smoothing/interpolation is to be added. The existing runtime
already complies. README/specs were clarified and two 16-voice abrupt-change
regressions added; **77/77 tests pass**, skipped 0. DSP/runtime/WASM unchanged.

The policy documentation/test update is prepared for standalone 0.3.1 /
bundled FM 0.2.17. Runtime/declaration/WASM payloads match the preceding release.
