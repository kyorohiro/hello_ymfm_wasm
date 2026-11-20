# ASWAN Synth: FM2612 common-feature alignment

Recorded: 2026-11-19. The initial table is a source audit. Implementation and
automated verification started on 2026-11-20 as recorded below; human listening
is separate.

The original sequence was **HuC6280 → SPU → DMG → SID**. On 2026-11-20,
ASWAN was selected as the next alignment target after SPU. Missing entries
below are not a commitment to implement every optional feature.

## Saving rollout (2026-11-20)

The first slice added the shared working/saved workspace, atomic Save/Discard,
v1 migration, saved Code readers and a v2 Cassette containing saved files plus
working differences. The second slice connects the Files controls and active
sound acceptance, and switches Run/Apply to saved-only readers.
No timed API, recording or audio gain changes in this rollout.

### Files UI integration (implemented)

Connect Auto apply (default On), dirty dots, Save/Save all/Discard/Discard all
and Cmd/Ctrl+S. Bind authored Auto controls/waves/valid JSON to an active sound
document; manual mode retains an accepted audible sound until Save. Physical
CH edits remain direct. Run/Apply reads accepted entries, modules and data.
Preserve running Code, VGM/Capture, invalid JSON drafts, rename/delete recovery
and the two-version Cassette. Do not add Undo/New/layout or timed operations in
this slice. Verify with speakers muted.

- [x] Implement and test the project data layer and legacy migration.
- [x] Verify existing Files/Capture/source-import behavior with Auto apply On.
- [x] Connect Auto apply/Save/Discard UI, active sound documents and saved
      Run/Apply together.

Implemented in this slice: `savedFs`, `workspace`, `setAutoApply`, dirty-path
queries, atomic Save/Discard, saved entry/module/data readers, v1 local/ZIP
migration and v2 ZIP export/import. Shared editor crash-journal recovery keeps
working and accepted Code separate. Auto apply remains On by default; the
Files checkbox and Save/Discard controls now expose manual acceptance. `saved`
means accepted content in memory, not proof of a successful IndexedDB/disk write.

Automated checks (2026-11-20):

- `npm run test:aswan-synth`: **179 passed**, including readable ZIP packaging,
  legacy migration, byte-exact source retention, saved entry/modules/data,
  invalid recovery rejection and pending Code journal recovery.
- `node scripts/check_aswan_synth_browser.cjs`: Chromium and WebKit passed
  against source and a generated standalone ZIP, with physical outputs muted.
  Existing keyboard/Code, Capture, reference playback, channel edits, highlight
  and Mixer behavior were checked. No human listening was performed.

Second-slice verification: `npm run test:aswan-synth` **189 passed**, including
manual Save/Discard, binary/folder rename recovery, malformed JSON, rejected
sound acceptance, old-v2 cache migration, PCM manifest aliasing and pending
checkbox state. Chromium and WebKit source checks passed with physical output
muted: manual sound drafts, Cmd/Ctrl+S, saved Code Run/Apply, Save not executing
or retiring Code, physical CH editing, and existing VGM/Capture/Mixer/Live.
A standalone readable ZIP also passed the same Chromium/WebKit browser suite. No
commit/push/npm/Tauri/release was performed by this task.

Reference: [FM2612 working/saved implementation](todo_fm2612_working_saved_20261119.md).

## Current status

| Common feature | Audited ASWAN status |
| --- | --- |
| working/saved, Auto apply, ●, Save/Save all/Discard, accepted Code, two-version Cassette | **Implemented.** Shared workspace, v1→v2 migration, Files Auto apply/●/Save/Discard, saved Code entry/modules/data and two-version Cassette export/import. |
| Active instrument file linked to knob/wave/JSON editing | **Implemented for authored Auto.** Selecting a sound links its document; controls/waves/valid JSON follow Auto apply. First Auto edits create a document. Physical CH edits stay direct and do not rewrite the Auto sound file. Incomplete JSON is retained and protected from knob overwrites. |
| Files Undo, New Cassette and replacement recovery | **Partial.** Validated imports and recovery exist; Capture transactionally keeps the previous and captured sounds. New Cassette now has confirmation, optional dual-version backup and rollback. General Files Undo remains a separate follow-up. |
| Persistent expanded Code workspace, chip/Mixer/Keyboard tabs, header Code/Synth, visible Master | **Implemented.** Code/ASWAN/Mixer/Keyboard share the expanded workspace, header Code/Synth changes layout, and the original Master and transport remain available. Expansion is retained across tabs; no new reload preference is added. |
| Brief Live changed-value highlights, default On and switchable | **Implemented.** [live_highlight.js](../synth-aswan/live_highlight.js), [synth.js](../synth-aswan/synth.js) and `aswanHighlightEnabled` in [index.html](../synth-aswan/index.html) follow VGM/Code, default On and retain a preference. Preserve this feature rather than adding a second highlighter. |
| Output-only channel switches shared by Keyboard, Code and song | **Implemented.** `aswanMixerChannels` applies four output switches to the instrument endpoint and reference player; Code uses that same instrument. Chip volume and final Master are separate. |
| PCM drawing and Start/Loop range editing | **Partial / software extension.** [editor.js](../synth-aswan/editor.js) already draws the 32-point 4-bit Wave RAM. Voice PCM has audio import, sample rate, Root and Loop, but no RF5C164-style full-sample draw/Start/Loop range editor. |
| Looper / Event Rec | **Not implemented; optional.** No equivalent recording UI is present; not required for the initial saving/layout rollout. |
| Timed build/schedule/compile/capture-state API | **Separate proposal.** Not wired through the ASWAN Code host. Existing hardware sweep/noise and software Voice PCM supply are not this reservation API. |

