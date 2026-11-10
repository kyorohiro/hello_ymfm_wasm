// RF5C164 physical voices; musical notes are software tuning above raw PCM steps.
const pcm = await createSoundChip('rf5c164');
const length = 256;
const bytes = new Uint8Array(length + 32);
for (let i = 0; i < length; i++) {
  const v = Math.sin(2 * Math.PI * i / length);
  bytes[i] = Math.round(Math.abs(v) * 100) | (v >= 0 ? 128 : 0);
}
// A raw 16-bit step can skip 32 bytes; make the loop marker impossible to skip.
bytes.fill(255, length);
await pcm.loadMemory(bytes);
// One cycle is length bytes. Declare its approximately 440 Hz playback step
// as the original sample speed (about 7087 at the default 12.5 MHz clock).
const baseStep = Math.round(440 * length * 384 * 2048 / pcm.clock);
await pcm.setChannel(CH1, { start: 0, loopStart: 0, step: baseStep, volume: 160, pan: { left: 15, right: 15 } });
pcm.setRootNote('A4'); // This known waveform is A4 at baseStep; no pitch detection.
setBpm(120);
liveLoop('pcm-sine', async () => {
  await pcm.noteOn(CH1, 'A4');
  await beat(1);
  await pcm.setNote(CH1, 'E5'); // Retune the held voice without retriggering.
  await beat(1);
  await pcm.setNote(CH1, 'A5'); // Twice the original sample speed.
  await beat(1);
  await pcm.noteOff(CH1);
  await beat(1);
});
// For WAV/FLAC bytes: const wave = await pcm.loadSample(bytes, {address: 0, endGuardBytes: 32});
// await pcm.setChannel(CH1, {...wave, volume: 160, pan: {left: 15, right: 15}});
// Set Root to that recording's known original pitch. null resets Root to C4.
