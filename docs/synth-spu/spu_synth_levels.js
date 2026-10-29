// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Software accumulator headroom applies AFTER original-precision voice volume
// multiplication. Dividing voice registers first would add rounding noise.
// Compensate in Web Audio; dry single-note PCM then equals the legacy output.
export const SPU_SYNTH_MIX_HEADROOM = 4;
