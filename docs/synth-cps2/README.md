# Tetorica CPS2 Synth · PCM preview

Serve the repository's docs directory over localhost or HTTPS and open
`/synth-cps2/`. Select CH1–16, then hold A S D F G H J K or a screen key.
Pitch follows the key. The sample selector applies on the next note; volume
and pan can change during a held note. Play demo and Download demo VGM use
the same original two-channel score and generated signed 8-bit sample ROM.

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

The DSP sample rate is 60 MHz / 2 / 1248. The audio worklet holds each sample
until the next DSP tick. The VGM export uses the conventional 4 MHz QSound
header, ROM block 0x8f, and big-endian 16-bit register data in command 0xc4.
See the [VGM specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt).

## Remaining work

- Compare generated PCM with an independent renderer, including bank boundaries.
- Implement the three ADPCM voices, spatial pan/filter tables, echo, delay, DSP initialization and host timing. Dry panning is an approximation.
- Integrate VGM identification, register/ROM dispatch, CH mute and WAV render into Analyzer and tetorica-vgm; verify the exported demo with both.
- Bring the Files, Code / liveLoop and cassette workspace across from CPS1 Synth.

The MAME-derived PCM code uses the [BSD 3-Clause license](../../third_party/mame-qsound/LICENSE).
