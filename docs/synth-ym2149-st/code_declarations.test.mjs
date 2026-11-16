import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { YM_CODE_GLOBALS, selectYmCodeDeclarations } from './code_declarations.js';
import { YM_STARTER_CODE } from './code_host.js';
import { definitionSource, sourcePosition, runtimeSourceUrl } from '../playground/playground_monaco_definitions.js';
const shared = await readFile(new URL('../playground/tetorica-playground-globals.d.ts', import.meta.url),'utf8');
const selected = selectYmCodeDeclarations(shared);

test('YM2149 ST declarations expose one borrowed three-channel AY and supported shared globals',()=>{
 const names=[...new Set([...selected.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm)].map(m=>m[1]))].sort();
 assert.deepEqual(names,[...YM_CODE_GLOBALS].sort());
 assert.doesNotMatch(selected,/declare (?:function|const) (?:fm|sid|play|createSoundChip|readFile|CH4|CH5|CH6|OP1)\b/);
 assert.doesNotMatch(selected,/interface Playground(?:Sid|Ps1|Nes|Snes)|type FMApi/);
 const body=source=>source.match(/interface PlaygroundAy8910 \{[\s\S]*?^\}/m)?.[0];
 assert.equal(body(selected),body(shared),'the existing public AY method signatures stay synchronous and intact');
 assert.match(selected,/getState\(\):YmCodeState/);
});

test('YM2149 ST synchronous AY controls, preset snapshots and three-channel limits typecheck with starter',async()=>{
 const work=await mkdtemp(join(tmpdir(),'ym2149-st-code-types-'));
 try {
  await writeFile(join(work,'globals.d.ts'),selected);
  await writeFile(join(work,'starter.js'),'export {};\n'+YM_STARTER_CODE);
  await writeFile(join(work,'entry.ts'),`export {};
const ym=await useSoundChip('ay8910');
const init:void=ym.initialize();const reset:void=ym.reset();
const hz:number=ym.setNote(CH3,'E3');const write:void=ym.setVoice(CH1,{tone:true,noise:false,period:100,volume:9});
const period:number=ym.tone(CH2,{note:'E4',envelope:true});const other:number=ym.setTone(CH2,{period:283});
ym.noise(CH3,{period:7,volume:3});ym.setMixer(CH1,{tone:true,noise:true});ym.setVolume(CH1,0,true);
ym.setEnvelope({period:65535,shape:15});ym.setNoisePeriod(31);ym.setTonePeriod(CH1,4095);ym.setFrequency(CH1,440);
ym.writeRegister(7,0x38);const registers:Uint8Array=ym.getRegisterSnapshot();
ym.noteOn(CH2,60);ym.noteOff(CH2);ym.keyOn(CH1);ym.keyOff(CH3);ym.off(CH2);ym.allNotesOff();
const state=ym.getState();const raw:number=state.preset.voices[0].period;const channel:0|1|2|null=state.selectedChannel;
state.registers[0];state.activeChannels[0];state.revision;const initialized:true=state.initialized;
await livePrepare('state',async api=>api.useSoundChip('ay8910'));pg.log(raw);const disposed:void=ym.dispose();
// @ts-expect-error the Synth borrows one AY-compatible YM2149
await useSoundChip('sid');
// @ts-expect-error only three physical channels
ym.noteOn(3,'C4');
// @ts-expect-error hardware writes stay synchronous
const asyncWrite:Promise<void>=ym.keyOff(CH3);
// @ts-expect-error snapshot retrieval stays synchronous
const asyncState:Promise<YmCodeState>=ym.getState();
// @ts-expect-error the clock belongs to the editor
ym.setClock(4000000);
// @ts-expect-error no independent chip factory
createSoundChip('ay8910');
// @ts-expect-error no global FM-style play helper
play('C4');
// @ts-expect-error no unsupported global readFile helper
readFile('/notes.json');
`);
  execFileSync(process.execPath,[fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url)),
   '--strict','--checkJs','--allowJs','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext',
   '--moduleResolution','Bundler','--lib','ES2022',join(work,'globals.d.ts'),join(work,'entry.ts'),join(work,'starter.js')],{stdio:'pipe'});
 } catch(error) {throw Error(error.stdout?.toString()||error.message);}
 finally {await rm(work,{recursive:true,force:true});}
});

test('YM2149 ST API methods retain readable AY implementation navigation',async()=>{
 const source=await readFile(new URL('../js/ay8910synth.js',import.meta.url),'utf8');
 const lines=selected.split('\n');
 for(const symbol of ['setNote','setVoice','setEnvelope','setMixer','getRegisterSnapshot']) {
  const line=lines.findIndex(text=>text.trimStart().startsWith(symbol+'('));
  assert(line>=0);
  const target=definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'atari-st',{runtimeFile:'playground_code_runtime.js'});
  assert.deepEqual(target,{file:'ay8910synth.js',symbol});
  assert(sourcePosition(source,symbol).lineNumber>1);
  assert.equal(runtimeSourceUrl(target.file).pathname.endsWith('/docs/js/ay8910synth.js'),true);
 }
});
