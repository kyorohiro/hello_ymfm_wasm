// SPDX-License-Identifier: BSD-3-Clause
import { SM511_DEMO } from './sm511.js';

export const BUZZER_EXAMPLES = [
	{
		path: '/examples/short-beep.js',
		data: `const buzzer = await useSoundChip("lcd-buzzer");

// A pair of short beeps. Change a pitch or the silence between them.
const notes = ["E5", null, "E5"];
const beepSeconds = 0.06;
const restSeconds = 0.18;

for (const note of notes) {
  if (note === null) {
    await sleep(restSeconds);
    continue;
  }
  await buzzer.noteOn(CH1, note);
  await sleep(beepSeconds);
  buzzer.noteOff(CH1);
}
`,
	},
	{
		path: '/examples/chirp.js',
		data: `const buzzer = await useSoundChip("lcd-buzzer");

// Step through nearby pitches quickly. Reverse the array for a falling chirp.
const pitches = ["E4", "F#4", "G#4", "A4", "B4", "C#5"];
const pitchSeconds = 0.045;

for (const pitch of pitches) {
  await buzzer.noteOn(CH1, pitch);
  await sleep(pitchSeconds);
}
buzzer.noteOff(CH1);
`,
	},
	{
		path: '/examples/trill.js',
		data: `const buzzer = await useSoundChip("lcd-buzzer");

// Alternate two pitches, then rest before repeating the phrase.
setBpm(150);
const pitches = ["G5", "A5"];
const pairs = 3;
const noteBeats = 0.16;
const restBeats = 0.6;

for (let phrase = 0; phrase < 2; phrase++) {
  for (let pair = 0; pair < pairs; pair++) {
    for (const note of pitches) {
      await buzzer.noteOn(CH1, note);
      await beat(noteBeats);
    }
  }
  buzzer.noteOff(CH1);
  if (phrase === 0) await beat(restBeats);
}
`,
	},
	{
		path: '/examples/sm510-r1.js',
		data: `const sm510 = await useSoundChip("sm510");
await sm510.write(sm510.REG_R, 0x1);
await sleep(0.1);
await sm510.write(sm510.REG_R, 0x0);
`,
	},
	{
		path: '/examples/sm510-cycles.js',
		data: `const sm510 = await useSoundChip("sm510");
const pulse = sm510.build(b => {
  b.atCycle(2).write(sm510.REG_R, 0x1);
  b.atCycle(1640).write(sm510.REG_R, 0x0);
});
await sm510.playCycles(pulse);
`,
	},
	{
		path: '/examples/sm511-melody.js',
		data: `const sm511 = await useSoundChip("sm511");

// Low nibble is note, rest or stop. Bit 4 is octave. Bit 5 doubles the length.
await sm511.playMelody([${SM511_DEMO.map(command => '0x' + command.toString(16).padStart(2, '0')).join(', ')}]);
`,
	},
];
