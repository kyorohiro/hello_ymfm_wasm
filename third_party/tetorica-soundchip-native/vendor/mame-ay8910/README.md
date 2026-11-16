# MAME AY-3-8910 / YM2149 adaptation

Upstream: https://github.com/mamedev/mame/blob/dd06c01bbbd7d0c1c8aefa477c095861c7f8bf31/src/devices/sound/ay8910.cpp
Header: https://github.com/mamedev/mame/blob/dd06c01bbbd7d0c1c8aefa477c095861c7f8bf31/src/devices/sound/ay8910.h

Revision: `dd06c01bbbd7d0c1c8aefa477c095861c7f8bf31`.
Copyright holder: Couriersud. License: BSD-3-Clause (see LICENSE).
Both original files are retained unmodified in `upstream/`.

## Scope and changes

`ay8910.cpp` retains the MAME three-tone counters, prescaled 17-bit noise LFSR,
shared envelope and resistor tables. `tone_t`, `envelope_t`, resistor parameters,
`build_single_table` and `build_3D_table` come from the pinned source.
The native tick is the AY8910/YM2149 subset of `sound_stream_update`.
Register writes retain raw latch values and apply the original masks when
updating tone/noise/volume state. Same-value shape writes retrigger the envelope,
without resetting its period counter, matching this MAME revision.

MAME device registration, streams, CPU I/O callbacks, save-state registration,
AY8930 expanded mode and other variants are removed. The two I/O latches and
port-direction bits remain readable. Host reset additionally clears the I/O
latches and resampling phase for deterministic VGM replay; mute selection remains.

Supported VGM types: `0x00` AY-3-8910 and `0x10` YM2149. AY-3-8912/13/30,
other YM variants, second instances, AY DAC streams and S98 conversion are not
exposed. Unsupported types/flags are rejected before creating the WASM chip.

## Output model

- Without flag bit 1, three independent MAME resistor tables use a 1000 ohm load per channel. The existing output path is unchanged.
- Flag bit 1 (`0x02`, Single Output) uses the pinned MAME nonlinear `build_3D_table` / `mix_3D` model with a 1000 ohm tied-output load. Fixed and envelope levels retain their separate resistor parameters, including gated level zero.
- Flag bit 0 selects MAME legacy normalization; zero uses the unnormalized table. The tied table uses MAME's normalization factor 3 exactly.
- AY uses 16 envelope levels with a two-tick step; YM2149 uses 32 with a one-tick step.
- Native sample rate is clock / 8. YM2149 flag bit 4 (pin 26 low) adds a /2 divider.
- Flags other than bits 0, 1 and 4 are rejected; bit 4 is rejected for AY8910.
  Resistor/raw output and stereo-pan flags are not silently treated as the chosen output model.
- The host retains its /3 output normalization: independent output averages A/B/C; Single Output divides the one nonlinear MAME level by 3. Both produce identical left/right mono samples. Thus normalized Single Output spans 0 to 1 rather than MAME's 0 to 3; unnormalized Single Output is also scaled by 1/3.
- `tick()` retains the three independent native table outputs for diagnostics. With flag `0x02`, `mixed_tick_output()` exposes the latest full MAME tied-output level before the host /3 scale. The tied table is allocated only when this flag is selected.
- Native table DC levels are retained, including legacy normalization's negative
  baseline. No artificial zero-volume gate or DC filter is applied.
- Resampling integrates the held native samples over each output sample using
  integer phase durations. Chunk boundaries do not change waveform or phase.
- Mutes act after native synthesis; counters and the shared envelope continue. Independent output retains the original per-channel averaging behavior. Single Output sets muted channels' cached level codes to zero before the nonlinear lookup, retaining envelope/fixed electrical parameters. All three host mutes force silence. Mute changes apply to the currently held native sample without advancing chip phase; unmuting resumes the current state.

The native range is bounded by the chosen tables. A standalone AY output is not
clipped. The app's master volume and AY+OPLL mix can exceed unity, as can other
engines; the default combined engine sums each source at unity gain.
This models the selected MAME output conditions, not an MSX motherboard circuit.

## Verification

`python3 scripts/verify_ay8910_reference.py` compiles the pinned original write,
reset and render methods with framework stubs. It compares all three outputs
against the adaptation for AY and YM, normalized and unnormalized tables,
including Single Output. It covers all envelope shapes, zero/min/max periods,
same-value shape writes, dynamic periods, randomized registers, all mixer
combinations and partial host mutes.
The output tables are independently built by the original MAME routine.
This check does not claim equivalence of the host resampler to MAME's resampler.

`node --test web/ay8910.test.mjs` checks actual WASM output, chunk partitioning,
reset, IO latches, muted phase, parser import scans, VGM seeking/looping and the
AY+OPLL mix. Analyzer monitor tests live in `docs/vgm_analyzer/ay8910_monitor.test.mjs`.
No real-song listening comparison or physical MSX output measurement is included.

Build: `sh scripts/build_ay8910_wasm.sh`.

VGM fields/commands were checked against:
https://raw.githubusercontent.com/vgmrips/vgmplay-legacy/master/VGMPlay/vgmspec171.txt
(clock 0x74, type 0x78, flags 0x79; command 0xA0, address bit 7 selects chip 2).
