# Synth common-feature alignment — 2026-11-19

The source audit began as a documentation-only plan. The user subsequently
authorized the [HuC6280 saving slice](todo_huc6280_working_saved_20261119.md).
The comparison baseline is the current
[FM2612 Synth](../synth/CODE.md), including its completed
[working/saved implementation](todo_fm2612_working_saved_20261119.md).
An absent feature is a comparison result, not approval to implement every row.
Preserve the identity and hardware constraints of each chip.

## Agreed order

| Order | Synth | Individual audit and TODO |
|---|---|---|
| 1 | HuC6280 / PC Engine | [HuC6280](todo_huc6280_synth_fm2612_alignment_20261119.md) |
| 2 | PS1 SPU | [SPU](todo_spu_synth_fm2612_alignment_20261119.md) |
| 3 | DMG | [DMG](todo_dmg_synth_fm2612_alignment_20261119.md) |
| 4 | SID | [SID](todo_sid_synth_fm2612_alignment_20261119.md) |

Other existing Synths are recorded for later comparison; their order is not
decided. Their presence here does not extend the next implementation request.

| Synth | Individual audit and TODO |
|---|---|
| FM2612 / Genesis | [Reference and remaining boundaries](todo_fm2612_synth_fm2612_alignment_20261119.md) |
| FM2608 / PC-98 | [FM2608](todo_fm2608_synth_fm2612_alignment_20261119.md) |
| 2A03 / NES + FDS | [2A03](todo_2a03_synth_fm2612_alignment_20261119.md) |
| S-DSP / SNES | [S-DSP](todo_snes_synth_fm2612_alignment_20261119.md) |
| SCSP / Saturn | [SCSP](todo_scsp_synth_fm2612_alignment_20261119.md) |
| ASWAN / WonderSwan | [ASWAN](todo_aswan_synth_fm2612_alignment_20261119.md) |
| YM2149 / Atari ST | [YM2149 ST](todo_ym2149_st_synth_fm2612_alignment_20261119.md) |

`docs/synth-gameboy/` redirects to DMG; `docs/synth-nes/` redirects to 2A03.
They do not require duplicate implementations or independent TODOs.

## Comparison checklist

1. **Files saving:** working/saved, default-on Auto apply, filename dots,
   Save / Save all / Discard, Ctrl/Cmd+S, and recovery/export of both versions.
2. **Instrument document editing:** selection, knobs, waveform and JSON/source
   editing update the intended file; loading a sound retains playback where supported.
3. **Files Undo:** file operations and project replacement can restore data,
   selection and both versions without automatically executing Code.
4. **Code workspace:** persistent expanded Code/chip/Mixer/Keyboard tabs,
   header Code/Synth switch and visible Master. Basic maximize alone is partial.
5. **Live change highlighting:** briefly highlight changed fields, with On/Off;
   this is separate from following Live state.
6. **Channel output switches:** shared Keyboard/Code/reference-song monitoring,
   separate from group Volume and from hardware gates or register writes.
7. **PCM editing:** drawing and playback/loop ranges where meaningful. Wave RAM,
   ADPCM/BRR/DMC and plain PCM require their own representation and constraints.
8. **Looper / Event Rec:** an optional, separately scoped software feature.
9. **Timed register API:** build/schedule/compile and reusable state snapshots;
   a chip-API project, not just Synth UI work. DSP assembly is a different compiler.

## Saving contract to retain

- Auto apply defaults On. Off retains working edits until explicit Save; show
  the dot in Files rather than introducing another Code/status mode.
- Saved and working must remain independent across switching files, rename,
  reload, Undo and import/export. Native instrument files and required sidecars
  form one atomic document where applicable.
- Cassette ordinary files contain saved content; versioned recovery metadata
  retains working differences. Avoid duplicating unchanged audio. Preserve
  existing metadata, size limits and each app's session-only media policy.
- Saving JavaScript never runs it. Run/Apply uses saved entry, imported modules
  and local data. Existing loops/context/FX continue during editing and Save.
- Physical-channel edits remain live session operations. File Save should not
  rewrite unrelated Code-owned registers or retune voices unintentionally.
- Existing immediate chip APIs and raw Key Off keep their semantics. Do not
  implement sample-accurate reservations with JavaScript timers.

## Rollout and verification

- [x] Record a source-based audit and individual TODO for every current canonical Synth.
- [x] Start the authorized [HuC6280 saving/document-editing phase](todo_huc6280_working_saved_20261119.md); implementation and [verification](verification_huc6280_working_saved_20261119.json) complete.
- [ ] Continue with SPU, DMG and SID in the agreed order, updating their audits at that time.
- [ ] Reassess layout, highlighting, common channel monitoring and PCM editing as separate slices.

Looper/Event Rec and timed-register ports remain proposals, not prerequisites
for completing the saving rollout. SID's Looper/Event Rec remains deferred by
the user's earlier decision. The HuC6280 saving implementation is now authorized separately. No npm
publication, Tauri import, release, commit or push is requested.

For each future implementation: preserve existing projects/formats, test
failure atomicity and recovery, then verify readable ZIPs and real Monaco /
fallback editors in Chromium/WebKit, including settled desktop/mobile resize
and keyboard focus. Keep physical speaker output muted for AI checks; do not
describe numeric measurements as human listening or long-duration testing.
