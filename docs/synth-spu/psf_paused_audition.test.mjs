// SPDX-License-Identifier: BSD-3-Clause
// Pure controller/lease tests. No AudioContext, node or audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsfPausedAudition} from './psf_paused_audition.js';
import {readPsfLiveSnapshot} from './psf_live_snapshot.js';
import {playbackAdpcm} from '../../test/helpers/spu_psf_playback_fixture.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await Promise.resolve();}assert.fail('Expected asynchronous controller boundary');}
const abort=()=>new DOMException('Stale fake SPU lease','AbortError');
function payload(pitch=0x1800) {
  const ram=new Uint8Array(512*1024),registers=new Uint16Array(512);ram.set(playbackAdpcm(),0x2000);
  for(const [at,value]of [[0,0x2000],[1,0x1000],[2,pitch],[3,0x400],[4,15],[5,0x1fc0],[7,0x400]])registers[at]=value;
  const frame=2205,state=readPsfLiveSnapshot({readRegister:at=>registers[at/2],readRam:(at,len)=>ram.slice(at,at+len),
    nativeFrames:frame,keyGateMask:1,activeMask:1});
  return {state,ram,frame,voice:0,source:{entry:'fixture.psf',title:'Original fixture'}};
}
function harness({pitch=0x1800}={}) {
  const original={name:'Authored instrument',ram:Uint8Array.of(1,2,3),hostPcm:Int16Array.of(-1234,2345),
    channels:[{sample:17,pitch:4096}],reverb:{preset:'room',volumeLeft:.3,volumeRight:.2}};
  let bank=structuredClone(original),owner=null,generation=0,payloadCalls=0,acquires=0,serial=0;
  const events=[],gates=new Map(),holds=new Map(),gain={gain:{value:0}};
  let selected={key:'source-A/frame-2205/CH1/C4',referenceNote:'C4',reverb:{...original.reverb}},image=payload(pitch);
  const current=token=>owner===token&&token.generation===generation;
  function wait(name){const list=holds.get(name);return list?.length?list.shift().promise:Promise.resolve();}
  function command(token,name,args,action=()=>true) {
    if(!current(token))throw abort();
    events.push({name,args:structuredClone(args),lease:token.id});
    const result=action();
    return wait(name).then(()=>{if(!current(token))throw abort();return result;});
  }
  const engine={context:{state:'running'},codeFadeNode:gain,getPs1Client(){
    if(owner)return owner.promise;
    const checkpoint=structuredClone(bank),token=owner={id:++serial,generation,promise:null};acquires++;
    events.push({name:'acquire',lease:token.id});let releasedGeneration=null;
    const client={
      ownsOutput:()=>current(token)||releasedGeneration!==null&&owner===null&&generation===releasedGeneration,
      reset:options=>command(token,'reset',[options],()=>{bank={channels:[],samples:[],reverb:null};gates.clear();}),
      loadADPCM:(bytes,options)=>command(token,'loadADPCM',[bytes,options],()=>{const sample={id:0,startAddress:0x1000};bank.samples=[{...sample,bytes:bytes.slice(),...options}];return sample;}),
      setReverb:value=>command(token,'setReverb',[value],()=>{bank.reverb=structuredClone(value);}),
      setPreset:(ch,preset)=>command(token,'setPreset',[ch,preset],()=>{bank.channels[ch]=structuredClone(preset);}),
      noteOn:(ch,midi)=>command(token,'noteOn',[ch,midi],()=>{
        assert.equal(gain.gain.value,1,'existing Code gate must be open before KON');
        const sample=bank.samples[bank.channels[ch].sample.id];
        bank.channels[ch].pitch=Math.round(4096*440*2**((midi-69)/12)/sample.baseFrequencyHz);
        gates.set(ch,{midi,sequence:events.filter(value=>value.name==='noteOn').length});
      }),
      noteOff:ch=>command(token,'noteOff',[ch],()=>{gates.delete(ch);}),
      dispose(){
        if(!current(token))throw abort();
        events.push({name:'dispose',lease:token.id});owner=null;const released=++generation;
        bank=structuredClone(checkpoint);gates.clear();
        return wait('dispose').then(()=>{releasedGeneration=released;return true;});
      },
    };
    token.promise=wait('acquire').then(()=>{if(!current(token))throw abort();return client;});return token.promise;
  },stop(){assert.fail('Controller must never call unguarded engine.stop()');}};
  let audio=engine;
  const createOutput=({getGain})=>({
    open(){const value=getGain();events.push({name:'open',touch:Boolean(value)});if(value)value.gain.value=1;},
    fadeOut(){const value=getGain();events.push({name:'fade',touch:Boolean(value)});if(value)value.gain.value=0;return wait('fade');},
    dispose(){const value=getGain();events.push({name:'outputDispose',touch:Boolean(value)});if(value)value.gain.value=0;},
  });
  const audition=createPsfPausedAudition({getAudio:()=>audio,getSelection:()=>selected,
    getCapturePayload:()=>{payloadCalls++;return image;},createOutput});
  return {audition,events,gates,gain,engine,original,
    get bank(){return bank;},get acquires(){return acquires;},get payloadCalls(){return payloadCalls;},
    get image(){return image;},set image(value){image=value;},
    get selection(){return selected;},set selection(value){selected=value;},
    setAudio(value){audio=value;},
    hold(name){const gate=deferred();if(!holds.has(name))holds.set(name,[]);holds.get(name).push(gate);return gate;},
    externalOwner(){generation++;owner={id:'new-Code',generation,promise:Promise.resolve({})};bank={newOwner:true};gates.clear();gain.gain.value=1;selected=null;},
  };
}

