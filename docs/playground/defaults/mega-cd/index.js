// Mega CD: FM and a short bass sample in the built-in PCM RAM.
// Try examples/mega-cd/megacd-sampler.js to turn your own audio into a keyboard instrument.
const pcm = await useSoundChip('rf5c164');
const sampleRate = 16000;
const rootNote = 48; // C3; the bass pattern uses this note or higher.
const rootHz = 440 * 2 ** ((rootNote - 69) / 12);
const samples = new Float32Array(Math.round(sampleRate * 0.35));
const attackFrames = Math.round(sampleRate * 0.005);
const releaseFrames = Math.round(sampleRate * 0.03);
for (let i = 0; i < samples.length; i++) {
  const ramp = Math.min(1, i / attackFrames, (samples.length - 1 - i) / releaseFrames);
  const envelope = (1 - Math.cos(Math.PI * ramp)) / 2;
  samples[i] = 0.75 * Math.sin(2 * Math.PI * rootHz * i / sampleRate) * envelope;
}
// With no loopStart, loadSample returns a silent tail after the finite sample.
const wave = await pcm.loadSample({channels: [samples], sampleRate});
await pcm.setChannel(0, {...wave, volume: 100, pan: {left: 15, right: 15}});
const stepFor = midi => Math.round(wave.step * 2 ** ((midi - rootNote) / 12));
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);

liveLoop('fm-and-pcm', async () => {
  for (const [note, midi] of [['C4', 48], ['E4', 52], ['G4', 55], ['B4', 59]]) {
    await pcm.setPitch(0, stepFor(midi));
    await pcm.keyOn(0);
    await play(note, {channel: CH1, beats: 0.8});
    // The 350 ms sample (or a faster note) has faded out before this 400 ms gate.
    await pcm.keyOff(0);
    await beat(0.2);
  }
});
