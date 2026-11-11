import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SPU_CODE_GLOBALS,selectSpuCodeDeclarations} from './code_declarations.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {definitionSource,sourcePosition} from '../playground/playground_monaco_definitions.js';

const shared=await readFile(new URL('../playground/tetorica-playground-globals.d.ts',import.meta.url),'utf8');
const selected=selectSpuCodeDeclarations(shared);
const names=source=>[...new Set([...source.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm)].map(value=>value[1]))].sort();
test('SPU Code exposes only its selected client and actual shared helpers',async()=>{
  assert.deepEqual(names(selected),[...SPU_CODE_GLOBALS].sort());
  assert.doesNotMatch(selected,/declare (?:function|const|var) (?:sid|fm|play|FM_PRESETS|createSoundChip|midi|PSG1|OP1)\b/);
  assert.doesNotMatch(selected,/interface Playground(?:Sid|Nes|Scsp|Snes|Rf5c164)|type FMApi/);
  assert.match(selected,/setPreset\(channel:PlaygroundPs1Channel,preset:PlaygroundPs1Preset,options\?:PlaygroundPs1EnvelopeUpdateOptions\):Promise<void>/);
  assert.match(selected,/allNotesOff\(\):Promise<void>/);
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>0,supportedSoundChips:['ps1'],useSoundChip:async()=>({}),guardExecution:false});
  try{await runtime.run('context.names=Object.keys(pg);');for(const name of SPU_CODE_GLOBALS)assert(runtime.getContext().names.includes(name),name);}
  finally{await runtime.stop();}
});
test('SPU Code types cover its 24 physical channels, samples, shared sound, acknowledged setters and software helpers',async()=>{
  const work=await mkdtemp(join(tmpdir(),'spu-synth-code-types-'));
  try{
    await writeFile(join(work,'globals.d.ts'),selected);
    await writeFile(join(work,'entry.ts'),`export {};
const ps1=await useSoundChip('ps1');
const other=await pg.useSoundChip('ps1');
const id:string=ps1.id, rate:number=ps1.sampleRate, channels:24=ps1.channelCount;
const state=await ps1.getState();
const channel=state.pmon.enabled?CH2:CH1;
const clock:number=state.noise.clock, amount:number=state.morph.amount;
const frames:number|undefined=state.hostAudio?.frames;
const sample=await ps1.loadADPCM(new Uint8Array([12,1,...Array(14).fill(0)]),{rootNote:'C4'});
const setting:Promise<void>=ps1.setPreset(channel,{sample,volumeLeft:.5,reverb:true},{live:true});
await setting;await ps1.setChannel(23,{volumeRight:.5});
const envelope:Promise<void>=ps1.setEnvelope(CH1,{attackRate:15,releaseRate:10},{live:true});
await envelope;await ps1.setReverb({preset:'room',volumeLeft:.25,volumeRight:.25});
const note:Promise<void>=ps1.setNote(CH3,'E3');await note;
await ps1.setPitch(CH4,4096);await ps1.setFrequency(CH5,440);await ps1.keyOn(CH6);await ps1.keyOff(CH6);
await ps1.noteOn(23,'C4');await ps1.noteOff(23);await ps1.allNotesOff();
const snapshot=await ps1.snapshot();snapshot.ram[0];snapshot.registers[0];
await ps1.reset({clearRam:true});await ps1.dispose();
liveLoop('phrase',async()=>{await other.noteOn(channel,choose(scale('E3','minorPentatonic',2)));await sleep(.12);await other.noteOff(channel);await beat(.5);});
await livePrepare('state',async api=>{const instrument=await api.useSoundChip('ps1');await instrument.setNote(0,60);api.log('ready');
  // @ts-expect-error there is no implicit default-FM helper
  api.play('C4');
  return instrument;
});
await tween({seconds:2},async progress=>{await ps1.setPreset(CH1,{volumeLeft:progress,volumeRight:progress});});
await file('notes.json',{type:'json'});liveFx('gain',{context:{gain:.5},process(input,output,state,ctx){output[0].set(input[0]);}});
context.position=cycle([0,1]);stopLoop('phrase');pg.stopAllLoops();
// @ts-expect-error borrow only this SPU
await useSoundChip('ym2612');
// @ts-expect-error canonical API name is ps1
await useSoundChip('spu');
// @ts-expect-error no independent factory in Synth Code
createSoundChip('ps1');
// @ts-expect-error only 24 physical channels exist
ps1.noteOn(24,'C4');
// @ts-expect-error channel cannot be negative
ps1.setPitch(-1,4096);
// @ts-expect-error note conversion crosses the worklet port
const synchronous:void=ps1.setNote(0,60);
// @ts-expect-error use explicit chip handles
play('C4');
// @ts-expect-error only ADPCM sample data is accepted here
ps1.loadADPCM('sample.wav',{rootNote:60});
// @ts-expect-error sample tuning must select exactly one base
ps1.loadADPCM(new Uint8Array(),{rootNote:60,baseFrequencyHz:440});
// @ts-expect-error CH24 constant is not a shared runtime global; use channel23
ps1.noteOn(CH24,'C4');
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});
  }finally{await rm(work,{recursive:true,force:true});}
});
test('SPU hardware methods and shared clock helpers navigate to readable implementations',async()=>{
  const lines=selected.split('\n'),runtime=await readFile(new URL('../js/playground_code_runtime.js',import.meta.url),'utf8'),ps1=await readFile(new URL('../js/ps1synth.js',import.meta.url),'utf8');
  for(const symbol of ['useSoundChip','liveLoop','sleep','stopLoop']){
    const line=lines.findIndex(value=>value.startsWith('declare function '+symbol+'(')||value.startsWith('declare function '+symbol+'<'));
    assert(line>=0,symbol);assert.deepEqual(definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'ps1',{runtimeFile:'playground_code_runtime.js'}),{file:'playground_code_runtime.js',symbol});assert(sourcePosition(runtime,symbol).lineNumber>1,symbol);
  }
  for(const symbol of ['noteOn','setPreset','setEnvelope','setReverb','getState']){
    const line=lines.findIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0,symbol);
    assert.deepEqual(definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'ps1',{runtimeFile:'playground_code_runtime.js'}),{file:'ps1synth.js',symbol});assert(sourcePosition(ps1,symbol).lineNumber>1,symbol);
  }
});