test('one lazy temporary bank serves chords, then restores all authored data and the existing output gate',async()=>{
  const h=harness(),a=h.audition;
  assert.equal(a.read().active,false);assert.equal(h.acquires,0);assert.equal(h.payloadCalls,0);
  assert.deepEqual(await a.noteOn('a',60),{channel:0,stolenId:null});
  assert.deepEqual(await a.noteOn('b',64),{channel:1,stolenId:null});
  assert.deepEqual(await a.noteOn('c',67),{channel:2,stolenId:null});
  assert.equal(h.acquires,1);assert.equal(h.payloadCalls,1);assert.equal(a.read().heldCount,3);
  assert.equal(a.read().sourceVoice,0);assert.equal(a.read().referenceNote,'C4');
  assert.equal(h.events.filter(e=>e.name==='setPreset').length,3,'program only channels actually used');
  assert.equal(h.bank.channels[0].pitch,0x1800);assert.deepEqual(h.bank.samples[0].bytes,playbackAdpcm());
  await a.noteOff('a');await a.allNotesOff();assert.equal(h.gates.size,0);assert.equal(a.read().heldCount,0);
  assert.equal(a.read().active,true,'prepared bank may be reused while the same song stays paused');
  await a.stop();assert.deepEqual(h.bank,h.original);assert.equal(h.gain.gain.value,1);assert.equal(a.read().active,false);
  const fade=h.events.findIndex(e=>e.name==='fade'),dispose=h.events.findIndex(e=>e.name==='dispose');assert(fade>=0&&dispose>fade);
  assert(h.events.filter(e=>e.name==='outputDispose').every(e=>!e.touch),'cleanup never closes the restored route');
  await a.dispose();
});

test('keyup before queued preparation causes no checkpoint or gate operation',async()=>{
  const h=harness(),on=h.audition.noteOn('tap',60),off=h.audition.noteOff('tap');
  assert.equal(await on,null);await off;assert.equal(h.acquires,0);assert.equal(h.payloadCalls,0);
  assert.equal(h.gates.size,0);assert.equal(h.audition.read().active,false);assert.deepEqual(h.bank,h.original);
});

test('keyup during checkpoint preparation prevents KON and restores the untouched authored bank',async()=>{
  const h=harness(),gate=h.hold('acquire'),on=h.audition.noteOn('tap',60);
  await until(()=>h.acquires===1);const off=h.audition.noteOff('tap');gate.resolve();
  assert.equal(await on,null);await off;assert.equal(h.events.some(e=>e.name==='noteOn'),false);
  assert.deepEqual(h.bank,h.original);assert.equal(h.audition.read().active,false);assert.equal(h.gain.gain.value,1);
});

