# 2A03 Synth: FM2612 common-feature alignment

Recorded: 2026-11-19; workspace implementation updated 2026-11-21.
The original audit is historical; verified changes are recorded below.

The agreed first sequence is **HuC6280 → SPU → DMG → SID**. 2A03 is an
follow-up candidate, now authorized in the NES → SNES → SCSP rollout. This inventory does not authorize every
optional feature or a release. `synth-nes` is the compatibility entry, not a
separate Synth requiring another rollout.

Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Current status

| Common feature | Audited 2A03 status |
| --- | --- |
| working/saved, Auto apply, ●, Save/Save all/Discard, accepted Code, two-version Cassette | **Missing.** [code_project.js](../synth-2a03/code_project.js) owns one filesystem and a v1 project snapshot. Ctrl/Cmd+S flushes the editor/local draft; it is not an accepted-content boundary. |
| Active instrument file linked to knob/wave/JSON editing | **Partial.** JSON selection applies a sound, and JSON can be edited in Code. [code_files.js](../synth-2a03/code_files.js) `saveSound()` adds a new instrument; `markSoundDirty()` updates project settings, not the selected JSON. |
| Files Undo, New Cassette and replacement recovery | **Partial.** Validated import/restore and local recovery exist. There is no FM-style Files Undo history or New Cassette workflow in the current Files adapter. DMC edit Undo is a different feature. |
| Persistent expanded Code workspace, chip/Mixer/Keyboard tabs, header Code/Synth, visible Master | **Present (2026-11-21).** Header Code/Synth and persistent Code / 2A03 + FDS / Keyboard use the common expanded-tab helper. Master and collapsible reference playback stay visible above Files/main; runtime and editor models are preserved. |
| Brief Live changed-value highlights, default On and switchable | **Missing.** [index.html](../synth-2a03/index.html) has Auto update and channel following, not a changed-value highlighter. |
| Output-only channel switches shared by Keyboard, Code and song | **Missing UI/integration.** There is no common six-channel Mixer. [song_player.js](../synth-2a03/song_player.js) has reference-player channel switching primitives; selecting a CH or disabling a hardware voice is not equivalent to output-only mute. |
| PCM drawing and Start/Loop range editing | **Chip-specific / already different.** [dmc_editor.js](../synth-2a03/dmc_editor.js) already edits DPCM bits and draws target DAC curves with Undo; FDS wave drawing also exists. RF5C164 PCM byte/range semantics must not be copied into DMC. |
| Looper / Event Rec | **Not implemented; optional.** No equivalent recording UI is present. This is not required for the first saving/layout rollout. |
| Timed build/schedule/compile/capture-state API | **Present for Pulse/Triangle/Noise and prepared DMC (2026-11-21).** Recorder/compiler, detached snapshots, AudioWorklet scheduling and Code lifecycle are connected. DMC memory/FDS and Native execution remain follow-ups. [Verification](todo_2a03_timed_register_api_20261121.md). |

## First implementation candidate: saving and Files

- [ ] Reuse the shared Virtual Files working/saved workspace. Migrate existing
      v1 snapshots without losing DMC payloads, FDS modulation tables, VGM bytes,
      metadata, text files, selection or the current instrument.
- [ ] Add Auto apply **On by default**, filename ●, Save, Save all and Discard;
      route Ctrl/Cmd+S to the selected/last-edited file without stealing note input.
- [ ] Link authored controls and DMC/FDS edits to their instrument file. Define
      validation of temporarily incomplete JSON before automatic sound changes;
      malformed edits must preserve the previously playable sound.
- [ ] With Auto apply Off, defer authored sound changes until Save. Physical CH
      edits remain direct; Code continues running. Run/Apply reads accepted
      entry/modules/data; saving JavaScript never executes it.
- [ ] Export ordinary **saved** files plus recoverable **working differences**;
      restore both versions and the mode. Avoid duplicating unchanged DPCM/audio.
- [ ] Add bounded Files Undo and a New Cassette workflow with starter Code and
      examples. Import/New/Undo must restore the two versions coherently and
      never execute restored scripts.

## Subsequent UI candidates

