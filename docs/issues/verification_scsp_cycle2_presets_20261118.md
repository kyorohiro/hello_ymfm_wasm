# SCSP Cycle 2OP presets and saved authoring - 2026-11-18

Base `6ca7c946bba5c8a84610dd4b3b7542e71562f89f`; initially clean worktree.
This adds the persistence part of Phase 2 of the
[bounded integration design](scsp_synth_cycle2_design_20261118.md).

Historical persistence-step record. The subsequent
[Cycle UI update](verification_scsp_cycle2_ui_20261118.md) adds selectable
controls, distinct forward/return display and a Synth example.

Cycle 2OP now saves and loads as **voice preset version 11**. It stores the
explicit two-OP Cycle/output selection, six source PCM buffers and their
options, ADSR/LFO/mix, ratios/depths, transpose and existing shared effect
settings. Runtime gates, ownership, oscillator phase and sound-stack history
are not part of a portable sound. A newly played restored preset follows the
existing four-owned-cell startup policy.

## Using it

Start a Cycle through Code or load a v11 file. The Connection selector displays
Cycle 2OP; selecting the connection directly and the distinct return-path UI
remain the next step.

- **Instrument JSON** downloads the current applied instrument as v11.
- **Files -> Save sound / Save to presets...** creates a named v11 sound in
  `presets/`; the existing preset selector applies it.
- **Export project** includes the current sound with Code/files. Local drafts
  also retain applied manual PCM/ADSR/mix/depth/ratio edits made during Cycle.
  Restoring either does not run Code or start audio.
- Code `await scsp.exportPatch()` returns the complete portable v11 object;
  `await scsp.loadPatch(preset)` validates and loads it through the existing API.

The temporary Phase-1 frozen-base cache and sound-save rejection are removed.
Applied manual changes now reach the same portable cache as other instruments.
Explicit sound saves and project export await a fresh authoring snapshot so a
pending editor update is not replaced by an older cache. A naming dialog keeps
the sound captured when it opens. If a renderer read fails, project export
still preserves Code/files with the last cached sound and reports the fallback;
an explicit sound save reports the failure instead of creating a stale preset.

Audio-error recovery retains the edited v11 sound. Reconnecting restores
requested settings/PCM without restarting Code or held voices. This does not
promise a native audio-phase checkpoint. Drawings not yet applied to PCM retain
their existing separate draft policy.

## Format and compatibility

Version 11 requires FM2, `fm.algorithm: 'cycle2'`, explicit valid
`fm.cycle2.outputs` and all six source operators. A dormant Custom graph is not
serialized in this format. Missing metadata, wrong mode/algorithm, duplicate
or invalid outputs, incomplete operators and invalid PCM reject before changing
the current sound, owned voices or RAM. V11 captures its FM input once and
checks the normalized recipe; getters cannot switch a legacy file into Cycle.

Versions 1-10 retain their existing meaning and continue to reject Cycle data,
including dormant metadata. Non-Cycle exports drop dormant Cycle metadata and
retain their previous version-selection rules. Code types include a dedicated
v11/FM2/Cycle variant while keeping those legacy discriminants.

## Verification

- **437 SCSP/package tests** pass; shared runtime TypeScript checks pass.
- Seven new real-WASM preset tests include **16 exact fresh-attack roundtrips**:
  four output choices x scalar/mixed depths x 44.1/48 kHz, with PCM8/PCM16,
  six operators' ADSR/LFO/mix and effect data. PCM, modulation control words
  and 64 stack cells match. Sample RAM addresses may relocate on loading;
  control comparisons explicitly account for those resource addresses.
- Invalid v11 and legacy Cycle aliases perform zero native writes and preserve
  current Code/manual owners and RAM. Loading during Code keeps its session and
  existing playing sample references; subsequent attacks use the loaded sound.
  Idle migration and portable restore never auto-start voices.
- **206 before/current native parity cases** cover 166 legacy fixtures and
  40 existing Cycle cases. PCM/registers/ring/write traces/requested state stay
  exact. New v11 serialization is explicitly tested separately from Phase 1's
  former export rejection; this intentional new behavior is not called equal.
- **20 browser checks** pass: Chromium/WebKit at 48 kHz, permanent physical
  mute, 112 served assets unchanged, zero page/processor/missing-asset errors.
  Actual Code/manual edits, all three sound-save entries, preset selection,
  JSON/Cassette/draft reload, no autoplay, invalid loads, ownership/Stop and
  AudioContext-close/reconnect recovery are verified through the real UI/Worklet.
- Exact predecessor source proofs retain historical JSON/pins and existing
  Mixer calibration checks. No native core/WASM/gain/default changes occur.

Evidence: `build/scsp-cycle2-presets-20261118/`. The
[machine record](verification_scsp_cycle2_presets_20261118.json) binds final
sources, parity/source receipts and local browser/test evidence.

No new Cycle selector/graph controls, arbitrary cycles, raw API changes,
listening/hardware test, npm/version/publication/release/commit/push/tag or Tauri
update is part of this task. Next: selectable Cycle UI and readable return path.
