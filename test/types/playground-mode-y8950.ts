/// <reference path="../../docs/playground/tetorica-playground-y8950.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkOplModeTypes() {
  opl.setPreset(0, OPL_PRESETS.sine);
  opl.setOperator(0, 1, {multi: 1, tl: 12, ar: 15, dr: 3, sl: 2, rr: 6, egt: true});
  opl.noteOn(8, 'A4');
  pg.opl.setFrequency(0, 440);
  opl.setLFO({amDepth: true, pmDepth: false});
  opl.setRhythm({enabled: true, bassDrum: true, hiHat: false});
  await opl.setClock(opl.clock);
  await livePrepare('opl', ({opl}) => { opl.noteOff(0); });
  const primary = await useSoundChip('y8950');
  primary.noteOff(0);
  // @ts-expect-error mode owns the borrowed primary
  primary.dispose();
  // @ts-expect-error physical channel limit
  opl.noteOn(9, 'C4');
  // @ts-expect-error operator limit
  opl.setOperator(0, 2, {tl: 0});
  // @ts-expect-error OPL has no OPN FM shorthand
  play('C4');
  // @ts-expect-error OPN API does not target this mode
  pg.fm;
  // @ts-expect-error OPN constants are not OPL operator indices
  OP1;
  // @ts-expect-error no Sega PSG primary in OPL modes
  psg;
  const extra = await createSoundChip('ymf262');
  extra.setFourOp(0, true);
  extra.setOperator(0, 3, {waveform: 7});
  extra.dispose();
  // @ts-expect-error this chip has no four-operator mode
  opl.setFourOp(0, true);
  // @ts-expect-error mono chip cannot select a left-only hardware output
  opl.setPan(0, true, false);
  // @ts-expect-error only OPL3 has algorithms 2 and 3
  opl.setAlgo(0, 3);

  // @ts-expect-error waveform outside this chip's hardware range
  opl.setOperator(0, 0, {waveform: 1});
}
