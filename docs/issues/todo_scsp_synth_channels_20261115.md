# SCSP Auto / physical channel workspace

Requested 2026-11-15. Put Auto / CH1–CH32 below the SCSP tab, matching the
other Synths and making Code's physical slot allocation visible.

- [x] Add one permanent channel selector and compact requested-gate activity.
      Selecting a tab only changes the inspected target.
- [x] Keep Auto's existing A–F PCM / FM templates and grouped keyboard / Code
      allocation. Auto may overwrite manually edited physical slots when it
      reuses them; do not infer protection from audibility or reserve channels.
- [x] Let a selected physical CH show / edit its own PCM, Envelope, LFO, mix,
      frequency and sound-stack modulation, and play that CH on the keyboard.
- [x] Keep Code running while switching targets or editing a physical CH.
      Retain the current logical performance-lane API and show the physical
      destination rather than silently changing existing programs.
- [x] Integrate SSF slot selection into the same CH row, retaining Live,
      paused audition, reference key, Capture and transport position.
- [x] Preserve authored drafts across view changes. Keep Auto grouped preset
      / Files behavior explicit; direct runtime CH overrides are not silently
      presented as the saved six-source Auto instrument.
- [x] Validate last-write-wins Auto reuse, pending key release / stale owners,
      modulator silent output, empty slots and invalid-edit preservation.
- [x] Verify actual WASM and packaged Chromium / WebKit behavior with physical
      output muted, then update guide / CI / handoff notes.

Implementation notes: the present Auto instrument uses physical CH1–CH6 as
A–F editing sources and allocates its grouped notes over CH7–CH32. A physical
CH tab addresses a real slot; Code CH1 is currently a logical performance lane
and may map to physical CH7. That distinction must be visible and documented.
DSP programming, Tauri and publication are outside this task.

## Implementation / recovery notes

- Physical slot controls use internal Worklet commands on the same authored
  SCSP. They do not add a raw-slot API to scoped Code: `noteOn(CH1, ...)`
  retains its logical lane, and the row displays its allocated physical CHs.
- Auto source CH1–CH6 retain future grouped-voice validation. Physical PCM
  edits can request guard padding through MDL15. Real Auto allocation can
  replace a manual owner; stale KeyOff or Code Stop cannot silence a newer
  direct owner.
- Cold audio startup migrates the complete passive 32-slot state and RAM,
  without gates or owners. A separate draft revision repeats migration after
  any committed edit during startup, independent of saved-Auto dirty state.
  Migrated allocations stay permanent until instrument reset; editor page
  reuse metadata is not serialized.
- Unapplied PCM drawings are saved separately per Auto operator / physical
  CH. Empty-slot drafts restore without assigning a sample. The shared
  panel's narrow passive change has an exact calibration-source revision;
  the original measurement reports and native WASM remain unchanged.
- Stop all sound retains non-Auto physical settings / PCM for retriggering.
  CH7–CH32 are session edits, not a portable preset bank. Save Auto sound,
  instrument JSON and Cassette still save the six-source Auto instrument.
- SSF Live uses this same CH row. Live Off retains the selected editor CH;
  Auto explicitly returns to grouped editing. Capture returns to Auto and
  preserves paused song transport. Live activity remains native snapshot
  state, separate from authored requested gates.

## Verification

- `npm run test:scsp-synth`: 165 passed, including real native PCM / ownership,
  idle migration, physical MDL15, Worklet routing and deterministic packaging.
- SCSP runtime: 57 passed; calibration / loop-link checks: 123 passed;
  `npm run test:runtime:types` and shared navigation receipt check passed.
- Browser checks intercept every physical destination at gain zero; no
  audible listening is claimed. Tests cover the Code logical-to-physical
  mapping, direct editing without stopping Code, Auto overwrite, stale and
  pending key releases, per-target drafts, cold edits, same-row SSF audition
  / Capture, and 390px layout with Files open and closed.
- CI runs the new `test:scsp-synth:channels-browser` runner against the
  extracted standalone ZIP alongside the existing base / Code / VGM / SSF /
  Live / Capture suites in Chromium and WebKit.
- All seven browser suites passed both engines on the final 352-file ZIP.
  Channels covers eight scenario groups per engine, including a deterministic
  startup race: physical-only edits during the final Pitch ACK cause exactly
  two idle migrations and survive into the eventual Code session. Live and
  Capture passed ten and thirteen groups per engine. No page errors or missing
  assets; one AudioContext per page. Desktop / 390px captures were inspected.
- ZIP SHA-256:
  `6177b397b679a18279f13d36c4f843597d2760c515b222f0eb016fe53c2fae82`.
  Review files are under `/private/tmp/tetorica-scsp-channels-review-20261115/`;
  browser receipts are `/private/tmp/scsp-channels-zip*.json`,
  `/private/tmp/scsp-live-channels-zip.json` and
  `/private/tmp/scsp-capture-channels-zip.json`.
  Native binaries / shared gain measurements are unchanged. Nothing published.
