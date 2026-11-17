import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {selectPlaygroundDeclarations} from './playground_declarations.js';
import {definitionSource, sourcePosition} from './playground_monaco_definitions.js';

const globals = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
const localModule = fileURLToPath(new URL('../../tetorica_src/runtime/scspsynth.js', import.meta.url));
const usage = `import type {ScspSynth, ScspDspProgram, ScspDspCoefficients, ScspDspReturn} from ${JSON.stringify(localModule)};
declare const local:ScspSynth;
const words = new Uint16Array(512);
const readonlyWords:readonly number[] = Object.freeze(Array.from(words));
const setup = {coefficients:{0:4095,1:3840,2:256}};
const localProgram:ScspDspProgram = local.applyDspProgram(readonlyWords, setup);
const localRead:ScspDspProgram = local.getDspProgram();
const localCodes:ScspDspCoefficients = local.setDspCoefficients({0:-4096,2:4095});
const localReturn:ScspDspReturn = local.setDspReturn({level:7,pan:31});
const localRight:ScspDspReturn = local.setDspReturn(1,{level:7,pan:15});
const optionalReturns:[ScspDspReturn,ScspDspReturn]|undefined = localRead.returns;
local.setMix(0,{dspSend:7,directLevel:0});
local.setPreset(0,{dspSend:0});
local.setMix(1,{dspSend:7,dspInput:1});
const primary = await useSoundChip('scsp');
const extra = await createSoundChip('scsp');
const remoteProgram:PlaygroundScspDspProgram = await primary.applyDspProgram(words, setup);
const remoteRead:PlaygroundScspDspProgram = await extra.getDspProgram();
const remoteCodes:PlaygroundScspDspCoefficients = await primary.setDspCoefficients({1:3072,2:1024});
const remoteReturn:PlaygroundScspDspReturn = await extra.setDspReturn({pan:15});
const remoteRight:PlaygroundScspDspReturn = await extra.setDspReturn(1,{pan:15,level:7});
const remoteReturns:[PlaygroundScspDspReturn,PlaygroundScspDspReturn]|undefined = remoteRead.returns;
if(localRead.returns) {const right:number=localRead.returns[1].level;void right;}
if(remoteRead.returns) {const right:number=remoteRead.returns[1].pan;void right;}
const rawProfile:'ram-free' = localProgram.profile;
const remoteProfile:'ram-free' = remoteProgram.profile;
const localDelay:ScspDspProgram=local.setDspDelay({enabled:true,timeMs:240,feedback:.35});
const remoteDelay:PlaygroundScspDspProgram=await primary.setDspDelay({enabled:true,timeMs:240,feedback:.35});
if(localDelay.profile==='delay-ring') {const address:number=localDelay.ram.address;void address;}
if(remoteDelay.profile==='delay-ring') {const time:number=remoteDelay.delay.timeMs;void time;}
const configured:boolean = remoteRead.configured;
const code:number = (await primary.getDspCoefficients()).codes[0];
const remoteApply:(words:Parameters<ScspSynth['applyDspProgram']>[0],options?:Parameters<ScspSynth['applyDspProgram']>[1])=>Promise<ReturnType<ScspSynth['applyDspProgram']>> = primary.applyDspProgram;
const remoteSetter:(patch:Parameters<ScspSynth['setDspCoefficients']>[0])=>Promise<ReturnType<ScspSynth['setDspCoefficients']>> = primary.setDspCoefficients;
const localState=local.getState();
if(localState.dsp) {const stored:'ram-free'|'delay-ring'=localState.dsp.profile;void stored;}
const remoteState=await primary.getState();
if(remoteState.dsp) {const stored:number=remoteState.dsp.coefficients.codes[1];void stored;}
primary.setMix(0,{dspSend:7,directLevel:0});
extra.setPreset(1,{dspSend:7});
extra.setMix(1,{dspInput:1});
// @ts-expect-error Applying words locally is synchronous.
const queued:Promise<ScspDspProgram> = local.applyDspProgram(words);
// @ts-expect-error An owner acknowledgement is asynchronous.
const immediate:PlaygroundScspDspProgram = primary.applyDspProgram(words);
// @ts-expect-error The executable image is numeric words, not source text.
local.applyDspProgram('000: EWT=1');
// @ts-expect-error Byte arrays have no implicit word order.
primary.applyDspProgram(new Uint8Array(1024));
// @ts-expect-error Optional setup is complete across all three supported coefficients.
local.applyDspProgram(words,{coefficients:{1:3840,2:256}});
// @ts-expect-error Optional setup still requires a coefficient table.
primary.applyDspProgram(words,{});
// @ts-expect-error No additional setup flags are exposed.
primary.applyDspProgram(words,{coefficients:{0:1,1:2,2:3},clearRam:true});
// @ts-expect-error Only COEF0..2 are exposed.
local.setDspCoefficients({3:0});
// @ts-expect-error Coefficient codes are numbers.
primary.setDspCoefficients({1:'3072'});
// @ts-expect-error Return levels are hardware numbers.
local.setDspReturn({level:true});
// @ts-expect-error The exposed return has no arbitrary DSP output index.
primary.setDspReturn({bus:2});
// @ts-expect-error dspSend is a level, not a boolean switch.
primary.setMix(0,{dspSend:true});
// @ts-expect-error The input code is named dspInput.
local.setMix(0,{dspBus:1});
// @ts-expect-error Only effect outputs 0 and 1 are exposed.
primary.setDspReturn(2,{level:7});
// @ts-expect-error An indexed return requires a patch.
primary.setDspReturn(1);
// @ts-expect-error dspInput uses a numeric hardware code.
primary.setMix(0,{dspInput:true});
// @ts-expect-error Use the separate pure assembler helper.
primary.compileDsp('000:');
// @ts-expect-error Delay input uses numeric milliseconds.
primary.setDspDelay({timeMs:'240'});
// @ts-expect-error Delay routes use setMix / setDspReturn.
primary.setDspDelay({send:7});
// @ts-expect-error Remote Delay setup awaits its owner acknowledgement.
const immediateDelay:PlaygroundScspDspProgram=primary.setDspDelay({enabled:true});
void [localProgram,localRead,localCodes,localReturn,localRight,optionalReturns,localDelay,remoteDelay,remoteRead,remoteCodes,remoteReturn,remoteRight,remoteReturns,rawProfile,remoteProfile,configured,code,remoteApply,remoteSetter,queued,immediate,immediateDelay];
`;

