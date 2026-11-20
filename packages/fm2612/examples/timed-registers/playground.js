// Paste into Tetorica Playground or a Code-enabled Synth with these two chips.
const psg = await useSoundChip('segapsg');
const opll = await useSoundChip('ym2413');
setBpm(120);
opll.setRhythm({enabled:false});
opll.setVoice(CH1, {instrument:1, attenuation:5});
liveLoop('timed-duet', async () => {
  const note = choose(scale('E3', 'minorPentatonic', 2));
  await psg.schedule(psg.build(b => {
    b.atSample(0).setAttenuation(CH1, 5).noteOn(CH1, note);
    b.atSeconds(.1).off(CH1);
  }), {name:'psg-note'});
  await opll.schedule(opll.build(b => {
    b.atSample(0).noteOn(CH1, note);
    b.atSeconds(.15).noteOff(CH1);
  }), {name:'opll-note'});
  await beat(.5);
});
// Run/Apply/Stop and stopLoop('timed-duet') manage the reservation owners.
