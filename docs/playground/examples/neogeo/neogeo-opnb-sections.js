// Select Mode: Neo Geo (FM 4ch) or Neo Geo (YM2610B, FM 6ch).
// Main / Worker: all sections share the default chip. No extra chip is needed.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
await play('C4', {channel: CH1, beats: 1});
// In YM2610B mode, CH5 and CH6 are available as well.

ssg.tone(0, {frequency: 440, volume: 10});
await beat(1);
ssg.noise(0, {period: 16, volume: 8});
await beat(1);
ssg.keyOff(0);

// Original test patterns of encoded ADPCM nibbles; no external ROM or WAV.
// A and B have separate memories and use 256-byte aligned sample ranges.
await adpcmA.loadMemory(new Uint8Array(256).fill(0x17));
adpcmA.setVolume(48);
for (let voice = 0; voice < 6; voice++) {
  adpcmA.setSample(voice, {start: 0, end: 256});
  adpcmA.setVoice(voice, {volume: 24, left: true, right: true});
  adpcmA.keyOn(voice);
  await beat(0.5);
}
adpcmA.keyOff([0, 1, 2, 3, 4, 5]);

// ADPCM-B: adjustable rate and whole-sample repeat. adpcm === adpcmB.
await adpcmB.loadMemory(new Uint8Array(256).fill(0x17));
adpcmB.setSample({start: 0, end: 256});
adpcmB.setPlaybackRate(8000);
adpcmB.setVolume(160);
adpcmB.setPan(true, true);
adpcmB.keyOn({repeat: true});
await beat(2);
adpcmB.keyOff();
