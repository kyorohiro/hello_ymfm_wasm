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

## Follow-up after push 8e5adcb0

- [x] DMG Node tests now pass in run `43575632560`.
- [x] Fix its subsequent WebKit cancellation-check race. The fake `slow.vgm`
      read finished after a fixed 500 ms before Playwright could click the real
      Cancel button. Hold that test read until cancellation is clicked, then
      release it and verify no source/preset files were committed.
- [x] Verify that actual-package song browser check in both browsers, muted.
- [x] HuC run `43575632499`: investigate the later WebKit MSM5205
      `held native RAM transfer` timeout; the previous shared-FX check now passes.
- [x] HuC local regression: compare a fixed complete PCM span across Seek,
      rather than assuming cooperative parser slices always return equal-sized
      first buffers. Force a budget yield and preserve exact sample equality.
- [x] itch run `43575632531`: coherent RF5C164 lookahead now passes, but the
      later WebKit initial/native RMS comparison fails. Inspect its actual
      output window and scheduled buffers before changing measurement or playback.
- [x] Verify the corresponding scheduled-PCM/output window comparison in both
      browsers, with independent native-copy/rate/clock/overlap checks and the
      original RMS/peak/Master bounds. Keep failed diagnostic receipts.

This is a checker synchronization fix; keep real user input and all original
cancellation/PCM assertions. HuC6280 UI/import work is tracked separately in
[the current TODO](todo_huc6280_synth_import_presets_tabs_01.md).

DMG's actual-package check now passes 14 Chromium/WebKit groups. The read remains
held past the previous 500 ms deadline until the real Cancel click, then settles
without late source or preset files.

The MSM artifact confirms that Stop safely retired an endpoint with a pending
state read: the subsequent file load correctly updated host RAM with no native
upload. The checker now awaits real Play and asserts one connected MSM endpoint
before holding its next transfer. All 14 groups pass in both browsers; the
20-second RPC timeout, strict held-count and PCM bounds remain unchanged.

The Seek test now compares every sample in the same 1024-frame stereo interval.
A forced budget yield gives prime buffers of 108 and 256 frames; their differently
partitioned continuations still match exactly. The former whole-buffer assertion
fails on that same forced split. The final HuC Node suite passes 558 tests.

The new RF artifact has output/native RMS ratio 0.653566 and peak ratio 1.0,
with no past starts or overlapping buffers. Its 8192-frame device window
contains a real refill gap, while the old native reference is a contiguous
future window. Capture exact output frames with a passive AudioWorklet and
reconstruct that same scheduled window, including gaps, with OfflineAudioContext.
Verify the original native PCM independently against every scheduled sample,
and reject incorrect rates, missing/duplicate frames and discontinuous capture
clocks. This changes measurement only; real main-thread starvation can still
leave silent gaps, as recorded separately from calibration gain.

Working evidence: `build/huc6280-import-tabs-20261114/pcm-ci-window-analysis.json`
and `pcm-window-diagnostic.json`. The controlled diagnostic contains about 78 ms
of gap; unity gain compares near 1.0 and doubled gain is rejected near 2.0.
The initial full-app capture attempt stopped before recording because the app
has separate authored/reference output branches. The final audit must follow
the verified reference BufferSource's actual graph to its unique live output,
rather than assuming the whole app has one meter or selecting by amplitude.

Final RF verification passes 18 groups across Chromium/WebKit, with 7 helper
Node tests. The initial RMS transfer is approximately 0.999559 / 1.000000;
the half-Master transfer ratio is approximately 0.500126 / 0.500000. Original
RMS ±15%, peak 1.15 plus 0.0001, Master ±0.07, and lookahead 0–0.11 s remain.

The strict raw-currentFrame attempt exposed Chromium repeating 25088 and then
jumping to 25344. The final capture therefore uses an independent PCM pilot on
input 1, never mixed into instrument input 0 or any audible output. Its known
sample-aligned future start plus all 8192 consecutive counter samples establishes
the absolute capture interval. Raw clock anomalies remain recorded separately.
Pilot repetition is rejected at the exact sample; doubled gain, modified native
copies, wrong rates, missing/duplicate source frames, overlaps and disconnected
output paths remain independent failures. Diagnostic and failed setup receipts
are retained; no window is reselected based on its measured gain.

All three subsequently reached CI failures are now locally corrected and
verified. See [the second follow-up record](verification_github_actions_20261114_second_followup.json).
Current changes still require commit/push and a new remote Actions confirmation.