## First implementation candidate: saving and Files

- [x] Reuse the shared working/saved workspace and migrate v1 projects without
      losing Wave/Noise/Sweep/Voice settings, PCM payloads, source VGM/VGZ,
      captured sounds, metadata, editor selection or Code.
- [x] Add Auto apply **On by default**, filename ●, Save, Save all and Discard;
      make Ctrl/Cmd+S save the selected/last-edited document and return pointer
      controls to performance focus.
- [x] Link authored controls, drawn waves and valid JSON editing to the active
      sound file. Retain safe behavior while JSON is incomplete or malformed.
- [x] With Auto apply Off, apply authored edits at Save without retiring Code.
      Physical CH edits remain direct. Run/Apply uses saved entry/modules/data;
      saving source never runs it.
- [x] Cassette export must include ordinary **saved** files and recoverable
      **working differences**, preserving mode and both versions on import.
      Do not duplicate unchanged PCM/source files.
- [ ] Add bounded Files Undo (separate follow-up).
- [x] Add New Cassette with the original starter Code and default sound.
      Preserve the existing two-sound Capture safety and never auto-run restored Code.

### New Cassette slice (2026-11-20)

Add Menu → New → Cassette · ZIP above Import. Offer Cancel, Export current &
create, and Create without export. Prepare defaults before stopping anything;
the backup contains saved files and working differences. Reset Files/VGM sources,
sound selection and Code to a fresh `/index.js`, keeping the Auto apply preference
and host Master/layout preferences. Stop Code/song/keys only after a requested
backup succeeds. Failed/cancelled initialization restores the previous project,
accepted sound, working draft, identity and editor selection; do not restart its
performance automatically. Block duplicate requests and late/disposed commits.
No general Undo, new examples, timed API, npm or release work in this slice.

Implemented: detached `prepareNew()` uses the original starter and accepts a
clean default project before any owner is retired. New uses a memory-only Code
flush so a full browser store does not prevent an optional ZIP backup. Only a
successful sound/editor replacement enables persistence for the fresh identity.
Pending resets are single-flight; cancellation/disposal cannot publish a late
starter or overwrite restored Code with a retired editor model. Dialog typing
and locked main controls cannot acquire new keyboard notes. Successful New
cancels old VGM imports and clears the temporary extracted-sound buttons too.

Verification: `npm run test:aswan-synth` **206 passed**, including creation,
dual-version/raw-source backup, backup rejection/cancellation, invalid starter,
failed native/editor restoration, cancellation during Apply, storage failure,
duplicate requests, disposal and keyboard locking. Source Chromium/WebKit New
checks passed with physical outputs muted. A readable standalone ZIP passed
the same suite, including 390px confirmation and creating before Enable
without an AudioContext. No human listening, push, tag, npm or Tauri release.

## Subsequent UI candidates and preservation

### Expanded layout slice (2026-11-20)

Reuse the existing shared expanded-tab controller for Code / ASWAN / Mixer /
Keyboard. Keep expansion while choosing any view; add the header Code/Synth
layout choice beside Files. Move the existing Master and Run/Apply/Stop into
expanded workspace slots without recreating controls or changing audio owners.
Restoring Synth returns controls to their original places. Add arrow/Home/End
navigation and verify 390px/desktop layout, saved/draft files and running Code
and VGM with physical output muted. Expansion persistence here means keeping
the layout across tab changes, not adding a new browser-storage preference.
Do not add New Cassette, timed APIs or recording in this slice.

- [x] Adopt persistent expanded ASWAN/Mixer/Keyboard/Code tabs and a header
      Code/Synth switch, with Master and Run/Apply/Stop always reachable.

Implementation reuses `setupSynthExpandedTabs` with attached ASWAN editor,
chip tabs and Master element overrides. Existing default FM/SPU/HuC6280
behavior is retained. The input-tab heading has its own wrapper so hiding the
old heading does not hide the keyboard/Code section. Hidden expanded views
clear Live highlights; switching views never runs Code or changes audio owners.

