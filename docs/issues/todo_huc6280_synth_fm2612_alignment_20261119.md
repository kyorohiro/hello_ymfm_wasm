# HuC6280 Synth: FM2612 common-feature alignment

Audited: 2026-11-19. Priority **1**, followed by SPU → DMG → SID.
The saving slice was subsequently authorized and implemented; see its
[implementation and verification TODO](todo_huc6280_working_saved_20261119.md)
and the [rollout index](todo_synth_fm2612_alignment_20261119.md).
Existing functionality is summarized in the [finish TODO](todo_huc6280_synth_finish_01.md).

## Comparison and current progress

| Area | Current status and evidence |
|---|---|
| Working/saved and Save UI | Implemented in [code_project.js](../synth-huc6280/code_project.js) and [code_files.js](../synth-huc6280/code_files.js): v2 workspace with v1 migration, default-on Auto apply, dots, Save / Save all / Discard and Ctrl/Cmd+S. Verification is recorded in the implementation TODO. |
| Instrument file/editor link | Implemented: selected sound document, knobs/drawings and valid JSON share working content. Invalid JSON retains text and the last playable cache. Manual Save applies accepted sound fields without replacing unrelated Code changes. Explicit standalone loads detach the prior document. |
| Files Undo | Implemented: file saves/Discard/rename/copy/delete and New/import retain bounded history, selection and both file versions. Project restoration never runs Code. |
| Persistent Code workspace | Implemented in the [workspace slice](todo_huc6280_code_workspace_20261119.md): header Code/Synth, persistent expanded Code/HuC6280/MSM5205/CD-DA/Mixer/Keyboard tabs, shared transport and the original visible header Master. |
| Live changed-value highlighting | Implemented in the [Live highlight slice](todo_huc6280_live_highlight_20261119.md): default-On remembered display preference, bounded CSS feedback for known hardware values using existing observations, with no added native reads or timers. |
| Shared CH output switches | Implemented in the [shared channel mixer slice](todo_huc6280_shared_channel_mixer_20261119.md): one session mask for Keyboard/Code/VGM/paused audition, available before enabling audio. Native output gates preserve Wave/Noise/DDA/LFO and Code ownership; source-group volumes/mutes remain independent. |
| PCM drawing/ranges | Partial. 32-point Main/LFO waves and generated MSM5205/CD-DA test waves are drawable. Loaded DDA samples in [editor.js](../synth-huc6280/editor.js) have an overview and Rate/Root/Speed/Loop, without FM's PCM draw/start/loop-range editor. MSM5205's loaded ADPCM display is also a distinct, currently read-only format. |
| Looper / Event Rec | Missing; optional software-feature proposal, not part of the saving phase. |
| Timed register API | Missing from [huc6280synth.js](../js/huc6280synth.js). A separate chip/API design and implementation, not a UI-only port. |

VGM sound selection now chooses Auto and retains Play/Pause position, including
selection from a physical CH. Code and VGM execution remain mutually exclusive.

Already supported: Keyboard/Code, Run/Apply/Stop, parameter/keyboard interaction
with Code or VGM, Monaco types/source navigation, software FX, original VGM
archiving and preset extraction, Auto/CH1–6, paused audition/edit/Capture,
Seek/cache, New Cassette, right-click file operations, and MSM5205/CD-DA UI
and keyboard playback. Preserve these rather than rebuilding them.

## First slice: saving and the selected sound document

- [x] Reuse the shared Virtual Files workspace; add independent working/saved
  content, default-on Auto apply, dots, Save/Save all/Discard and Ctrl/Cmd+S.
- [x] Define the active sound document explicitly. Knobs and Main/LFO wave or
  DDA edits update its working version; valid JSON edits and UI edits must not
  overwrite each other through stale editor models. Retain Save sound as an
  explicit new-document action where useful.
- [x] In manual mode, apply saved sound changes only on Save. Merge touched
  fields against current chip state without stopping Code or overwriting its
  unrelated parameters. Physical CH controls remain immediate session edits.
- [x] Execute Code from saved entry/modules/data; saving or importing source
  never runs it. Preserve loops, context, FX and keyboard focus.
