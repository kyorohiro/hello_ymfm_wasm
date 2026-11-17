# SCSP DSP two-input / two-output routing — 2026-11-18

User approved committing / pushing the completed examples update, then adding
two DSP input / output paths. Start from clean parent be6f8faf. The examples
checkout contains only the previously prepared npm 0.2.44 update.

- [x] Review, commit and push the verified examples-repository update; verify
  remote commit equality without force-pushing or modifying unrelated changes.
- [x] Inspect hardware ISEL / IMXL and EFREG return addressing, executable
  profile boundaries, state adoption, native capability and default-path guards.
- [x] Add bounded two-bus sends and two effect returns while preserving existing
  mono calls / snapshots and the managed fixed Delay's documented routing.
- [x] Connect local / Main / Worker APIs, exact declarations and completion;
  preserve masked register fields, live held notes, ownership and atomic errors.
- [x] Add a readable Gain-left / IIR-right example and verify channel isolation,
  pan, bus / return edits, Stop / reset / restore and invalid-request preservation.
- [x] Verify real WASM output, independent left/right expectations, unchanged
  legacy PCM / mono DSP paths, muted browsers, installed npm candidate and ZIPs.
- [x] Record usage, limitations, source / calibration evidence and restart tasks.

No parent git commit / push / tag, npm publication / version bump, itch upload,
Tauri work, core/WASM rebuild, Reverb or arbitrary DSP RAM layout is part of
the routing milestone. Browser physical output stays permanently muted.
The examples commit / push is explicitly authorized by this follow-up request;
the prior publication task's no-push note describes its earlier scope only.

## Initial decisions

`setPreset(slot,{dspInput:0|1})` configures the next keyOn; `setMix()` updates
ISEL live with the existing `dspSend` IMXL. Omitted input remains MIXS0 without
adding a field to legacy snapshots. Explicit input selection is Web Audio only.

`setDspReturn(patch)` keeps its EFREG0 behavior. The new indexed overload
`setDspReturn(output,patch)` selects output 0 or 1. Indexed use adds an optional
detached `returns:[return0,return1]` tuple while preserving `return` as output 0.
The RAM-free execution profile permits EFREG0 / EFREG1; the separate Synth
Delay validator and managed fixed Delay remain MIXS0 → EFREG0.

Examples update pushed: `5b726813fddf7fc96bb11d8d61616bfbca75b677`.
HEAD / origin/main / GitHub API commit equality and clean worktree verified.
SSH failed with publickey; the existing gh HTTPS credential helper completed a
normal push without changing the remote URL or authentication configuration.

## Completed and resume point

Implementation and automated verification are complete. See
[verification](verification_playground_scsp_dsp_routing_20261118.md) and its
machine evidence. Playground SCSP Files includes `examples/scsp/scsp-dsp-routing.js`.
The unpublished npm candidate and both tested Playground ZIPs are retained under
`build/scsp-routing-20261118/` and `release/` respectively.

Remaining manual check: listen to the Gain-left / IIR-right example. Parent
commit / push, a version bump and publication require a later user instruction.
