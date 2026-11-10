import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {selectSynthCodeDeclarations,SYNTH_CODE_GLOBALS} from './synth_code_declarations.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {definitionSource,sourcePosition} from '../playground/playground_monaco_definitions.js';

const shared=await readFile(new URL('../playground/tetorica-playground-globals.d.ts',import.meta.url),'utf8');
const selected=selectSynthCodeDeclarations(shared);
const names=source=>[...new Set([...source.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm)].map(value=>value[1]))].sort();

test('Code declaration globals match the running lightweight host and exclude the independent rack',async()=>{
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>0,useSoundChip:async()=>({}),getFm:()=>({clock:7670454}),guardExecution:false});
  try {
    await runtime.run('context.names = Object.keys(pg).sort();');
    assert.deepEqual(names(selected),runtime.getContext().names);
    assert.deepEqual(names(selected),[...SYNTH_CODE_GLOBALS].sort());
    assert(selected.length<shared.length/3,'only reachable chip and helper interfaces are included');
    assert.doesNotMatch(selected,/declare (?:function|const|var) (?:play|createSoundChip|midi|psg|dac|sample|cdda|CH7|createTimeline)\b/);
    assert.doesNotMatch(selected,/type PlaygroundSoundChipMap|interface Playground(?:Nes|Ps1|Scsp|Sid|Snes)/);
    assert.match(shared,/^declare function play\(/m,'the normal Playground keeps its play helper');
  }finally{await runtime.stop();}
});

test('Code types accept its four clients, shared helpers and FX while rejecting unavailable globals and channels',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'synth-code-types-'));
  try {
    await writeFile(join(scratch,'globals.d.ts'),selected);
    await writeFile(join(scratch,'entry.ts'),`export {};
const fm = await useSoundChip('ym2612');
fm.setPreset(CH1, FM_PRESETS.sine);
fm.noteOn(CH1, 'C4'); fm.noteOff(CH1);
const psg = await useSoundChip('segapsg'); psg.tone(PSG1,{note:'C4'}); psg.keyOn(3); psg.noteOff(3);
const pcm = await useSoundChip('rf5c164');
pcm.setChannel(7,{volume:64,pan:{left:15,right:0}}); pcm.keyOn(7); pcm.noteOff(7);
const rawStep:number = pcm.setNote(0,'E1'); pcm.setPitch(0,rawStep);
const midi:number=60; pcm.setNote(7,midi); pcm.setNote(0,0); pcm.setNote(7,127);
const effectiveRoot:number=pcm.setRootNote('A4');
pcm.setRootNote(midi); pcm.setRootNote(0); pcm.setRootNote(127); pcm.setRootNote(null);
const started:void|Promise<void> = pcm.noteOn(0,'C4'); await started;
await pcm.noteOn(7,127); pcm.noteOff(0);
await pcm.loadSample(new Uint8Array([1,2]),{loopStart:0});
const pwm = await useSoundChip('pwm'); await pwm.writeRegister(1,1047); await pwm.setClock(23011361);
setBpm(120); await beat(.5); await sleep(.01); await sleepSamples(4);
liveLoop('phrase',async()=>{
  fm.noteOn(CH2,'C4'); await sleep(.125); fm.noteOff(CH2); await beat(.25);
});
const prepared = await livePrepare('state', async api=>{
  api.fm.noteOn(CH1,'D4'); const tone=await api.useSoundChip('segapsg');
  // @ts-expect-error sample playback is not a Code global
  api.sample.stopAll();
  // @ts-expect-error prepared Code also requires an explicit instrument
  api.play('D4');
  return {tone,count:0};
});
liveFx('gain',{context:{gain:.5},process(input,output,state,ctx){for(let i=0;i<output[0].length;i++)output[0][i]=input[0][i]*ctx.gain;}});
pg.fx.setChain([pg.fx.gain({gain:.5})]); pg.log('hello'); trackAsync(Promise.resolve());
parseNoteName('C4'); toPitch(60); midiToNoteName(60); await tween({beats:1},progress=>{context.position=progress;});
await file('preset.vgi',{type:'arrayBuffer'}); await file<{title:string}>('data.json',{type:'json'});
// @ts-expect-error Code always names the acquired instrument instead of implicit play
await play('C4');
// @ts-expect-error pg has no implicit play helper either
await pg.play('C4');
// @ts-expect-error independent chip creation belongs to Playground
createSoundChip('ym2612');
// @ts-expect-error unsupported chip
await useSoundChip('ps1');
// @ts-expect-error no options or independent instances in Code
await useSoundChip('ym2612',{id:'second'});
// @ts-expect-error only six FM channels
fm.noteOn(6,'C4');
// @ts-expect-error only eight PCM channels
pcm.keyOn(8);
// @ts-expect-error software tuning also uses the eight physical PCM channels
pcm.setNote(8,'C4');
// @ts-expect-error PCM notes do not accept a negative channel
pcm.noteOn(-1,'C4');
// @ts-expect-error software release also uses the eight physical PCM channels
pcm.noteOff(8);
// @ts-expect-error a note must be a string or number
pcm.noteOn(0,true);
// @ts-expect-error MIDI numbers are passed directly rather than wrapped in an object
pcm.setNote(0,{midi:60});
// @ts-expect-error noteOn requires a note instead of an implicit default pitch
pcm.noteOn(0);
// @ts-expect-error setNote returns the raw numeric RF5C164 step
const incorrectStep:string=pcm.setNote(0,'C4');
// @ts-expect-error starting a note does not return a success boolean
const incorrectStart:boolean=await pcm.noteOn(0,'C4');
// @ts-expect-error a Root override must be a note name, MIDI number or null
pcm.setRootNote(true);
// @ts-expect-error Root overrides do not take note descriptor objects
pcm.setRootNote({note:'A4'});
// @ts-expect-error null is required to inherit the UI Root; omitted arguments are not accepted
pcm.setRootNote();
// @ts-expect-error setRootNote returns the effective MIDI number rather than a note name
const incorrectRoot:string=pcm.setRootNote('A4');
// @ts-expect-error no implicit global PSG
psgTone(0,100);
// @ts-expect-error CH7 is not a physical FM channel
log(CH7);
// @ts-expect-error pg exposes exactly the Code host
pg.midi.output('tetorica-ym2612',{});
// @ts-expect-error Synth PSG has no stereo register
psg.setStereo(255);
// @ts-expect-error borrowed YM2612 has no clock setter
fm.setClock(8000000);
// @ts-expect-error PCM loading accepts local data, never a URL
await pcm.loadSample('https://example.invalid/audio.wav');
`);
    await writeFile(join(scratch,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,skipLibCheck:false,target:'ES2022',module:'ESNext',moduleResolution:'Bundler',lib:['ES2022'],types:[]},files:['globals.d.ts','entry.ts']}));
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    execFileSync(process.execPath,[compiler,'-p',join(scratch,'tsconfig.json')],{stdio:'pipe'});
  }catch(error){if(error.stdout)assert.fail(error.stdout.toString());throw error;}
  finally{await rm(scratch,{recursive:true,force:true});}
});

