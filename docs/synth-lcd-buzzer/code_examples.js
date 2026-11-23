// SPDX-License-Identifier: BSD-3-Clause
import { formatSm511MelodyCode, SM511_DEMO } from './sm511.js';

export const BUZZER_EXAMPLES = [
	{
		path: '/examples/short-beep.js',
		data: `const buzzer = await useSoundChip("sm510-dk52");

// A pair of short beeps. Change the gate note or the silence between them.
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
		data: `const buzzer = await useSoundChip("sm510-direct");

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
		data: `const buzzer = await useSoundChip("sm510-direct");

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
		data: `const sm510 = await useSoundChip("sm510-dk52");
await sm510.write(sm510.REG_R, 0x1);
await sleep(0.1);
await sm510.write(sm510.REG_R, 0x0);
`,
	},
	{
		path: '/examples/sm510-cycles.js',
		data: `const sm510 = await useSoundChip("sm510-dk52");
const pulse = sm510.build(b => {
  b.atCycle(2).write(sm510.REG_R, 0x1);
  b.atCycle(1640).write(sm510.REG_R, 0x0);
});
await sm510.playCycles(pulse);
`,
	},
	{
		path: '/examples/sm511-notes.js',
		data: `const sm511 = await useSoundChip("sm511");

await sm511.noteOn(CH1, "A5", { slotMs: 62.5 });
await sleep(0.2);
await sm511.noteOn(CH1, "A6", { slotMs: 125 });
await sleep(0.25);

// Without slotMs, the app holds the note until noteOff.
await sm511.noteOn(CH1, "C7");
await sleep(0.4);
sm511.noteOff(CH1);
`,
	},
	{
		path: '/examples/sm511-melody.js',
		data: `// Low nibble is note, rest or stop. Bit 4 is octave. Bit 5 doubles the length.
${formatSm511MelodyCode(SM511_DEMO)}`,
	},
	{
		path: '/examples/sm511-instructions.js',
		data: `const sm511 = await useSoundChip("sm511");
sm511.setMelody([0x0d, 0x29, 0x12, 0x01]);
await sm511.pre(0x00);
await sm511.tmel(); // Clear a flag left by the previous address.
await sm511.sme();
while (!(await sm511.tmel())) await sleep(0.002);
await sm511.rme();
`,
	},
	{
		path: '/examples/sm511-timed.js',
		data: `const sm511 = await useSoundChip("sm511");

sm511.setMelody([
  0x01, // 0x00 Stop. PRE starts at 0x01.
  0x2d, // 0x01 C♯5
  0x29, // 0x02 F5, while R is muted
  0x32, // 0x03 C7. Try 0x35 for A6 and press Apply.
  0x01, // 0x04 Stop
]);

const slotCycles = sm511.machineCycleHz / 8; // 125 ms for each note above.
const plan = sm511.build(b => {
  b.pre(0x01).sme();
  // Each instruction takes two cycles. Complete it on a slot boundary.
  b.atCycle(slotCycles - 2).rme();
  b.atCycle(2 * slotCycles - 2).sme(); // The ROM has advanced to 0x03.
  b.atCycle(3 * slotCycles - 2).rme();
  b.atCycle(4 * slotCycles);
});

console.table(await sm511.compile(plan));
await sm511.schedule(plan, { name: "sm511-timed", repeatSeconds: 1 });
`,
	},
	{
		path: '/examples/sm511-rom-groove.js',
		data: `// The real SM511 has a factory-programmed Melody ROM. It cannot rewrite it.
// What if each repeat could rewrite 0x01 while keeping 0x00 at G#5?
const sm511 = await useSoundChip("sm511");
const slotSeconds = 0.0625;
const descending = [
  0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, // C7 to C#6
  0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, // C6 to C#5
  0x00, 0x01, // Rest, then Stop.
];
const sweep = [...descending, ...descending.slice(1, -1).reverse()];

// Lay out successive two-word ROM images to keep the groove on the audio clock.
const words = sweep.flatMap(secondWord => [0x06, secondWord]);
sm511.setMelody(words);

// Keep R enabled through Stop. It sets the flag and gives a silent slot.
const plan = sm511.build(b => {
  b.pre(0x00).sme();
  b.atCycle(words.length * slotSeconds * sm511.machineCycleHz);
});
await sm511.schedule(plan, { name: "sm511-rom-groove", repeatSeconds: words.length * slotSeconds });
`,
	},
	{
		path: '/examples/sm5xx-duet.js',
		data: `const sm510 = await useSoundChip("sm510-dk52");
const sm511 = await useSoundChip("sm511");

const slotSeconds = 0.0625;
const repeatSeconds = 32 * slotSeconds; // Four beats at 120 BPM.
const cyclesPerSlot = sm510.machineCycleHz * slotSeconds;
const accent = 256, tap = 96; // Gate lengths in SM510 machine cycles.
const hits = [
  [0, accent], [6, tap],
  [8, accent], [12, tap],
  [16, accent], [22, tap],
  [24, accent], [28, tap], [30, tap],
];

// Gate the fixed 4,096 Hz R1 carrier in short bursts.
const rhythm = sm510.build(b => {
  for (const [slot, gateCycles] of hits) {
    const at = slot * cyclesPerSlot + 2; // Allow two cycles for LAX and ATR.
    b.atCycle(at).write(sm510.REG_R, 0x01);
    b.atCycle(at + gateCycles).write(sm510.REG_R, 0x00);
  }
  b.atCycle(repeatSeconds * sm510.machineCycleHz);
});

// Each row uses eight slots. Bit 5 doubles a note's length.
sm511.setMelody([
  0x22, 0x00, 0x1a, 0x37, 0x00, 0x07, // C6, rest, E6, G6, rest, G5
  0x35, 0x17, 0x00, 0x3a, 0x1c, 0x00, // A6, G6, rest, E6, D6, rest
  0x22, 0x00, 0x1a, 0x37, 0x15, 0x00, // C6, rest, E6, G6, A6, rest
  0x37, 0x1a, 0x00, 0x3c, 0x22,       // G6, E6, rest, D6, C6
  0x01, // Stop.
]);
const melody = sm511.build();

// Run or Apply starts both reservations together. Try each Mute in Mixer.
await sm510.schedule(rhythm, { name: "dk52-rhythm", repeatSeconds });
await sm511.schedule(melody, { name: "sm511-melody", repeatSeconds });
`,
	},
];
