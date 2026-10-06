fm.reset();

// YM2612 DAC replaces FM channel 6 with unsigned 8-bit PCM.
// Generate a 440 Hz sine at 11,025 samples/second for two seconds.
// Schedule on the audio clock: setInterval is too imprecise for PCM.
const pcmRate = 11025;
const frequency = 440;
const seconds = 2;
const count = pcmRate * seconds;
/** @type {Array<[number, number]>} */
const entries = [];
for (let i = 0; i < count; i += 1) {
  // Short fades keep the beginning and end from clicking.
  const fade = Math.min(1, i / (pcmRate * 0.01), (count - 1 - i) / (pcmRate * 0.01));
  const value = Math.round(128 + 80 * fade * Math.sin(2 * Math.PI * frequency * i / pcmRate));
  entries.push([i * 4, value]); // Scheduling offsets use 44,100 Hz units.
}
entries.push([count * 4, 128]);

const start = beginSampleSchedule();
scheduleWritesSamples(start, [
  [0, 1, 0xb6, 0xc0], // CH6: left + right.
  [0, 0, 0x2a, 128],  // Neutral DAC level.
  [0, 0, 0x2b, 0x80], // Enable DAC.
]);
dac.schedule(start, entries);
scheduleWritesSamples(start, [
  [count * 4 + 1, 0, 0x2b, 0], // Disable after the last PCM sample.
]);
await sleepSamples(count * 4 + 1);
