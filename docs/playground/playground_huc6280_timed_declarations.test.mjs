import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {definitionSource,sourcePosition} from './playground_monaco_definitions.js';
const declarations=await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8');

test('Playground HuC6280 immediate, recorded, snapshot and factory types support Main/Worker and the actual example',async()=>{
 const work=await mkdtemp(join(tmpdir(),'huc-timed-types-'));
 try{
 await writeFile(join(work,'globals.d.ts'),"type TetoricaSelectedChip='huc6280';\n"+declarations);
 await writeFile(join(work,'entry.ts'),`export {};
const chip=await useSoundChip('huc6280');
const hz:number=chip.setNote(CH1,'C4');chip.noteOff(CH1);
const operations=chip.build(b=>{b.atSample(0).noteOn(CH1,'C4');b.atSeconds(.1).noteOff(CH1);});
const recorder=chip.build(b=>b.setNoise(CH5,{enabled:true,frequency:15}),{referenceSampleRate:48000});
const snapshot=await chip.captureState();const format:'tetorica-huc6280-state'=snapshot.format;
const registers:readonly (readonly number[])[]=snapshot.state.registers;
const trace:PlaygroundHuc6280CompiledWrite[]=await chip.compile(operations);
await chip.compile(operations,{initialState:'client'});await chip.compile(operations,{initialState:'reset'});await chip.compile(operations,{initialState:snapshot});
const receipt=await chip.schedule(recorder,{name:'noise',repeatSeconds:.1});const start:number|undefined=receipt.startFrame;await chip.clearSchedule('noise');
const extra=await createSoundChip('huc6280');await extra.compile(extra.build(b=>b.keyOn(CH2)),{initialState:'reset'});extra.dispose();
// @ts-expect-error recording must be synchronous
chip.build(async b=>b.keyOn(CH1));
// @ts-expect-error no bulk Wave RAM upload in recorded calls
chip.build(b=>b.setWaveform(CH1,new Uint8Array(32)));
// @ts-expect-error six physical channels
chip.build(b=>b.noteOn(6,'C4'));
// @ts-expect-error only CH5/CH6 can generate noise
chip.build(b=>b.setNoise(CH1,{enabled:true}));
// @ts-expect-error captured data is readonly
snapshot.state.globals[0]=9;
// @ts-expect-error baseline name must be supported
await chip.compile(operations,{initialState:'cached'});
{
${await readFile(new URL('./examples/pc-engine/pce-timed-registers.js',import.meta.url),'utf8')}
}
`);
 const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
 try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022,DOM',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});}catch(error){throw Error(String(error.stdout||error.stderr||error));}
 }finally{await rm(work,{recursive:true,force:true});}
});

test('timed method and snapshot completion navigate to their readable implementation',async()=>{
 for(const [owner,method,file,symbol] of [
 ['PlaygroundHuc6280','compile','huc6280_timed_client.js','attachHuc6280TimedClient'],
 ['PlaygroundHuc6280','build','huc6280_operations.js','buildHuc6280Operations'],
 ['PlaygroundHuc6280OperationRecorder','atSample','huc6280_operations.js','buildHuc6280Operations'],
 ['PlaygroundHuc6280StateSnapshot','frame','huc6280_timed_state.js','createHuc6280TimedSnapshot'],
 ]){
 const text=`interface ${owner} {\n  ${method}():void;\n}`;
 const target=definitionSource(text,{lineNumber:2,column:3},'huc6280');assert.deepEqual(target,{file,symbol});
 assert(sourcePosition(await readFile(new URL(`../js/${file}`,import.meta.url),'utf8'),target.symbol));
 }
});
