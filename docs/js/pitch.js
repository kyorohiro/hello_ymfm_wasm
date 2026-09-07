/**
 * Convert a MIDI note number into a YM2612-style BLOCK/FNUM pair.
 *
 * This helper is intentionally tiny and runtime-agnostic so browser demos,
 * game-side code, and shared playground utilities can all use the same pitch
 * conversion logic.
 *
 * @param {number} midi
 * @param {{
 *   referenceMidi: number,
 *   referenceBlock: number,
 *   referenceFnum: number,
 * }} reference
 * @returns {{ block: number, fnum: number }}
 */
export function createPitchFromMidi(
  midi,
  {
    referenceMidi,
    referenceBlock,
    referenceFnum,
  }
) {
  let block = referenceBlock;
  let fnum =
    referenceFnum *
    Math.pow(
      2,
      (midi - referenceMidi) / 12
    );

  while (
    fnum >= 1024 &&
    block < 7
  ) {
    fnum /= 2;
    block += 1;
  }

  while (
    fnum < 512 &&
    block > 0
  ) {
    fnum *= 2;
    block -= 1;
  }

  return {
    block,
    fnum: Math.max(
      0,
      Math.min(
        0x7ff,
        Math.round(fnum)
      )
    ),
  };
}

/** Convert Hz to the closest YM2612 BLOCK/FNUM pair at the given chip clock.
 * @param {number} hz
 * @param {number} [clock]
 * @returns {{block: number, fnum: number}}
 */
export function hzToBlockFnum(hz, clock = 7670454) {
  if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(clock) || clock <= 0) {
    throw new Error("hzToBlockFnum requires a positive frequency and clock");
  }
  let best;
  let bestError = Infinity;
  for (let block = 0; block < 8; block++) {
    const unit = clock * 2 ** (block - 1) / (144 * 2 ** 20);
    const fnum = Math.max(1, Math.min(2047, Math.round(hz / unit)));
    const error = Math.abs(fnum * unit - hz);
    if (error < bestError) {
      best = { block, fnum };
      bestError = error;
    }
  }
  return best;
}
