# SPU hardware Noise / PMON — 2026-11-20

Implemented after the initial timed API slice. Validation was silent: no speaker
output, Native audio device or human listening test was used.

## Public operations

```javascript
const ps1 = await useSoundChip('ps1');
await ps1.setNoiseEnabled(CH3, true);
await ps1.setNoiseClock(37);  // One clock for all Noise voices, not a note pitch.
await ps1.setPmonEnabled(CH2, true); // CH1 is the source; no automatic source key-on.

const changes = ps1.build(b => {
  b.setNoiseEnabled(CH3, true).setPmonEnabled(CH2, true);
  b.atSample(4410).setNoiseClock(18);
});
const baseline = await ps1.captureState();
console.table(await ps1.compile(changes, {initialState: baseline}));
await ps1.schedule(changes, {name: 'hardware-flags'});
```

- NON uses offsets `0x194/0x196`; PMON uses `0x190/0x192`.
- SPUCNT Noise clock uses only mask `0x3f00` at offset `0x1aa`.
- Addresses are byte offsets from `0x1f801c00`; all writes are 16-bit.
- Channels are 0..23. PMON carrier 0 is rejected: CH1 has no preceding source.
- Existing immediate setters and the operation resolver share the same class
  implementation. Bits resolve against applied state, not the admission snapshot.
- No sample allocation, source waveform generation, retuning, muting, pair lease
  or automatic source key-on is performed by these three hardware operations.
- The core still needs a loaded voice sample for noteOn/keyOn. Examples use the
  current loop and schedule no RAM upload. This backing requirement is a current
  instrument API/core limitation, not a claim about physical PS1 Noise hardware.

`getState().noiseClock`, `channels[ch].noise` and `channels[ch].pmon` read actual
registers. Code Live reports the hardware bits independently of the Synth's
separate pair helper. Snapshot format stays unchanged because its raw register
image already contains the needed state. Compile/reset/snapshot remain isolated.

The Synth keeps raw overrides until a corresponding manual helper edit, full
instrument selection, reset or Code retirement replaces them. Stop restores the
author's sound; allNotesOff does not reinterpret the programmed hardware flags.
The low-level stopVoices clears envelopes while retaining programmed flags/clock.

## Examples

New Cassettes seed these Files entries, without replacing an existing saved project:

- `examples/hardware-noise.js`: change the shared Noise clock while one Gate is held.
- `examples/hardware-pmon.js`: explicitly play a silent CH1 source and CH2 carrier,
  then change the source frequency. The real core proves modulation occurs before
  the source's stereo volume, so output Volume 0 still modulates the next voice.

Both examples run through the actual queue and produce inspectable register rows.
Types/completion cover the three APIs, state fields and first-voice restriction.

## Native boundary

The current Native mask protocol is ADSR-only. Native output therefore does not
execute these new controls: the direct client throws an explicit capability error
before changing its shadow or submitting a native batch. Native Worker use remains
unsupported. Native build/reset compile can inspect their conversion; Native timed
execution remains a separate TODO. No C++/Rust or Tauri repository was modified.

## Verification

- SPU Synth suite: **491 passed**. Includes 44.1/48kHz real-SPU timing and masks,
  compile/schedule parity, manual interleaving, snapshot reuse, invalid replacement,
  real queue execution of both examples, author-state restoration and existing UI.
- Additional core / client / Native / declarations suite: **76 passed**.
- Distribution, calibration, provenance and ZIP suite: **156 passed**.
- Chromium and WebKit: physically muted before startup. Synth Run/Apply/rejected
  Apply/Stop, observed flags, manual edits, Main/Worker transport and snapshots.
  The final readable SPU package passed the same Synth checks.
- `git diff --check`, package source/SDK checks and ZIP CRCs passed.
- Full Playground and `_for_run` ZIPs passed; browser file count remains **1000**.

## Fresh calibration

Every changed served dependency is covered by new full measurements, followed by
full generated-policy verification. Historical reports and the common target
`0.12881777435541153` remain unchanged. PS1/WonderSwan gains reproduce exactly;
SCSP's extra route differs by 0.000001 and POKEY gains differ by less than 0.005%
from the preceding run. No additional gain policy or freshness bypass was added.

| Kind | Raw | Generated-policy verification |
|---|---|---|
| PS1 | [48 + 8 anchors](ps1_spu_hardware_chip_levels_01.json) | [complete](ps1_spu_hardware_chip_levels_verify_01.json) |
| WonderSwan | [48 + 8 anchors](wonderswan_spu_hardware_chip_levels_01.json) | [complete](wonderswan_spu_hardware_chip_levels_verify_01.json) |
| SCSP | [48 + 8 anchors](scsp_spu_hardware_chip_levels_01.json) | [complete](scsp_spu_hardware_chip_levels_verify_01.json) |
| POKEY | [96 + anchors/dual checks](pokey_spu_hardware_chip_levels_01.json) | [complete](pokey_spu_hardware_chip_levels_verify_01.json) |

Remaining work is recorded in [the TODO](todo_spu_noise_pmon_api_20261120.md).
No npm publication, commit/push/tag, external messages or remote CI was performed.
