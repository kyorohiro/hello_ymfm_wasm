# SCSP Synth — FM2612 interaction alignment

Recorded: 2026-11-19. Documentation/source audit only; existing checked work
remains in its original TODOs. No runtime edits or new validation are claimed.
SCSP is currently an unprioritized candidate; the user's ordered rollout is
HuC6280 → SPU → DMG → SID. This list does not approve every optional extension.

## Current comparison

| FM2612 reference feature | SCSP status and source evidence |
| --- | --- |
| Working/saved and explicit Save | **Missing.** [code_project.js](../synth-scsp/code_project.js) uses a single filesystem/v1 project snapshot. [code_files.js](../synth-scsp/code_files.js) has local persistence and Save sound/Code, but not independent accepted/working versions, Auto apply, dots, Save all/Discard or dual-version Cassette recovery. |
| Instrument file linked to UI edits | **Partial.** PCM/routing/voice presets and JSON editing exist; Save sound creates a new `.scsp.json` path. UI state, per-target unapplied PCM drafts and the selected Files document are not one working/saved document. |
| Files Undo and New/import restore | **Partial.** Transactional replacement and failed-New rollback exist. There is no user Files Undo history for successful file/New/import operations in [code_files.js](../synth-scsp/code_files.js). |
| Persistent expanded Code workspace | **Partial.** Existing Code/maximize and SCSP/DSP/CH controls are present. [code_host.js](../synth-scsp/code_host.js) does not enable FM2612's persistent combined tab workspace or header Code–Synth switch. |
| Changed-value highlighting | **Present.** Default-On switch, stored preference and bounded Code/SSF highlighting already exist in [live_highlight.js](../synth-scsp/live_highlight.js) and [synth.js](../synth-scsp/synth.js). Preserve the [completed work](todo_scsp_live_parameter_highlight_20261118.md); do not rebuild it as a missing feature. |
| Shared channel output mutes | **Missing as a common output-only mixer.** Level/pan, DSP sends/returns and sound-stack routing are editable, but are hardware/control state, not independent Keyboard/Code/SSF listening switches. [index.html](../synth-scsp/index.html) has no FM2612-style channel output mixer. The desired Direct/DSP/modulator behavior needs a design decision first. |
| PCM drawing/ranges | **Present in part / chip-specific.** The [shared voice panel](../playground/playground_scsp_voice_panel.js) already draws PCM, selects a region from loaded audio and sets Root/rate/forward-loop start. Explicit Apply allocates RAM for future notes; held/releasing notes retain their sample. Arbitrary Start/Loop End controls are not a required 1:1 RF5C164 port. |
| Looper / Event Rec | **Optional, absent from the user interface.** Unused `stopLooper` host callbacks do not constitute a recorder. Do not introduce one to complete saving/UI alignment. |
| Timed register operation compiler | **Separate candidate.** SCSP DSP assembly compilation and DSP programs already exist; they are not the timed `build/schedule/compile/captureState` API. [scspsynth.js](../js/scspsynth.js) has no equivalent public recorder/compiler contract. |

## Proposed implementation stages

- [ ] Introduce the shared working/saved workspace and migrate existing presets,
      PCM assets, Code, `.scspasm` and original SSF/library files without rewriting them.
- [ ] Define how file Save relates to existing PCM Apply and DSP Compile/Apply
      before changing behavior. Keep these distinctions visible; do not silently
      upload a PCM draft or replace a DSP program merely because source was saved.
- [ ] Add default-On Auto apply, filename ●, Save/Save all/Discard and Ctrl/Cmd+S;
      link UI/JSON editing to its selected instrument file and preserve per-target
      unapplied drafts. Keep invalid JSON/assembly distinct from valid sound state.
- [ ] Apply accepted changes without stopping Code, rewriting unrelated physical
      CHs or destroying surviving FM/self-feedback histories. Preserve Auto groups,
      physical slot ownership, captured loop metadata and existing release guards.
- [ ] Execute saved Code/modules/data only on explicit Run/Apply. Saving source
      never runs it. Export ordinary saved files plus validated working differences;
      deduplicate unchanged PCM and retain both layers through crash recovery.
- [ ] Add reversible Files operations and restore both layers/selection/mode on
      Undo/New/import/reload; separate in-memory acceptance from storage durability.
- [ ] Add persistent Code/SCSP/DSP/Keyboard workspace navigation and the header
      Code–Synth switch, keeping Master, existing CH/slot maps and highlighted
      observations available without stopping the performance.

## Optional work requiring its own decision

- [ ] Specify output-only muting of 32 physical slots, grouped voices and DSP
      returns. Muting an audible modulator must not accidentally disable Sound
      Stack generation, DSP input or SSF timing. Do not repurpose hardware TL or
      STWINH as a transparent output mute.
- [ ] Consider additional PCM playback-range controls only where sample addressing,
      Attack/loop link, loop modes and operator modulation permit safe editing.
- [ ] Keep Looper/Event Rec and timed register scheduling separate from this rollout.
      A timed API would need Worklet execution and shared chip operation resolution,
      not JS timers or reuse of the unrelated DSP assembler's `compile()` meaning.

## Required validation when implementation starts

- [ ] Test text/binary/large PCM, malformed input and atomic compound saves;
      rename, quota/reconnect, recovery journals, both-version Cassette and Undo.
- [ ] Verify saved Code execution and continuing Code/manual edits. Preserve
      independent Synth/SSF DSP state, assembly diagnostics, slot routing, Loop
      Link and captured PCM; importing/Save must never start playback.
- [ ] Use muted real source/standalone-ZIP Chromium/WebKit, fallback and actual
      Monaco, with keyboard focus and settled desktop/390px expanded/restored
      layouts. Do not claim human listening or a new hardware-accuracy guarantee.

Related work: [Code UI](todo_scsp_synth_code_ui_20261115.md),
[SSF Capture](todo_scsp_synth_ssf_capture_20261115.md),
[DSP edit/apply](todo_scsp_dsp_edit_apply_20261117.md),
[DSP Save Code](todo_scsp_dsp_save_code_20261117.md),
[FM2612 saving reference](todo_fm2612_working_saved_20261119.md).
No publication, Tauri import, commit, push or tag is part of this checklist.

## Timed register API follow-up

Not implemented; separate from the existing DSP assembler and its compile method.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [ ] Resolve slot register widths/addresses, packed fields, key execution, envelope, loop, LFO and slot-modulation routing operations.
- [ ] Define a bounded register-only surface; PCM transfers, ring-buffer contents and DSP assembly/program execution remain separate concerns.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.
