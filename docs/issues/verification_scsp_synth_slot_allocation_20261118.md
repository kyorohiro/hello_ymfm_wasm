# Synth / Code physical slot allocation view - 2026-11-18

Base `e74d3a23435a6505fb9907c8211ddbd222754d7e`; initially clean worktree.
The existing Auto / CH1–32 overview now describes authored voice ownership as
well as the separate SSF machine's native observations.

## Using the view

In **Auto**, play a keyboard note or run Code. **Synth slot allocation**, below
the existing selector, follows the most recently allocated group. Its physical
CH members are highlighted together; cards identify A–F and their actual CH
numbers. The owner is Keyboard or a logical Code CH, with the note and requested
Held / Released state. Auto keeps following the newest allocation after its
release instead of jumping back to an older held group.

Choose a physical CH to follow that CH's current group. The editor and keyboard
continue targeting that same physical CH; this observation does not select an
operator, allocate a voice or stop Code. Custom's dependency-driven A–F placement
comes from the existing authoritative mapping, rather than reversed slot guesses.
Without an allocated group, Auto shows its selected editor source. Physical keys
in CH1–CH6 retain their secondary role as source templates.

Cards show receiving modulation Depth and inputs, physical Direct level/pan and
requested MIXS sends with output/ownership/effect policy. Recipe-derived arrows
appear only while every group member's requested modulation settings match the
allocation recipe. Self retains two distinct history references; Cycle labels
current A into B and the B-history average into A. Depth zero is explicitly Off.
An override, including producer write inhibition, falls back to ordered X/Y
settings without inferring an arbitrary producer. Mapping/ownership stays visible.

Released means an allocator-retained request, not a native release phase,
measured output or free slot. Stolen groups, manual replacements, Code Stop and
topology retirement update from current owner records; stale Code lanes grant
no ownership. Conflicting ownership is unavailable. Direct / MIXS are requested
settings, and a custom DSP return path is not inferred. Longer caveats stay in
the stable `?` disclosure. SSF Live swaps to its existing separate route view;
Live Off / Stop restores authored allocation without changing that machine.

## Verification

- **462 unit tests + 2 deterministic package tests pass.** Eight new real-WASM /
  model / DOM tests and two channel-selector tests cover current ownership,
  exact Custom4/6 mappings, old grouped settings under a changed preset,
  Self/Cycle/depth zero, physical overrides, stale lanes, stealing, manual
  replacements, conflicting/missing data, requested sends, immutable models and
  stable disclosure/focus/disposal. Existing instrument, Code, DSP, PCM and SSF
  tests remain passing.
- **14 source-browser scenarios pass** across Chromium and WebKit at 48 kHz.
  Actual keyboard and Code exercise Auto/polyphony, physical targets, retained
  release, nontrivial 4/6OP mappings, source edits, Self, raw requested fallback,
  stealing/stale lanes, retirement, Stop, SSF handoff and narrow layout.
  All 116 served assets remain unchanged during the run. Physical output is
  permanently muted before initialization; page and missing-asset errors are
  zero. Desktop and 390 px Cycle/6OP screenshots were inspected.
- **16 prior SSF browser scenarios pass** in both engines, including native
  Play/Pause/Resume/Release, selected raw routes, audition, Capture, frozen CH
  selection and restoration of authored drafts.
- The actual packaging CLI passes and preserves the new readable module
  through the existing source-copy dependency collector. The extracted ZIP
  passes the same **14 browser scenarios** through its root `index.html`.
  All 115 shared served assets and the original SSF fixture match source bytes;
  only the entry HTML path differs. Packaged desktop/mobile screenshots were
  visually reviewed, with zero page/missing errors and mobile overflow.
- **26 source-proof tests**, six source-recorder checks and both actual Mixer
  generator freshness checks pass. New receipt pin:
  `8cd2319158007783eb21c4588f92604c80a56ce7ebe13aec9da3c55a7a7ce083`.
  Nine historical receipts and 87 unchanged implementation inputs remain
  byte-identical to Git. No historical calibration result is rewritten.

Evidence: `build/scsp-synth-slot-allocation-20261118/` and
`build/scsp-synth-slot-allocation-browser-20261118/`. Local verification archive:
`release/tetorica_scsp_synth_slot-allocation-check-e74d3a23_itch.zip`.
The [machine record](verification_scsp_synth_slot_allocation_20261118.json)
binds final source, proof receipts, test logs, browser reports and the archive.

No audio owner/allocation/core/WASM/observer/gain/preset/public API behavior,
npm/version/publication/commit/push/tag or Tauri changes. Human listening and
physical Saturn fidelity remain separate from these permanently muted checks.
