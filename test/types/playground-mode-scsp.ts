/// <reference path="../../docs/playground/tetorica-playground-scsp.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
async function checkScspModeTypes() {
  const saturn=await useSoundChip('scsp');
  const sample=await saturn.loadPCM(new Int16Array(64),{baseFrequencyHz:44100/64,loopStartSamples:0});
  saturn.setPreset(31,{sample,totalLevel:12,envelope:{attackRate:31}});
  scsp.noteOn(0,'C4');pg.scsp.keyOff(0);saturn.setMix(31,{pan:15});
  const created=await createSoundChip('scsp',{id:'saturn-extra'});created.dispose();
  (await saturn.getState()).ramFreeBytes.toFixed();
  // @ts-expect-error Primary core is owned by the runtime.
  saturn.dispose();
  // @ts-expect-error Explicit source tuning is required.
  saturn.loadPCM(new Int8Array(64),{});
  // @ts-expect-error Unsigned PCM is not the signed SCSP format.
  saturn.loadPCM(new Uint8Array(64),{rootNote:69});
  // @ts-expect-error SCSP mode does not supply primary Yamaha FM.
  fm.setPreset(0,{});
  // @ts-expect-error Unverified DSP/FM controls are not exposed.
  saturn.setPreset(0,{fmDepth:15});
}
