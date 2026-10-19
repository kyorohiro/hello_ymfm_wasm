/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkCommonModeTypes() {
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
  const extraPsg = await useSoundChip('segapsg');
  extraPsg.noteOn(0, 'C4');
}
