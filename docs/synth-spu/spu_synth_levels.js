// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Fixed input headroom prevents ordinary chords from clipping the SPU's
// 16-bit accumulator. Compensate after the chip, never by its master volume.
// Fourfold output compensation stays below unity at the calibrated max gain.
export const SPU_SYNTH_MIX_HEADROOM = 4;
export const spuSynthVoiceVolume = value => Math.round(value * 0x3fff / SPU_SYNTH_MIX_HEADROOM) & 0x7fff;
