# MSM5205 ADPCM renderer

The ADPCM predictor, step table, raw register, seven-nibble FIFO, reset and
clock behavior are a C11 port of this project's existing
`web/msm5205audioengine.js`. That implementation adapts the BSD-3-Clause
libvgm MSM5205 core by Aaron Giles, eito, cam900, Valley Bell and Mao. The
upstream copyright holders and license are retained in `LICENSE`.

- libvgm: https://github.com/ValleyBell/libvgm/blob/master/emu/cores/msm5205.c
- Included upstream snapshot and provenance:
  `third_party/tetorica-soundchip-native/vendor/libvgm-msm5205/`
- Existing Analyzer notice: `docs/licenses/libvgm-msm5205/README.md`

The allocation-free planar PCM interface, fixed-memory WASM wrapper and
immutable 64 KiB RAM playback helper are original Tetorica integration code
by kyorohiro, also under BSD-3-Clause. The helper consumes packed four-bit
ADPCM high nibble first, allows nibble ranges, and uses the PC Engine rate
register formula `clock / (48 * (16 - rate))`. Its default reference clock is
1,536,000 Hz (32,000 samples/second at rate 15); callers may explicitly use
1,540,200 Hz when that clock is desired.

This is a sound playback helper. It does not emulate the PC Engine CPU,
SCSI interface, DMA, address latches or CD-ROM firmware. The existing
Analyzer/VGM JavaScript implementation remains unchanged. This module is
currently an application module, not a new published Native SDK release.

Source and behavioral references:

- https://github.com/pce-devel/huc/wiki/MSM5205

The linked hardware notes describe a 1,540,200 Hz measured clock and a
byte-counted hardware length register. This host helper deliberately exposes
nibble ranges and defaults to the existing 32 kHz reference rate; neither is
presented as a register-level emulation of that control ASIC.

Portability details: negative predictor arithmetic explicitly floors the
division by 256, rather than relying on implementation-defined signed right
shifts. The literal step table preserves the JavaScript
`floor(16 * 1.1 ** index)` values without platform `libm` differences.
