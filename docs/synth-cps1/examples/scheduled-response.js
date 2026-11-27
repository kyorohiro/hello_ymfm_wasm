// Choose 0_default.rom. Edit a note or rhythm and press Apply.
const riff = opm.build(b => {
  b.noteOn(0, 'C3');
  b.atSeconds(0.18).keyOff(0);
  b.atSeconds(0.5).noteOn(0, 'Eb3');
  b.atSeconds(0.8).keyOff(0);
});
const drums = oki.build(b => {
  b.play(0, 0, 2);
  b.atSample(12000).play(2, 2, 5);
  b.atSample(24000).play(1, 1, 3);
}, {referenceSampleRate:48000});
const writes = await opm.compile(riff);
if (writes.length) await opm.schedule(riff, {name:'riff', repeatSeconds:1});
await oki.schedule(drums, {name:'drums', repeatSeconds:1});