test('SCSP local and acknowledged DSP contracts match in strict Playground mode consumers', async () => {
  const work = await mkdtemp(join(tmpdir(), 'playground-scsp-dsp-execution-types-'));
  const compiler = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
  try {
    for (const chip of ['scsp', 'ym2612', 'ps1']) {
      await writeFile(join(work,'globals.d.ts'), selectPlaygroundDeclarations(globals,chip));
      await writeFile(join(work,'selected.d.ts'), `type TetoricaSelectedChip='${chip}';\n`);
      await writeFile(join(work,'entry.mts'), usage);
      for (const resolution of ['NodeNext','Bundler']) {
        await writeFile(join(work,'tsconfig.json'),JSON.stringify({compilerOptions:{
          strict:true,noEmit:true,skipLibCheck:false,target:'ES2022',
          module:resolution==='NodeNext'?'NodeNext':'ESNext',moduleResolution:resolution,
          lib:['ES2022','DOM'],types:[],
        },files:['globals.d.ts','selected.d.ts','entry.mts']}));
        try {execFileSync(process.execPath,[compiler,'-p',join(work,'tsconfig.json')],{stdio:'pipe'});}
        catch(error){assert.fail(`${chip} / ${resolution}: ${error.stdout?.toString()||error.message}`);}
      }
    }
  } finally {await rm(work,{recursive:true,force:true});}
});

