// Mega CD mode: one 128-byte waveform, eight physical PCM voices.
// Change the waveform below; all voices reuse the same RAM with their own pitch and pan.
const pcm = await useSoundChip('rf5c164');
const length = 128;
const wave = new Uint8Array(length + 32);
for (let i = 0; i < length; i++) {
  const phase = 2 * Math.PI * i / length;
  const value = (Math.sin(phase) + 0.3 * Math.sin(phase * 3)) / 1.3;
  wave[i] = Math.round(Math.abs(value) * 100) | (value >= 0 ? 0x80 : 0);
}
// A pitch step can skip bytes. Pad all 32 bytes a 16-bit step can cross,
// so the chip always reads an end marker and returns to loopStart.
wave.fill(0xff, length);
await pcm.loadMemory(wave);
const stepFor = midi => Math.round(440 * 2 ** ((midi - 69) / 12) * length * 384 * 2048 / pcm.clock);
for (let voice = 0; voice < 8; voice++) {
  await pcm.setChannel(voice, {
    start: 0, loopStart: 0, volume: 100,
    pan: {left: 15 - voice * 2, right: 1 + voice * 2},
  });
}
setBpm(120);
liveLoop('eight-pcm-voices', async () => {
  const notes = [48, 52, 55, 59, 60, 64, 67, 71];
  for (let voice = 0; voice < 8; voice++) {
    await pcm.setPitch(voice, stepFor(notes[voice]));
    await pcm.keyOn(voice);
    await beat(0.25);
  }
  await beat(1);
  for (let voice = 0; voice < 8; voice++) await pcm.keyOff(voice);
  await beat(1);
});
