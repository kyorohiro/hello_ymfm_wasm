# SPU Synth: FM2612 interaction alignment

Audit date: 2026-11-19. Documentation and planning only; this file does not
authorize runtime changes, publication, or every optional feature below.
User order: **HuC6280 → SPU → DMG → SID**. SPU is second.
Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Audited status

“Missing” means missing the stated FM2612 interaction, not missing all related
functionality. Chip-specific behavior and file formats must remain independent.

| Comparison item | SPU status and evidence |
| --- | --- |
| working/saved and Save controls | Missing. [code_project.js](../synth-spu/code_project.js) has one `fs` and a v1 filesystem snapshot. No Auto apply, dirty dots, Save all/Discard or dual-version Cassette. Ctrl/Cmd+S already flushes Code/local storage; it is not the new accepted-content Save. |
| Active instrument file ↔ controls/JSON | Partial. Selecting SPU JSON/VAB loads sound; JSON opens in shared Code without forcing Keyboard into Code. `markSoundDirty()` clears the applied-file identity; `saveSound()` creates a unique new `.spu.json` rather than updating the selected document ([code_files.js](../synth-spu/code_files.js)). |
| Files Undo / New / import recovery | Partial. Atomic project import and local recovery exist. No FM2612-style Files history or New Cassette workflow is mounted in [index.html](../synth-spu/index.html) / `code_files.js`. |
| Persistent expanded Code workspace | Partial. Maximize and Keyboard/Code already exist. [code_host.js](../synth-spu/code_host.js) does not install persistent expansion or the unified Code/chip/Mixer/Keyboard tabs and header Code/Synth switch. Keep Master reachable in either layout. |
| Live changed-value highlighting | Missing. CH observation/activity and Live following exist; these are not value-change flashes with a separate On/Off option. |
| Shared channel output switches | Missing as a common Keyboard/Code/PSF output policy. PSF's 24-CH activity indicators are observations, not output toggles. Keep shared Noise, reverb and PMON processing active when output is muted. |
| PCM drawing / sample range | Already substantial: [README](../synth-spu/README.md) documents full imported ADPCM drawing, zoom, numeric sample edits and loop preservation. Arbitrary Start/Loop Start/End editing equivalent to RF5C164 is not established; assess separately rather than duplicating RF5C164 registers. |
| Looper / Event Rec | Missing; optional backlog, not required for saving/layout alignment. |
| Timed build/schedule/compile/snapshots | Missing the YM2612-style timed-operation API. Existing immediate SPU APIs and ordinary live loops remain usable; this needs a separate chip API design. |

## Proposed implementation phases

- [ ] Adopt the reusable two-version Virtual Files workspace; migrate existing
      SPU projects without rewriting VAB/VH/VB, PSF sets or unrelated files.
- [ ] Add Auto apply (default On), Files **●**, Save / Save all / Discard and
      Ctrl/Cmd+S. Save accepts content in memory; storage durability remains a
      separate result and failures retain exportable data.
- [ ] Link the active editable instrument to knobs, PCM drawing and JSON edits.
      Keep native VAB sources and bank identity intact; explicitly determine
      the editable JSON target instead of silently overwriting an original bank.
- [ ] With Auto apply Off, keep drafts out of playback until Save. Validated
      instrument changes apply while Code continues; incomplete JSON stays
      editable and does not replace a valid sound. Save never executes Code.
- [ ] Make explicit Run/Apply read the saved entry, dynamic modules and data.
      Preserve physical-CH direct edits, raw KON/KOFF, ownership and click guard.
- [ ] Retain working and saved across selection, rename/delete, Undo, New,
      import and reload. Export ordinary saved files plus working recovery
      differences, without duplicating unchanged sample/bank bytes.
- [ ] Add Files operation history and a reviewable New Cassette workflow;
      preserve Code/song retirement and failed-import rollback.
- [ ] Add persistent expanded navigation, header Code/Synth and visible Master.
      Use SPU's PCM/ADSR/FX/PSF views; do not invent FM chip tabs or a Mixer
      panel merely to copy the reference layout.
- [ ] Add optional Live value-change highlighting, default On, with an Off
      switch; keep activity, Live following and change highlighting distinct.

## Later decisions, not automatic implementation

- [ ] Decide whether common output-only channel switches belong in a new
      SPU Mixer; do not implement them as KOFF or destructive voice-volume edits.
- [ ] Assess sample/loop range editing while preserving original ADPCM length,
      repeat-address rules, PSF capture, RAM bounds and large Software audio.
- [ ] Reconsider Looper/Event Rec only after separate user prioritization.
- [ ] Design timed register operations separately; keep existing immediate
      methods, chip-specific register semantics and raw keyOff behavior.

## Required verification when implementation starts

- [ ] Test SPU JSON, native bank files, paired VH/VB, long samples and legacy
      snapshots; cover invalid JSON, size limits, rename collisions and atomic
      rejection. Original bytes and unchanged sample data must survive.
- [ ] Test manual/automatic saving during Code and PSF observation/Capture;
      preserve song position, PMON/Noise/reverb and later-writer ownership.
- [ ] Test both versions through local draft/journal recovery, quota failures,
      export/import, Undo/New and Monaco model switching without autorun.
- [ ] Check source and readable standalone ZIP in muted Chromium/WebKit,
      fallback editor and real Monaco, desktop/mobile and expanded navigation.
      Use numeric audio measurements; do not claim human listening occurred.

Related history: [Files/Capture](todo_spu_files_capture_resume_01.md),
[Code/Files](todo_spu_synth_code_files_live_01.md),
[loaded sample editor](todo_spu_loaded_tone_pcm_morph_01.md).
