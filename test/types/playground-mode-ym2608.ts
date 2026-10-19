/// <reference path="../../docs/playground/tetorica-playground-ym2608.d.ts" />
/// <reference path="./playground-mode-common.ts" />
/// <reference path="./playground-mode-opn.ts" />

async function checkPc98OpnaModeTypes() {
  fm.setPreset(CH6, {algorithm: 7, pan: {left: true}, ams: 1});
  fm.setPan(CH6, true, false);
  fm.setLfo(true, 2);
  await play('C4', {channel: CH6});
  const lastFmChannel: 5 = pg.CH6;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH7;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH16;
  // @ts-expect-error OPNA has no YM2612 PCM DAC
  fm.dac.stop();
  // @ts-expect-error pg.fm follows OPNA capabilities
  pg.fm.writeDac(128);
  await livePrepare('opna', ({fm}) => {
    // @ts-expect-error livePrepare follows OPNA capabilities
    fm.setDacEnabled(true);
  });
  // These built-in sections address the primary OPNA; no extra chip is needed.
  const period: number = ssg.setFrequency(0, 440);
  ssg.setVolume(0, 8);
  ssg.keyOn(0);
  ssg.noteOn(1, 'C4');
  pg.ssg.setEnvelope({period: 600, shape: 9});
  const romUpload: Promise<void> = rhythm.loadRom(new Uint8Array(8192));
  await romUpload;
  rhythm.setVoice('bd', {volume: 20, left: true, right: true});
  rhythm.keyOn(['bd', 'sd']);
  pg.rhythm.keyOff('bd');
  const memoryUpload: Promise<void> = adpcm.loadMemory(new Uint8Array(256), 0);
  await memoryUpload;
  const encoded = await pg.adpcm.loadSample({channels: [new Float32Array(100)], sampleRate: 22050});
  const sampleStart: number = encoded.start;
  adpcm.setSample({start: encoded.start, end: encoded.end});
  adpcm.setDeltaN(encoded.deltaN);
  adpcm.setPan(true, true);
  adpcm.keyOn({repeat: true});
  pg.adpcm.keyOff();
  await livePrepare('primary-opna', async ({ssg, rhythm, adpcm}) => {
    ssg.noteOn(2, 'G4');
    await rhythm.loadRom(new Uint8Array(8192));
    await adpcm.loadMemory(new Uint8Array(256));
    const sample = await adpcm.loadSample('/samples/tone.wav');
    adpcm.setSample(sample);
  });
  await pg.livePrepare('primary-opna-pg', ({ssg, rhythm, adpcm}) => {
    ssg.keyOff(0);
    rhythm.reset();
    adpcm.reset();
  });
  // @ts-expect-error frequency is numeric Hz
  ssg.setFrequency(0, 'A4');
  // @ts-expect-error rhythm ROM uploads require binary bytes
  rhythm.loadRom('/rhythm.rom');
  // @ts-expect-error ADPCM memory uploads require encoded binary bytes
  adpcm.loadMemory('sample');
  // @ts-expect-error ADPCM key-on requires an options object
  pg.adpcm.keyOn(true);
  // @ts-expect-error fm remains the FM facade; sections have their own names
  fm.ssg;
  // @ts-expect-error pg.fm remains the FM facade
  pg.fm.adpcm;
  // Full YM2608 is still independently available in its own mode.
  const opna = await useSoundChip('ym2608');
  opna.ssg.setFrequency(0, 440);
  await opna.rhythm.loadRom(new Uint8Array(8192));
  await opna.prepareTimeline([], [], 44100);
}
