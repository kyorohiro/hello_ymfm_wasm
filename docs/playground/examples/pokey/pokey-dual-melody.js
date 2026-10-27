// Atari arcade configuration: two independent POKEYs, four voices each.
// Both chips are mono. Use Mixer Pan for an intentional stereo arrangement.
// Keyboard can select POKEY 1 or POKEY 2, then its physical channel 0..3.
setBpm(120);
for (const chip of [pokey, pokey2]) {
  for (let channel = 0; channel < 4; channel++) chip.setVolume(channel, 6);
}

liveLoop('dual-pokey-melody', async () => {
  for (const [lead, bass] of [['C5','C3'], ['E5','C3'], ['G5','G3'], ['D5','G3']]) {
    pokey.setNote(0, lead); pokey.keyOn(0);
    pokey2.setNote(0, bass); pokey2.keyOn(0);
    await beat(0.8);
    pokey.keyOff(0); pokey2.keyOff(0);
    await beat(0.2);
  }
});
