import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectSnesCodeDeclarations} from './code_declarations.js';
const source=await readFile(new URL('../playground/tetorica-playground-globals.d.ts',import.meta.url),'utf8');
test('S-DSP declarations expose the actual borrowed performance API and reject raw chip factories',async()=>{
  const selected=selectSnesCodeDeclarations(source),work=await mkdtemp(join(tmpdir(),'snes-code-types-'));
  assert.doesNotMatch(selected,/declare (?:function|const) (?:fm|play|createSoundChip)\b/);
  try{
    await writeFile(join(work,'globals.d.ts'),selected);
    await writeFile(join(work,'entry.ts'),`export {};
const snes=await useSoundChip('snes');
await snes.noteOn(CH1,'C4');await beat(.5);await snes.noteOff(CH1);
await snes.noteOn(7,60);const state:SnesCodeState=await snes.getState();
const active:boolean=state.pmon.active;
liveLoop('melody',async()=>{await snes.noteOn(CH2,choose(scale('C4','minor')));await beat(.25);await snes.noteOff(CH2);});
await livePrepare('chip',async api=>api.useSoundChip('snes'));
await pg.useSoundChip('snes');await snes.allNotesOff();await snes.dispose();
// @ts-expect-error unsupported borrowed chip
await useSoundChip('ym2612');
// @ts-expect-error no ninth performance lane
snes.noteOn(8,'C4');
// @ts-expect-error use the editor to change the authored BRR/Echo bank
snes.writeDsp(0x4c,1);
// @ts-expect-error no independent instance
createSoundChip('snes');
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});}catch(e){throw Error(e.stdout?.toString()||e.message);}
  }finally{await rm(work,{recursive:true,force:true});}
});
