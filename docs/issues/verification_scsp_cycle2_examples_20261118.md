# SCSP cycle2 example catalog integration - 2026-11-18

Base: `d0372196c843629f9b206bcff5aeb1f09628d408`.

The tested prototype is now available directly in **Tetorica FM2612 Playground,
SCSP mode -> Files -> examples -> scsp -> scsp-cycle2-prototype.js**.
Select it as Run file, then Run. Opening the file does not execute it.
This example uses the Playground's physical-slot API; it does not add cycle
support to the SCSP Synth Code facade.

The [canonical example](../playground/examples/scsp/scsp-cycle2-prototype.js)
is byte-identical to the former research file
(`b5875535d6c2c8f05841641188112cc448b01f2c76685e35d15e92a76f593a72`).
Only its location and SCSP catalog registration change. The generated catalog
includes its readable source; the page import query refreshes the catalog cache.
Existing starters, example bodies and other mode selections remain unchanged.

An older project's reconciliation adds the example if missing. It keeps edits
at the same path, custom code, the current editor file and the Run selection.
No project reset is needed. The normal existing conflict rules still protect
files/directories occupying a bundled path.

Validation:

- Example bundle consistency and 36 example/mode-restoration/actual-SCSP tests
  pass. The prototype still uses a dedicated instance, retains setup on Run
  reevaluation and releases its own instance on Stop.
- 32 browser checks pass: Chromium/WebKit x Main/Worker at 48 kHz, eight cases
  each. The checker opens the actual bundled file from the Files tree, verifies
  exact editable source and no audio creation before Run, then checks execution,
  slot settings, finite output, live depth changes, reuse and fresh Stop -> Run.
  Physical output stays muted. Page/asset/processor errors are zero.
- Packaging checks cover reviewed source predecessors, unchanged Mixer
  defaults, runtime artifact consistency and the shipped module graph. The
  source receipt accepts only the exact catalog addition and cache-query edit;
  it does not exempt changed audio code from measurement.

Local browser evidence is in
`build/scsp-cycle2-examples-20261118/browser-source.json`, `.log` and screenshots.
The [machine record](verification_scsp_cycle2_examples_20261118.json) binds the
final edited files and evidence. The earlier research measurement JSON remains
unchanged and describes its original manual-paste verification run.

No runtime/core/WASM, gain, default instrument or Synth behavior changes.
No native research remeasurement, npm publication, version bump, commit/push/tag
or Tauri update is part of this step.
