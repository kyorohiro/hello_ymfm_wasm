import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import {YM2612Synth} from '../../web/ym2612synth.js';
import {RF5C164Synth} from '../../web/rf5c164synth.js';
import {createRf5c164Client} from '../../web/playground_rf5c164.js';
import {FM_PRESETS} from '../../web/megasynth-fm-presets.js';
import {presetToVoice,voiceToPreset} from '../../web/msfa_dx7/src/preset.js';
import {EXAMPLE_FILES,MODE_EXAMPLE_FILES} from './playground_examples.js';

const path='/examples/genesis/mixed-chip-stability.js';
const source=await readFile(new URL('.'+path,import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function scene(t){
  const fmWrites=[],gates=Array(6).fill(false),memory=[],pcmWrites=[],samples=[],notes=[],releases=[],active=new Set(),mixes=[],creates=[],loops=new Map(),cleanups=new Map(),prepared=new Map(),beats=[];
  const lead=new YM2612Synth({transport:{write(port,register,value){fmWrites.push([port,register,value]);if(port===0&&register===0x28){const channel=[0,1,2,4,5,6].indexOf(value&7);if(channel>=0)gates[channel]=!!(value&240);}},reset(){}}});lead.id='scene-fm';
  const pcm=new RF5C164Synth({transport:{write:(...entry)=>pcmWrites.push(entry),loadMemory:bytes=>memory.push(bytes.slice()),reset(){}}});
  const {port1,port2}=new MessageChannel();
  port2.onmessage=async({data})=>{if(data.method==='dispose')return;try{const value=await pcm[data.method](...data.args);port2.postMessage({id:data.id,value});}catch(error){port2.postMessage({id:data.id,error:error.message});}};
  const bass=createRf5c164Client(port1,()=>{throw Error('The generated sample needs no file decoder');},{clock:12500000});bass.id='scene-pcm';
  const loadSample=bass.loadSample.bind(bass);bass.loadSample=(data,options)=>{samples.push({data,options});return loadSample(data,options);};
  let preset;
  const pad={id:'scene-dx7',async setPreset(value){preset=voiceToPreset(presetToVoice(value));},noteOn(midi,velocity){assert(Number.isInteger(midi)&&midi>=0&&midi<=127);assert(Number.isInteger(velocity)&&velocity>0&&velocity<=127);notes.push(midi);active.add(midi);},noteOff(midi){releases.push(midi);active.delete(midi);},allNotesOff(){active.clear();}};
  let binding;
  const api={FM_PRESETS,
    async createSoundChip(kind,options){creates.push({kind,...options});return {ym2612:lead,rf5c164:bass,dx7:pad}[kind];},
    livePrepare(name,prepare){if(!prepared.has(name))prepared.set(name,Promise.resolve().then(prepare));return prepared.get(name);},
    liveLoop:(name,run)=>loops.set(name,run),liveCleanup:(names,run)=>cleanups.set(names[0],run),
    mixer:{async set(id,value){mixes.push({id,...value});}},setBpm:value=>assert.equal(value,96),
    beat:async value=>{assert(value>0);beats.push(value);},keyboard:{bind(name,handlers){binding={name,handlers};}},log:message=>assert.match(message,/^Mixed chip scene ready/),
  };
  const evaluate=()=>new AsyncFunction(...Object.keys(api),source)(...Object.values(api));await evaluate();
  t.after(()=>{bass.dispose();port2.close();});
  return {lead,bass,pcm,pad,creates,loops,cleanups,beats,prepared,mixes,samples,memory,pcmWrites,fmWrites,gates,notes,releases,active,evaluate,get binding(){return binding;},get preset(){return preset;}};
}

test('one mixed-chip source is discoverable in Genesis catalogs; Mega-CD keeps its dedicated compact catalog',()=>{
  const files=EXAMPLE_FILES.filter(file=>file.path===path);assert.equal(files.length,1);assert.equal(files[0].data,source);
  for(const mode of ['genesis','genesis-nuked','genesis-full','genesis-full-nuked'])assert(MODE_EXAMPLE_FILES[mode].includes(files[0]),mode);
  assert(!MODE_EXAMPLE_FILES['mega-cd'].includes(files[0]));
});
test('the mixed scene uses real FM/RF controls, original bounded PCM, a valid DX7 voice and a balanced deterministic phrase',async t=>{
  const f=await scene(t);assert.deepEqual(f.creates,[{kind:'ym2612',id:'scene-fm'},{kind:'rf5c164',id:'scene-pcm'},{kind:'dx7',id:'scene-dx7'}]);
  assert.deepEqual(f.mixes,[{id:'scene-fm',volume:.45,pan:-.15},{id:'scene-pcm',volume:.55,pan:.1},{id:'scene-dx7',volume:.3,pan:.15}]);
  const sample=f.samples[0];assert.equal(sample.data.sampleRate,12000);assert.equal(sample.options.endGuardBytes,32);const wave=sample.data.channels[0];assert.equal(wave[0],0);assert.equal(wave.at(-1),0);assert(wave.every(Number.isFinite));assert(Math.max(...wave.map(Math.abs))<=.6);assert(wave.some(value=>Math.abs(value)>.1));
  assert(f.memory[0].length<65536);assert(f.memory[0].subarray(-32).every(value=>value===255));assert(!f.memory[0].subarray(0,wave.length).includes(255),'PCM body cannot contain an end marker');
  assert.equal(f.preset.operators[1].outputLevel,78);assert.equal(f.preset.operators[1].envelope.levels[3],0);assert.equal(f.loops.size,1);
  await f.loops.get('mixed-chip-scene')();assert(Math.abs(f.beats.reduce((a,b)=>a+b,0)-64)<1e-9,'one cycle is sixteen bars / forty seconds');
  assert.equal(f.fmWrites.filter(([,r,v])=>r===0x28&&(v&240)).length,128);assert.equal(f.notes.length,12);assert.deepEqual(f.releases,f.notes);assert.equal(f.active.size,0);assert(f.gates.every(value=>!value));assert.equal(f.pcm.channelMask,255);
  const first=f.notes.slice();await f.loops.get('mixed-chip-scene')();assert.deepEqual(f.notes.slice(first.length),first,'a repeat uses the same notes rather than random choices');
  await f.evaluate();assert.equal(f.creates.length,3,'a live-edit Run reuses the three prepared IDs');
});
test('the mixed Keyboard owns CH2–6 by press ID and cleanup releases the independent scene',async t=>{
  const f=await scene(t),keys=f.binding.handlers;assert.match(f.binding.name,/YM2612 CH2–6/);f.lead.noteOn(0,72);
  keys.noteOn({id:'old',midi:60});keys.noteOn({id:'new',midi:60});keys.noteOff({id:'old'});assert.equal(f.gates[1],false);assert.equal(f.gates[2],true);assert.equal(f.gates[0],true);
  for(let i=0;i<5;i++)keys.noteOn({id:`fill${i}`,midi:64+i});assert.equal(f.gates.filter(Boolean).length,6,'Keyboard cannot borrow the scene channel');
  keys.noteOff({id:'old'});assert.equal(f.gates[2],true,'an old release cannot cut a newer press');keys.allNotesOff();assert.deepEqual(f.gates,[true,false,false,false,false,false]);
  await f.bass.keyOn(0);f.pad.noteOn(60,68);await f.cleanups.get('mixed-chip-scene')();assert(f.gates.every(value=>!value));assert.equal(f.pcm.channelMask,255);assert.equal(f.active.size,0);
});
