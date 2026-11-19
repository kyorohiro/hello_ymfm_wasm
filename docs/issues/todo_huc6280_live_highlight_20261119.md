# HuC6280 Live changed-value highlighting — 2026-11-19

Authorized next slice of the
[HuC6280 alignment](todo_huc6280_synth_fm2612_alignment_20261119.md).

- [x] Reuse FM2612's passive CSS-based highlighter for displayed HuC6280 channel
  values. Do not add native reads, polling, animation timers or chip writes.
- [x] Add a default-On Live highlight control beside Auto update; remember the
  display preference separately from instrument files and Cassette state.
- [x] Bind known scalar hardware fields, including level/balance, source, Noise
  and LFO controls/periods. Establish a baseline on first observation and reset
  on channel/source/run changes, Pause/Seek, Auto view or frozen Auto update.
  Unknown values must not flash as inferred/default settings.
- [x] Highlight only values actually displayed. Drawing/dragging must retain
  its existing ownership; no source/model edits or working/saved changes.
- [x] Bound rapid changes to one short pulse, clear on disable/dispose, honor
  reduced motion, and avoid PCM/wave-array serialization for highlighting.
- [x] Test Code/VGM changes, unchanged values, channel/context changes, Off/On,
  frozen Live, normal editing, focus and compact/expanded/mobile layouts using
  physically muted real source/ZIP browsers and existing unit tests.
- [x] Update README, alignment TODO and verification receipt.

No shared channel mixer, new PCM editing, media highlighting, recording,
timed-register API, npm publish, Tauri import or release is part of this slice.
The chip APIs, gain calibration and Code/VGM ownership remain unchanged.

## Implementation

- `live_highlight.js` composes unchanged FM2612 scalar highlighters for 15
  cached editor bindings. Per-control known/visible baselines allow a real Source
  change to pulse while a newly opened/known Noise field initializes quietly.
- Use existing `renderCodeLive()` snapshots only. The scope includes the owner,
  observation origin, selected channel and Code/session/manual epoch. Map
  `positionFrames` to the shared frame-zero guard; Code snapshots without a
  revision compare only the small scalar set.
- Auto update Off retains a frame barrier even across hidden/paused/dragging
  views. Re-enabling waits for a fresh frame before baselining, preventing a
  catch-up pulse from the retained old snapshot.
- Existing CH1/CH2 LFO period fields are included; no new selected-CH period
  output or register-write trace is added. LFO Off uses mode zero, so the UI's
  schema fallback depth 1–3 is excluded until depth becomes meaningful again.
- Closed-card, visibility and workspace transitions reconcile cached display
  state so cancelled CSS animations cannot leave stale pulses. No layout reads,
  native commands, polling, timers or wave/PCM serialization are added.
- UI preference key is `tetorica-huc6280-synth-live-highlight`; default On.
  Source files, saved/working versions and instrument/Cassette formats stay as
  before. The toggle returns focus for performance keys.
- CSS pulse is 420ms and rapid changes share one active pulse; reduced motion
  uses 1ms with the same animation-end cleanup. Scope exits/disable/disposal
  clear classes and listeners. The existing palette is retained.
- **746/746** source/shared tests pass with:
  `node --test --test-concurrency=4 docs/synth-huc6280/*.test.mjs docs/synth/synth_code_controls.test.mjs docs/synth/synth_expanded_tabs.test.mjs docs/synth/synth_live_highlight.test.mjs`.

## Final verification

[Verification receipt](verification_huc6280_live_highlight_20261119.json).
Source and the exact extracted readable ZIP pass Chromium/WebKit with fallback
and actual Monaco: **8 cases, 64 scenario groups, 40 settled layout screenshots**.
All receipts use one frozen checker hash and served-file hashes match the final
source / archive. Desktop and 390px normal/expanded views fit; the added checkbox
and existing help remain compact. Active-pulse screenshots were also visually
reviewed.

- First observations, unchanged values, rapid writes, animation-end cleanup,
  per-control known/visible transitions, LFO/Noise and disabled LFO depth are
  verified against actual Code observations and DOM events.
- Off/On and preference reload work without automatic playback. Auto update Off
  plus highlight toggles adds no native reads; reenabling starts at a fresh
  baseline. Code PCM, pitch, loop/context and graph stay stable across toggles.
- Hidden views, dragging, focus/performance keys and reduced-motion 1ms cleanup
  pass. Timed VGM changes follow the observed/heard position; Unknown/first-known,
  Pause, CH changes and a real range-key Seek preserve their quiet baselines.
- No page errors, rejected promises, missing assets, unexpected external
  requests or unexpected console errors. All raw console messages are retained;
  only the deliberately aborted pinned Monaco loader in fallback is permitted.
  Actual Monaco has no raw console errors or failed CDN requests.
- All physical output was muted before startup and all browsers closed afterward.
  Human listening, long-duration testing, Tauri import and publication were not
  performed.

Verification archive:
`release/tetorica_huc6280_synth_live_highlight_check_20261119_2_itch.zip`
(206 files, 2,180,459 bytes), SHA-256
`f2f57bb3c2b3f9c06f20bf27c09c4f76e6a7533a8f22daf7e738c65ca0d5eaec`.
Builder flags retain readable unminified/unbundled modules; changed UI/highlight
modules are byte-identical to source. Native code/WASM and gain calibration are
unchanged.
