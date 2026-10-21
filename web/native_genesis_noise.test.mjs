import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisNoise,createNativeNoiseOwnership,nativeGenesisNoiseMessage} from './native_genesis_noise.js';
import {controlNativeNoise} from './native_noise.js';

function fixture() {
  const messages=[];const noise=createNativeGenesisNoise({send:message=>messages.push(message)});
  return {messages,noise};
}

test('native noise shares seeded types, filter, requested targets and ramps without an audio graph',()=>{
  const f=fixture(),voice=f.noise.create({type:'pink',seed:0xffffffff,gain:.25,pan:-.5,attack:.1,release:.2,autoStart:false});
  assert.deepEqual(f.messages[0],{op:'noise',namespace:0,action:'create',slot:0,token:1,type:1,seed:0xffffffff});
  assert.equal(f.messages.filter(message=>message.action==='start').length,0);
  assert.equal(voice.gain.get(),.25);assert.equal(voice.attack.get(),.1);assert.equal(voice.release.get(),.2);
  voice.filter.set('highpass',1800,.8);voice.start();
  controlNativeNoise(voice,{gain:.5,pan:.75,cutoff:900,q:.7,slide:.2});
  assert.equal(voice.gain.get(),.5);assert.equal(voice.pan.get(),.75);assert.equal(voice.filter.cutoff.get(),900);
  assert.deepEqual(f.messages.filter(message=>message.action==='parameter').slice(-4).map(message=>message.seconds),[.2,.2,.2,.2]);
  assert.ok(f.messages.some(message=>message.action==='filter'&&message.mode===1));
  voice.stop();voice.dispose();const count=f.messages.length;voice.dispose();assert.equal(f.messages.length,count);
  assert.throws(()=>voice.start(),/disposed/);
});

test('invalid initial noise options fail before any create or slot reservation',()=>{
  const f=fixture();
  for(const options of [null,[],{seed:-1},{seed:1.5},{seed:0x100000000},{seed:'1'},{gain:Infinity},{release:NaN},{attack:'bad'},{pan:-Infinity}]) {
    assert.throws(()=>f.noise.create(options),/options|seed|noise/);
    assert.deepEqual(f.messages,[]);
  }
  const voice=f.noise.create({seed:0,gain:99,pan:-99});
  assert.equal(voice.gain.get(),8);assert.equal(voice.pan.get(),-1);assert.equal(f.messages[0].slot,0);assert.equal(f.messages[0].token,1);
});

test('loop ownership transfers on start and stale parent cleanup cannot stop, dispose or edit its replacement',()=>{
  const f=fixture(),a={name:'a'},b={name:'b'};let context=a;
  const owned=createNativeNoiseOwnership(f.noise,{getContext:()=>context});
  const voice=owned.api.create({seed:7,autoStart:false});context=b;voice.start();
  const count=f.messages.length;context=a;voice.stop();voice.dispose();voice.gain.set(0);owned.releaseOwner(a);
  assert.equal(f.messages.length,count);assert.equal(voice.gain.get(),.3);
  context=b;owned.releaseOwner(b);assert.equal(f.messages.at(-1).action,'retire');
  assert.throws(()=>voice.start(),/disposed/);voice.dispose();
  const replacement=owned.api.create({seed:8});assert.equal(f.messages.findLast(message=>message.action==='create').slot,0);
  assert.equal(f.messages.findLast(message=>message.action==='create').token,2);assert.equal(replacement.type,'white');
});

test('a prepared noise voice releases a cancelled loop and can start again under a new lease',()=>{
  const f=fixture(),a={name:'a'},b={name:'b'};let context=null;
  const owned=createNativeNoiseOwnership(f.noise,{getContext:()=>context}),voice=owned.api.create({seed:2,autoStart:false});
  context=a;voice.start();owned.releaseOwner(a);assert.equal(f.messages.at(-1).action,'stop');
  assert.equal(f.messages.filter(message=>message.action==='retire').length,0);
  context=b;voice.start();const count=f.messages.length;context=a;a.stopped=true;voice.stop();voice.dispose();
  assert.equal(f.messages.length,count);assert.throws(()=>voice.gain.set(0),{name:'AbortError'});
  context=b;owned.releaseOwner(b);assert.equal(f.messages.at(-1).action,'stop');
  owned.clear();f.noise.reset();assert.throws(()=>voice.start(),/disposed/);
});

test('global Stop resets logical slots, invalidates old handles and emits no cleanup into a new performance',()=>{
  const f=fixture();let old;
  for(let run=0;run<40;run++) {
    const voice=f.noise.create({seed:run});const created=f.messages.findLast(message=>message.action==='create');
    assert.equal(created.slot,0);assert.equal(created.token,run+1);
    const before=f.messages.length;f.noise.reset();assert.equal(f.messages.length,before);
    assert.throws(()=>voice.stop(),/disposed/);assert.throws(()=>voice.start(),/disposed/);
    if(old){const count=f.messages.length;old.dispose();assert.equal(f.messages.length,count);}
    old=voice;
  }
  for(let i=0;i<32;i++)f.noise.create({seed:i});assert.throws(()=>f.noise.create(),/32 voices/);
  f.noise.reset();assert.doesNotThrow(()=>f.noise.create({seed:1}));
});

test('native wire validation trusts only the transport namespace and bounds every parameter before admission',()=>{
  const base={op:'noise',namespace:999,action:'create',slot:1,token:2,type:4,seed:123};
  assert.equal(nativeGenesisNoiseMessage(base,{namespace:3,sampleRate:48000}).namespace,3);
  for(const patch of [{slot:32},{token:0},{type:5},{seed:-1},{action:'unknown'}])assert.throws(()=>nativeGenesisNoiseMessage({...base,...patch},{namespace:3,sampleRate:48000}),/noise/);
  const parameter={op:'noise',action:'parameter',slot:0,token:1,param:0,value:.5,seconds:.1};
  for(const patch of [{param:6},{value:9},{value:NaN},{seconds:-1},{seconds:1e9}])assert.throws(()=>nativeGenesisNoiseMessage({...parameter,...patch},{namespace:0,sampleRate:48000}),/noise/);
});
