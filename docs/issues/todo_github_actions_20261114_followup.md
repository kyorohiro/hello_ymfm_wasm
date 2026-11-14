# GitHub Actions follow-up: scheduling and measurement failures

Started: 2026-11-14. Base HEAD: `a39b8a74dc1ded45fd316f4cbc43facc9c327c7a`.
The user authorized the remaining CI fixes before the HuC6280 Tauri update.

- [x] Inspect the latest runs and collect the three concrete failure logs.
- [x] DMG: wait for the first real scheduled BufferSource after a cooperative parser yield.
- [x] HuC6280: measure shared liveFx input/output during the same render quantum.
- [x] RF5C164: observe rendered/heard frame counters in one browser task.
- [x] FM2612 reference playback: fix reproduced late-buffer overlap without skipping PCM.
- [x] Run targeted regressions and actual-package Chromium/WebKit checks, with physical output muted.
- [x] Recheck the latest pre-fix Actions outcomes and record the continuation below.
- [ ] Commit/push these local fixes and confirm the resulting Actions runs.
- [ ] After that CI gate, import the fixed readable ZIP into HuC6280 Tauri and verify its desktop integration.

No commit, push, tag or publication was performed. Tauri import has not started.
Do not loosen timing/PCM bounds or add blind retries to conceal defects.
[Verification record](verification_github_actions_20261114_followup.json).

## Findings

- **DMG**: `play()` can finish before its first cooperative parser slice produces PCM.
  The test now drives the actual scheduled refill before checking the first buffer.
  A forced parser-budget yield checks the same engine, frame 0, offset 0 and every PCM sample.
- **HuC6280**: looped ADPCM retains decoder predictor/step state. Actual WASM
  first/later-loop fundamentals are 0.248497 and 1.066361. Comparing half gain
  in the later loop with full gain in the first falsely yields 2.145618.
  A passive paired capture now measures the real pre-FX and post-FX/Master paths
  for identical frames. All three sources retain transfer ratios near 1.0 and 0.5.
  The original half-gain bounds, 0.35–0.65, remain unchanged.
- **RF5C164 timing**: separate browser RPCs observed different playback moments,
  producing a false negative lookahead. A single synchronous observation retains
  the existing 0–0.11-second bound. No clock is frozen to make the test pass.
- **Actual playback defect**: a refill arriving 5 ms late scheduled a whole buffer
  in the past while its successor retained the old timeline. Their 5 ms overlap
  doubled constant 0.1 PCM to 0.2. Scheduling now rebases the first unreserved
  sample when its start is already past, including clock progress during rendering
  or Resume setup. Every source sample and exact partial-buffer offset are retained.
  A scheduling gap can still be audible when the main thread misses its deadline;
  the recovery prevents duplicated audio rather than promising uninterrupted playback.
  The old CI capture also contains a brief peak about 1.91 times its native peak;
  it has no scheduling trace, so direct attribution of that historical spike is unproven.

## Validation

- DMG: 265 Node tests pass, including the forced first-parser-slice yield.
- HuC6280: `npm run test:huc6280-synth` passes 543 tests. Actual standalone ZIP:
  Chromium/WebKit pass 14 shared-FX checks. Product/native/API/volume are unchanged.
- FM2612: 690 Node tests pass. The new regression fails against the previous
  product implementation and passes after the scheduling fix. It checks 5/50 ms
  gaps, rendering-time clock progress, PCM continuity, cursor monotonicity,
  exact Pause/Resume offsets, delayed Resume setup, and Seek/cache consistency.
- The rebuilt FM2612 ZIP passes PCM 18, FM 14 and PSG 18 browser checks across
  Chromium/WebKit. Original peak/RMS/lookahead assertions remain. PCM peak/native
  ratio is 1.0 in both browsers; measured lookahead is 0.049280 s and 0.080106 s.
- Total: 1,498 passing Node tests and 64 passing browser check groups.
  Physical output remained muted; no listening or long-duration test was performed.

Logs and package receipts are under `build/ci-followup-20261114/`.
The committed verification record includes their hashes and key measurements.
No native core, public API, calibration gain or calibration provenance was changed.

## Actions and continuation

At the base HEAD, the latest HuC6280 run `43573364799` and itch ZIP run
`43573364764` failed at the known measurements corrected here. DMG's earlier
failure was run `43570789090`. Latest SDK, npm, VGM, SBI and Pages runs succeeded.
These outcomes predate the local fixes; remote success is still pending a new push.
After the new CI runs pass, continue the remaining Tauri item in
[HuC6280 completion TODO](todo_huc6280_synth_finish_01.md).
