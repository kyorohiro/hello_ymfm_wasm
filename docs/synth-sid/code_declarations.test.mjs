import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SID_CODE_GLOBALS,selectSidCodeDeclarations} from './code_declarations.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {definitionSource,sourcePosition} from '../playground/playground_monaco_definitions.js';

const shared=await readFile(new URL('../playground/tetorica-playground-globals.d.ts',import.meta.url),'utf8');
const selected=selectSidCodeDeclarations(shared);
const names=source=>[...new Set([...source.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm)].map(value=>value[1]))].sort();

test('SID Code declarations expose its selected client and shared helpers without the FM rack or independent factory',async()=>{
  assert.deepEqual(names(selected),[...SID_CODE_GLOBALS].sort());
  assert.doesNotMatch(selected,/declare (?:function|const|var) (?:sid|fm|play|FM_PRESETS|createSoundChip|midi|CH4|PSG1|OP1)\b/);
  assert.doesNotMatch(selected,/interface Playground(?:Nes|Ps1|Scsp|Snes|Rf5c164)|type FMApi/);
  assert.match(selected,/noteOn\(channel:PlaygroundSidChannel,note:string\|number\):Promise<void>/);
  assert.match(selected,/allNotesOff\(\):Promise<void>/);
  assert.match(selected,/setNote\(channel:PlaygroundSidChannel,note:string\|number\):Promise<number>/);
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>0,supportedSoundChips:['sid'],useSoundChip:async()=>({}),guardExecution:false});
  try {
    await runtime.run('context.names=Object.keys(pg);');
    for(const name of SID_CODE_GLOBALS)assert(runtime.getContext().names.includes(name),name);
  }finally{await runtime.stop();}
});

test('SID Code types validate physical channels, asynchronous setters, supported chip names and livePrepare/pg',async()=>{
  const work=await mkdtemp(join(tmpdir(),'sid-synth-code-types-'));
  try {
    await writeFile(join(work,'globals.d.ts'),selected);
    await writeFile(join(work,'entry.ts'),`export {};
const sid=await useSoundChip('sid');
const sid2=await pg.useSoundChip('sid');
const id:string=sid.id, voices:3=sid.channels, model:'6581'|'8580'=sid.model;
const setter:Promise<void>=sid.setVoice(CH1,{waveform:'triangle+saw',pulseWidth:2048,attack:2,sustain:12});
await setter; await sid2.setFilter({mode:'notch',cutoff:1200,resonance:5,routing:7});
const frequency:Promise<number>=sid.setFrequency(CH2,440);
const note:Promise<number>=sid.setNote(CH3,69);
await sid.noteOn(CH1,'C4');await sleep(.2);await sid.noteOff(CH1);
await sid.keyOn(CH2);await sid.keyOff(CH2);await sid.allNotesOff();
await sid.writeRegister(24,15);await sid.reset();await sid.initialize();await sid.dispose();
const state:PlaygroundSidState=await sid.getState();const gate:boolean=state.channels[0].gate;
const read:Promise<number>=sid.readRegister(27);const clock:Promise<boolean>=sid.setClock(sid.clock);
liveLoop('phrase',async()=>{await sid.noteOn(CH3,choose(scale('C4','minor')));await beat(.5);await sid.noteOff(CH3);});
await livePrepare('state',async api=>{const instrument=await api.useSoundChip('sid');await instrument.setNote(0,60);api.log('ready');
  // @ts-expect-error the borrowed host has no implicit default-FM play helper
  api.play('C4');
  return instrument;
});
await file('voice.sid.json',{type:'text'});await file<{name:string}>('voice.json',{type:'json'});
liveFx('gain',{context:{gain:.5},process(input,output,state,ctx){output[0].set(input[0]);}});
await tween({beats:1},async progress=>{await sid.setFilter({cutoff:Math.round(2047*progress)});});
context.position=cycle([0,1]);parseNoteName('C4');midiToNoteName(60);stopLoop('phrase');pg.stopAllLoops();
// @ts-expect-error only the existing SID can be borrowed
await useSoundChip('ym2612');
// @ts-expect-error an independent instance is outside Synth Code
createSoundChip('sid');
// @ts-expect-error useSoundChip accepts no instance options
await useSoundChip('sid',{id:'extra'});
// @ts-expect-error only physical channels zero through two exist
sid.noteOn(3,'C4');
// @ts-expect-error negative physical channels are unavailable
sid.setVoice(-1,{waveform:'saw'});
// @ts-expect-error Synth Code uses explicit SID handles
play('C4');
// @ts-expect-error there is no implicit FM client
fm.noteOn(0,'C4');
// @ts-expect-error a SID has no CH4 constant
sid.noteOn(CH4,'C4');
// @ts-expect-error raw note conversion is acknowledged asynchronously
const wrongNote:number=sid.setNote(0,'C4');
// @ts-expect-error the state is read asynchronously from the audio owner
const wrongState:PlaygroundSidState=sid.getState();
// @ts-expect-error note must be a note name or integer MIDI value
sid.noteOn(0,true);
// @ts-expect-error raw waveform flags use the shared canonical names
sid.setVoice(0,{waveform:'sine'});
`);
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022',
      '--module','ESNext','--moduleResolution','Bundler','--lib','ES2022',join(work,'globals.d.ts'),join(work,'entry.ts')],{stdio:'pipe'});
  } finally {await rm(work,{recursive:true,force:true});}
});

test('SID declarations keep the existing Monaco source mappings for shared clock helpers and SID hardware methods',async()=>{
  const lines=selected.split('\n'),runtime=await readFile(new URL('../js/playground_code_runtime.js',import.meta.url),'utf8');
  for(const symbol of ['useSoundChip','liveLoop','sleep','stopLoop']) {
    const line=lines.findIndex(value=>value.startsWith('declare function '+symbol+'(')||value.startsWith('declare function '+symbol+'<'));
    assert(line>=0,symbol);
    assert.deepEqual(definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'c64',{runtimeFile:'playground_code_runtime.js'}),
      {file:'playground_code_runtime.js',symbol});
    assert(sourcePosition(runtime,symbol).lineNumber>1,symbol);
  }
  for(const [symbol,file,target=symbol]of [['noteOn','sidsynth.js'],['setVoice','sidsynth.js'],['setFilter','sidsynth.js'],['getState','playground_sid.js','createSidRegisterClient']]) {
    const line=lines.findIndex(value=>value.trimStart().startsWith(symbol+'('));assert(line>=0,symbol);
    assert.deepEqual(definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'c64',{runtimeFile:'playground_code_runtime.js'}),{file,symbol:target});
  }
});
