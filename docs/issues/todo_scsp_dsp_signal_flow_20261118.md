# SCSP Synth DSP signal-flow view — 2026-11-18

User approved a compact, collapsible visualization of the existing routing UI.
Base `ac5024067fb9404151bf66623e0c050cdae93b6d`; worktree was clean.

- [x] Show the selected Auto source / physical CH, MIXS0/1 Send, applied DSP
  program and both shared Returns with their left/right Pan settings.
- [x] Reflect Send zero, disabled Returns and Return level / Pan changes while
  distinguishing configured paths from actual audio measurement.
- [x] Keep arbitrary DSP input/output connectivity explicit as unknown; do not
  infer nonexistent connections or claim a silent total output from one CH.
- [x] Preserve direct output context, SSF separation, keyboard focus and all
  existing controls; opening the view must not write registers or start audio.
- [x] Verify pure behavior, real browser updates, compact/narrow layout,
  unchanged DSP sources / audio and standalone source-preserving packaging.
- [x] Record verification and resume information.

No npm publication, API changes, engine/WASM changes, new audio meters,
parent commit / push / tag or Tauri work are requested. Browser automated
checks keep physical output permanently muted. Explanations remain concise and
the view is collapsed by default.

## Completed / resume

Open **SCSP Synth → DSP → Signal flow**. The diagram is a passive, configured
route view; it includes Direct output and shared Returns without claiming to
measure sound. Unknown custom programs remain program-defined. Known examples
show selected input/output connectivity. SSF keeps its existing separate DSP
and disabled Synth-DSP-tab policy.

See [verification](verification_scsp_dsp_signal_flow_20261118.md). Source and
exact standalone ZIP pass Chromium / WebKit at 48 kHz, including keyboard,
Code, SSF, passive disclosure and 390px layout. Audio/core/API sources were not
changed. No publication or Git mutation was performed. Further visual feedback
can be applied after the user tries the collapsed/expanded view.
