# SCSP DSP draft / Check / Apply — 2026-11-17

User approved editing, checking and explicit Apply while keeping the current
sound during editing / validation, applying only a valid program, and retaining
the old program on failure. First execution profile keeps the existing Delay's
coefficient tables, packed-format 64 KiB ring and EFREG0 routing.

- [x] Add shared pure source Check / execution-profile validation with line /
  physical-step errors. Keep the lossless assembler's broader bit codec intact.
- [x] Add a synchronous Worklet-side transactional MPRO replacement with fresh
  validation, rollback on failure, exact Start-word handling and no voice reset.
- [x] Keep coefficient / address tables and PCM allocations unchanged. Successful
  changed Apply clears DSP ring tails; unchanged Apply is a no-op. Failed Apply
  restores the prior program / ring / return before rendering can resume.
- [x] Retain an applied program over Stop / mode changes / preset loads within
  the Synth instance; transfer a cold-applied program during audio startup.
  Keep Code sessions and the separate SSF / audition DSP unaffected.
- [x] Add draft editor, Check, canonical preview, Apply, Reset draft, and an
  explicit applied-program status. Copy / Save preserve the draft, including
  errors. Store draft text only; restoring a draft must never auto-apply it.
- [x] Validate UI / processor / backend with real shipped WASM, injected failures,
  source and isolated package browsers with physical output permanently muted.
- [x] Refresh cache graph / readable assets, retain calibration evidence, and
  record actual validation, semantics, limitations and restart information.

No public npm DSP API, SDK / WASM rebuild, all-chip abstraction, custom
coefficient / RAM-layout editor, SSF-program editing, commit, push or publication.
Portable voice presets keep their current format; DSP source is exported
separately. Any first-profile execution restriction must be explained in UI/help.

## Execution-profile direction

The lossless codec still preserves all bits for inspection. Execution rejects
uninterpreted RAW bits, unsupported IRA values, even-step RAM I/O, TABLE mode,
non-packed RAM mode, coefficient indices outside 0..2, memory-address indices
outside 0..1 when used, and effect outputs other than EFREG0. Ring base / length
remain the existing configuration. Validation is repeated in the audio owner.

The display must distinguish draft / checked preview / applied program; the
existing six-role narrative remains a clearly labelled built-in reference,
because arbitrary field edits can change a step's meaning.

## Completed / restart

Open **DSP → edit → Check → Apply to Synth**. Only changed Apply clears the wet
ring; held Keyboard / Code voices continue. Reset draft does not apply until
Check / Apply. Cold Apply transfers at audio startup. Saved text is never
auto-applied; keep a separate `.scspasm` because voice presets / Cassettes do not
include this source. Fatal restoration failure stops audio rather than resuming
an inconsistent owner; normal rejected / recoverably failed Apply keeps sound.

SCSP suite 221/221 and assembler / CLI 12/12 pass. Source and final isolated ZIP
pass Chromium / WebKit (13 scenarios each, 52 across both roots), including
pending Apply / newer checked-draft races. The older reference / export browser
regression also passes. All physical outputs were permanently muted. Both
calibration checks pass with existing measurements / gains unchanged.

Local ZIP: `release/tetorica_scsp_synth_dsp-edit-apply-20261117-r2_itch.zip`.
See [verification](verification_scsp_dsp_edit_apply_20261117.md) and
[machine evidence](verification_scsp_dsp_edit_apply_20261117.json).
No commit / push / publication. Subsequent work can choose a small additional
effect example or coefficient editing; no API expansion is decided here.

The bounded [live COEF0–2 follow-up](todo_scsp_dsp_coefficients_20261117.md)
adds signed coefficient controls synchronized with Feedback, without expanding
the executable program profile or changing portable format shapes.
