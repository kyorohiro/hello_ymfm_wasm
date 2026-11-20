import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {definitionSource,sourcePosition} from './playground_monaco_definitions.js';
test('WonderSwan timed types include physical channels, readonly snapshots and the actual example',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ws-public-types-'));
 try{
 await writeFile(join(directory,'globals.d.ts'),"type TetoricaSelectedChip='wonderswan';\n"+await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8'));
 await writeFile(join(directory,'entry.ts'),`export {};
 const ws=await useSoundChip('wonderswan');
 const hz:number=ws.setNote(CH1,'E3');
 const plan=ws.build(b=>b.atSample(10).setSweep({enabled:true,step:-1,time:3}).keyOn(CH3));
 const snapshot=await ws.captureState();
 const rows:PlaygroundWonderSwanCompiledWrite[]=await ws.compile(plan,{initialState:snapshot});
 await ws.compile(plan,{initialState:'client'});await ws.compile(plan,{initialState:'reset'});
 const extra=await createSoundChip('wonderswan');await extra.schedule(plan,{name:'extra'});extra.dispose();
 // @ts-expect-error Synth software notes are outside the hardware recorder
 ws.build(b=>b.noteOn(CH1,'C4'));
 // @ts-expect-error four physical channels
 ws.build(b=>b.keyOn(4));
 // @ts-expect-error recorded callbacks must be synchronous
 ws.build(async b=>b.keyOff(CH1));
 // @ts-expect-error no RAM transfer in the recorder
 ws.build(b=>b.setWaveform(CH1,new Uint8Array(32)));
 // @ts-expect-error immutable capture
 snapshot.state.registers[0]=0;
 // @ts-expect-error offline timeline is not a live timed endpoint
 ws.createTimeline().schedule(plan,{name:'not-live'});
 {
 ${await readFile(new URL('./examples/wonderswan/ws-timed-registers.js',import.meta.url),'utf8')}
 }
 `);
 const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
 try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022,DOM',join(directory,'globals.d.ts'),join(directory,'entry.ts')],{stdio:'pipe'});}catch(error){throw Error(String(error.stdout||error.stderr||error));}
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('WonderSwan timed completion opens the corresponding readable implementation',async()=>{
 for(const [owner,method,file,symbol] of [
 ['PlaygroundWonderSwan','compile','wonderswan_timed_client.js','attachWonderSwanTimedClient'],
 ['PlaygroundWonderSwan','build','wonderswan_operations.js','buildWonderSwanOperations'],
 ['PlaygroundWonderSwanOperationRecorder','atSample','wonderswan_operations.js','buildWonderSwanOperations'],
 ['PlaygroundWonderSwanStateSnapshot','frame','wonderswan_timed_state.js','createWonderSwanTimedSnapshot']]){
 const target=definitionSource(`interface ${owner} {\n  ${method}():void;\n}`,{lineNumber:2,column:3},'wonderswan');
 assert.deepEqual(target,{file,symbol});assert(sourcePosition(await readFile(new URL('../js/'+file,import.meta.url),'utf8'),symbol));
 }
});
