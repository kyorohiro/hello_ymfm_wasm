import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {definitionSource,sourcePosition} from './playground_monaco_definitions.js';

test('Game Boy timed declarations retain nested physical channels, synchronous build and detached snapshots',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gameboy-public-types-'));
  try{
    await writeFile(join(directory,'globals.d.ts'),"type TetoricaSelectedChip='gameboy';\n"+await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8'));
    await writeFile(join(directory,'entry.ts'),`export {};
const gb=await useSoundChip('gameboy');
gb.initialize();
const plan=gb.build(b=>{
  b.atSample(0).pulse.setVoice(CH1,{duty:.25,envelope:{direction:'down',period:3}}).pulse.noteOn(CH1,'E3');
  b.atSeconds(.1).wave.setWaveform(new Uint8Array(32)).wave.setLevel(.5).wave.noteOn('C4');
  b.atSample(8820).noise.setParameters({divisor:3,width:7}).noise.keyOn().atSeconds(.3).keyOff(CH4);
},{referenceSampleRate:44100});
const snapshot=await gb.captureState();
const rows:PlaygroundGameboyCompiledWrite[]=await gb.compile(plan,{initialState:snapshot});
const seconds:number=rows[0].offsetSeconds;
await gb.compile(plan,{initialState:'client'});await gb.compile(plan,{initialState:'reset'});
await gb.schedule(plan,{name:'phrase',repeatSeconds:1});await gb.clearSchedule('phrase');
const independent=await createSoundChip('gameboy');independent.build(b=>b.pulse.keyOn(CH2));independent.dispose();
// @ts-expect-error CH3 is not a Pulse channel
gb.build(b=>b.pulse.keyOn(CH3));
// @ts-expect-error Noise has no note pitch
gb.build(b=>b.noteOn(CH4,'C4'));
// @ts-expect-error physical channels are0..3
gb.build(b=>b.setPan(4,true,true));
// @ts-expect-error lifecycle initialize is outside bounded register recordings
gb.build(b=>b.initialize());
// @ts-expect-error recorded callbacks must be synchronous
gb.build(async b=>b.noise.keyOn());
// @ts-expect-error snapshots remain immutable
snapshot.state.voice[0]=0;
// @ts-expect-error only named supported baseline modes
gb.compile(plan,{initialState:'latest'});
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022,DOM',join(directory,'globals.d.ts'),join(directory,'entry.ts')],{stdio:'pipe'});}catch(error){throw Error(String(error.stdout||error.stderr||error));}
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('Game Boy timed completion opens its readable recorder, snapshot and client implementation',async()=>{
  for(const [owner,method,file,symbol]of [
    ['PlaygroundGameboy','build','gameboy_operations.js','buildGameboyOperations'],
    ['PlaygroundPrimaryGameboy','compile','gameboy_timed_client.js','attachGameboyTimedClient'],
    ['GameboyCodeClient','captureState','gameboy_timed_client.js','attachGameboyTimedClient'],
    ['PlaygroundGameboyOperationRecorder','atSample','gameboy_operations.js','buildGameboyOperations'],
    ['PlaygroundGameboyStateSnapshot','frame','gameboy_timed_state.js','createGameboyTimedSnapshot'],
    ['PlaygroundGameboyCompiledWrite','value','gameboy_operations.js','compileGameboyOperations'],
  ]){
    assert.deepEqual(definitionSource(`interface ${owner} {\n  ${method}():void;\n}`,{lineNumber:2,column:3},'gameboy'),{file,symbol});
    assert(sourcePosition(await readFile(new URL('../../tetorica_src/runtime/'+file,import.meta.url),'utf8'),symbol));
  }
});
