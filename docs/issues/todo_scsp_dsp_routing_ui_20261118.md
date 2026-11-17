# SCSP Synth DSP routing UI — 2026-11-18

User requested the Synth UI follow-up instead of another npm publication.
Base: `176eb363ef9533f9d226b4e0eed6800ac1b03d6c`; worktree was clean.

- [x] Inspect the Synth DSP owner, physical / Auto channel editing, Code bridge,
  preset / setup export and existing Delay compatibility.
- [x] Expose each Synth channel's DSP input bus and Send amount, keeping edits
  live and respecting the selected channel / Auto behavior.
- [x] Expose two independent effect Return levels and Pan controls, with concise
  help and the same button / drag controls as existing Synth parameters.
- [x] Provide an understandable Gain-left / IIR-right setup and make the
  currently applied routing visible without enlarging explanatory text.
- [x] Preserve existing Delay, presets, save-to-Code, held notes, Stop / reset,
  failed-Apply atomicity and the separate SSF engine.
- [x] Verify real WASM / transport behavior, muted browser operation, layout and
  standalone packaging; document results and remaining manual listening.

No npm publication / version bump, parent commit / push / tag, other Synth or
Tauri changes are requested. Keep browser physical output muted during automated
verification. DSP buses / effect outputs are hardware controls; any convenience
setup or routing allocation is Synth software behavior.

## Completed / resume

DSP now keeps the shared Auto / CH selector visible and exposes the selected
voice's MIXS0/1 send plus two independent Return level / Pan controls. Default
restores inherited routing. Gain-left / IIR-right is a staged example; Apply
does not silently change sends or start notes.

New routing and Returns are DSP session settings, saved by **Save setup to
Code**, including inheritance. Existing voice preset formats remain unchanged.
Cold-to-audio migration, owner retirement and atomic routing ACK recovery are
covered by tests. No new common DSP owner is started by the Synth controls.

See [verification](verification_scsp_dsp_routing_ui_20261118.md) for source,
browser, default-output and ZIP evidence. Remaining manual work: listen to the
two paths and assess the control placement. No publication was performed.
