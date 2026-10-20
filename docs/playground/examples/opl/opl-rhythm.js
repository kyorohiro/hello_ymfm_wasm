// All OPL models: rhythm reuses the operators of physical channels 6..8.
// Prepare those voices while rhythm mode is off, then trigger individual gates.
setBpm(110);
opl.setRhythm({enabled: false});
for (const channel of [6, 7, 8]) {
  opl.setPreset(channel, OPL_PRESETS.organ);
  opl.setNote(channel, channel === 6 ? 'C2' : 'G3');
  for (const operator of [0, 1]) {
    opl.setOperator(channel, operator, {tl: 20, ar: 15, dr: 9, sl: 12, rr: 10, egt: false});
  }
}
opl.setRhythm({enabled: true});

liveLoop('opl-rhythm', async () => {
  for (let step = 0; step < 8; step++) {
    const drum = step % 4 === 0 ? 'bassDrum' : step % 4 === 2 ? 'snare' : 'hiHat';
    opl.setRhythm({[drum]: true});
    await beat(0.12);
    opl.setRhythm({[drum]: false});
    await beat(0.38);
  }
});
