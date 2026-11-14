// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {Huc6280Instrument} from './instrument.js';
import {waveShape} from './preset.js';
import {prepareHuc6280SongVoice} from './song_voice.js';
import {createHuc6280SongAudition} from './song_audition.js';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function snapshot(channel=2){
  const globals=Array(10).fill(0),registers=Array.from({length:8},()=>Array(8).fill(0)),waveforms=Array.from({length:8},()=>null);
  globals[1]=255;registers[channel][2]=172;registers[channel][3]=1;registers[channel][4]=128|24;registers[channel][5]=255;waveforms[channel]=waveShape('sine');
  return{clock:3579545,positionFrames:4096,globals,registers,waveforms};
}
function fixture(t,{initial=snapshot(),channel=2,ensureGate,createGate,onGate,failure,realCreate}={}){
  const events=[],clients=[],updates=[];let selection={key:'run/source/frame/CH'+channel,snapshot:initial,channel},ensures=0;
  let engine;
  const makeEngine=()=>({context:{state:'running'},command:()=>assert.fail('Audition never commands the authored PSG'),getHuc6280Client:()=>assert.fail('Audition never borrows Code'),
    async createAuditionVoice(preset,options){
      events.push(['create',preset]);if(createGate)await createGate.promise;
      if(options.signal.aborted||!options.isCurrent())throw new DOMException('Cancelled','AbortError');
      let closed=false;const instrument=await realCreate?.(preset);
      const invoke=async(method,args=[])=>{if(closed||!options.isCurrent())throw new DOMException('Cancelled','AbortError');events.push([method,...args]);
        if(failure===method)throw Error('Private '+method+' failed');if(method==='noteOn'&&onGate)await onGate.promise;
        if(closed||!options.isCurrent())throw new DOMException('Cancelled','AbortError');return instrument?instrument[method](...args):method==='noteOn'?{channel:preset.source==='noise'?4:0}:true;};
      const client={context:engine.context,outputGain:{gain:{value:0}},isCurrent:()=>!closed&&options.isCurrent(),instrument,
        command:invoke,noteOn:(...args)=>invoke('noteOn',args),noteOff:id=>invoke('noteOff',[id]),setPitch:value=>invoke('setPitch',[value]),
        fail(error){options.onError(error);},dispose(){if(closed)return;closed=true;events.push(['dispose']);instrument?.dispose();}};
      clients.push(client);return client;
    }});
  engine=makeEngine();
  const audition=createHuc6280SongAudition({ensureAudio:async()=>{ensures++;if(ensureGate)await ensureGate.promise;return engine;},getAudio:()=>engine,getSelection:()=>selection,onUpdate:value=>updates.push(value),
    createOutput:()=>({fadeOut:async()=>{events.push(['fade']);},open:options=>events.push(['open',options]),dispose:()=>events.push(['outputDispose'])})});
  t.after(()=>audition.dispose());
  return{audition,events,clients,updates,get ensures(){return ensures;},get selection(){return selection;},set selection(value){selection=value;},replaceEngine(){engine=makeEngine();},get engine(){return engine;}};
}

test('paused Wave audition is lazy and uses only its private voice, preserving the source snapshot',async t=>{
  const f=fixture(t),before=structuredClone(f.selection);assert.equal(f.ensures,0);assert.equal(f.events.length,0);
  const result=await f.audition.noteOn('a',60);assert.equal(result.channel,2);assert.equal(f.audition.read().heldCount,1);assert.equal(f.audition.read().soundingCount,1);
  assert.deepEqual(f.selection,before);assert.equal(f.events[0][0],'create');assert(f.events.some(event=>event[0]==='noteOn'&&event[1]==='a'));
  assert.equal(await f.audition.noteOff('a'),true);assert.equal(f.audition.read().heldCount,0);
  const release=f.events.findLastIndex(event=>event[0]==='noteOff');assert.equal(f.events[release-1][0],'fade');
  await f.audition.stop();assert.equal(f.audition.read().soundingCount,0);assert(f.events.some(event=>event[0]==='dispose'));assert.deepEqual(f.selection,before);
});

test('monophonic latest key retriggers behind a fade and an obsolete release cannot stop it',async t=>{
  const f=fixture(t);await f.audition.noteOn('old',60);const result=await f.audition.noteOn('new',67);
  assert.equal(result.stolenId,'old');assert.equal(f.audition.read().heldCount,1);assert.equal(f.clients.length,1);
  const before=f.events.length;assert.equal(await f.audition.noteOff('old'),false);assert.equal(f.events.length,before);assert.equal(f.audition.read().soundingCount,1);
  await f.audition.setPitch(2);assert.deepEqual(f.events.at(-1),['setPitch',2]);
  const ons=f.events.map((event,index)=>event[0]==='noteOn'?index:-1).filter(index=>index>=0);
  for(const index of ons){assert.equal(f.events[index-2][0],'stop');assert.equal(f.events[index-3][0],'fade');assert.equal(f.events[index+1][0],'open');}
});

