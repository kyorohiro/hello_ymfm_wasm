// MSX AY-3-8910: both voices use the same hardware envelope.
setBpm(120);
ay.setVoice(0, {tone: true, noise: false, volume: 9, envelope: true});
ay.setVoice(1, {tone: true, noise: false, volume: 7, envelope: true});

liveLoop('msx-ay-envelope', async () => {
  for (const [shape, period, notes] of [[8, 1800, ['C4', 'E4']], [10, 1200, ['G3', 'D4']], [12, 2200, ['A3', 'C4']], [14, 1500, ['G3', 'B3']]]) {
    // Period is a 16-bit hardware value. An explicit Shape write restarts it
    // globally, once per chord; noteOn itself does not reset the shared envelope.
    ay.setEnvelope({period, shape});
    ay.noteOn(0, notes[0]);
    ay.noteOn(1, notes[1]);
    await beat(2);
    ay.keyOff(0);
    ay.keyOff(1);
    await beat(0.5);
  }
});
