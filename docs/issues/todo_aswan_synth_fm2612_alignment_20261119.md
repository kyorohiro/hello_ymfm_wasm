# ASWAN Synth: FM2612 common-feature alignment

Recorded: 2026-11-19. The initial table is a source audit. Implementation and
automated verification started on 2026-11-20 as recorded below; human listening
is separate.

The original sequence was **HuC6280 → SPU → DMG → SID**. On 2026-11-20,
ASWAN was selected as the next alignment target after SPU. Missing entries
below are not a commitment to implement every optional feature.

## Active implementation slice (2026-11-20)

Implement the data layer first: shared working/saved workspace, atomic
Save/Discard, v1 migration, saved Code readers and a v2 Cassette containing
saved files plus working differences. Keep Auto apply On and the existing UI
behavior until the Files controls and active-sound acceptance are connected
together in the next slice. Do not switch Run/Apply to saved-only readers yet.
No timed API, recording, audio gain or playback changes in this slice.

- [x] Implement and test the project data layer and legacy migration.
- [x] Verify existing Files/Capture/source-import behavior with Auto apply On.
- [ ] Connect Auto apply/Save/Discard UI, active sound documents and saved
      Run/Apply together in the next slice.

Implemented in this slice: `savedFs`, `workspace`, `setAutoApply`, dirty-path
queries, atomic Save/Discard, saved entry/module/data readers, v1 local/ZIP
migration and v2 ZIP export/import. Shared editor crash-journal recovery keeps
working and accepted Code separate. Auto apply remains On for existing users;
there are no new visible controls yet. `saved` means accepted content in memory,
not proof of a successful IndexedDB/disk write.

Automated checks (2026-11-20):

- `npm run test:aswan-synth`: **179 passed**, including readable ZIP packaging,
  legacy migration, byte-exact source retention, saved entry/modules/data,
  invalid recovery rejection and pending Code journal recovery.
- `node scripts/check_aswan_synth_browser.cjs`: Chromium and WebKit passed
  against source and a generated standalone ZIP, with physical outputs muted.
  Existing keyboard/Code, Capture, reference playback, channel edits, highlight
  and Mixer behavior were checked. No human listening was performed.

Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Current status

| Common feature | Audited ASWAN status |
| --- | --- |
| working/saved, Auto apply, ●, Save/Save all/Discard, accepted Code, two-version Cassette | **Data layer implemented; UI pending.** [code_project.js](../synth-aswan/code_project.js) now uses the shared workspace, v1→v2 migration, atomic Save/Discard, saved Code readers and two-version Cassette export/import. Files controls and Run/Apply still use their existing immediate behavior until the acceptance UI is connected. |
| Active instrument file linked to knob/wave/JSON editing | **Partial.** Files opens sound JSON for editing/selection. [code_files.js](../synth-aswan/code_files.js) `saveSound()` creates another file, and `markSoundDirty()` persists settings rather than updating an active sound document. |
| Files Undo, New Cassette and replacement recovery | **Partial.** Validated imports and recovery exist; Capture transactionally keeps the previous and captured sounds. There is no general Files Undo history or New Cassette workflow in the adapter. |
| Persistent expanded Code workspace, chip/Mixer/Keyboard tabs, header Code/Synth, visible Master | **Partial.** Keyboard/Code and maximize exist. [code_host.js](../synth-aswan/code_host.js) does not wire FM's persistent expanded tabs or header layout switch. |
| Brief Live changed-value highlights, default On and switchable | **Implemented.** [live_highlight.js](../synth-aswan/live_highlight.js), [synth.js](../synth-aswan/synth.js) and `aswanHighlightEnabled` in [index.html](../synth-aswan/index.html) follow VGM/Code, default On and retain a preference. Preserve this feature rather than adding a second highlighter. |
| Output-only channel switches shared by Keyboard, Code and song | **Implemented.** `aswanMixerChannels` applies four output switches to the instrument endpoint and reference player; Code uses that same instrument. Chip volume and final Master are separate. |
| PCM drawing and Start/Loop range editing | **Partial / software extension.** [editor.js](../synth-aswan/editor.js) already draws the 32-point 4-bit Wave RAM. Voice PCM has audio import, sample rate, Root and Loop, but no RF5C164-style full-sample draw/Start/Loop range editor. |
| Looper / Event Rec | **Not implemented; optional.** No equivalent recording UI is present; not required for the initial saving/layout rollout. |
| Timed build/schedule/compile/capture-state API | **Separate proposal.** Not wired through the ASWAN Code host. Existing hardware sweep/noise and software Voice PCM supply are not this reservation API. |

## First implementation candidate: saving and Files

- [x] Reuse the shared working/saved workspace and migrate v1 projects without
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
