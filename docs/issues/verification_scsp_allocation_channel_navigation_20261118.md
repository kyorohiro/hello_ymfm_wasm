# Allocation diagram physical-CH navigation - 2026-11-18

Base `18a9bc47`; initially clean worktree. The displayed CH numbers in Synth
slot-allocation cards are now native buttons into the existing physical editor.

## Behavior

Press **CH8** in **B -> CH8** to select physical CH8 in the permanent selector,
show its existing SCSP editing controls and bring those controls into view.
The same action works from the DSP tab, including when CH8 was already selected.
It does not change the Keyboard / Code mode, source operator, sound registers,
voice owner, allocated group, Code session or PCM draft. Subsequent PCM Apply
and Envelope / LFO edits use their existing timing and physical-CH semantics.

The button delegates to the same channel-selection callback as the permanent
CH selector. Native Enter / Space keep button focus; pointer / touch activation
releases only that button's focus so musical letter keys can play the selected
CH. Polling keeps the buttons and help disclosure stable. Touch targets are
at least 44 by 44 CSS pixels on coarse pointers.

A held gesture is invalidated when its physical address changes, including a
change back before release, or when the view is disabled/hidden. Same-CH Code
retriggers or ownership changes remain navigable: the target is the physical
address, not a reservation of the note. Unknown/unavailable targets, hidden
members, missing callbacks and disposed views cannot navigate. SSF Live and its
starting/seeking transitions disable the authored shortcuts until the Synth
view is active again. The pure allocation model remains byte-identical.

## Verification

- **467 unit tests + 2 package tests pass.** Five new DOM/WASM navigation tests
  cover exact reordered Code targets, unchanged owner/register snapshots,
  native event delegation, pointer focus release, stable keyboard focus,
  value/release polling, remap/reversion, same-slot retrigger/replacement,
  disabled/hidden/disposed targets, cancellation and sync/async errors.
- **28 focused source-browser checks pass** across Chromium and WebKit at
  48 kHz. Actual UI covers cold navigation without audio initialization,
  advancing Code, selected-only Envelope/LFO edits, physical/Auto unapplied
  PCM drafts and Apply, DSP-to-SCSP navigation, Enter/Space, musical keys,
  Custom4/6 reordered links, live target changes, rapid same-slot retriggers,
  Stop, SSF Live/Pause and disposal. Native coarse-pointer touch has 44 px
  targets and zero 390 px overflow. Desktop/mobile screenshots were inspected.
  Physical output is permanently muted before initialization; page/missing
  errors are zero and served files stay unchanged during the run.
- **14 existing allocation browser checks pass** in both engines, preserving
  the previous ownership/mapping/SSF handoff behavior.
- The actual package CLI and deterministic readable-source ZIP tests pass.
  The extracted archive passes the same **28 browser checks** through its root
  `index.html`. All 115 shared served assets match source hashes; only the entry
  path differs. Touch, fast retriggers and SSF checks pass again, with zero
  page/missing errors. Packaged screenshots were visually reviewed.
- **31 source-proof tests**, seven source-recorder checks and both actual
  Mixer freshness generators pass. New receipt pin:
  `0e9351b17baafe7095f97f6e6694474c0f1c5274c59675b934e221a18fbce7cf`.
  The 13,807-byte pure model/helper prefix, 93 unchanged implementation inputs
  and all 914 previously tracked issue JSON files match base Git bytes.

Evidence: `build/scsp-allocation-channel-navigation-20261118/` and
`build/scsp-allocation-channel-navigation-browser-20261118/`. Verification ZIP:
`release/tetorica_scsp_synth_allocation-navigation-check-18a9bc47_itch.zip`.
The [machine record](verification_scsp_allocation_channel_navigation_20261118.json)
binds final source, proof receipts, test logs, browser reports and archive bytes.

No public API, audio/allocation/core/WASM/observer/gain/preset behavior,
npm/version/publication/commit/push/tag or Tauri changes. Human listening and
physical Saturn fidelity remain separate from these permanently muted checks.
