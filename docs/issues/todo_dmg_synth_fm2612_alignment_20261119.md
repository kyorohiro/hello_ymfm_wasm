# DMG Synth: FM2612 interaction alignment

Audit date: 2026-11-19. Documentation and planning only; optional rows are not
blanket implementation approval. User order: **HuC6280 → SPU → DMG → SID**.
DMG is third. `synth-gameboy` is an alias, not another independent Synth TODO.
Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Audited status

| Comparison item | DMG status and evidence |
| --- | --- |
| working/saved and Save controls | Missing. [code_project.js](../synth-dmg/code_project.js) retains one filesystem and current settings in a v1 snapshot. Existing Code flush/Ctrl+S is not accepted-content Save. No Auto apply, Files dots, Save all/Discard or dual-version Cassette. |
| Active instrument file ↔ controls/JSON | Partial. JSON selection applies a sound and can open in Code without forcing the input view. `markSoundDirty()` updates current settings and clears the applied preset; `saveSound()` creates a new unique `.dmg.json` ([code_files.js](../synth-dmg/code_files.js)). Controls do not update the selected instrument document. |
| Files Undo / New / import recovery | Partial. Import/export, local recovery and validated replacement exist. No FM2612-style Files Undo/history or New Cassette workflow was found in `code_files.js` / [index.html](../synth-dmg/index.html). |
| Persistent expanded Code workspace | Partial. Code maximize exists, but [code_host.js](../synth-dmg/code_host.js) does not install persistent expansion, unified navigation or header Code/Synth switching. Master should remain available during expansion. |
| Live changed-value highlighting | Missing. Auto update and same-CH display/edit/keyboard already exist; these do not highlight changed values briefly. |
| Shared channel output switches | Partial. Four software song switches exist in [song_preview.js](../synth-dmg/song_preview.js); keys intervening in a playing song share that reference APU's mute. Normal keyboard/Code APU output does not share these switches. Hardware stereo routing is separate. |
| PCM drawing / Start / Loop range | Not applicable as RF5C164-style PCM editing. DMG CH3 is finite 32-nibble Wave RAM, already drawable. It is not a general variable-length sample bank, and CH4 Noise is not pitched PCM. |
| Looper / Event Rec | Missing; optional backlog. Previous DMG Code/song work explicitly excluded these. |
| Timed build/schedule/compile/snapshots | Missing the YM2612-style timed-operation API. Existing immediate APU APIs/live loops are present; any timed API is a separate chip-level design. |

## Proposed implementation phases

- [ ] Migrate to the shared working/saved workspace while retaining v1 projects,
      source VGM/VGZ, original JSON bytes, unrelated text and opaque files.
- [ ] Add Auto apply (default On), Files **●**, Save / Save all / Discard and
      Ctrl/Cmd+S; distinguish accepted buffers from successful local storage.
- [ ] Link the selected editable preset to knobs and CH3 Wave drawing. Preserve
      existing per-CH session settings; selecting Auto alone must not unify them.
- [ ] Define valid JSON application without losing unfinished edits. With Auto
      apply Off, working edits do not change the sound until Save. Save never
      runs Code; explicit Run/Apply reads saved source, imports and local data.
- [ ] Save/restore both versions through file selection, rename/delete, Undo,
      New, import and reload. Cassette normal files contain saved content and
      recovery metadata contains working differences without redundant binaries.
- [ ] Add Files history and New Cassette rollback, keeping project replacement
      separate from ordinary sound/file editing and explicit Code Run/Apply.
- [ ] Add persistent expanded Code / APU / Keyboard navigation and header
      Code/Synth controls. Design a Mixer tab only with its actual output policy;
      keep Master visible rather than copying Genesis-specific source tabs.
- [ ] Add Live value-change highlighting with independent On/Off, default On.

## Later decisions, not automatic implementation

- [ ] Unify four output-only channel switches across normal keyboard, Code and
      VGM. Muting must not change NR51 routing, channel enable/DAC state,
      Envelope, Sweep, Wave RAM or Noise sequence.
- [ ] Consider Looper/Event Rec separately; avoid adding a sequencer as an
      assumed part of this alignment.
- [ ] Consider timed operations separately, including Wave RAM constraints,
      packed register companions and trigger writes. Keep raw trigger/keyOff
      behavior and ordinary immediate methods unchanged.

## Required verification when implementation starts

- [ ] Test Pulse, CH1 Sweep, CH3 Wave, Noise and mixed physical-CH settings.
      Hardware sweep must retain its CH1 allocation rules.
- [ ] Test active document edits, invalid JSON and legacy presets, simultaneous
      manual/Code or manual/VGM use, later-write ownership and view changes.
      Keep Code and song execution mutually exclusive.
- [ ] Test dirty markers, shortcuts, current/all/discard, Undo/New, both versions
      through local journal/quota recovery and Cassette roundtrips; restoration
      must not run Code or start audio.
- [ ] Verify source and readable ZIP with muted Chromium/WebKit, fallback and
      real Monaco, mobile/desktop resize and expanded navigation. Use measured
      output; do not alter the existing mixer/gain policy without evidence.

Related history: [Code/Files](todo_dmg_synth_code_files_live_01.md),
[unified CH controls](todo_dmg_synth_unified_channel_01.md),
[manual VGM interaction](todo_dmg_synth_vgm_manual_01.md),
[song output switches](todo_dmg_synth_song_channels_01.md).

## Timed register API follow-up

Not implemented; separate chip-level API work from Files/UI alignment.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [ ] Resolve packed Tone/Sweep/Envelope/Noise/routing fields and preserve repeated trigger writes, channel power and shared APU state.
- [ ] Define Wave RAM access restrictions and state needed for resolution; distinguish the hardware frame sequencer from host reservations.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.
