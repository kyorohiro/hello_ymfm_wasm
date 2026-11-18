# SCSP Code / SSF parameter change highlighting - 2026-11-18

Base `8f25b37f`; initially clean worktree. **Highlight changes** beside the
slot legend defaults On. Changes to displayed Frequency, Depth, Ratio,
Envelope, LFO and mix values briefly glow during Code or live SSF playback.
SSF's displayed raw modulation values participate; ENV/activity meters do not.

The adapter reuses FM2612's unchanged scalar highlighter. Bindings and their
ancestors are cached once after the existing controls are created. It compares
rendered values at the end of the existing render path, so focused/dragged
controls do not flash for values that have not appeared yet. There are no
additional engine reads, polling/frame loops, timers or layout measurements.
The pulse lasts 420 ms; rapid changes do not restart an active animation.
Reduced-motion mode uses a 1 ms animation and clears its class normally.

Initial display, source/CH/operator/engine/session changes, PCM source changes
and visible-panel changes establish a silent baseline. Pause, seek, Live Off,
Stop and hidden views clear pulses. Resume starts a fresh baseline. Off clears
pulses and skips comparison reads; On starts fresh. This local display
preference is stored separately from presets and Cassettes. Longer explanation
is behind `?`. This is a view of displayed parameter changes, not a register
write trace, audio measurement or attribution to a particular writer.

## Verification

- **477 SCSP unit tests and 2 deterministic package tests pass.** Ten adapter
  cases cover selection/session/source baselines, rendered-value deferral,
  existing SSF raw outputs, hidden controls, Off's no-read path, stable cached
  bindings and disposal. The unchanged FM2612 helper's seven cases also pass.
- **20 focused source-browser scenario groups pass** across Chromium and
  WebKit at 48 kHz. Actual Code and an original 68000 SSF fixture change
  Frequency, Envelope, LFO, mix and modulation values. Checks exercise native
  bounded/reduced-motion animation completion, focus/drag, CH/source switching,
  Off/On, preference reload and blocked storage, Pause/Resume/seek, Live Off/On,
  Stop and read-only selection. Existing observer intervals measured about
  100 ms. Desktop and 390 px screenshots were visually inspected.
- **28 existing physical-CH navigation browser checks pass** in both engines,
  preserving Code continuity, PCM drafts/Apply, SSF handoff, native keyboard
  focus, coarse-pointer targets and no horizontal page overflow.
- The actual CLI produces a readable-source ZIP with 388 files. Its fresh
  extraction passes the same **20 browser scenario groups** through the root
  `index.html`, using the same frozen checker as the source run. All 117 shared
  served assets are byte-identical; the entry differs only by the existing
  packaging URL/link rewrites. Packaged screenshots were visually inspected.
- The exact source revision retains 104 unchanged implementation inputs,
  109 related pins, all 20 predecessor contexts and all 916 previously tracked
  issue JSON files. Its six final receipt/context tests and 18 recorder outputs
  pass (14 direct CLIs and four existing contextual reproductions). Receipt pin:
  `9629697967a702965c15fe63264bdf3b1cf5b7f57222b51f4d798c4b5cb3d720`.
- Both actual Mixer freshness generators pass against the final receipt;
  measured gains and saved listening levels are unchanged.
- **191 unique source-proof/Mixer tests pass:** 190 unaffected passes from the
  initial suite plus the one affected case rerun after the browser checker was
  frozen. Six final-pin receipt checks repeat existing cases without double
  counting. The initial run correctly rejected a provisional checker edit;
  the superseded log and successful focused rerun are retained in the proof
  ledger. No production change was needed for that test synchronization fix.

Evidence directories: `build/scsp-live-parameter-highlight-20261118/` and
`build/scsp-live-parameter-highlight-browser-20261118/`. Verification archive:
`release/tetorica_scsp_synth_live-highlight-check-8f25b37f_itch.zip`.
The [machine record](verification_scsp_live_parameter_highlight_20261118.json)
binds final source, proof receipts, logs, browser results and archive bytes.

Browser checks permanently mute physical output before initialization. Human
listening and physical Saturn fidelity remain separate. No public API,
audio/core/WASM/observer/allocator/gain/preset behavior, npm/version/publication,
commit/push/tag or Tauri changes.
