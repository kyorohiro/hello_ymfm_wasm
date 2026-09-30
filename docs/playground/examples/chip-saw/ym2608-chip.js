// Independent YM2608: works alongside the chip selected in the Playground UI.
const ym2608 = await createSoundChip('ym2608');
ym2608.reset();
ym2608.ssg.tone(0, {frequency: 440, volume: 10});
await sleep(0.4);
ym2608.ssg.off(0);
ym2608.rhythm.setVolume(48);
for (let voice = 0; voice < 6; voice++) {
  ym2608.rhythm.setVoice(voice, {volume: 24, left: true, right: true});
  ym2608.rhythm.keyOn(voice);
  await sleep(0.75);
}
// ADPCM-B takes encoded bytes, not WAV. This synthetic fixture needs no ROM.
await ym2608.adpcm.loadMemory(new Uint8Array(256).fill(0x17));
ym2608.adpcm.setSample({start: 0, end: 256});
ym2608.adpcm.setVolume(160);
ym2608.adpcm.setPan(true, true);
ym2608.adpcm.setPlaybackRate(8000);
ym2608.adpcm.keyOn();
await sleep(0.3);
ym2608.dispose();
