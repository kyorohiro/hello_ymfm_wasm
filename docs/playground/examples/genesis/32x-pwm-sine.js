// MAME-derived 32X PWM. Main and Worker execution use the same AudioWorklet.
const pwm = await useSoundChip('pwm');
await pwm.reset();
const {sampleRate, clock} = await pwm.getState();
const cycle = 1047;
const seconds = 2;
const frames = Math.round(sampleRate * seconds);
// Write once per PWM timer period, using output-frame offsets.
const pwmRate = clock / (cycle - 1);
const entries = [
  {frame: 0, register: 0, value: 5}, // L -> L, R -> R.
  {frame: 0, register: 1, value: cycle},
];
for (let i = 0; i < Math.ceil(seconds * pwmRate); i++) {
  const time = i / pwmRate;
  const fade = Math.max(0, Math.min(1, time / 0.02, (seconds - time) / 0.02));
  const value = Math.round(cycle / 2 + cycle * 0.12 * fade * Math.sin(2 * Math.PI * 440 * time));
  entries.push({frame: Math.round(time * sampleRate), register: 4, value}); // Mono FIFO.
}
entries.push({frame: frames, register: 4, value: Math.round(cycle / 2)});
await pwm.scheduleWrites(entries);
// sleep sets the example duration; Worklet drives every PCM frame and PWM write.
await sleep(seconds + 0.05);
await pwm.reset();
