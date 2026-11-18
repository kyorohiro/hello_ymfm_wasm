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
const inputBus:0|1=state.dspRouting.sources[0].input;
const returnPan:number=state.dspReturns[1].pan;
const physicalSlot:number|undefined=state.manualVoices[0]?.slot;
const logicalSlots:number[]=state.codeLanes[0].slots;
const sample=await scsp.loadPCM(new Int16Array([0,1,0,-1]),{rootNote:'C4',loopStartSamples:0});
await scsp.setPreset(0,{sample});await scsp.setConfig({mode:'fm6',fm:{algorithm:'pairs'}});
await scsp.setConfig({mode:'fm2',fm:{algorithm:'custom',custom:{inputs:[[],[0]],outputs:[1]}}});
await scsp.setConfig({fm:{custom:{inputs:[[1],[]],outputs:[0,1]}}});
await scsp.setConfig({mode:'fm4',fm:{algorithm:'custom',custom:{inputs:[[1,2],[3],[3],[]],outputs:[0,2]}}});
await scsp.setConfig({mode:'fm6',fm:{algorithm:'custom',custom:{inputs:[[],[],[0,1],[1],[2,3],[4]],outputs:[4,5]}}});
const customInput:ScspCodeCustomOperator|undefined=state.config.fm.custom?.inputs[1][0];
const customOutputs:ScspCodeCustomOperator[]|undefined=state.config.fm.custom?.outputs;
const presetVersion:4|5|6=(await scsp.exportPatch()).version;
const exported=await scsp.exportPatch();
if(exported.version===5){
  const customMode:'fm2'=exported.mode;
  const customAlgorithm:'custom'=exported.fm.algorithm;
  const savedGraph:ScspCodeCustomRouting2=exported.fm.custom;
}
if(exported.version===6&&exported.mode==='fm4'){
  const savedGraph:ScspCodeCustomRouting4=exported.fm.custom;
  const secondSource:ScspCodeCustomOperator4|undefined=savedGraph.inputs[0][1];
}
if(exported.version===6&&exported.mode==='fm6'){
  const savedGraph:ScspCodeCustomRouting6=exported.fm.custom;
  const output:ScspCodeOperator|undefined=savedGraph.outputs[0];
}
const operatorSlots:[number,number]|[number,number,number,number]|[number,number,number,number,number,number]|undefined=state.voiceGroups[0]?.operatorSlots;
await scsp.setEffect({enabled:true});await scsp.setEnvelope(5,{attackRate:31});
await scsp.setEffect({feedback:-0.5});
const physicalSend:ScspCodeDspSend=await scsp.setDspSend(31,{input:1,level:7});
await scsp.setDspSend(31,null);
await scsp.setDspSourceSend(5,{input:0});
await scsp.setDspSourceSend(5,null);
const secondReturn:ScspCodeDspReturn=await scsp.setDspReturn(1,{level:7,pan:15});
const dspWords:Uint16Array=scsp.compileDsp('000: ZERO=1');
const dsp:ScspCodeDspProgram=await scsp.applyDspProgram(dspWords);
await scsp.applyDspProgram(Object.freeze(Array.from(dspWords)),{coefficients:{0:4095,1:3840,2:256}});
const dspSnapshot:ScspCodeDspProgram=await scsp.getDspProgram();
const dspCoefficients:ScspCodeDspCoefficients=await scsp.getDspCoefficients();
const dspCoefficient:number=dspCoefficients.codes[2];
const updatedDsp:ScspCodeDspCoefficients=await scsp.setDspCoefficients({1:3072,2:1024});
await scsp.setDspCoefficients({0:-4096});
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
// @ts-expect-error source is readable field text, not words
scsp.compileDsp(new Uint16Array(512));
// @ts-expect-error compilation is local and synchronous
const compilePromise:Promise<Uint16Array>=scsp.compileDsp('000: ZERO=1');
// @ts-expect-error program input is a word image, not source text
scsp.applyDspProgram('000: ZERO=1');
// @ts-expect-error setup must provide every coefficient
scsp.applyDspProgram(dspWords,{coefficients:{1:3840,2:256}});
// @ts-expect-error only the existing three-entry setup is supported
scsp.applyDspProgram(dspWords,{coefficients:{0:4095,1:3840,2:256},reset:true});
// @ts-expect-error coefficient indices are 0, 1 or 2
scsp.setDspCoefficients({3:0});
// @ts-expect-error coefficients are signed integer codes, represented by numbers
scsp.setDspCoefficients({1:'0.5'});
// @ts-expect-error coefficient reads take no parameters
scsp.getDspCoefficients(0);
// @ts-expect-error raw DSP register access is not exposed
scsp.setDspRegister(0x700,0x7ff8);
// @ts-expect-error physical DSP slots end at31
scsp.setDspSend(32,{level:7});
// @ts-expect-error Auto source templates end atF
scsp.setDspSourceSend(6,{input:0});
// @ts-expect-error only two owned effect returns
scsp.setDspReturn(2,{level:7});
// @ts-expect-error only two input buses
scsp.setDspSend(0,{input:2});
// @ts-expect-error Return has no routing reset shorthand
scsp.setDspReturn(1,null);
// @ts-expect-error Synth's DSP owner uses the explicit routing API
scsp.setMix(0,{dspSend:7});
// @ts-expect-error raw common Synth routing cannot replace the application DSP owner
scsp.setPreset(0,{dspInput:1});
// @ts-expect-error custom inputs name only A or B
scsp.setConfig({fm:{custom:{inputs:[[],[2]],outputs:[1]}}});
// @ts-expect-error custom outputs name only A or B
scsp.setConfig({fm:{custom:{inputs:[[],[0]],outputs:[2]}}});
// @ts-expect-error custom graphs have exactly two, four or six operators
scsp.setConfig({fm:{custom:{inputs:[[],[0],[]],outputs:[1]}}});
// @ts-expect-error no duplicate / second custom source in the two-operator editor
scsp.setConfig({fm:{custom:{inputs:[[],[0,0]],outputs:[1]}}});
// @ts-expect-error a custom graph update supplies both inputs and outputs
scsp.setConfig({fm:{custom:{outputs:[1]}}});
// @ts-expect-error four-OP sources end at D
scsp.setConfig({fm:{custom:{inputs:[[4],[],[],[]],outputs:[0]}}});
// @ts-expect-error four-OP outputs end at D
scsp.setConfig({fm:{custom:{inputs:[[],[],[],[]],outputs:[4]}}});
// @ts-expect-error six-OP sources end at F
scsp.setConfig({fm:{custom:{inputs:[[6],[],[],[],[],[]],outputs:[0]}}});
// @ts-expect-error each target accepts at most two sources
scsp.setConfig({fm:{custom:{inputs:[[1,2,3],[],[],[]],outputs:[0]}}});
// @ts-expect-error version 5 retains only the original two-OP format
const wrongV5:ScspCodePatch={...exported,version:5,mode:'fm4',fm:{depth:9,ratio:1,ratios:[],algorithm:'custom',custom:{inputs:[[],[],[],[]],outputs:[0]}}};
// @ts-expect-error version 6 four-OP presets cannot contain a six-OP graph
const wrongV6:ScspCodePatch={...exported,version:6,mode:'fm4',fm:{depth:9,ratio:1,ratios:[],algorithm:'custom',custom:{inputs:[[],[],[],[],[],[]],outputs:[0]}}};
// @ts-expect-error fixed version 4 does not save a custom graph
const wrongV4:ScspCodePatch={...exported,version:4,mode:'fm2',fm:{depth:9,ratio:1,ratios:[],algorithm:'custom',custom:{inputs:[[],[]],outputs:[0]}}};
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});}catch(e){throw Error(e.stdout?.toString()||e.message);}
  }finally{await rm(work,{recursive:true,force:true});}
});

test('SCSP Code implementation links open its actual performance client instead of a raw Playground synth',async()=>{
  const {definitionSource,sourcePosition}=await import('../playground/playground_monaco_definitions.js');
  const declarations=selectScspCodeDeclarations(source),lines=declarations.split('\n');
  const client=await readFile(new URL('./code_endpoint.js',import.meta.url),'utf8');
  for(const symbol of ['noteOn','noteOff','getState','allNotesOff','dispose','compileDsp','applyDspProgram','getDspProgram','getDspCoefficients','setDspCoefficients','setDspSend','setDspSourceSend','setDspReturn']){
    const line=lines.findIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0,symbol);
    assert.deepEqual(definitionSource(declarations,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'scsp',{runtimeFile:'playground_code_runtime.js'}),{file:'synth-scsp/code_endpoint.js',symbol:'createScspCodeClient'});
    assert(sourcePosition(client,'createScspCodeClient').lineNumber>1,symbol);
  }
});