test('keyup after KON but before acknowledgement emits the matching Off instead of leaving a note',async()=>{
  const h=harness(),gate=h.hold('noteOn'),on=h.audition.noteOn('tap',60);
  await until(()=>h.gates.size===1);const off=h.audition.noteOff('tap');gate.resolve();
  assert.equal(await on,null);await off;assert.equal(h.gates.size,0);assert.equal(h.audition.read().heldCount,0);
  assert.equal(h.events.filter(e=>e.name==='noteOff').length,1);await h.audition.stop();
});

test('an overtaken physical press guard also releases an already submitted KON',async()=>{
  const h=harness(),gate=h.hold('noteOn');let held=true;
  const on=h.audition.noteOn('tap',60,{isCurrent:()=>held});await until(()=>h.gates.size===1);held=false;gate.resolve();
  assert.equal(await on,null);assert.equal(h.gates.size,0);assert.equal(h.audition.read().heldCount,0);await h.audition.stop();
});

test('stop during preparation serializes restoration before a new selection lease can begin',async()=>{
  const h=harness(),gate=h.hold('loadADPCM'),old=h.audition.noteOn('old',60);
  await until(()=>h.events.some(e=>e.name==='loadADPCM'));
  const stopped=h.audition.stop();h.selection={...h.selection,key:'source-B/CH2'};
  const next=h.audition.noteOn('next',64);gate.resolve();assert.equal(await old,null);await stopped;
  assert.deepEqual(await next,{channel:0,stolenId:null});assert.equal(h.gates.size,1);assert.equal(h.acquires,2);
  const restored=h.events.findIndex(e=>e.name==='dispose'),second=h.events.findIndex(e=>e.name==='acquire'&&e.lease===2);
  assert(second>restored);assert.equal(await h.audition.noteOff('old'),false);assert.equal(h.gates.size,1);
  await h.audition.stop();assert.deepEqual(h.bank,h.original);
});

test('stop overtaking a submitted KON releases it before the next prepared lease is allowed to gate',async()=>{
  const h=harness(),gate=h.hold('noteOn'),old=h.audition.noteOn('old',60);
  await until(()=>h.gates.size===1);const stopped=h.audition.stop();h.selection={...h.selection,key:'new-CH-after-KON'};
  const next=h.audition.noteOn('next',64);gate.resolve();assert.equal(await old,null);await stopped;
  assert.deepEqual(await next,{channel:0,stolenId:null});assert.equal(h.gates.size,1);
  const restore=h.events.findIndex(e=>e.name==='dispose'),newOn=h.events.findIndex(e=>e.name==='noteOn'&&e.lease===2);
  assert(newOn>restore);assert.equal(await h.audition.noteOff('old'),false);assert.equal(h.gates.size,1);
  await h.audition.stop();
});

test('a stolen identity cannot release the replacement note on the same physical channel',async()=>{
  const h=harness();for(let n=0;n<24;n++)await h.audition.noteOn(`note-${n}`,60);
  assert.deepEqual(await h.audition.noteOn('replacement',64),{channel:0,stolenId:'note-0'});
  const replacement=h.gates.get(0),offs=h.events.filter(e=>e.name==='noteOff').length;
  assert.equal(await h.audition.noteOff('note-0'),false);assert.deepEqual(h.gates.get(0),replacement);
  assert.equal(h.events.filter(e=>e.name==='noteOff').length,offs);assert.equal(h.audition.read().heldCount,24);
  await h.audition.stop();
});

test('a high unrepresentable key rejects only that note and preserves another held chord voice',async()=>{
  const h=harness({pitch:0x3f00});await h.audition.noteOn('valid',60);
  const before=h.events.length;await assert.rejects(h.audition.noteOn('too-high',127),/PITCH range/);
  assert.equal(h.gates.size,1);assert.equal(h.audition.read().heldCount,1);
  assert.equal(h.events.slice(before).some(e=>['noteOff','dispose','setPreset','noteOn'].includes(e.name)),false);
  await h.audition.noteOff('valid');await h.audition.stop();
});

