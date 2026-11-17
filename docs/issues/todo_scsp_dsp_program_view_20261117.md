# SCSP Synth DSP program view — 2026-11-17

User approved displaying the existing Delay in the DSP tab, explaining its six
physical steps, and providing Copy / Save actions. This milestone is read-only:
it does not upload or replace programs, mutate sound settings, or inspect the
separate SSF player's DSP.

- [x] Add a compact, accessible six-step listing derived from the production
  Delay + disassembler. Explain each step, shared pipeline timing and source.
- [x] Add Copy / Save `.scspasm`, with clipboard fallback and local feedback.
  Exports must reassemble to the exact existing 512-word image.
- [x] Integrate into the DSP tab, retaining experimental Delay controls and
  their enable indicator; distinguish read-only viewing from future editing.
- [x] Keep the listing usable before audio starts. Verify no sound / state
  mutation, keyboard interference, extra renderer or audio resource.
- [x] Update cache keys, readable packaging / source assets and usage notes.
  Preserve immutable calibration evidence and existing measured gains.
- [x] Verify source and isolated package in physically muted Chromium / WebKit,
  Copy / Save content, failure feedback, mobile layout and Delay behavior.
- [x] Record tests, package hash, limitations and restart information.

No live editing / Apply, macros, new public npm API, runtime / SDK / WASM change,
commit, push, Tauri import or release upload. Prior working-tree status clean.

## Completed / restart

The DSP tab now shows six physical instructions with their roles. Copy / Save
export the same annotated 878-byte source and reconstruct all 512 legacy words.
The listing is available without audio; exports preserve settings and held notes.
Narrow views scroll horizontally with touch / pointer or Left / Right keys;
musical letter keys remain usable while the listing is focused.

SCSP suite 210/210, assembler / CLI 12/12, both calibration checks, and four
muted source / package browser cases pass. No measured-source adapter was
needed. Readable modules, declaration, guide and authored fixture are packaged.

Local ZIP: `release/tetorica_scsp_synth_dsp-program-view-20261117_itch.zip`.
See [verification](verification_scsp_dsp_program_view_20261117.md) and
[machine evidence](verification_scsp_dsp_program_view_20261117.json).
No commit / push / upload performed. Live editing / Apply remains a later
milestone with its own program replacement and failure / ownership design.

That follow-up is now implemented in
[DSP draft / Check / Apply](todo_scsp_dsp_edit_apply_20261117.md). The original
six-role listing is retained as a collapsed built-in reference.
