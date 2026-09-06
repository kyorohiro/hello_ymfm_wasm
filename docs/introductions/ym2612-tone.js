// Frequency conversion shared by the introductory Playground examples.
/**
 * @param {{ setFrequency: Function, keyOn: Function, keyOff: Function }} fm
 * @param {(seconds: number) => Promise<unknown>} sleep
 */
export function createSound(fm, sleep) {
  return sound;

  async function sound(channel, hz, seconds = 2) {
    const pitch = pitchFromHz(hz);
    fm.setFrequency(channel, pitch.block, pitch.fnum);
    fm.keyOn(channel);
    try {
      await sleep(seconds);
    } finally {
      fm.keyOff(channel);
    }
  }
}

function pitchFromHz(hz) {
  const clock = 7670454;
  let best;
  for (let block = 0; block < 8; block++) {
    const unit = clock * 2 ** (block - 1) / (144 * 2 ** 20);
    const fnum = Math.max(1, Math.min(2047, Math.round(hz / unit)));
    const actual = fnum * unit;
    if (!best || Math.abs(actual - hz) < Math.abs(best.actual - hz)) {
      best = { block, fnum, actual };
    }
  }
  return best;
}

