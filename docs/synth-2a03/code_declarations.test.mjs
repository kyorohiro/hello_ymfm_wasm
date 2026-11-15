import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NES_CODE_GLOBALS,selectNesCodeDeclarations} from './code_declarations.js';
import {definitionSource,sourcePosition} from '../playground/playground_monaco_definitions.js';

const shared=await readFile(new URL('../playground/tetorica-playground-globals.d.ts',import.meta.url),'utf8'),selected=selectNesCodeDeclarations(shared);
test('NES declarations expose the borrowed six-channel APU and shared helpers only',()=>{
  const names=[...new Set([...selected.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm)].map(match=>match[1]))].sort();
  assert.deepEqual(names,[...NES_CODE_GLOBALS].sort());
  assert.doesNotMatch(selected,/declare (?:function|const) (?:fm|sid|play|createSoundChip|PSG1|OP1)\b/);
  assert.doesNotMatch(selected,/interface Playground(?:Sid|Ps1|Gameboy|Snes)|type FMApi/);
  assert.match(selected,/setWave\(wave:ArrayLike<number>\):Promise<void>/);
});
test('NES async channel helpers and nested hardware API typecheck',async()=>{
  const work=await mkdtemp(join(tmpdir(),'nes-code-types-'));
  try{
    await writeFile(join(work,'globals.d.ts'),selected);await writeFile(join(work,'entry.ts'),`export {};
const nes=await useSoundChip('nes');
const voice:Promise<void>=nes.pulse.setVoice(CH1,{duty:.25,volume:8,envelope:{period:2}});await voice;
const timer:Promise<number>=nes.fds.setFrequency(440);await timer;
const pitch:Promise<number>=nes.pulse.setNote(CH1,'E3');await pitch;
const attack:Promise<{channel:NesCodeChannel}>=nes.triangle.noteOn('E3');await attack;
const released:Promise<boolean>=nes.keyOff(CH3);await released;
await nes.noteOn(CH3,'E3');await nes.noteOn(CH4,60);await nes.keyOn(CH5);await nes.noteOff(CH6);
await nes.fds.setWave(Array(64).fill(32));await nes.fds.setModulation({table:Array(32).fill(0),rate:256});
await nes.dmc.loadSample(Uint8Array.of(0));await nes.dmc.play({rate:15,level:64});
await nes.loadMemory(Uint8Array.of(0),0xc000);await nes.reset();await nes.allNotesOff();
const state=await nes.getState();const source:'pulse'|'triangle'|'noise'|'dmc'|'fds'=state.preset.source;state.registers[0];
state.preset.pulse.sweep.shift;state.preset.fds.modulation.envelope.initialGain;state.channelPresets[0].dmc.data;
await livePrepare('state',async api=>{const chip=await api.useSoundChip('nes');return chip;});
liveLoop('notes',async()=>{await nes.noteOn(CH1,choose(scale('E3','minorPentatonic',2)));await beat(.5);await nes.noteOff(CH1);});
await tween({seconds:2},async value=>{await nes.pulse.setVoice(CH1,{duty:value>.5?.25:.5});});pg.log(source);await nes.dispose();
// @ts-expect-error only NES is borrowed
await useSoundChip('sid');
// @ts-expect-error Pulse has two physical channels
await nes.pulse.noteOn(CH3,'C4');
// @ts-expect-error setters cross the Worklet
const sync:void=nes.keyOff(CH4);
// @ts-expect-error triangle tuning has no noise channel
await nes.setNote(CH4,'C4');
// @ts-expect-error no implicit FM helper
play('C4');
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});
  }finally{await rm(work,{recursive:true,force:true});}
});
test('2A03 methods and clock helpers keep readable implementation targets',async()=>{
  const lines=selected.split('\n'),nes=await readFile(new URL('../js/nesapusynth.js',import.meta.url),'utf8');
  for(const symbol of ['setNote','keyOn','setVoice']){
    const line=lines.findLastIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0);
    assert.deepEqual(definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'nes',{runtimeFile:'playground_code_runtime.js'}),{file:'nesapusynth.js',symbol});
    const location=sourcePosition(nes,symbol);assert(location.lineNumber>1);
    if(symbol==='setVoice')assert.match(nes.split('\n')[location.lineNumber-1],/^\s*setVoice:/,'Nested pulse API opens its readable implementation');
  }
});
test('Synth-specific NES methods open the shared borrowed-client implementation',async()=>{
  const lines=selected.split('\n'),endpoint=await readFile(new URL('./code_endpoint.js',import.meta.url),'utf8');
  for(const symbol of ['noteOn','keyOn','getState','allNotesOff','dispose']){
    const line=lines.findIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0);
    const target=definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'nes',{runtimeFile:'playground_code_runtime.js'});
    assert.deepEqual(target,{file:'synth-2a03/code_endpoint.js',symbol:'createNesCodeClient'});
    assert(sourcePosition(endpoint,target.symbol).lineNumber>1);
  }
});