- [x] Adopt persistent expanded Code/chip/Keyboard navigation and header
      Code/Synth controls. Mixer remains separate. Keep
      Run/Apply/Stop and Master usable without changing the active performance.
- [ ] Add switchable Live changed-value highlights, default On; keep Auto update
      and its frozen-view semantics separate.
- [ ] Consider one shared output-only six-channel Mixer for Keyboard/Code/VGM.
      Muting must not alter hardware registers, DMC progress or FDS modulation.

## Optional work requiring a separate decision

- [ ] Decide whether Looper or Event Rec is useful here before implementing it.
- [ ] Evaluate timed operations as a separate chip-API design; do not substitute
      `setTimeout()` for an AudioWorklet sample-clock execution path.
- [ ] If additional sample tools are wanted, retain LSB-first DPCM, ±2 DAC steps,
      initial-level parity and aligned sample-length constraints. Do not label
      existing DMC drawing as missing PCM conversion or add conversion implicitly.

## Completion checks for a future implementation

- [ ] Cover text/binary Save/Discard, atomic invalid edits, rename/delete,
      import/New/Undo, reload and failed IndexedDB writes; recovery must preserve
      working and saved independently rather than silently accepting a draft.
- [ ] Use self-authored DMC/FDS fixtures and actual Worklet output with physical
      speaker gain zero. Check continuing Code, key ownership and raw hardware
      gates; preserve the existing software click guard.
- [ ] Verify source and readable standalone ZIP in Chromium/WebKit, fallback and
      real Monaco, normal/expanded 390px layouts and shortcuts. Keep native
      formats and chip limits intact; do not change calibration to match FM.
- [ ] Update existing 2A03 documentation and record automated results separately
      from human listening. Commit/push/npm/tag/Tauri/release need their own task.

## Timed register API follow-up

Pulse/Triangle/Noise and prepared DMC playback are implemented; separate the remaining DMC memory/FDS chip-level work from Files/UI alignment.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [x] Preserve pulse/triangle/noise, shared enables, length/envelope/retrigger writes and NES register side effects.
- [ ] Scope DMC sample memory and FDS Wave/modulation RAM separately; hardware frame sequencing is not a substitute for sample-clock reservations.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to this chip when the work is authorized.

## Authorized rollout — 2026-11-21

User selected NES → SNES → SCSP for the remaining workspace and timed-API ports.
Work in bounded slices; do not imply ordinary Code performance is timed scheduling.

- [x] First: header Code/Synth, persistent expanded Code / 2A03 + FDS / Keyboard
      navigation, visible original Master and collapsible reference playback above
      both Files and main. Preserve Code context/client/model, song transport,
      instrument selection and keyboard note ownership during layout changes.
- [x] Validate source/readable ZIP in muted Chromium/WebKit, fallback and Monaco,
      desktop/mobile, existing Code/keyboard/song flow and relevant regressions.
- [x] Next: implement the first Pulse/Triangle/Noise timed API slice. DMC/FDS remain separately tracked. Keep
      memory transfers, FDS RAM semantics, raw gates and click guards explicit.

No Looper/Event Rec, Live highlighting, Files migration or new mixer is included
in the first workspace slice. No npm/Tauri/publication/commit/push is requested.

Workspace verification: 273 NES regressions and 11 common expanded-workspace
checks passed. Source and readable ZIP pass physically muted Chromium/WebKit
with fallback and real local Monaco, including ongoing six-channel Code audio,
manual edits/notes, retained session/context/client/model, instrument loading,
transport/Master visibility, 1240px/390px layouts and Files/tab alignment.
Human listening and device tests remain pending. Timed API is the next task,
not part of this UI port.
[Evidence](verification_2a03_code_workspace_20261121.json).

Timed first slice is verified: [implementation and remaining work](todo_2a03_timed_register_api_20261121.md).
The borrowed Synth client explicitly rejects incomplete `client` snapshots;
current/reset/reused snapshots are supported without stopping audio.

- [x] Prepared DMC timed playback, detached selection, ownership and optional
      standalone click guard. [Verification](verification_2a03_dmc_timed_20261121.json).
