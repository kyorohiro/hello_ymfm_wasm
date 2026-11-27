# Tetorica CPS2 Synth · PCM preview

Serve the repository's docs directory over localhost or HTTPS and open
`/synth-cps2/`. Select CH1–16, then hold A S D F G H J K or a screen key.
Pitch follows the key. The sample selector applies on the next note; volume
and pan can change during a held note. Play demo and Download demo VGM use
the selected score and generated ROM. PCM duet uses two pitched PCM channels. ADPCM trio triggers three one-shot samples, panned left, center and right.

## Register model

Based on the [MAME QSound HLE implementation](https://github.com/mamedev/mame/blob/master/src/devices/sound/qsoundhle.cpp)
and [header](https://github.com/mamedev/mame/blob/master/src/devices/sound/qsoundhle.h).
The PCM update follows this software reference. Hardware comparison is pending.

| Register | Behavior |
|---|---|
| 8 × channel + 0 | Bank of the **following** channel, wrapping CH16 to CH1. Low 15 bits select a 64 KiB window. |
| +1, +3 | Signed address and fractional phase. ROM fetch uses the low 16 address bits. |
| +2 | Unsigned 4.12 rate. 0x1000 advances one ROM byte per DSP sample. |
| +4, +5 | Signed loop length and end address. On reaching the end, subtract loop length. |
| +6 | Signed volume. The keyboard releases a note by writing zero. |
| 0x80–0x8f | Per-channel pan. The preview uses a linear dry mix across 0x110–0x130. |

For ADPCM voice index `i` (0–2), the four registers at `0xca + 4*i` set the start byte, exclusive end byte, bank and signed volume. Write a nonzero word to `0xd6 + i` to trigger the sample. The voice latches volume at the start of the next high nibble. Pan uses `0x90 + i`. Each voice decodes one nibble every third DSP tick, high nibble first. The decoder follows MAME HLE and the step coefficients in [libvgm](https://github.com/ValleyBell/libvgm/blob/master/emu/cores/qsound_ctr.c).

PCM echo comparison plays a short note twice. The second note feeds a shared delay line for an audible tail. Registers `0xba–0xc9` set each PCM voice’s signed send, `0x93` controls signed feedback, and `0xd9` sets the delay end. Subtract the mode base (0x554 or 0x53c) for the delay in DSP ticks, up to 1024. ADPCM has no send register. Muting a PCM voice stops new input while the existing tail decays. The line and its two-sample average follow MAME HLE. The preview centers the return and applies mode requests immediately. Spatial filtering and DSP state timing remain approximate.

The DSP sample rate is 60 MHz / 2 / 1248. The audio worklet holds each sample
until the next DSP tick. The VGM export uses the conventional 4 MHz QSound
header, ROM block 0x8f, and big-endian 16-bit register data in command 0xc4.
See the [VGM specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt).

The exported demo plays in VGM Analyzer and renders in tetorica-vgm with the same PCM and ADPCM core. Each PCM or ADPCM voice can be muted independently.

## Remaining work

- Compare generated PCM with an independent renderer, including bank boundaries.
- Implement spatial pan/filter tables, stereo output delays, DSP initialization and host timing. Dry panning is an approximation.
- Bring the Files, Code / liveLoop and cassette workspace across from CPS1 Synth.

The MAME-derived PCM code uses the [BSD 3-Clause license](../../third_party/mame-qsound/LICENSE).
