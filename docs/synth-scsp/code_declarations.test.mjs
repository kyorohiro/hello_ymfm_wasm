import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectScspCodeDeclarations} from './code_declarations.js';
const source=await readFile(new URL('../playground/tetorica-playground-globals.d.ts',import.meta.url),'utf8');
test('SCSP declarations expose the actual borrowed performance API and reject raw chip factories',async()=>{
  const selected=selectScspCodeDeclarations(source),work=await mkdtemp(join(tmpdir(),'scsp-code-types-'));
  assert.doesNotMatch(selected,/declare (?:function|const) (?:fm|play|createSoundChip)\b/);
  try{
    await writeFile(join(work,'globals.d.ts'),selected);
    await writeFile(join(work,'entry.ts'),`export {};
const scsp=await useSoundChip('scsp');
await scsp.noteOn(CH1,'C4');await beat(.5);await scsp.noteOff(CH1);
await scsp.noteOn(7,60);const state:ScspCodeState=await scsp.getState();
const mode:ScspCodeConfig['mode']=state.config.mode;
const pitchBend:number=state.pitchBend;
const clickGuard:boolean=state.clickGuard;
const coefficient:number=state.dspCoefficients[2];
const physicalSlot:number|undefined=state.manualVoices[0]?.slot;
const logicalSlots:number[]=state.codeLanes[0].slots;
const sample=await scsp.loadPCM(new Int16Array([0,1,0,-1]),{rootNote:'C4',loopStartSamples:0});
await scsp.setPreset(0,{sample});await scsp.setConfig({mode:'fm6',fm:{algorithm:'pairs'}});
await scsp.setEffect({enabled:true});await scsp.setEnvelope(5,{attackRate:31});
await scsp.setEffect({feedback:-0.5});
await scsp.setEnvelope(0,{loopLink:true});
await scsp.setPreset(0,{envelope:{loopLink:false}});
await scsp.setLfo(0,{pitchDepth:2});await scsp.setMix(0,{totalLevel:9});
await scsp.applyPCM(0,new Int16Array([0,1]),{rootNote:'C4'});
await scsp.getPCM(5);await scsp.exportPatch();await scsp.keyOn(31);await scsp.keyOff(31);
liveLoop('melody',async()=>{await scsp.noteOn(CH2,choose(scale('C4','minor')));await beat(.25);await scsp.noteOff(CH2);});
await livePrepare('chip',async api=>api.useSoundChip('scsp'));
await pg.useSoundChip('scsp');await scsp.allNotesOff();await scsp.dispose();
// @ts-expect-error unsupported borrowed chip
await useSoundChip('ym2612');
// @ts-expect-error logical lanes are 0 through 31
scsp.noteOn(32,'C4');
// @ts-expect-error source operators are A through F
scsp.setEnvelope(6,{attackRate:31});
// @ts-expect-error use authored FM connection and depth
scsp.setModulation(0,{depth:9});
// @ts-expect-error reset belongs to raw ScspSynth
scsp.reset();
// @ts-expect-error no raw DSP writes
scsp.writeDsp(0x4c,1);
// @ts-expect-error no independent instance
createSoundChip('scsp');
// @ts-expect-error hardware loopLink is boolean
scsp.setEnvelope(0,{loopLink:1});
// @ts-expect-error Click guard is a host preference, not a Code setter
scsp.setClickGuard(false);
// @ts-expect-error Click guard is not an authored voice configuration
scsp.setConfig({clickGuard:false});
// @ts-expect-error portable instrument presets exclude host preferences
(await scsp.exportPatch()).clickGuard;
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});}catch(e){throw Error(e.stdout?.toString()||e.message);}
  }finally{await rm(work,{recursive:true,force:true});}
});

test('SCSP Code implementation links open its actual performance client instead of a raw Playground synth',async()=>{
  const {definitionSource,sourcePosition}=await import('../playground/playground_monaco_definitions.js');
  const declarations=selectScspCodeDeclarations(source),lines=declarations.split('\n');
  const client=await readFile(new URL('./code_endpoint.js',import.meta.url),'utf8');
  for(const symbol of ['noteOn','noteOff','getState','allNotesOff','dispose']){
    const line=lines.findIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0,symbol);
    assert.deepEqual(definitionSource(declarations,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'scsp',{runtimeFile:'playground_code_runtime.js'}),{file:'synth-scsp/code_endpoint.js',symbol:'createScspCodeClient'});
    assert(sourcePosition(client,'createScspCodeClient').lineNumber>1,symbol);
  }
});