test('unsupported selected sources fail before acquiring or changing the editor SPU',async()=>{
  const h=harness();h.image.state.observation.noiseMask=1;h.image.state.channels[0].noise=true;
  await assert.rejects(h.audition.noteOn('noise',60),/Noise/);assert.equal(h.acquires,0);assert.equal(h.gates.size,0);
  assert.deepEqual(h.bank,h.original);assert.equal(h.audition.read().error,true);
  await h.audition.stop();assert.equal(h.audition.read().state,'idle');
});

test('an external newer owner survives stale KON completion and cleanup without a Stop or output write',async()=>{
  const h=harness(),gate=h.hold('noteOn'),on=h.audition.noteOn('old',60);
  await until(()=>h.gates.size===1);h.externalOwner();const before=h.events.length;gate.resolve();
  assert.equal(await on,null);await h.audition.stop();assert.deepEqual(h.bank,{newOwner:true});assert.equal(h.gain.gain.value,1);
  assert.equal(h.events.slice(before).some(e=>e.name==='dispose'||e.name==='noteOff'||e.name==='open'&&e.touch||e.name==='outputDispose'&&e.touch),false);
});

test('a newer owner appearing during old Stop acknowledgement cannot be reopened or muted by old cleanup',async()=>{
  const h=harness();await h.audition.noteOn('old',60);const gate=h.hold('dispose'),stopped=h.audition.stop();
  await until(()=>h.events.some(e=>e.name==='dispose'));h.externalOwner();const before=h.events.length;gate.resolve();await stopped;
  assert.deepEqual(h.bank,{newOwner:true});assert.equal(h.gain.gain.value,1);
  assert.equal(h.events.slice(before).some(e=>(e.name==='open'||e.name==='outputDispose')&&e.touch),false);
});

test('a newer owner during the old fade is protected by the live output ownership guard',async()=>{
  const h=harness();await h.audition.noteOn('old',60);const gate=h.hold('fade'),stopped=h.audition.stop();
  await until(()=>h.events.some(e=>e.name==='fade'));h.externalOwner();const before=h.events.length;gate.resolve();await stopped;
  assert.deepEqual(h.bank,{newOwner:true});assert.equal(h.gain.gain.value,1);
  assert.equal(h.events.slice(before).some(e=>e.name==='dispose'||e.name==='outputDispose'&&e.touch),false);
});

test('source invalidation during a pending load restores its own bank and never gates the stale tone',async()=>{
  const h=harness(),gate=h.hold('loadADPCM'),on=h.audition.noteOn('old',60);
  await until(()=>h.events.some(e=>e.name==='loadADPCM'));h.selection=null;gate.resolve();
  assert.equal(await on,null);assert.equal(h.gates.size,0);assert.deepEqual(h.bank,h.original);
  assert.equal(h.events.some(e=>e.name==='noteOn'),false);await h.audition.dispose();
});

test('replacement audio engines are never faded, opened or stopped by cleanup of the old engine',async()=>{
  const h=harness();await h.audition.noteOn('old',60);
  const replacement={context:{state:'running'},codeFadeNode:{gain:{value:1}},stop(){assert.fail('new engine was stopped');}};
  h.setAudio(replacement);await h.audition.stop();
  assert.deepEqual(h.bank,h.original);assert.equal(replacement.codeFadeNode.gain.value,1);
  assert.equal(h.events.filter(e=>e.name==='dispose').length,1,'only the still-valid old client restores its checkpoint');
  assert.equal(h.events.filter(e=>e.name==='outputDispose').some(e=>e.touch),false);
});

test('allNotesOff overtaking setup cancels all pending notes; disposal prevents future setup',async()=>{
  const h=harness(),gate=h.hold('setReverb'),a=h.audition.noteOn('a',60),b=h.audition.noteOn('b',64);
  await until(()=>h.events.some(e=>e.name==='setReverb'));const off=h.audition.allNotesOff();gate.resolve();
  assert.equal(await a,null);assert.equal(await b,null);await off;assert.equal(h.gates.size,0);
  await h.audition.dispose();assert.deepEqual(h.bank,h.original);
  await assert.rejects(h.audition.noteOn('after-dispose',60),/disposed/);
});
