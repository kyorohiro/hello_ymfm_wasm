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
