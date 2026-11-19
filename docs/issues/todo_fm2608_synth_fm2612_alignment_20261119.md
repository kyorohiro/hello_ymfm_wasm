# FM2608 Synth — FM2612 interaction alignment

Recorded: 2026-11-19. Documentation and source audit only; no runtime changes or
new test results are claimed here. This Synth is not yet ordered in the rollout.
The user's selected order is HuC6280 → SPU → DMG → SID. Missing items below are
candidates, not a commitment to implement every FM2612 feature.

## Current comparison

| FM2612 reference feature | FM2608 status and source evidence |
| --- | --- |
| Working/saved versions and explicit Save | **Missing.** [code_project.js](../synth-fm2608/code_project.js) uses one filesystem and a v1 settings/files snapshot. [code_files.js](../synth-fm2608/code_files.js) persists edits and supports Ctrl/Cmd+S, but has no Auto apply, file dots, Save all/Discard, saved-only execution or dual-version Cassette recovery. |
| Active instrument file linked to controls | **Partial.** JSON instruments and TFI/VGI import/export exist. `markSoundDirty()` updates project settings; `saveSound()` creates a new JSON path. Knob/sample edits are not a working version of the selected preset file. |
| Files Undo and project replacement | **Partial.** New/import preparation, validation, replacement and failure rollback exist; a user-visible Files Undo history for successful operations/New/import is absent. See [code_files.js](../synth-fm2608/code_files.js). |
| Persistent expanded Code workspace | **Partial.** Keyboard/Code and maximize exist; [code_host.js](../synth-fm2608/code_host.js) does not enable persistent expansion or the FM2612 combined expanded tab row/header Code–Synth switch. Master visibility needs checking when adopting that layout. |
| Live changed-value highlighting | **Missing.** Auto update follows selected channels, but no change-flash preference/highlighter is wired in [synth.js](../synth-fm2608/synth.js). Live following and highlighting are separate features. |
| Shared output mixer and channel switches | **Present.** FM/SSG/Rhythm/ADPCM have four independent faders and 6/3/6/1 channel switches shared by Keyboard, Code and reference playback. Preserve the recent [four-source mixer](todo_fm2608_four_source_mixer_20261119.md), YM2203 correction and VGM gain entries. |
| PCM drawing and playback-range editing | **Partial / chip-specific.** ADPCM-B drawing, WAV loading/export, Root/Rate/Repeat and software release already exist. The preset retains aligned Start/End addresses, but visible ADPCM controls lack the RF5C164-style range editor. ADPCM-B Repeat uses its selected range, not an independent RF5C164 Loop Start. See [index.html](../synth-fm2608/index.html), [preset.js](../synth-fm2608/preset.js). |
| Looper / Event Rec | **Deferred candidate.** Neither UI exists; the [guide](../synth-fm2608/README.md) explicitly defers recording. Do not add it as a prerequisite for Files/UI alignment. |
| Timed build/schedule/compile/capture API | **Separate candidate.** The YM2608 client currently exposes immediate operations, not YM2612's timed recorder/compiler contract. Existing SSG/Rhythm/ADPCM subclients must retain their own register/port semantics. |

## Proposed implementation stages

- [ ] Adopt the common Virtual Files workspace with independent working/saved
      content; migrate v1 projects without losing samples, original files or metadata.
- [ ] Add Auto apply (default On), filename ●, Save/Save all/Discard and the
      existing Ctrl/Cmd+S route. Link the selected instrument's knobs, sample
      edits and JSON editor to one working document; handle invalid JSON explicitly.
- [ ] Apply accepted sound changes through sparse writes while Code continues.
      Preserve packed-register companions, live pitch and each FM/SSG/Rhythm/
      ADPCM channel's ownership; keep raw keyOff semantics and the existing
      software noteOff fade. Save must not retrigger an unchanged SSG envelope.
- [ ] Run/Apply must read saved entry/modules/data; saving JavaScript never
      executes it. Export ordinary saved files plus versioned working differences,
      including deletions/mode/metadata, without duplicating unchanged audio.
- [ ] Preserve both layers through reload, recovery journals, selection,
      rename, import/New and reversible Files operations; distinguish accepted
      in-memory Save from durable browser storage.
- [ ] Add the persistent Code/FM/SSG/Rhythm/ADPCM/Mixer/Keyboard workspace and
      header Code–Synth switch without stopping playback; keep Master available.
- [ ] Add bounded changed-value highlighting, default On with an Off preference,
      using the existing channel display rather than changing the sound.

## Optional work requiring its own decision

- [ ] Consider an ADPCM-B Start/End editor with 32-byte alignment, predictor
      resets, original memory offsets and Repeat semantics retained. Do not
      promise lossless Saw/Square reconstruction from lossy ADPCM.
- [ ] Revisit Looper/Event Rec only after a separate product decision.
- [ ] Design timed YM2608 operations separately: share operation resolution,
      preserve partial updates and event writes, use AudioWorklet sample timing,
      and retain immediate APIs. Do not emulate timing with JavaScript timers.

## Required validation when implementation starts

- [ ] Exercise text/binary and embedded ADPCM, compound state, malformed JSON,
      atomic failure, rename, Save all/Discard, quota/reconnect and reload recovery.
- [ ] Verify Code continues during sound Save, saved-source execution, and no
      execution on Save/import/restore; retain VGM/YM2203 and mixer behavior.
- [ ] Verify real source and readable standalone ZIP in muted Chromium/WebKit,
      fallback and actual Monaco, including shortcuts, focus and desktop/390px
      resize with Code expanded/restored. Keep physical audio muted; record
      numerical verification separately from any future human listening.

Existing context: [initial Synth TODO](todo_fm2608_synth_01.md),
[ADPCM edges](todo_fm2608_adpcm_edges_20261119.md), and
[FM2612 completed saving work](todo_fm2612_working_saved_20261119.md).
No publication, Tauri import, commit, push or tag is authorized by this checklist.

## Timed register API follow-up

Not implemented; separate chip-level API work from Files/UI alignment.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [ ] Preserve FM operator packed fields and key events, shared SSG Tone/Noise/envelope state, Rhythm triggers and ADPCM-B register/port semantics.
- [ ] Scope ADPCM memory transfer separately and keep YM2203-compatible playback/mixer modes distinct from the timed API.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.
