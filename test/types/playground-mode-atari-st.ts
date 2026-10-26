/// <reference path="../../docs/playground/tetorica-playground-atari-st.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkAtariStModeTypes() {
  ay.tone(0,{note:'A4',volume:9});
  ay.setVoice(2,{tone:true,noise:true,volume:7,envelope:false});
  ay.setEnvelope({period:1600,shape:10});
  ay.setNoisePeriod(16);
  pg.ay.noteOn(1,'C4');
  ay.keyOff(1);
  await livePrepare('ym2149',({ay})=>ay.allNotesOff());
  const primary=await useSoundChip('ay8910');
  const primaryClock:number=primary.clock;
  primary.setFrequency(0,440);
  void primaryClock;
  // @ts-expect-error Primary YM2149 lifetime belongs to the mode.
  primary.dispose();
  // @ts-expect-error Three physical voices use channels 0..2.
  ay.noteOn(3,'A4');
  // @ts-expect-error Atari ST provides no implicit OPN FM.
  fm;
  // @ts-expect-error Atari ST provides AY-compatible PSG as ay, not Sega PSG.
  psg;
  // @ts-expect-error OPLL is an independent sound chip in this mode.
  opll;
  // @ts-expect-error pg only exposes this mode's primary instrument.
  pg.fm;
  // @ts-expect-error No OPN play shortcut.
  play('C4');
  // @ts-expect-error No OPN channel constants.
  CH1;
  const extra=await createSoundChip('ay8910');
  extra.dispose();
  const opllChip=await useSoundChip('ym2413');
  opllChip.dispose();
}
