# SPU Synth: one instrument and a round-robin keyboard

Date: 2026-10-29

## Requested behaviour

Tetorica SPU Synth edits one instrument. Remove the Voice studio heading,
physical-voice selectors, Selected ADPCM voice card and advanced voice dump.
Retain the three PCM cycle → SPU ADPCM, ADSR envelope and SPU reverb editors.
Keyboard notes use all 24 SPU voices through round-robin allocation.

## Implementation

- A standalone adapter reuses the existing PCM/ADSR/FX editors, removes the
  physical-voice inspection UI, and maps edits to common instrument commands.
  The original Playground panel is unchanged.
- One prepared waveform message, envelope patch or preset patch updates all
  24 voices within the audio owner. The PCM encoder runs once on Main, never
  once per note or voice in the audio thread. Each existing short-cycle RAM
  slot is reused; drawing does not grow the bank.
- Round-robin allocation is owned by the AudioWorklet. It prefers free slots
  in rotating order, and steals the oldest held note only if all 24 are held.
  MIDI, sample tuning, pitch and note identities are validated before changing
  ownership. Old releases cannot reach replacement notes.
- Pointer and PC keyboard presses have independent identities. A sustained
  released key continues to own its voice; releasing the pedal only releases
  those notes, keeping physically held keys. Checkboxes do not consume musical
  letter keys. Layout changes and Release notes use one bulk release message.
- Common Pitch bends held notes and Release tails without retriggering.
  Switching a held imported recording to a short PCM cycle recalculates pitch
  from the MIDI note and its bend before any RAM writes, preserving musical
  tuning despite the different sample fundamental. Finished notes do not
  prevent changing instruments. Apply edits controls envelope refresh and
  whether held notes restart on a PCM edit; shared RAM does not preserve an
  old waveform just because retriggering is disabled.
- File audio and `.spu.json` instruments now apply to all voices. The existing
  version-1 instrument format remains readable. Stop retains the instrument
  and clears voices, tails, allocation and pitch-note tracking. The worklet
  cache revision is `spu-synth-2`.

## Validation

`npm run test:spu-synth` passes **28 tests**, including actual WASM rendering,
26 notes on 24 voices, stolen-note releases, allocation reset, invalid-note
atomicity, common live/deferred envelopes, RAM reuse, all-note pitch and
Release tails, recording-to-waveform tuning, instrument files and isolated
distribution/source checks.

The source UI and actual extracted distribution pass Chromium 153.0.8010.12
and WebKit 26.6. Both verify the three-section UI, chords, 26 simultaneous keys
over 24 voices, two stolen notes and harmless old releases, Sustain while its
checkbox retains focus, common live ADSR and Pitch without KON, recording-to-
cycle tuning, waveform and audio assignment on all voices, instrument files,
reverb, Stop and audio failure/retry. Desktop 1440px and mobile 390px layouts
have no horizontal overflow.

The final ZIP run has 18 Chromium captures / 196,608 frames and 19 WebKit
captures / 200,704 frames. All independent PCM pilots and callback clocks are
continuous; zero clock anomalies were reported. The physical destination is
permanently muted. This is not human listening or a hardware-accuracy claim.

- [Source browser report](spu_synth_round_robin_source_browser_01.json)
- [Actual ZIP browser report](spu_synth_round_robin_browser_01.json)
- [Verified distribution receipt](spu_synth_round_robin_distribution_01.json)

`release/tetorica_spu_synth_dev_itch.zip` contains **45 files / 275,949 bytes**,
SHA256 `227fe107ecd7f44d18644720b7d52ff68e98ec2fdf3c3bc23817adbd89ca9849`.
CRC and every member's byte equality to the actual extracted browser root
passed. All served runtime hashes and the unchanged checker/helper hashes
were verified. The earlier selected-voice ZIP is retained separately as
`release/tetorica_spu_synth_selected_voice_dev_itch.zip`. No remote CI,
commit/push or publication was performed in this task.

The first selected-voice implementation remains documented as historical work
in [spu_synth_01.md](spu_synth_01.md). Public instructions are in the
[SPU Synth guide](../synth-spu/README.md).
