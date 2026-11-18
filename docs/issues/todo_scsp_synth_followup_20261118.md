# SCSP Synth follow-up roadmap — 2026-11-18

Consolidate the remaining candidates after Code / SSF parameter highlighting.
This document records TODOs; it does not authorize runtime implementation,
publication or a commitment to implement every candidate before a release.

Suggested order: **multi-slot SSF Capture → DSP Reverb**. The broader DSP
authoring UI and SSF DSP transfer/editing are separate later candidates.
Basic PCM / FM / Envelope / LFO, Code, SSF playback / observation and the
existing Synth DSP assembler/editor are already available.

## 1. Multi-slot SSF Capture — next investigation

Extend [ordinary PCM Capture](todo_scsp_synth_ssf_capture_20261115.md) toward
capturing the selected CH together with the slots required for its sound.
**Do not assume two operators or a fixed A/B pair.** More operators, branches,
multiple outputs, self-feedback and cycles may be involved.

- [ ] Inspect real local SSF snapshots and classify the modulation cases in
  use, separating configured X/Y offsets from verified dependencies. Raw
  offsets are not direct producer-CH numbers: Sound Stack history, delayed
  writes, slot order and inhibited writes matter. Do not infer a complete
  instrument from one snapshot unless its dependencies can be established.
- [ ] Define the capture boundary and the supported cases from that evidence.
  Identify required slots and sample data, pitch relationships, output/mix,
  Envelope, LFO and modulation settings from the same observation position.
  Define what an instrument snapshot retains and what still depends on later
  song-program writes; do not promise continuation of the original song state.
  Keep fresh PCM / Envelope / LFO phases and dry capture explicit; the song's
  DSP is a separate transfer problem.
- [ ] Check representation against the current Synth's six editable sources
  and supported graphs / feedback semantics. Report missing capabilities or
  over-limit groups explicitly; do not silently truncate to two or six slots.
  Increasing the authoring limit requires a separate design decision.
- [ ] Convert only validated groups into the authored Synth instrument and
  portable preset. Preserve slot relationships rather than copying every slot
  into an independent, identical keyboard voice.
- [ ] Keep Pause / Resume, Live selection, the previous authored instrument,
  PCM drafts and sample ownership safe. Unsupported or failed conversions
  retain the previous sound and explain the missing requirement.
- [ ] Verify more-than-two-operator fixtures, branching / multiple outputs,
  feedback / history-dependent cases, shared PCM, preset round trips and
  explicit unsupported cases. Compare supported native / Synth behavior,
  muted browser flows and the extracted readable ZIP; record audible
  differences and leave human listening as a separate check.

Existing [SSF slot / route observation](todo_scsp_ssf_slot_map_20261118.md)
and [Synth allocation view](todo_scsp_synth_slot_allocation_20261118.md) provide
inspection tools, not proof of arbitrary game-instrument connectivity.

## 2. DSP Reverb — next effect candidate

Delay, FIR and IIR examples exist. Reverb does not yet exist in this Synth.
This would be an authored microprogram running on the SCSP DSP, not a dedicated
fixed hardware Reverb mode or an automatically copied game algorithm.

- [ ] Design a bounded initial Reverb microprogram, coefficient meanings,
  RAM layout, sends and returns using the existing assembler / DSP APIs.
- [ ] Define meaningful controls such as decay and size after the algorithm
  and supported ranges are verified; keep detailed explanations behind `?`.
- [ ] Provide a readable JavaScript example and matching Synth controls.
  Define preset compatibility, memory ownership and safe program replacement
  without expanding into a general allocator or unrelated audio framework.
- [ ] Verify impulse / decay behavior, feedback stability, clipping, bypass,
  sample-memory isolation, saved-setting round trips and browser / ZIP flows.
  Record a human-listening checklist before treating the effect as finished.

Earlier backlog: [SCSP resume TODO](todo_scsp_resume_20261031.md).
The existing [Delay API milestone](todo_playground_scsp_dsp_delay_20261118.md)
explicitly excluded Reverb and arbitrary RAM layouts.

## 3. Broader DSP authoring UI — later candidate

The Synth already supports `.scspasm` editing, Check / Apply / Copy / Save,
bounded live COEF0–2 controls and program / routing observation.

- [ ] Design an editing UI for additional coefficient-bank entries and
  MADRS / delay-memory layout, tied to the existing program representation.
- [ ] Define signed ranges, address units, validation, draft / Apply behavior,
  memory boundaries and preset / JavaScript export consistency before adding
  general-purpose controls. Preserve current bounded effect workflows.
- [ ] Verify invalid-edit retention, program replacement and conflicts with
  PCM / DSP memory usage without assuming arbitrary game layouts are safe.

Context: [current coefficient controls](todo_scsp_dsp_coefficients_20261117.md)
and [DSP edit / Apply](todo_scsp_dsp_edit_apply_20261117.md).

## 4. SSF DSP transfer and editing — later investigation

The current [SSF DSP view](todo_scsp_ssf_dsp_live_20261118.md) is read-only.
Viewing or expanding it does not copy or apply the program to Synth.

- [ ] Separate two possible workflows: editing the playing / paused SSF DSP,
  and transferring a verified program into the authored Synth. Define scope
  and safety for each before implementing either.
- [ ] Establish cross-engine instruction compatibility. The pinned Mednafen
  renderer uses NOFL word3 bit 8; Synth / MAME uses bit 15. Viewing-only decode
  adaptation is not a valid generic transfer rule. Preserve opaque/raw bits
  and reject unsupported instruction or state combinations explicitly.
- [ ] Define the required coefficients, MADRS, effect routing, RAM layout and
  TEMP / delay-history state, Synth execution-profile limits and PCM memory
  conflicts. Decide whether transfer starts fresh or preserves any
  verified history; a program-only copy is not a complete effect snapshot.
- [ ] For direct SSF editing, define later song-program overwrites, transport
  transitions and failure retention. Keep the source file and authored draft
  intact and mark the active editing target clearly.
- [ ] Verify supported transfer/edit cases and audible differences with
  independent fixtures and both engines before exposing a general action.

No claim is made that arbitrary SSF DSP programs or dynamic instruments can be
transferred exactly between the two current rendering implementations.
