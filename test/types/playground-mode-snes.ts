/// <reference path="../../docs/playground/tetorica-playground-snes.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkSnesModeTypes() {
  const echo=await snes.setEcho({enabled:true,delay:4,feedback:-32,volumeLeft:32,volumeRight:32,sendMask:255,fir:[127,0,0,0,0,0,0,0]});
  echo.fir[0].toFixed();echo.byteLength.toFixed();const echoStart:0=echo.startAddress;
  (await snes.getEcho()).reserved.valueOf();(await snes.getState()).maxSampleBytes.toFixed();
  // @ts-expect-error Echo requires a boolean enable flag.
  await snes.setEcho({enabled:1});
  // @ts-expect-error FIR coefficients use an ordinary number array.
  await snes.setEcho({fir:new Int8Array(8)});
  // @ts-expect-error Echo configuration does not expose raw buffer addresses.
  await snes.setEcho({startAddress:0});
  const encoded = encodeBrr(new Float32Array(32), {loopStartSamples:0});
  pg.encodeBrr(new Float32Array(16)).metrics.snrDb?.toFixed();
  await snes.loadBRR(encoded.brr, {baseFrequencyHz:250, loopStartSamples:encoded.loopStartSamples!});
  // @ts-expect-error PCM must be Float32.
  encodeBrr(new Int16Array(32));
  // @ts-expect-error Encoder does not infer tuning or resample.
  pg.encodeBrr(new Float32Array(32), {sampleRate:32000});
  const instrument = await snes.loadBRR(new Uint8Array(9), {rootNote:'C4'});
  snes.setPreset(7, {sample:instrument,volumeLeft:70,volumeRight:70});
  pg.snes.noteOn(7,'C4'); snes.keyOff(7);
  await livePrepare('snes', async ({snes, stream}) => { await snes.getState(); stream.stop(); });
  const primary = await useSoundChip('snes'); primary.allNotesOff();
  // @ts-expect-error primary lifetime belongs to the mode
  primary.dispose();
  // @ts-expect-error SNES has eight physical voices
  snes.noteOn(8,'C4');
  // @ts-expect-error fixed-rate S-DSP does not expose master chip-clock controls
  snes.setClock(32000);
  // @ts-expect-error native modes have no global FM
  fm;
  // @ts-expect-error native modes have no FM shorthand
  play('C4');
  // @ts-expect-error native modes have no OPN helpers
  noteToBlockFnum('C4');
  // @ts-expect-error pg has no OPN sections
  pg.adpcm;
  // @ts-expect-error pg follows the selected mode
  pg.fm;
  // @ts-expect-error another primary APU is unavailable
  nes;
  const extra = await createSoundChip('snes'); extra.dispose();
  const independentOpm = await useSoundChip('ym2151'); independentOpm.setAlgo(7,7); independentOpm.dispose();
}
