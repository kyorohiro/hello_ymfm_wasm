// A pitch coordinate measured in semitones from base.
const base = 220;
const pitch = 12 * Math.log2(5 / 4); // 3.863...; try 4 or 4.1.
const frequency = base * 2 ** (pitch / 12);

console.log("Semitones:", pitch, "Cents:", pitch * 100);
await sound([base, frequency], 3);

// YM2612 bridge: Hz -> the closest integer BLOCK/FNUM pair.
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

function prepareVoice(channel) {
  fm.setAlgo(channel, 7, 0); // Additive: four independent carriers.
  fm.setPan(channel, true, true);
  for (const [operator, multi, tl] of [
    [OP1, 1, 32], [OP2, 2, 48], [OP3, 3, 56], [OP4, 5, 60],
  ]) {
    fm.setOperator(channel, operator, {
      dt: 0, multi, tl, ar: 31, rs: 0, am: false,
      d1r: 0, d2r: 0, sl: 0, rr: 15, ssg: 0,
    });
  }
}

async function sound(frequencies, seconds = 2) {
  const channels = [CH1, CH2, CH3];
  frequencies.forEach((hz, i) => {
    const channel = channels[i];
    prepareVoice(channel);
    const pitch = pitchFromHz(hz);
    console.log(`Target ${hz.toFixed(3)} Hz -> chip ${pitch.actual.toFixed(3)} Hz`);
    fm.setFrequency(channel, pitch.block, pitch.fnum);
    fm.keyOn(channel);
  });
  await sleep(seconds);
  frequencies.forEach((_hz, i) => fm.keyOff(channels[i]));
  await sleep(0.25);
}
