import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HUC6280_CODE_GLOBALS,selectHuc6280CodeDeclarations} from './code_declarations.js';
import {HUC6280_STARTER_CODE} from './code_host.js';
import {definitionSource,sourcePosition,runtimeSourceUrl} from '../playground/playground_monaco_definitions.js';

const shared=await readFile(new URL('../playground/tetorica-playground-globals.d.ts',import.meta.url),'utf8'),selected=selectHuc6280CodeDeclarations(shared);
test('PC Engine CD declarations retain the borrowed six-channel PSG and shared scheduling globals',()=>{
  const names=[...new Set([...selected.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm)].map(match=>match[1]))].sort();
  assert.deepEqual(names,[...HUC6280_CODE_GLOBALS].sort());
  assert.doesNotMatch(selected,/declare (?:function|const) (?:pce|fm|sid|play|createSoundChip|CH7|CH8|PSG1|OP1)\b/);
  assert.doesNotMatch(selected,/interface Playground(?:Sid|Ps1|Gameboy|Nes|Snes)|type FMApi/);
  assert.match(selected,/setLfo\(options:\{frequency:number;depth:0\|1\|2\|3;reset\?:boolean\}\): Promise<void>/);
});

test('the actual starter plus async Wave, Noise, LFO and DDA APIs typecheck with channel constraints',async()=>{
  const work=await mkdtemp(join(tmpdir(),'huc-code-types-'));
  try{
    await writeFile(join(work,'globals.d.ts'),selected);await writeFile(join(work,'entry.ts'),`export {};
const pce=await useSoundChip('huc6280');
const initialized:Promise<void>=pce.initialize();await initialized;await pce.reset();
const hz:Promise<number>=pce.setNote(CH1,'E3');await hz;await pce.setFrequency(CH6,220);
await pce.setWaveform(CH1,new Uint8Array(32));await pce.setVolume(CH2,24);await pce.setPan(CH1,12,15);await pce.setMasterVolume(15);
await pce.setNoise(CH5,{enabled:true,frequency:12});await pce.setNoise(CH6,{enabled:false});
await pce.setLfo({frequency:32,depth:2,reset:false});await pce.setDda(CH4,true);await pce.writeDda(CH4,16);
await pce.writeRegister(0,5);await pce.keyOn(CH6);await pce.keyOff(CH6);await pce.allNotesOff();
const released:Promise<boolean>=pce.noteOff(CH1);await released;
const state=await pce.getState();const source:'wave'|'noise'|'dda'=state.editorSource;state.globals[0];state.registers[0][4];state.waveforms[0][31];state.positionFrames;
const observed:'sent'=state.observation.registers;const samples:number=state.dda.samples;const release:number|undefined=state.envelopes[0]?.release;
await livePrepare('state',async api=>{const chip=await api.useSoundChip('huc6280');return chip;});
await tween({seconds:2},async value=>{await pce.setVolume(CH1,Math.round(31*value));});pg.log(source);await pce.dispose();
const adpcm=await useSoundChip('msm5205');
await adpcm.loadMemory('/audio/drum.adpcm');await adpcm.loadSample({sampleRate:8000,channels:[new Float32Array(800)]},{rate:12});
await adpcm.play({offset:0,length:100,loop:true,rate:12});await adpcm.writeRegister(1,7);const adpcmState=await adpcm.getState();adpcmState.positionNibbles;await adpcm.stop();
const sourceId:string=adpcm.sourceId;const stateId:string=adpcmState.sourceId;const revision:number=adpcmState.revision;
const rate:PlaygroundMsm5205Rate=adpcmState.defaults.rate;const loop:boolean=adpcmState.defaults.loop;
const sampleName:string|undefined=adpcmState.sample?.name;const format:'wav'|'adpcm'|undefined=adpcmState.sample?.format;
const adpcmPlayback:'empty'|'ready'|'playing'|'ended'=adpcmState.state;
// @ts-expect-error source identity belongs to the host
adpcm.sourceId='other';
const cd=await useSoundChip('cdda');await cd.load('/audio/track.wav');await cd.play(1,{offset:.1});await cd.pause();await cd.resume();await cd.seek(0);await cd.list();await cd.getState();await cd.stop();await cd.dispose();
// @ts-expect-error unsupported chips remain unavailable
await useSoundChip('sid');
// @ts-expect-error ADPCM rate is a 0..15 hardware field
await adpcm.play({rate:16});
// @ts-expect-error CD-DA offset is seconds
await cd.play(1,{offset:'wrong'});
// @ts-expect-error there are six physical channels
await pce.noteOn(6,'C4');
// @ts-expect-error Noise exists only on CH5 / CH6
await pce.setNoise(CH4,{enabled:true});
// @ts-expect-error there is no seventh channel global
await pce.noteOn(CH7,'C4');
// @ts-expect-error commands cross the Worklet asynchronously
const sync:void=pce.keyOff(CH1);
// @ts-expect-error do not expose an independent chip factory
await createSoundChip('huc6280');
// @ts-expect-error no implicit FM/global note helper
play('C4');
{
${HUC6280_STARTER_CODE}
}
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022,DOM',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});}
    catch(error){assert.fail(error.stdout?.toString()||error.message);}
  }finally{await rm(work,{recursive:true,force:true});}
});

test('HuC6280 hardware method definitions retain readable implementation targets',async()=>{
  const lines=selected.split('\n'),source=await readFile(new URL('../js/huc6280synth.js',import.meta.url),'utf8');
  for(const symbol of ['setWaveform','setNoise','setLfo','setNote','keyOn','writeDda']){
    const line=lines.findIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0);
    assert.deepEqual(definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'huc6280',{runtimeFile:'playground_code_runtime.js'}),{file:'huc6280synth.js',symbol});
    assert(sourcePosition(source,symbol).lineNumber>1,`${symbol} opens its actual public hardware implementation`);
  }
});

test('Code-specific state, software note and disposal definitions open the authored instrument implementation',async()=>{
  const lines=selected.split('\n'),source=await readFile(new URL('./instrument.js',import.meta.url),'utf8');
  for(const [symbol,implementation]of [['getState','observeCode'],['noteOn','_liveNoteOn'],['noteOff','noteOff'],['dispose','stop']]){
    const line=lines.findIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0);
    assert.deepEqual(definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'huc6280',{runtimeFile:'playground_code_runtime.js'}),{file:'synth-huc6280/instrument.js',symbol:implementation});
    assert(sourcePosition(source,implementation).lineNumber>1);
  }
});

test('CD-ROM² media completion opens the shared ADPCM and audio-track implementations',async()=>{
  for(const[owner,file,symbol]of [['PlaygroundMsm5205API','msm5205_player.js','loadSample'],['PlaygroundMsm5205API','msm5205_player.js','writeRegister'],['PlaygroundCddaAPI','cdda_player.js','load'],['PlaygroundCddaAPI','cdda_player.js','seek']]){
    const start=selected.indexOf('type '+owner+' ='),offset=selected.indexOf(symbol+'(',start);assert(start>=0&&offset>start);
    const prefix=selected.slice(0,offset),position={lineNumber:prefix.split('\n').length,column:offset-prefix.lastIndexOf('\n')};
    assert.deepEqual(definitionSource(selected,position,'huc6280',{runtimeFile:'playground_code_runtime.js'}),{file,symbol});
    const implementation=await readFile(new URL('../js/'+file,import.meta.url),'utf8');assert(sourcePosition(implementation,symbol).lineNumber>1);
  }
});

test('source navigation resolves namespaced app and sibling API modules without accepting traversal',()=>{
  const base='https://unit.invalid/docs/playground/playground_monaco_definitions.js';
  assert.equal(runtimeSourceUrl('huc6280synth.js',base).href,'https://unit.invalid/docs/js/huc6280synth.js');
  assert.equal(runtimeSourceUrl('synth-huc6280/instrument.js',base).href,'https://unit.invalid/docs/synth-huc6280/instrument.js');
  assert.equal(runtimeSourceUrl('js/huc6280synth.js',base).href,'https://unit.invalid/docs/js/huc6280synth.js');
  for(const invalid of ['../instrument.js','synth-huc6280/../instrument.js','/synth-huc6280/instrument.js','synth-huc6280\\instrument.js','synth-huc6280/%2e%2e/instrument.js','https://bad.invalid/x.js','instrument.js?v=1'])assert.throws(()=>runtimeSourceUrl(invalid,base),/source path/);
});
