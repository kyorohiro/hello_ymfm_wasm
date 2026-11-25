// SPDX-License-Identifier: BSD-3-Clause
export const glassSteps = `const chip = await useSoundChip('fm21290');
setBpm(112);
liveLoop('pedal', async () => {
  for (const note of [48, 43, 46, 41]) {
    chip.keyOn(CH1, note, 100);
    await beat(1.75);
    chip.keyOff(CH1);
    await beat(0.25);
  }
});
liveLoop('glass', async () => {
  for (const note of [72, 79, 75, 82, 77, 79, 74, 70]) {
    chip.keyOn(CH2, note, 85);
    // OP2 attenuation for CH2. Try 12 for a brighter attack.
    chip.writeRegister(0x30c1, 36);
    await beat(0.3);
    chip.keyOff(CH2);
    await beat(0.2);
  }
});`;
export const glassPatch = {
  name:'GLASS STEP', algorithm:4, feedback:2, oscillatorSync:true,
  operators:Object.fromEntries(Array.from({length:6}, (_,i) => [i+1,{
    coarse:[1,1,2,3,1,7][i], fine:[0,0,0,2,0,3][i],
    outputLevel:[90,78,72,73,67,66][i], velocitySensitivity:i%2 ? 4 : 1,
    envelope:{rates:[98,72,45,70], levels:[99,i%2 ? 42 : 80,48,0]},
  }])),
};

export const scoreExample=[
  {path:'/examples/glass-echo/score.json',data:JSON.stringify({
    bpm:116,notes:[72,79,75,82,77,74],velocities:[102,52,88,48,91,60],
  },null,2)},
  {path:'/examples/glass-echo/play.js',data:`const score = await file('./score.json', {type: 'json'});
const out = midi.output('tetorica-fm21290', {channel: CH1});
setBpm(score.bpm);
for (const [i, note] of score.notes.entries()) {
  await out.play(note, {duration: 0.35, velocity: score.velocities[i]});
  await beat(0.15);
}`},
];
