// SPDX-License-Identifier: BSD-3-Clause
// The chip plays a repeating fifth on the audio clock. Apply changes the phrase.
const chip = await useSoundChip('fm21290');
const phrase = chip.build(b => {
  b.keyOn(CH1, 60, 100);
  b.atSeconds(0.25).keyOff(CH1);
  b.atSeconds(0.5).keyOn(CH1, 67, 80);
  b.atSeconds(0.75).keyOff(CH1);
});
const writes = await chip.compile(phrase);
log(writes.length + ' register writes');
liveFx('level', {
  context: {gain: 0.6},
  process(input, output, state, context) {
    for (let ch = 0; ch < input.length; ch++) {
      for (let i = 0; i < input[ch].length; i++) output[ch][i] = input[ch][i] * context.gain;
    }
  },
});
await chip.schedule(phrase, {name: 'fifth', repeatSeconds: 1});
