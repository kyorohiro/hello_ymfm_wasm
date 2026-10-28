# PS1 SPU: direct ADSR graph editing

Date: 2026-10-29. Base: `defa1795d728efbcc10a3ce3ce5c5b1449ca1ec8`.

## Operation

The Playground **SPU** tab has four draggable ADSR points, matching the OPN
editor's direct manipulation workflow:

- **A** moves horizontally to edit attack rate (0–127).
- **D** moves horizontally to edit decay rate (0–15), vertically to edit
  sustain level (0–15).
- **S** moves horizontally to edit sustain rate (0–127).
- **R** moves horizontally to edit release rate (0–31).

Right increases the raw PS1 rate code, which makes the stage slower and can
eventually stop it. These guides use separate editing bands, not measured
milliseconds. The sustain level grid represents `(SL + 1) / 16`; SL 0 is not
zero gain. Targets remain editable when the attack is stopped; dashed target
curves and a flat baseline distinguish that condition. Exponential/direction
switches retain their existing controls.

Each point is a focusable button with a descriptive accessible name. Left/right
arrows adjust its rate by one code; D also supports up/down for sustain level.
Mouse dragging preserves the existing computer-keyboard audition focus. Numeric
fields and the graph reflect the same draft, and a plain click sends no write.

**Sustain play** or the shared **Keyboard** auditions the selected voice during
editing. The existing retrigger checkbox determines whether an ADSR change
restarts an audition held by this editor. No new audition is started by dragging,
and the existing inspector preserves code-owned notes, unrelated fields,
reserved ADSR bits and other voices.

## Implementation and lifecycle

`playground_ps1_envelope.js` owns pure geometry and point-to-field mapping.
`playground_ps1_voice_panel.js` overlays the four handles on its existing canvas.
Updates coalesce per animation frame and wait for the previous inspector request
to finish. The final pointer position flushes on release. Applied snapshots
cannot erase unsent edits. Failed writes restore the applied value while
preserving newer queued changes.

Pointer cancellation, lost capture, channel changes, hiding, window blur,
document hiding, disconnection, disposal and numeric/raw overrides retire unsent
drags. Already applied edits are retained; cancellation does not send a rollback.
Idle or hidden graphs add no polling or continuous animation loop.

The new UI helper is included in standalone packaging and its dependency check.
UI cache revisions are `ps1-envelope-drag-1`. Sound generation, public package
APIs, SDK sources and WASM binaries are unchanged.

## Verification

- 144 focused Node tests pass, with no skips: panel, shared chip tabs, OPN graph
  regression, named PS1 parameters and actual SPU Worklet behavior. Graph tests
  cover every rate code/SL round-trip, clamping, four drags, keyboard controls,
  pointer ownership, cancellation, slow writes, snapshots and rejected edits.
- Source browser check passes Chromium/WebKit × Main/Worker (four routes), using
  the actual SPU AudioWorklet and physical output muted. Real mouse drags reach
  the applied SPU state before release; all fields, reserved bits, other voices,
  focus, plain-click/idle zero writes, retrigger, Keyboard, reverb and Stop pass.
- Desktop and 390px layout screenshots were inspected. Full source report:
  `/private/tmp/ps1-envelope-drag-browser.json`.
- The actual bundled/minified Run ZIP passes the same public UI checker in
  Chromium/WebKit Main (two more routes). Both complete and Run ZIPs pass CRC;
  the complete ZIP contains the new helper, and Run remains 931 entries.
  The package checks 1,167 module/asset references. Artifact hashes and the six
  browser-route summaries are retained in [ps1_adsr_graph_01.json](ps1_adsr_graph_01.json).
- 319 calibration/provenance tests pass. The original PS1/WonderSwan/POKEY raw
  measurements are unchanged. Existing cache-only receipts now recognize six
  precise UI import tokens; actual UI code changes use a separate
  [exact feature revision receipt](ps1_adsr_graph_ui_receipt_01.json). It pins the
  three changed UI source revisions and the new helper, audited against the
  original report source bytes and the four-route browser evidence. Any later
  code/helper change is rejected until separately reviewed. This is an audited
  UI revision, not a claim that the historical captures were remeasured.

Commands:

```sh
node --test docs/playground/playground_ps1_voice_panel.test.mjs docs/playground/playground_chip_tabs.test.mjs docs/playground/playground_operator_visual.test.mjs web/ps1_parameters.test.mjs web/playground_ps1_worklet.test.mjs
node scripts/check_ps1_voice_editor_browser.cjs --out /private/tmp/ps1-envelope-drag-browser.json --screenshots /private/tmp/ps1-envelope-drag-final-images
sh scripts/package_itch_playground.sh ps1-envelope-drag-dev
node scripts/check_ps1_voice_editor_browser.cjs --execution main --zip release/hello_ymfm_wasm_ps1-envelope-drag-dev_itch_playground_for_run.zip --out /private/tmp/ps1-envelope-drag-zip-browser.json
```

No npm/SDK release, remote CI dispatch, Tauri frontend import or human listening
has been performed for this UI change.
