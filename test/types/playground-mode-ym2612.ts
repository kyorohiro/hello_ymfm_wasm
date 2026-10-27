/// <reference path="../../docs/playground/tetorica-playground-ym2612.d.ts" />
/// <reference path="./playground-mode-common.ts" />
/// <reference path="./playground-mode-without-opna.ts" />

async function checkImportedPokeyInGenesis() {
  const imported = await createSoundChip('pokey', {clock:1789773});
  try {
    const score = imported.createTimeline();
    score.adoptRegisterState(); score.writeRegister(15,3);
    await imported.prepareTimeline(score.finish(441));
    const state = await imported.getTimelineState();
    await imported.playTimeline({startFrame:state.currentFrame+state.sampleRate});
  } finally {imported.dispose();}
}

async function checkGenesisModeTypes() {
  fm.setPan(CH6, true, false);
  fm.setLfo(true, 2);
  fm.setDacEnabled(true);
  fm.writeDac(128);
  await fm.dac.stop();
  await pg.fm.dac.stop();
  await play('C4', {channel: CH6});
  const lastMidiChannel: 15 = pg.CH16;
  pg.psg.noteOn(pg.PSG1, 'C4');
  pg.psgTone(pg.PSG2, 400);
  pg.psgNoise(0);
  await pg.livePrepare('genesis-psg', ({psg}) => psg.noteOn(0, 'C4'));
  await livePrepare('genesis', ({fm}) => fm.setDacEnabled(false));
  const primary = await useSoundChip('ym2612');
  await primary.dac.stop();
  const opn = await useSoundChip('ym2203');
  opn.ssg.noteOn(0, 'C4');
  // @ts-expect-error adding YM2203 does not give it YM2612 stereo controls
  opn.setPan(0, true, false);
}