Validation: **239 tests passed** (189 ASWAN/package and 50 shared Code/tab
controls). Chromium and WebKit source checks passed with physical outputs
muted: Code session identity, Master identity/value/listeners, tab order,
arrow/End navigation, desktop/390px screenshots, restore to the last chip tab,
saved/draft Files, and continuing VGM playback through header Code and chip
views. Real Monaco loading and human listening were not part of these checks;
the browser runner uses the textarea fallback. A readable standalone ZIP is
also verified with the same browser suite. No release/push/npm/Tauri action.
The Code highlight assertion first waits for awaited initialization writes to
reach the hardware and Live controls, then checks the loop's left-only motion;
an intermediate initialization poll is not an unchanged-field regression.
- [ ] Regression-check the **existing** Live highlight preference across
      selection, pause/freeze, manual edits, project replacement and new layout.
- [ ] Regression-check the **existing** shared four-channel output Mixer;
      muted sources must retain sweep/noise/Voice state and reference timing.

## Optional work requiring a separate decision

- [ ] Decide whether to add a full Voice PCM sample/range editor. This would be
      a software tool supplying the CH2 DAC; it must not imply extra hardware
      polyphony, HyperVoice, DMA or FM2612/RF5C164 register compatibility.
- [ ] Decide whether Looper/Event Rec is useful before adding recording.
- [x] Implement the bounded timed parameter slice below, keeping immediate calls
      intact and using sample-clock execution rather than JS timeout emulation.

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

Implemented (2026-11-20): first ASWAN Synth Web Audio parameter slice.
- [x] Record/compile/capture/schedule `setVolume`, `setPan`, `setFrequency`,
      `setNote`, `setNoise`, `setSweep`; retain immediate melody/key calls.
- [x] Reuse WonderSwanSynth conversion, Performance Queue and Code transactions;
      resolve packed R90 updates at execution, preserve voices and manual edits.
- [x] Verify atomic replace/cancel, Stop/Apply/loop ownership, snapshot reuse,
      actual 44.1/48 kHz rendering, declarations and a Files example.
- [x] Verify muted source/readable-ZIP browsers and document backend limits.

Later scope (not implied by this first slice): scheduled gate operations with
software-envelope ownership, Playground/npm factory integration, direct Native
API, Wave RAM transfer and Voice PCM feeding.
Follow the [shared timed-API contract](todo_synth_timed_register_api_20261119.md).

- [x] Resolve stereo volume/pan, frequency/note and shared Sweep/Noise controls
      with execution-time R90 merges and hardware event ordering.
- [ ] Extend scheduled gate/note operations with explicit software-envelope and
      per-loop note ownership; then evaluate general Playground/npm integration.
- [ ] Scope Wave RAM transfer and software Voice PCM feeding explicitly; keep reservation execution independent from JS timers.
- [ ] Apply the shared compilation/snapshot, ownership, atomicity, type/example
  and 44.1/48 kHz verification checklist to future expanded scopes as well.

### First-slice verification

- `npm run test:aswan-synth`: 218 tests passed, including actual WASM at 44.1/48
  kHz, mixed second/sample offsets, fractional-period repeats without cumulative
  rounding drift, shared-register preservation, compile/live trace agreement,
  detached reusable snapshots and explicit incomplete-client rejection.
- Actual Code runtime: Run/Apply stages and commits, failed Apply retains the
  old reservation, loop cancellation leaves another loop running, Stop/new
  leases clear reservations and reject stale requests. Existing held voice and
  software-envelope ownership are retained by parameter edits.
- CH2 volume/pan rejects Voice mode because R89 becomes a DAC byte; a mode
  conflict discovered after admission reports a recoverable pattern error.
- Compilation uses one scratch WonderSwanSynth per pass; it does not copy
  16 KiB of RAM for every operation or reproduce high-level register math.
- Fresh app projects and New Cassette seed `examples/timed-motion.js`; restored
  projects and deliberately removed files are left alone. Declarations cover
  the six supported operation methods and reject out-of-scope gates/RAM.
- Public factory/npm, direct Native API, scheduled gates, Wave RAM and PCM
  feeding are not completed by this Synth-scoped slice. Human listening remains
  separate. No npm publication, release, commit, push or Tauri import performed.
- Source and readable standalone ZIP both passed the muted Chromium/WebKit
  runner, including scheduled stereo changes through the real audio route,
  same-lease Apply replacement, Stop cancellation and the fresh Files example.
  All physical destinations were forced through zero gain before audio startup.
  Real Monaco CDN loading and human listening were not checked. Temporary test
  ZIPs/receipts were written under `/tmp`; the user's release directory was not
  replaced. Existing shared runtime/core artifacts and calibration were unchanged.
