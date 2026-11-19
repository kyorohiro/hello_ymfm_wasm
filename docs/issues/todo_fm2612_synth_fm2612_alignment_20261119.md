# FM2612 Synth: common-feature reference and boundaries

Audited: 2026-11-19. This app is the reference for the
[cross-Synth rollout](todo_synth_fm2612_alignment_20261119.md), not another
unstarted implementation target. See [CODE.md](../synth/CODE.md) and the
[completed saving record](todo_fm2612_working_saved_20261119.md).

## Reference status

| Area | Implemented behavior / boundary |
|---|---|
| Working/saved and Save UI | Implemented in [synth_project.js](../synth/synth_project.js), [synth_files.js](../synth/synth_files.js) and the shared workspace. Auto apply defaults On; manual edits show dots and use Save/Save all/Discard and Ctrl/Cmd+S. Cassette and recovery retain both layers. |
| Instrument file/editor link | FM/PSG/RF5C164 author editing updates the selected document. FM TFI/VGI plus required Synth sidecar form an atomic unit; JavaScript saving does not execute Code. |
| Files Undo | Available for file operations, Save/Discard and project replacement; restored Code is not run automatically. |
| Persistent Code workspace | [synth_expanded_tabs.js](../synth/synth_expanded_tabs.js) keeps Code/chip/Mixer/Keyboard tabs, the header Code/Synth switch and Master accessible across expanded views. |
| Live changed-value highlighting | Implemented with default-on On/Off control for FM/PSG/PCM state displays. Distinct from following Live state. |
| Shared CH output switches | Implemented across Keyboard/Code/VGM for the supported FM, PSG, PCM, CD-DA and PWM outputs, with independent source-group volumes. These are software output controls. |
| PCM drawing/ranges | RF5C164 supports loaded-sample drawing and playback/loop ranges. CD-DA has transport/generated test waves; it is not an RF5C164 instrument. PWM editor remains a different scope. |
| Looper / Event Rec | Implemented for the FM/PSG/PCM instrument paths. Not a universal recorder for CD-DA/PWM or concurrent Code/VGM sessions. |
| Timed register API | YM2612 supports build/schedule/compile/captureState and the existing scheduleWrites compatibility path. This does not mean every chip selected through useSoundChip has the same reservation API. |

## Preserve while porting to other apps

- [x] Keep the existing immediate API and sample-accurate YM2612 operation API compatible.
- [x] Keep source data separate from live chip state and software output controls.
- [x] Keep Code loops/context/FX running during ordinary sound editing and Save.
- [x] Retain independent working/saved source, native binaries/sidecars and recovery.
- [x] Validate real Monaco/fallback and readable standalone ZIPs without speaker output.

These checked rows describe the existing baseline; they are not new test runs
performed during this documentation-only inventory. Details and validation
receipts are in the completed saving record linked above.

## Optional boundaries, not newly approved work

- [ ] Reassess shared abstractions only after the HuC6280 and SPU ports expose
  a concrete common need; retain chip-specific port/register formats.
- [ ] Consider any additional chip's timed API separately rather than assuming
  the YM2612 implementation automatically covers PSG/PCM/CD-DA/PWM.
- [ ] Consider broader recording or media editors only in a separately scoped request.

No source change, npm publish, Tauri import or release is part of this inventory.

## Timed register API follow-up

YM2612 already provides the reference API; do not list it as missing.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [x] Existing timed API recorded as supported; this is not a new verification run.
- [ ] Preserve YM2612 build/schedule/compile/captureState and scheduleWrites compatibility during Synth changes.
- [ ] Scope Sega PSG, RF5C164, 32X PWM and CD-DA separately; their presence in useSoundChip does not imply timed-operation support.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.
