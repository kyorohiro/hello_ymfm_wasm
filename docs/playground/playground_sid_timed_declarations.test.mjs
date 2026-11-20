import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {definitionSource,sourcePosition} from './playground_monaco_definitions.js';
import {selectSidCodeDeclarations} from '../synth-sid/code_declarations.js';

const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
function check(files){
  try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022,DOM',...files],{stdio:'pipe'});}catch(error){throw Error(String(error.stdout||error.stderr||error));}
}
for(const borrowed of [false,true])test(`SID ${borrowed?'Synth borrowed':'Playground'} timed declarations retain channel/patch types and synchronous recording`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sid-public-types-'));
  try{
    const source=await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8');
    await writeFile(join(directory,'globals.d.ts'),borrowed?selectSidCodeDeclarations(source):"type TetoricaSelectedChip='c64';\n"+source);
    await writeFile(join(directory,'entry.ts'),`export {};
const sid=await useSoundChip('sid');
await sid.initialize();
const plan=sid.build(b=>{
  b.atSample(0).setVoice(CH1,{waveform:'triangle+saw',attack:2,sync:true}).noteOn(CH1,'E3');
  b.atSeconds(.1).setFilter({mode:'lowpass+bandpass',cutoff:777,routing:3}).keyOn(CH3).keyOn(CH3);
  b.atSample(8820).keyOff(CH1).allNotesOff();
},{referenceSampleRate:44100});
const snapshot=await sid.captureState();
const rows:PlaygroundSidCompiledWrite[]=await sid.compile(plan,{initialState:snapshot});
const seconds:number=rows[0].offsetSeconds;
await sid.compile(plan,{initialState:'client'});await sid.compile(plan,{initialState:'reset'});
await sid.schedule(plan,{name:'phrase',repeatSeconds:1});await sid.clearSchedule('phrase');
// @ts-expect-error physical SID channels are0..2
sid.build(b=>b.keyOn(3));
// @ts-expect-error filter outputs are hardware mode combinations
sid.build(b=>b.setFilter({mode:'ladder'}));
// @ts-expect-error lifecycle initialize is not a recorded operation
sid.build(b=>b.initialize());
// @ts-expect-error callbacks run synchronously once
sid.build(async b=>b.keyOn(CH1));
// @ts-expect-error snapshots remain immutable
snapshot.state.registers[0]=0;
// @ts-expect-error unknown baseline is not silently accepted
sid.compile(plan,{initialState:'latest'});
`);
    check([join(directory,'globals.d.ts'),join(directory,'entry.ts')]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('SID timed completion opens the readable recorder, resolver snapshot and client implementation',async()=>{
  for(const [owner,method,file,symbol]of [
    ['PlaygroundSid','build','sid_operations.js','buildSidOperations'],
    ['PlaygroundPrimarySid','compile','sid_timed_client.js','attachSidTimedClient'],
    ['PlaygroundSidOperationRecorder','atSample','sid_operations.js','buildSidOperations'],
    ['PlaygroundSidStateSnapshot','frame','sid_timed_state.js','createSidTimedSnapshot'],
    ['PlaygroundSidCompiledWrite','value','sid_operations.js','compileSidOperations'],
  ]){
    assert.deepEqual(definitionSource(`interface ${owner} {\n  ${method}():void;\n}`,{lineNumber:2,column:3},'sid'),{file,symbol});
    assert(sourcePosition(await readFile(new URL('../../tetorica_src/runtime/'+file,import.meta.url),'utf8'),symbol));
  }
});

test('explicit SID package client exposes accurate additive timing without changing the direct SidSynth',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sid-module-types-'));
  try{
    const client=fileURLToPath(new URL('../../tetorica_src/runtime/playground_sid.js',import.meta.url));
    const synth=fileURLToPath(new URL('../../tetorica_src/runtime/sidsynth.js',import.meta.url));
    await writeFile(join(directory,'entry.ts'),`import {createSidClient} from ${JSON.stringify(client)};
import type {SidSynth} from ${JSON.stringify(synth)};
const sid=createSidClient({} as MessagePort,{model:'8580'});
const p=sid.build(b=>b.setVoice(0,{ring:true}).atSample(50).keyOff(0));
const snapshot=await sid.captureState();
await sid.compile(p,{initialState:snapshot});await sid.schedule(p,{name:'voice'});
// @ts-expect-error parameter records retain real SidVoiceOptions
sid.build(b=>b.setVoice(0,{waveform:'invalid'}));
// @ts-expect-error physical SID voice is not4
sid.build(b=>b.noteOn(4,'C4'));
// @ts-expect-error async callback is not a recorder
sid.build(async b=>b.keyOn(0));
declare const direct:SidSynth;
// @ts-expect-error direct CPU-free immediate Synth does not imply a Worklet scheduler
direct.schedule(p,{name:'wrong'});
`);
    check([join(directory,'entry.ts')]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
