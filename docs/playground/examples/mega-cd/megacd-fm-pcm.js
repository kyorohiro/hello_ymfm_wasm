// Mega CD mode: Genesis FM + PSG, with the CD expansion's PCM bass.
const pcm = await useSoundChip('rf5c164');
const length = 128;
const wave = new Uint8Array(length + 1);
for (let i = 0; i < length; i++) {
  const phase = 2 * Math.PI * i / length;
  const value = (Math.sin(phase) + 0.2 * Math.sin(phase * 2)) / 1.2;
  wave[i] = Math.round(Math.abs(value) * 100) | (value >= 0 ? 0x80 : 0);
}
wave[length] = 0xff;
await pcm.loadMemory(wave);
await pcm.setChannel(0, {start: 0, loopStart: 0, volume: 130, pan: {left: 15, right: 15}});
const stepFor = midi => Math.round(440 * 2 ** ((midi - 69) / 12) * length * 384 * 2048 / pcm.clock);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
setBpm(120);

liveLoop('fm-psg-pcm', async () => {
  for (const [note, bass] of [['C4', 36], ['E4', 40], ['G4', 43], ['D4', 38]]) {
    await pcm.setPitch(0, stepFor(bass));
    await pcm.keyOn(0);
    psg.tone(PSG1, {note, attenuation: 12});
    await play(note, {channel: CH1, beats: 0.75});
    psg.off(PSG1);
    await pcm.keyOff(0);
    await beat(0.25);
  }
});
