# ASWAN Synth: FM2612 common-feature alignment

Recorded: 2026-11-19. Documentation and source audit only; no implementation or
new runtime/listening verification was performed for this checklist.

The agreed first sequence is **HuC6280 → SPU → DMG → SID**. ASWAN is an
unprioritized follow-up candidate; missing entries below are not a commitment
to implement every optional feature.

Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Current status

| Common feature | Audited ASWAN status |
| --- | --- |
| working/saved, Auto apply, ●, Save/Save all/Discard, accepted Code, two-version Cassette | **Missing.** [code_project.js](../synth-aswan/code_project.js) stores one filesystem and v1 snapshot. Existing Ctrl/Cmd+S/local persistence does not separate accepted content from an editable draft. |
| Active instrument file linked to knob/wave/JSON editing | **Partial.** Files opens sound JSON for editing/selection. [code_files.js](../synth-aswan/code_files.js) `saveSound()` creates another file, and `markSoundDirty()` persists settings rather than updating an active sound document. |
| Files Undo, New Cassette and replacement recovery | **Partial.** Validated imports and recovery exist; Capture transactionally keeps the previous and captured sounds. There is no general Files Undo history or New Cassette workflow in the adapter. |
| Persistent expanded Code workspace, chip/Mixer/Keyboard tabs, header Code/Synth, visible Master | **Partial.** Keyboard/Code and maximize exist. [code_host.js](../synth-aswan/code_host.js) does not wire FM's persistent expanded tabs or header layout switch. |
| Brief Live changed-value highlights, default On and switchable | **Implemented.** [live_highlight.js](../synth-aswan/live_highlight.js), [synth.js](../synth-aswan/synth.js) and `aswanHighlightEnabled` in [index.html](../synth-aswan/index.html) follow VGM/Code, default On and retain a preference. Preserve this feature rather than adding a second highlighter. |
| Output-only channel switches shared by Keyboard, Code and song | **Implemented.** `aswanMixerChannels` applies four output switches to the instrument endpoint and reference player; Code uses that same instrument. Chip volume and final Master are separate. |
| PCM drawing and Start/Loop range editing | **Partial / software extension.** [editor.js](../synth-aswan/editor.js) already draws the 32-point 4-bit Wave RAM. Voice PCM has audio import, sample rate, Root and Loop, but no RF5C164-style full-sample draw/Start/Loop range editor. |
| Looper / Event Rec | **Not implemented; optional.** No equivalent recording UI is present; not required for the initial saving/layout rollout. |
| Timed build/schedule/compile/capture-state API | **Separate proposal.** Not wired through the ASWAN Code host. Existing hardware sweep/noise and software Voice PCM supply are not this reservation API. |

## First implementation candidate: saving and Files

- [ ] Reuse the shared working/saved workspace and migrate v1 projects without
      losing Wave/Noise/Sweep/Voice settings, PCM payloads, source VGM/VGZ,
      captured sounds, metadata, editor selection or Code.
- [ ] Add Auto apply **On by default**, filename ●, Save, Save all and Discard;
      make Ctrl/Cmd+S save the selected/last-edited document and return pointer
      controls to performance focus.
- [ ] Link authored controls, drawn waves and valid JSON editing to the active
      sound file. Retain safe behavior while JSON is incomplete or malformed.
- [ ] With Auto apply Off, apply authored edits at Save without retiring Code.
      Physical CH edits remain direct. Run/Apply uses saved entry/modules/data;
      saving source never runs it.
- [ ] Cassette export must include ordinary **saved** files and recoverable
      **working differences**, preserving mode and both versions on import.
      Do not duplicate unchanged PCM/source files.
- [ ] Add bounded Files Undo and New Cassette with starter Code/examples.
      Preserve the existing two-sound Capture safety and never auto-run restored Code.

## Subsequent UI candidates and preservation

- [ ] Adopt persistent expanded ASWAN/Mixer/Keyboard/Code tabs and a header
      Code/Synth switch, with Master and Run/Apply/Stop always reachable.
- [ ] Regression-check the **existing** Live highlight preference across
      selection, pause/freeze, manual edits, project replacement and new layout.
- [ ] Regression-check the **existing** shared four-channel output Mixer;
      muted sources must retain sweep/noise/Voice state and reference timing.

## Optional work requiring a separate decision

- [ ] Decide whether to add a full Voice PCM sample/range editor. This would be
      a software tool supplying the CH2 DAC; it must not imply extra hardware
      polyphony, HyperVoice, DMA or FM2612/RF5C164 register compatibility.
- [ ] Decide whether Looper/Event Rec is useful before adding recording.
- [ ] Design timed operations separately, keeping immediate calls intact and
      using sample-clock execution rather than JavaScript timeout emulation.

## Completion checks for a future implementation

- [ ] Test independent Save/Discard, JSON validation, text/binary recovery,
      rename/delete, Capture, import/New/Undo and reload; quota/write failures
      must not silently promote working data or lose the previous sound.
- [ ] Preserve current VGM preparation/playback limits and the long-timeline
      fixes. Use self-authored Wave/Voice fixtures and speaker gain zero to
      verify continuing Code and hand-key ownership without changing calibration.
- [ ] Verify source and readable standalone ZIP in Chromium/WebKit, fallback and
      real Monaco, with desktop/390px resize, persistent layout and shortcuts.
- [ ] Update ASWAN documentation and record automated checks separately from
      human listening. Commit/push/npm/tag/Tauri/release are separate tasks.

## Timed register API follow-up

Not implemented; separate chip-level API work from Files/UI alignment.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [ ] Resolve per-channel Wave/volume/frequency and shared Sweep/Noise/routing controls with hardware event ordering.
- [ ] Scope Wave RAM transfer and software Voice PCM feeding explicitly; keep reservation execution independent from JS timers.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.
