# S-DSP Synth: FM2612 common-feature alignment

Recorded: 2026-11-19. Documentation and source audit only; no implementation or
new runtime/listening verification was performed for this checklist.

The agreed first sequence is **HuC6280 → SPU → DMG → SID**. S-DSP is an
authorized follow-up in the NES → SNES → SCSP rollout. This checklist does not turn all optional
FM2612 features into required S-DSP work. The canonical web path is `synth-snes`.

Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Current status

| Common feature | Audited S-DSP status |
| --- | --- |
| working/saved, Auto apply, ●, Save/Save all/Discard, accepted Code, two-version Cassette | **Missing.** [code_project.js](../synth-snes/code_project.js) has one filesystem and a v1 project snapshot. Ctrl/Cmd+S flushes text/local storage, without an independent accepted-content layer. |
| Active instrument file linked to knob/wave/JSON editing | **Partial.** JSON selection and text editing exist; [code_files.js](../synth-snes/code_files.js) `saveSound()` adds a new file and `markSoundDirty()` updates current settings instead of the active JSON. |
| Files Undo, New Cassette and replacement recovery | **Partial.** Validated import/restore and local recovery exist; no FM-style Files Undo history or New Cassette workflow is present. Looper Undo is not Files Undo. |
| Persistent expanded Code workspace, chip/Mixer/Keyboard tabs, header Code/Synth, visible Master | **Present (2026-11-21).** Persistent expanded Code/S-DSP/Mixer/Keyboard navigation and header Code/Synth reuse shared controls; Master and collapsible SPC playback remain above Files/main. |
| Brief Live changed-value highlights, default On and switchable | **Missing.** Live/Auto channel display exists in [index.html](../synth-snes/index.html) and [spc_live.js](../synth-snes/spc_live.js), without a changed-value highlight switch. |
| Output-only channel switches shared by Keyboard, Code and song | **Implemented.** [mixer.js](../synth-snes/mixer.js) applies source volume and an eight-channel mute mask to the instrument and SPC player. Muted modulators continue driving PMON. |
| PCM drawing and Start/Loop range editing | **Partial / chip-specific.** [editor.js](../synth-snes/editor.js) draws 128-point waves for carrier/modulator. Imported BRR has a read-only decoded overview and editable Root/base PITCH/Loop start. Arbitrary BRR sample drawing and RF5C164-style Start/End trimming are absent. |
| Looper / Event Rec | **Looper implemented; Event Rec optional/missing.** [index.html](../synth-snes/index.html) and [README](../synth-snes/README.md#software-looper) describe independent audio layers, release/Echo wrapping, Undo/Clear and Code ownership. Do not duplicate that recorder. |
| Timed build/schedule/compile/capture-state API | **Separate proposal.** Not wired through the S-DSP Code host; hardware ADSR/GAIN, PMON and Echo are not a replacement for register-operation reservations. |

## First implementation candidate: saving and Files

- [ ] Introduce shared working/saved state and migrate existing v1 projects.
      Preserve original SPC/BRR files, complete carrier/modulator payloads,
      tuning/loops, Noise, ADSR/GAIN, Echo/FIR, PMON, selection and Code.
- [ ] Add Auto apply **On by default**, filename ●, Save, Save all and Discard;
      Ctrl/Cmd+S saves the selected/last-edited document without consuming note keys.
- [ ] Link authored knobs, waves and valid JSON edits to the active preset file.
      Treat the full carrier/modulator preset atomically; a failed sample/RAM
      validation must retain the previous playable sound and pending draft.
- [ ] With Auto apply Off, apply authored changes on Save while Code continues.
      Physical CH edits stay direct and SPC playback retains its ownership.
      Run/Apply reads saved entry/modules/data; saving source never executes it.
- [ ] Export ordinary **saved** files plus recoverable **working differences**.
      Import/reload preserves both versions and Auto apply; unchanged SPC/BRR
      payloads must not be duplicated solely for recovery metadata.
- [ ] Add bounded Files Undo and New Cassette with starter Code/examples. Define
      explicit performance retirement on project replacement while preserving
      the existing Looper's documented layer-retention rules.

## Subsequent UI candidates and preservation

- [ ] Adopt persistent expanded Code/S-DSP/Mixer/Keyboard tabs, header Code/Synth
      controls and reachable Master/Run/Apply/Stop, without losing edited Code.
- [ ] Add switchable Live changed-value highlights, default On; distinguish them
      from Live following and preserve paused/frozen physical-CH edits.
- [ ] Regression-check the **existing** shared eight-channel Mixer, PMON signal
      flow and Looper; do not reset DSP state merely to mute or switch views.

## Optional work requiring a separate decision

- [ ] Evaluate imported-BRR sample drawing/range tools separately. Preserve
      9-byte BRR blocks, END/LOOP flags, 16-frame loop alignment, explicit tuning,
      predictor behavior and the shared 64 KiB/Echo/PMON memory budget. Do not
      promise lossless or seamless PCM editing by copying RF5C164 controls.
- [ ] Decide whether Event Rec is useful; existing audio-layer Looper remains.
- [ ] Design timed operations as a separate API effort with sample-clock
      execution; preserve current immediate APIs and raw hardware gates.

## Completion checks for a future implementation

- [ ] Cover atomic full-preset Save/Discard, invalid JSON/BRR/RAM budgets,
      rename/delete, import/New/Undo, reload and failed IndexedDB transactions.
      Neither recovery nor export may silently accept the working version.
- [ ] Use self-authored BRR/SPC fixtures and actual Worklet output with speaker
      gain zero; check continuing Code, physical-CH edits, Looper and PMON/Echo.
      Retain original files and existing calibration/limits.
- [ ] Verify source and readable ZIP in Chromium/WebKit with fallback and real
      Monaco, normal/expanded desktop/390px layouts and keyboard shortcuts.
- [ ] Update S-DSP documentation and distinguish automated measurements from
      human listening. Commit/push/npm/tag/Tauri/release are separate tasks.

## Timed register API follow-up

Not implemented; separate chip-level API work from Files/UI alignment.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [ ] Resolve voice/global DSP registers, KON/KOFF event masks, ADSR/GAIN, PMON, Noise and shared Echo/FIR settings with their original side effects.
- [ ] Scope BRR/sample RAM transfers and Echo memory separately; reusable resolver snapshots are not full SPC emulator save states.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.

## Authorized workspace slice — 2026-11-21

- [x] Persistent Code/S-DSP/Mixer/Keyboard tabs and header Code/Synth switch.
- [x] Reachable Master and collapsible SPC playback above Files/main.
- [x] Preserve running Code, editor model, physical-CH editing, Mixer/PMON/Echo and existing Looper rules.
- [x] Verify source/readable ZIP muted browsers, Monaco and relevant regressions.

Timed APIs follow this UI slice; Files migration, highlighting and new recorders are excluded.

Workspace verification: 187 S-DSP regressions/packaging tests and 11 shared
expanded-tab checks pass. Source and readable ZIP pass physically muted
Chromium/WebKit with fallback and real Monaco at desktop/390px widths.
Human listening remains pending; timed APIs are the next task.
[Evidence](verification_snes_code_workspace_20261121.json).