- [x] Migrate v1 snapshots; retain sound/file selection and both versions in
  local draft and recovery. Export ordinary saved files plus working deltas;
  retain original VGM, existing metadata, session WAV policy and byte limits.
- [x] Add atomic file/project Undo, including rename/deletion and New/import,
  with explicit handling of the authored instrument, transport and selection.
- [x] Align preset selection from physical CH with Auto/transport behavior,
  or document any chip-specific restriction after checking actual ownership.

## Subsequent, separately bounded slices

- [x] Port the persistent Code workspace/header switch and visible Master to
  the HuC6280/MSM5205/CD-DA/Mixer/Keyboard arrangement.
- [x] Add optional Live changed-value highlighting, default On.
- [x] Extend channel output monitoring to ordinary Keyboard/Code as well as
  VGM. Muting must keep DDA, Noise and the CH2 → CH1 LFO running internally.
- [ ] Evaluate loaded DDA PCM drawing and start/loop ranges as a software
  editing feature; scope MSM5205 ADPCM editing separately from generated waves.

Looper/Event Rec and timed-register API ports stay in an optional backlog;
neither is required to finish the slices above. No release/publication is implied.

## Acceptance checks for implementation

- [x] Test saved/working independence, JSON validation, save/discard/new/rename,
  Undo, import/export/reload and IndexedDB/journal failure recovery atomically.
- [x] Measure that unsaved manual tone edits leave sounding Code unchanged;
  Save applies the intended fields without retuning unrelated Code voices.
- [x] Preserve VGM/paused audition/Capture, keep-loudest preset extraction,
  channel ownership, Seek/cache, LFO pairing and media-source lifecycle.
- [x] Verify source and exact readable ZIP, Chromium/WebKit, actual Monaco and
  fallback, settled 390px/desktop and expanded/restore layouts, and input focus.
  Use muted physical output; record human listening separately.

Saving-slice verification: [717 Node tests and the 8-case source/ZIP matrix](verification_huc6280_working_saved_20261119.json).
The [persistent Code workspace](todo_huc6280_code_workspace_20261119.md) is also
implemented and [verified](verification_huc6280_code_workspace_20261119.json).
The [Live highlighting slice](todo_huc6280_live_highlight_20261119.md) is implemented
and [verified](verification_huc6280_live_highlight_20261119.json).
Shared channel monitoring is implemented in the
[shared mixer slice](todo_huc6280_shared_channel_mixer_20261119.md).
Additional loaded PCM editing remains pending above.

## Timed register API follow-up

Not implemented; next planned timed-API candidate before moving on to the SPU UI port.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [ ] Map existing Tone/Wave gate, volume/balance, Noise and shared CH2 → CH1 LFO operations to their chip-specific resolver.
- [ ] Handle channel selection and packed control updates at execution time; retain meaningful writes and LFO reset events.
- [ ] Define supported Wave RAM/DDA operations first. Keep software DDA feed/sample transfer and MSM5205/CD-DA transport outside the first register-only scope.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.

Implementation tracking: [HuC6280 timed API](todo_huc6280_timed_register_api_20261119.md).
The internal recorder/compiler foundation is implemented; public scheduling,
coherent snapshots and Code lifecycle integration are still pending there.

Timed API progress (2026-11-19): internal HuC6280 Worklet queue adapter and
state snapshots are tested against real WASM rendering at 44.1/48 kHz. Public
Code/Worklet host integration, software-envelope ownership and types remain;
see the linked timed API TODO for the explicit integration contract.

Timed Synth Code connection: build/schedule/compile/captureState/clearSchedule
are now available in the HuC6280 Synth's existing Worklet route, with declarations
and examples/huc6280-timed.js. Run/Apply/Stop, liveLoop ownership and manual
interleaving pass real-processor and muted Chromium/WebKit checks. Immediate
software-envelope noteOn/off remain unchanged; timed register patterns use
explicit setNote/keyOn/keyOff. Shared Playground Main/Worker/npm exposure and
Native capability reporting remain in the timed API TODO.
