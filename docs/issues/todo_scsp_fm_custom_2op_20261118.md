# SCSP Synth custom two-operator FM routing — 2026-11-18

User approved beginning the previously planned free-routing work with 2OP.
Base `62da69d00511f66e2db7aca69b258f96b6726438`; worktree was clean.

- [x] Add an explicit Custom connection for 2OP with an independently selected
  modulation source and direct-output choice for A and B.
- [x] Map the validated acyclic graph to physical SCSP slots in dependency
  order, preserving existing Chain / Pairs / Branch behavior and voice ownership.
- [x] Reject unsupported self/cyclic routing atomically as an initial software
  editor limit; keep hardware raw physical-CH controls available as before.
- [x] Integrate compact controls with the existing operator diagram, selection,
  focus/keyboard behavior, Code, DSP sends and configured signal-flow view.
- [x] Save/load custom routing without silently downgrading it; keep legacy
  preset versions and default state / rendered sound unchanged.
- [x] Verify actual WASM, invalid changes, allocation / stealing / release,
  Code/manual coexistence, typed API, browser layout and standalone packaging.
- [x] Record exact unchanged-default / source evidence and restart notes.

Initial scope is custom acyclic 2OP. Custom 4/6OP, cyclic/self feedback and a
general graphical patch-cable editor remain follow-up tasks. Voice allocation
and graph-to-slot mapping are Synth software over SCSP hardware sound-stack
modulation. No npm publication, common-runtime/API or WASM changes, parent
commit/push/tag, Tauri work or changes to other Synths are requested. Automated
browser output remains muted.

Proposed portable shape: `fm.algorithm:'custom'`, with
`fm.custom:{inputs:[[],[0]],outputs:[1]}` for A → B and direct output B.
The existing `fm.depth` and per-operator frequency ratios remain in use.

## Completed / resume

Choose **2-operator FM → Connection: Custom**, select A or B in the diagram,
then set **Modulation from** and **Direct output**. Both source directions,
parallel / mixed direct outputs and direct outputs Off are supported. Physical
slots follow dependency order while source IDs remain stable.

Active Custom sounds save as v5. Noncustom export remains v4 and omits dormant
custom metadata; v1–v4 loading stays compatible. Code uses the same `setConfig`
API. A validated graph change retires current Auto notes while Code continues;
manual physical key-up remains valid across that change.

See [verification](verification_scsp_fm_custom_2op_20261118.md). Remaining work:
manual listening / usability feedback, then custom 4/6OP, per-OP depth / dual
inputs and feedback/history semantics as separate follow-ups. No publication
or parent Git mutation was performed.
