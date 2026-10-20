// Master System: six melodic FM channels plus five hardware rhythm voices.
setBpm(120);
opll.setNote(6, 'C2'); // Bass drum tuning uses physical CH6.
opll.setNote(7, 'G3'); // Hi-hat / snare share physical CH7.
opll.setNote(8, 'D3'); // Tom / cymbal share physical CH8.
opll.setRhythm({enabled: true});
opll.setRhythmLevels({bassDrum: 5, snare: 6, tom: 6, cymbal: 8, hiHat: 8});
opll.setVoice(0, {instrument: 8, attenuation: 7, sustain: false});

liveLoop('sms-opll-rhythm', async () => {
  for (let step = 0; step < 8; step++) {
    if (step % 2 === 0) opll.noteOn(0, step < 4 ? 'C3' : 'G2');
    const drum = step % 4 === 0 ? 'bassDrum' : step % 4 === 2 ? 'snare' : 'hiHat';
    opll.setRhythm({[drum]: true});
    await beat(0.1);
    opll.setRhythm({[drum]: false});
    opll.keyOff(0);
    await beat(0.4);
  }
});

// Rhythm uses CH6..8 instrument/volume nibbles; selecting melody afterward
// requires assigning their instruments again. Keyboard lists the five drums.
