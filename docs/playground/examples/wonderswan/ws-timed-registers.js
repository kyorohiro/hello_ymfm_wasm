// Hardware register operations: sample-clock Sweep/pan and raw Gate.
// Web Audio only for schedule/capture. Native supports local build/compile.
const chip = await useSoundChip('wonderswan');
chip.setVolume(CH3, 9, 9);
const phrase = chip.build(b => {
  b.setNote(CH3, 'E3').keyOn(CH3);
  b.setSweep({enabled:true,step:1,time:8});
  b.atSeconds(0.25).setPan(CH3, 12, 4);
  b.atSeconds(0.5).setSweep({enabled:true,step:-1,time:8});
  b.atSeconds(0.75).setPan(CH3, 4, 12);
  b.atSeconds(0.9).keyOff(CH3);
});
const snapshot = await chip.captureState();
console.table(await chip.compile(phrase, {initialState:snapshot}));
await chip.schedule(phrase, {name:'sweep-pan-gate',repeatSeconds:1});
// Apply atomically replaces this name. Stop cancels its owned Gate.
// await chip.clearSchedule('sweep-pan-gate');
// Offsets are fixed seconds/reference samples, independent of later BPM changes.
// Raw keyOff is immediate hardware Gate off, with no Synth software Release.
// RAM transfers, Voice PCM feeding and Synth noteOn/noteOff are not recorded here.