test('Code helper implementation links use the lightweight source and chip definitions retain their original implementation',async()=>{
  const runtime=await readFile(new URL('../js/playground_code_runtime.js',import.meta.url),'utf8');
  for(const symbol of ['useSoundChip','setBpm','beat','nextBeat','sleep','sleepSamples','tween','liveLoop','livePrepare','liveFx','stopLoop','stopAllLoops','liveCleanup','trackAsync','file','log']) {
    const lines=selected.split('\n'),line=lines.findIndex(text=>new RegExp(`^declare (?:function|const|var) ${symbol}\\b`).test(text));
    assert(line>=0,symbol);
    const target=definitionSource(selected,{lineNumber:line+1,column:lines[line].indexOf(symbol)+1},'ym2612',{runtimeFile:'playground_code_runtime.js'});
    assert.deepEqual(target,{file:'playground_code_runtime.js',symbol});
    const point=sourcePosition(runtime,symbol);assert(point.lineNumber>1,symbol);
    assert.match(runtime.split('\n')[point.lineNumber-1],new RegExp(`\\b${symbol}\\s*[(=:]`));
  }
  assert.deepEqual(definitionSource('type FMApi = {\n  setFrequency():void;\n}',{lineNumber:2,column:3},'ym2612',{runtimeFile:'playground_code_runtime.js'}),{file:'ym2612synth.js',symbol:'setFrequency'});
  assert.deepEqual(definitionSource('type PSGApi = {\n  setPeriod():number;\n}',{lineNumber:2,column:3},'ym2612',{runtimeFile:'playground_code_runtime.js'}),{file:'segapsgsynth.js',symbol:'setPeriod'});
});