test('quick release, Stop and a resumed source cannot leave a late Note On',async t=>{
  for(const phase of ['ensure','create','on'])await t.test(phase,async t=>{
    const gate=deferred(),f=fixture(t,{...(phase==='ensure'?{ensureGate:gate}:phase==='create'?{createGate:gate}:{onGate:gate})});
    const playing=f.audition.noteOn('late',60);await turn();
    if(phase==='ensure'){const releasing=f.audition.noteOff('late');gate.resolve();await releasing;}
    else {f.selection=null;const stopping=f.audition.stop();gate.resolve();await stopping;}
    gate.resolve();assert.equal(await playing,null);assert.equal(f.audition.read().heldCount,0);assert.equal(f.audition.read().soundingCount,0);
    assert(!f.events.some(event=>event[0]==='open'));
  });
});

test('strict unknown Wave RAM, DDA and inactive LFO modulator fail before acquiring audio',async t=>{
  const wave=snapshot();wave.waveforms[2]=null;
  const dda=snapshot();dda.registers[2][4]|=64;
  const lfo=snapshot(1);lfo.globals[9]=1;
  for(const [state,channel]of [[wave,2],[dda,2],[lfo,1]]){
    const f=fixture(t,{initial:state,channel});await assert.rejects(f.audition.noteOn('bad',60),/Wave RAM|DDA|modulator/);assert.equal(f.ensures,0);assert.equal(f.events.length,0);
  }
});

test('Noise preserves its clock while keyboard Pitch stays neutral',async t=>{
  const state=snapshot(5);state.registers[5][7]=128|23;state.waveforms[5]=null;const f=fixture(t,{initial:state,channel:5});
  await f.audition.noteOn('noise',36);await f.audition.setPitch(12);assert.equal(f.audition.read().pitch,0);assert.equal(f.events[0][1].noise.frequency,23);
  assert(!f.events.some(event=>event[0]==='setPitch'&&event[1]!==0));
});

test('private RPC failure or engine replacement retires only the old trial lease',async t=>{
  const failed=fixture(t,{failure:'noteOn'});await assert.rejects(failed.audition.noteOn('bad',60),/Private noteOn/);assert(failed.audition.read().error);assert(failed.events.some(event=>event[0]==='dispose'));
  const f=fixture(t);await f.audition.noteOn('old',60);f.replaceEngine();await f.audition.noteOn('new',64);
  assert.equal(f.clients.length,2);assert.equal(f.audition.read().heldCount,1);assert.equal(f.audition.read().soundingCount,1);assert.equal(await f.audition.noteOff('old'),false);
});

test('release and asynchronous processor failures clear sounding state and retire the private lease',async t=>{
  const off=fixture(t,{failure:'noteOff'});await off.audition.noteOn('key',60);await assert.rejects(off.audition.noteOff('key'),/Private noteOff/);
  assert.equal(off.audition.read().soundingCount,0);assert.equal(off.audition.read().heldCount,0);assert(off.audition.read().error);
  const asynchronous=fixture(t);await asynchronous.audition.noteOn('key',60);asynchronous.clients[0].fail(Error('Private processor failed'));await turn();
  assert.equal(asynchronous.audition.read().soundingCount,0);assert.equal(asynchronous.audition.read().heldCount,0);assert.match(asynchronous.audition.read().message,/processor failed/);
});

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
async function instrument(preset){const core=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:48000});const i=new Huc6280Instrument(core);i.loadPreset(preset);return i;}
test('actual isolated Wave and recorded LFO trials render the same PCM as their prepared static presets',async t=>{
  const wave=snapshot(2),lfo=snapshot(0);lfo.globals[8]=7;lfo.globals[9]=2;lfo.registers[0][2]=188;lfo.registers[0][3]=2;
  lfo.registers[1][2]=145;lfo.registers[1][3]=3;lfo.registers[1][4]=8;lfo.registers[1][5]=0x39;lfo.waveforms[1]=waveShape('triangle');
  for(const [state,channel]of [[wave,2],[lfo,0]])await t.test(channel===0?'recorded pair':'Wave',async t=>{
    const before=structuredClone(state),prepared=prepareHuc6280SongVoice(state,channel),oracle=await instrument(prepared.preset);t.after(()=>oracle.dispose());
    const f=fixture(t,{initial:state,channel,realCreate:instrument});await f.audition.noteOn('trial',60);oracle.noteOn('oracle',60);
    assert.deepEqual(f.clients[0].instrument.generateStereo(2048),oracle.generateStereo(2048));assert.deepEqual(state,before);
  });
});
