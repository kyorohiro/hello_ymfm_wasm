# SSF slot activity and configured routes - 2026-11-18

Base `e585c87940abc257842f3e0faa37c24902fda9eb`; initially clean worktree.
The existing physical CH selector now doubles as the SSF 32-slot overview.

## Behavior

With **Live from SSF** On, Play follows audible-position observations. CH1–32
show observed activity and ENV strips; amber means an active slot in the
observed Release phase, separately from the requested Gate bit. Inactive does
not mean unassigned/free and these indicators are not measured audio output.
The same buttons retain channel selection, editable parameters and keyboard
audition behavior. Pause freezes one snapshot across channel choices.

**Selected SSF route**, below the selector, shows two raw Sound Stack X/Y
offsets, the receiving physical CH/source and MDL/STWINH, plus independent
Direct level/pan and MIXS/IMXL send branches. Equal X/Y references remain two
fields. This does not infer immediate producer CHs, A/B pairs, template-source
reservations or an arbitrary DSP program's return path. The pinned Mednafen
SSF renderer's MDL > 4 threshold is labelled separately from its raw code.
Longer timing and interpretation details stay behind `?`.

The passive view uses existing same-frame observations and detached pending
parameter edits; it adds no reads to the sound engine, clocks, owner, register
writes, PCM transfers or observer ABI. Native `details` and existing CH DOM
nodes survive polling. Live Off / Stop returns to the authored view.

## Verification

- **454 unit/package tests** pass, including nine new route-model/DOM tests
  and one new overview phase test. Valid zeros, missing/invalid fields,
  separate Gate/activity/phase, repeated X/Y, raw pan and source modes,
  immutable input/model, stable DOM/disclosure and disposal are covered.
- **16 source-browser cases** pass in Chromium/WebKit at 48 kHz. An original
  authored 68000 fixture verifies actual Play/Pause/Resume, real active Release,
  ordered raw route fields, read-only selection, physical CH32, paused audition,
  Capture and authored-draft restoration. All 108 served assets stay unchanged.
  Page, processor and missing-asset errors are zero. Physical output is muted
  before initialization. Desktop and 390 px screenshots were inspected.
- **16 existing channel-browser cases** pass in both engines, covering Code,
  cold startup, physical edits, Auto reuse, stale key release, unapplied drafts
  and the existing SSF audition/Capture workflow.
- The actual packaging CLI and deterministic ZIP/source-copy checks pass.
  The readable route module is included through the existing dependency copier.
  The extracted verification archive passes the same **16 browser cases**
  through its root `index.html` in both engines. Its fixture and all 107 shared
  served assets match source bytes; only the entry HTML path differs. Packaged
  desktop/mobile screenshots were inspected, all 108 served assets remain
  stable and page/processor/missing/external errors are zero.
- Exact predecessor receipts preserve historical native/source evidence. The
  new source receipt pin is
  `25144c7b141e9983a750c3c7a0349c20167ce368734d4f3145377a4d42802571`.
  Thirteen new/prior source-proof tests and all three source-recorder checks
  pass. Both soundchip and Playground Mixer generators pass their existing
  freshness checks; no gain policy or calibration result is changed.

Evidence: `build/scsp-ssf-slot-map-20261118/` and
`build/scsp-ssf-slot-map-browser-20261118/`. The local verification archive is
`release/tetorica_scsp_synth_ssf-slot-map-check-e585c879_itch.zip`.
The [machine record](verification_scsp_ssf_slot_map_20261118.json) binds final
source, receipts, browser reports, test logs and archive identity.

No core/WASM/observer/audio/gain/preset changes, exact causal signal tracing,
npm/version/publication/commit/push/tag or Tauri work. Human listening and
physical Saturn fidelity remain separate from muted current-core checks.
