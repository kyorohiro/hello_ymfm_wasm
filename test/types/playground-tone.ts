/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
type TetoricaSelectedChip = 'ym2612';
async function commonToneTypes() {
  for (const chip of [await createSoundChip('ym2612'),await createSoundChip('ym2203'),await createSoundChip('ym2610'),await createSoundChip('ym2608'),await createSoundChip('ym2151'),await createSoundChip('segapsg'),await createSoundChip('nes'),await createSoundChip('gameboy')]) {
    chip.setFrequency(0,440); chip.setNote(0,'A4'); chip.keyOn(0); chip.keyOff(0); chip.noteOn(0,69);
    // @ts-expect-error Hz is numeric
    chip.setFrequency(0,'A4');
    // @ts-expect-error noteOn requires a note
    chip.noteOn(0);
  }
  fm.setFrequency(CH1,440); fm.setNote(CH1,69); fm.noteOn(CH1,'C4');
  fm.setBlockFnum(CH1,4,600); fm.noteOnRaw(CH1,4,600);
  fm.setFrequency(CH1,4,600); fm.noteOn(CH1,4,600);
  const neo=await createSoundChip('ym2610');
  neo.setFrequency(3,440); neo.noteOn(3,'C4'); neo.noteOn(3,4,600);
  // @ts-expect-error Neo Geo logical FM channels are 0..3
  neo.setNote(4,'C4');
  const gb=await createSoundChip('gameboy');gb.initialize();
  gb.pulse.noteOn(0,69);gb.wave.noteOn('C4');
  // @ts-expect-error noise is not a tone channel
  gb.setNote(3,'C4');
  const nes=await createSoundChip('nes',{fds:true});
  for (const part of [nes.triangle,nes.fds]) {part.setFrequency(440);part.setNote(69);part.keyOn();part.keyOff();part.noteOn('C4');}
  const opna=await createSoundChip('ym2608');
  opna.ssg.setFrequency(0,440);opna.ssg.setNote(0,69);opna.ssg.keyOn(0);opna.ssg.keyOff(0);opna.ssg.noteOn(0,'C4');
}
