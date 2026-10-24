/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkCommonModeTypes() {
  // @ts-expect-error primary Game Boy only exists in its selected mode
  pg.gameboy;
  livePrepare('without-primary-apu', context => {
    // @ts-expect-error independent APUs are not primary OPN mode globals
    context.gameboy;
  });
  fm.setPreset(CH1, FM_PRESETS.sine);
  fm.setOperators(CH1, [[OP1, {multi: 1, tl: 20}]]);
  fm.setFrequency(CH1, 440);
  fm.setFrequency(CH1, 4, 600);
  fm.noteOn(CH1, 'A4');
  fm.noteOn(CH1, 4, 600);
  pg.fm.setNote(CH1, 69);
  fm.setChannel3SpecialMode(true);
  fm.setChannel3SpecialFrequency(OP1, 4, 600);
  await fm.setClock(fm.clock);
  await play('C4', {channel: CH1, preset: 'one-op-basic', beats: 0.5});
  await pg.play('C4', {preset: 'host-custom-preset', seconds: 0.2});
  // @ts-expect-error play looks up a preset name, not a preset object
  await play('C4', {preset: FM_PRESETS.sine});
  // @ts-expect-error FM pitch is numeric Hz, not a note name
  fm.setFrequency(CH1, 'A4');
  // @ts-expect-error noteOn requires a note or raw pitch
  fm.noteOn(CH1);
  // @ts-expect-error channels remain bounded in every OPN mode
  await pg.play('C4', {channel: 6});

  // Independent chips keep their own capabilities regardless of the selected mode.
  const accurate = await createSoundChip('ym2612', {id:'accurate',engine:'nuked'});
  const engine: PlaygroundYm2612Engine = accurate.engine;
  accurate.setPreset(5, FM_PRESETS.sine);
  accurate.noteOn(5, 'C4');
  // @ts-expect-error engine is selected at creation and cannot be changed
  accurate.engine = 'ymfm';
  // @ts-expect-error only the two supported engines are accepted
  await createSoundChip('ym2612', {engine:'other'});
  // @ts-expect-error engine selection belongs only to YM2612
  await createSoundChip('ym2610b', {engine:'nuked'});
  // @ts-expect-error shared borrowing does not accept engine options
  await useSoundChip('ym2612', {engine:'nuked'});
  accurate.dispose();
  const opn = await createSoundChip('ym2203');
  opn.ssg.noteOn(0, 'C4');
  opn.setPreset(2, {algorithm: 7, operators: [{multi: 1}]});
  // @ts-expect-error YM2203 does not have stereo pan
  opn.setPan(0, true, true);
  // @ts-expect-error YM2203 has three FM channels
  opn.setNote(3, 'C4');
  const opna = await useSoundChip('ym2608');
  opna.ssg.noteOn(0, 'C4');
  opna.rhythm.keyOn('bd');
  await opna.adpcm.loadMemory(new Uint8Array(256));
  opna.setNote(5, 'C4');
  const neo = await createSoundChip('ym2610');
  neo.setPan(3, true, true);
  neo.adpcmA.keyOn(0);
  // @ts-expect-error independent Neo Geo uses four logical channels
  neo.noteOn(4, 'C4');
  const neoB = await createSoundChip('ym2610b', {id:'opnb-six'});
  neoB.setPreset(5, FM_PRESETS.sine);
  neoB.setPan(5, true, false);
  neoB.noteOn(0, 'C4');
  neoB.noteOn(5, 'G4');
  neoB.ssg.tone(2, {frequency:440,volume:8});
  await neoB.adpcmA.loadMemory(new Uint8Array(256));
  await neoB.adpcmB.loadMemory(new Uint8Array(256));
  neoB.adpcm.keyOn({repeat:true});
  // @ts-expect-error YM2610B has six FM channels
  neoB.setNote(6, 'C4');
  // @ts-expect-error YM2610B has no YM2612 DAC
  neoB.setDacEnabled(true);
  neoB.dispose();
  const extraPsg = await useSoundChip('segapsg');
  extraPsg.noteOn(0, 'C4');
  const extraApu = await useSoundChip('gameboy');
  extraApu.dispose();
}
