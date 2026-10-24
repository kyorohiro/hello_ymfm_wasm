async function checkBuiltInOpnbSections() {
  const period: number = ssg.setFrequency(0, 440);
  ssg.tone(0, {frequency: 440, volume: 10});
  ssg.noise(1, {period: 12, volume: 8});
  pg.ssg.setMixer(1, {tone: false, noise: true});
  pg.ssg.setEnvelope({period: 600, shape: 9});
  const uploadA: Promise<void> = adpcmA.loadMemory(new Uint8Array(256), 0);
  await uploadA;
  adpcmA.setSample(5, {start: 0, end: 255});
  adpcmA.setVolume(48);
  adpcmA.setVoice(5, {volume: 24, left: true, right: true});
  pg.adpcmA.keyOn([0, 5]);
  pg.adpcmA.keyOff(5);
  const uploadB: Promise<void> = adpcmB.loadMemory(new ArrayBuffer(256), 0);
  await uploadB;
  adpcmB.setSample({start: 0, end: 255});
  adpcmB.setPan(true, true);
  const deltaN: number = pg.adpcmB.setPlaybackRate(16000);
  pg.adpcmB.setDeltaN(deltaN);
  adpcm.keyOn({repeat: true});
  pg.adpcm.keyOff();
  await livePrepare('primary-opnb', async ({ssg, adpcmA, adpcmB, adpcm}) => {
    ssg.noteOn(2, 'G4');
    await adpcmA.loadMemory(new Uint8Array(256));
    await adpcmB.loadMemory(new Uint8Array(256));
    adpcm.setSample({start: 0, end: 255});
  });
  await pg.livePrepare('primary-opnb-pg', ({ssg, adpcmA, adpcmB, adpcm}) => {
    ssg.keyOff(0);
    adpcmA.reset();
    adpcmB.reset();
    adpcm.keyOff();
  });
  // @ts-expect-error the YM2610 family has ADPCM-A instead of OPNA rhythm
  pg.rhythm;
  livePrepare('opnb-without-rhythm', api => {
    // @ts-expect-error the YM2610 family has no built-in rhythm ROM
    api.rhythm;
  });
  // @ts-expect-error Neo Geo ADPCM-B currently accepts encoded memory
  adpcm.loadSample(new Float32Array(100));
  // @ts-expect-error the alias has the same encoded-memory API
  pg.adpcmB.loadSample('/tone.wav');
  // @ts-expect-error ADPCM-A uploads require binary data
  adpcmA.loadMemory('/tone.adpcm');
  // @ts-expect-error ADPCM-B requires a range
  adpcmB.setSample(0, 255);
  fm.ssg.setVolume(0, 8);
  pg.fm.adpcmA.setVolume(19);
}
