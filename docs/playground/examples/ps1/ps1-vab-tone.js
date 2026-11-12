// Select PS1 mode. First use Files -> Add files... to import a standard .vab.
// Try the original demo at samples/spu-import/spu-synth-demo.vab
// (Playground's SPU import demos); Add files places it at the workspace root.
const asset='/spu-synth-demo.vab'; // Replace with your imported bank's path.
const bank=readVab(await file(asset,{type:'arrayBuffer'}));
log(bank.tones.map((tone,toneNumber)=>({toneNumber,program:tone.program,tone:tone.index,sample:tone.sample})));
// The second argument is an index in bank.tones, not a Program number.
const prepared=prepareVabTone(bank,0);
const ps1=await useSoundChip('ps1');
const instrument=await livePrepare('vab-demo-tone',()=>ps1.loadADPCM(prepared.adpcm,prepared.options));
const channel=0; // PS1 physical channels are numbered 0–23.
await ps1.setPreset(channel,{...prepared.preset,sample:instrument});
setBpm(120);
// Standard VAB bytes -> tuned ADPCM + preset. No intermediate JSON is needed.
// Shared reverb and driver-controlled modulation remain separate host choices.
liveLoop('vab-melody',async()=>{
  for(const note of ['C4','E4','G4','C5']) {
    await ps1.noteOn(channel,note);
    await beat(0.8);
    await ps1.keyOff(channel);
    await beat(0.2);
  }
});
