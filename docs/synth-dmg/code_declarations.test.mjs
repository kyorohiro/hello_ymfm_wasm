import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GAMEBOY_CODE_GLOBALS,selectGameboyCodeDeclarations} from './code_declarations.js';
import {definitionSource,sourcePosition} from '../playground/playground_monaco_definitions.js';

const shared=await readFile(new URL('../playground/tetorica-playground-globals.d.ts',import.meta.url),'utf8'),selected=selectGameboyCodeDeclarations(shared);
test('DMG declarations contain physical/nested APU controls and shared helpers only',()=>{
  const names=[...new Set([...selected.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm)].map(match=>match[1]))].sort();
  assert.deepEqual(names,[...GAMEBOY_CODE_GLOBALS].sort());assert.doesNotMatch(selected,/declare (?:function|const) (?:fm|sid|play|createSoundChip|CH5|CH6|PSG1|OP1)\b/);
  assert.doesNotMatch(selected,/interface Playground(?:Sid|Ps1|Nes|Snes)|type FMApi/);assert.match(selected,/keyOn\(\): Promise<void>/);
});
test('DMG async nested API, state and channel limits typecheck without unrelated chip helpers',async()=>{
  const work=await mkdtemp(join(tmpdir(),'dmg-code-types-'));
  try{
    await writeFile(join(work,'globals.d.ts'),selected);await writeFile(join(work,'entry.ts'),`export {};
const gb=await useSoundChip('gameboy');
const pulse:Promise<void>=gb.pulse.setVoice(CH1,{duty:.25,volume:8,envelope:{period:2}});await pulse;
const hz:Promise<number>=gb.wave.setNote('E3');await hz;await gb.wave.noteOn(60);await gb.wave.keyOff();
await gb.noise.setParameters({divisor:3,width:7,shift:4});await gb.noise.keyOn();await gb.keyOff(CH4);
await gb.setPan(CH3,true,false);await gb.initialize();await gb.reset();await gb.allNotesOff();
const state=await gb.getState();const source:'pulse'|'wave'|'noise'=state.editorSource;state.registers[0];state.voice[0];state.positionFrames;
await livePrepare('state',async api=>{const chip=await api.useSoundChip('gameboy');return chip;});
liveLoop('notes',async()=>{await gb.pulse.noteOn(CH2,choose(scale('E3','minorPentatonic',2)));await beat(.5);await gb.pulse.keyOff(CH2);});
await tween({seconds:2},async value=>{await gb.pulse.setDuty(CH1,value>.5?.25:.5);});pg.log(source);await gb.dispose();
// @ts-expect-error only DMG is borrowed
await useSoundChip('sid');
// @ts-expect-error Noise has no per-note pitch
await gb.noise.noteOn('C4');
// @ts-expect-error Pulse has two physical channels
await gb.pulse.noteOn(CH3,'C4');
// @ts-expect-error setters cross the Worklet
const sync:void=gb.keyOff(CH4);
// @ts-expect-error the Synth keeps its existing physical DMG clock
await gb.setClock(4000000);
// @ts-expect-error no implicit FM helper
play('C4');
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});
  }finally{await rm(work,{recursive:true,force:true});}
});
test('DMG methods and clock helpers keep readable implementation targets',async()=>{
  const lines=selected.split('\n'),gameboy=await readFile(new URL('../js/gameboysynth.js',import.meta.url),'utf8');
  for(const symbol of ['setNote','keyOn','setPan','setVoice']){
    const line=lines.findIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0);
    assert.deepEqual(definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'gameboy',{runtimeFile:'playground_code_runtime.js'}),{file:'gameboysynth.js',symbol});
    const location=sourcePosition(gameboy,symbol);assert(location.lineNumber>1);
    if(symbol==='setVoice')assert.match(gameboy.split('\n')[location.lineNumber-1],/^\s*setVoice:/,'Nested pulse API opens its readable implementation, not its typedef');
  }
});
