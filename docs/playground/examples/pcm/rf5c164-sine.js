// RF5C164 physical voices, direct Worker -> Worklet control.
const pcm = await createSoundChip('rf5c164');
const bytes = new Uint8Array(257);
for (let i = 0; i < 256; i++) {
  const v = Math.sin(2 * Math.PI * i / 256);
  bytes[i] = Math.round(Math.abs(v) * 100) | (v >= 0 ? 128 : 0);
}
bytes[256] = 255; // Return to loopStart.
await pcm.loadMemory(bytes);
await pcm.setChannel(CH1, { start: 0, loopStart: 0, step: 3543, volume: 160, pan: { left: 15, right: 15 } });
setBpm(120);
liveLoop('pcm-sine', async () => {
  await pcm.setPitch(CH1, 3543); // approximately A4, for this 256-byte waveform
  await pcm.keyOn(CH1);
  await beat(1);
  await pcm.setPitch(CH1, 5315);
  await beat(1);
  await pcm.keyOff(CH1);
  await beat(1);
});
// For WAV/FLAC bytes: const wave = await pcm.loadSample(bytes, {address: 0});
// await pcm.setChannel(CH1, {...wave, volume: 160, pan: {left: 15, right: 15}});
