// Master System: one global User patch shared by every instrument-0 channel.
setBpm(120);
opll.setUserPatch(OPLL_USER_PRESETS.bell);
opll.setVoice(0, {instrument: 0, attenuation: 5, sustain: false});
opll.setVoice(1, {instrument: 0, attenuation: 7, sustain: false});
opll.setVoice(2, {instrument: 4, attenuation: 7, sustain: false}); // ROM Flute is unaffected.

liveLoop('sms-opll-user-chord', async () => {
  for (const notes of [['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4']]) {
    for (let channel = 0; channel < notes.length; channel++) opll.noteOn(channel, notes[channel]);
    await tween({beats: 1}, progress => opll.setUserOperator(0, {
      tl: Math.round(36 - 14 * progress), // Modulator level changes CH0 and CH1 together.
    }));
    for (const channel of [0, 1, 2]) opll.keyOff(channel);
    await beat(0.5);
  }
});

// Carrier level is set per channel with setAttenuation(channel, 0..15).
// Editing the User patch does not alter ROM instrument 4 on CH2.