test('SCSP DSP declarations and slot sends navigate to the real owning implementation', async () => {
  const source=await readFile(new URL('../../tetorica_src/runtime/scspsynth.js',import.meta.url),'utf8');
  const lines=globals.split('\n');
  const start=lines.findIndex(line=>line==='interface PlaygroundScsp {');
  const end=lines.findIndex((line,index)=>index>start&&line==='}');
  for (const symbol of ['applyDspProgram','getDspProgram','getDspCoefficients','setDspCoefficients','setDspReturn','setDspDelay','setMix']) {
    const indexes=lines.flatMap((line,index)=>index>start&&index<end&&line.trimStart().startsWith(symbol+'(')?[index]:[]);
    assert(indexes.length>0,symbol);
    if(symbol==='setDspReturn')assert.equal(indexes.length,2,'Both return overloads have source navigation');
    for(const index of indexes){
      const target=definitionSource(globals,{lineNumber:index+1,column:lines[index].indexOf(symbol)+1},'scsp');
      assert.deepEqual(target,{file:'scspsynth.js',symbol:'ScspSynth.'+symbol});
      const position=sourcePosition(source,target.symbol);
      assert(position.lineNumber>1,symbol);
      assert.match(source.split('\n')[position.lineNumber-1],new RegExp(symbol+'\\s*\\('));
    }
  }
});

test('explicit local declarations are also served byte-for-byte', async () => {
  for(const name of ['scspsynth.d.ts','scsp.d.ts'])assert.deepEqual(
    await readFile(new URL('../../tetorica_src/runtime/'+name,import.meta.url)),
    await readFile(new URL('../js/'+name,import.meta.url)));
});

test('standalone SCSP hand declarations resolve in an isolated browser consumer',async()=>{
  const work=await mkdtemp(join(tmpdir(),'standalone-scsp-dsp-types-'));
  const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
  try {
    for(const name of ['scspsynth.d.ts','scsp.d.ts'])await writeFile(join(work,name),await readFile(new URL('../js/'+name,import.meta.url)));
    await writeFile(join(work,'entry.mts'),`import type {Scsp} from './scsp.js';
import {ScspSynth,type ScspDspProgram,type ScspMix} from './scspsynth.js';
declare const core:Scsp;
const chip=new ScspSynth(core);
const legacyMix:ScspMix={totalLevel:12,directLevel:7,pan:0};
chip.setMix(0,legacyMix);
const setup:ScspDspProgram=chip.applyDspProgram(new Uint16Array(512),{coefficients:{0:2048,1:0,2:0}});
chip.setDspReturn({level:7});chip.setDspReturn(1,{level:7,pan:15});chip.setDspCoefficients({0:1024});
chip.setMix(1,{dspInput:1,dspSend:7});
const profile:'ram-free'=setup.profile;
const delay:ScspDspProgram=chip.setDspDelay({enabled:true,timeMs:20,feedback:.5});
if(delay.profile==='delay-ring') {const bytes:number=delay.ram.byteLength;void bytes;}
// @ts-expect-error The complete coefficient table is required in an Apply setup.
chip.applyDspProgram(new Uint16Array(512),{coefficients:{1:3840}});
void profile;
`);
    for(const resolution of ['NodeNext','Bundler']){
      await writeFile(join(work,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,skipLibCheck:false,target:'ES2022',module:resolution==='NodeNext'?'NodeNext':'ESNext',moduleResolution:resolution,lib:['ES2022','DOM'],types:[]},files:['entry.mts']}));
      try{execFileSync(process.execPath,[compiler,'-p',join(work,'tsconfig.json')],{stdio:'pipe'});}
      catch(error){assert.fail(error.stdout?.toString()||error.message);}
    }
  }finally{await rm(work,{recursive:true,force:true});}
});
