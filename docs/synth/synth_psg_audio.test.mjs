import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthPsgAudio} from './synth_psg_audio.js';
import {SEGAPSG_CLOCK} from '../js/segapsg.js';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>Promise.resolve();
function host() {
  const gains=[],context={state:'running',closeCalls:0,close(){this.closeCalls++;},createGain(){
    const gain={context,gain:{value:1},output:null,disconnects:0,connect(output){this.output=output;},disconnect(){this.disconnects++;}};
    gains.push(gain);return gain;
  }};
  return {context,output:{context},gains};
}
function fixture() {
  const requests=[],errors=[];
  const audio=createSynthPsgAudio({onError:error=>errors.push(error),createDevice:(context,destination,options)=>{
    const task=deferred(),writes=[],device={port:{postMessage:command=>writes.push(command)},disposeCalls:0,dispose(){this.disposeCalls++;}};
    requests.push({context,destination,options,task,writes,device});return task.promise;
  }});
  return {audio,requests,errors};
}
const offWrites=[0x9f,0xbf,0xdf,0xff].map(value=>({method:'write',args:[value]}));

test('PSG allocation is lazy, coalesces the same route, sends ordered real API writes and uses calibrated Master once',async()=>{
  const f=fixture(),h=host();
  assert.equal(f.audio.getPsg(),null);assert.equal(f.audio.isPreparing(),false);assert.equal(h.gains.length,0);
  f.audio.setVolume(2);f.audio.setEnabled(true);assert.equal(f.requests.length,0);
  const pending=f.audio.prepare(h.context,h.output);
  assert.equal(f.audio.prepare(h.context,h.output),pending);
  assert.equal(f.audio.isPreparing(),true);assert.equal(h.gains.length,1);assert.equal(h.gains[0].gain.value,0);
  await turn();const request=f.requests[0];
  assert.equal(request.options.clock,SEGAPSG_CLOCK);assert.equal(request.options.stereoEnabled,false);
  assert.match(String(request.options.workletUrl),/synth_psg_worklet\.js\?v=psg-envelope-1$/,'software control uses a private Synth worklet');
  assert.equal(request.destination,h.gains[0]);assert.equal(h.gains[0].output,h.output);
  request.task.resolve(request.device);const psg=await pending;
  assert.equal(f.audio.getPsg(),psg);assert.equal(f.audio.isPreparing(),false);
  assert.deepEqual(request.writes,offWrites,'every fresh endpoint begins with all four PSG attenuators muted');
  assert.equal(h.gains[0].gain.value,2*SYNTH_SONG_MIX_DEFAULTS.psg);
  psg.tone(0,{frequency:440,attenuation:6});
  assert.deepEqual(request.writes.slice(-3),[0x8e,0x0f,0x96].map(value=>({method:'write',args:[value]})),
    'the low latch, high data and attenuation reach one ordered endpoint');
  f.audio.setVolume(3.8);assert.equal(h.gains[0].gain.value,3.8*SYNTH_SONG_MIX_DEFAULTS.psg);
  assert.equal(await f.audio.prepare(h.context,h.output),psg);assert.equal(f.requests.length,1);
  f.audio.dispose();assert.equal(request.device.disposeCalls,1);assert.equal(h.gains[0].gain.value,0);assert.equal(h.gains[0].disconnects,1);
  assert.equal(h.context.closeCalls,0,'the host retains its shared AudioContext');
});

test('disabled preparation stays silent, and disabling a ready endpoint clears tones before later re-enabling',async()=>{
  const f=fixture(),h=host();f.audio.setEnabled(true);
  const pending=f.audio.prepare(h.context,h.output);await turn();f.audio.setEnabled(false);
  const request=f.requests[0];request.task.resolve(request.device);const psg=await pending;
  assert.equal(h.gains[0].gain.value,0);assert.deepEqual(request.writes,offWrites);
  psg.tone(1,{frequency:220,attenuation:0});
  assert.equal(h.gains[0].gain.value,0,'late client writes cannot make a disabled bus audible');
  f.audio.setEnabled(true);assert.deepEqual(request.writes.slice(-4),offWrites,'enable clears stale gates before opening the bus');
  assert.equal(h.gains[0].gain.value,SYNTH_SONG_MIX_DEFAULTS.psg);
  psg.noise({type:'white',rate:'medium',attenuation:4});f.audio.setEnabled(false);
  assert.deepEqual(request.writes.slice(-4),offWrites);assert.equal(h.gains[0].gain.value,0);
  f.audio.dispose();assert.equal(f.errors.length,0);
});

test('context/output replacement cancels waiting owners immediately and disposes late endpoints without retiring the new route',async()=>{
  const f=fixture(),first=host(),second=host();
  const obsolete=f.audio.prepare(first.context,first.output);await turn();
  const rejected=assert.rejects(obsolete,{name:'AbortError'});
  const current=f.audio.prepare(second.context,second.output);await rejected;await turn();
  assert.equal(f.requests[0].options.signal.aborted,true);assert.equal(first.gains[0].disconnects,1);
  const fresh=f.requests[1];fresh.task.resolve(fresh.device);const psg=await current;
  const old=f.requests[0];old.task.resolve(old.device);await turn();await turn();
  assert.equal(old.device.disposeCalls,1);old.options.onError(new Error('late old processor failure'));
  assert.equal(f.audio.getPsg(),psg);assert.equal(f.errors.length,0);
  const nextOutput={context:second.context},again=f.audio.prepare(second.context,nextOutput);await turn();
  assert.equal(fresh.device.disposeCalls,1,'changing only the output still retires its previous GainNode and endpoint');
  const third=f.requests[2];third.task.resolve(third.device);await again;
  assert.equal(second.gains[1].output,nextOutput);assert.equal(first.context.closeCalls,0);assert.equal(second.context.closeCalls,0);
  f.audio.dispose();
});

test('dispose aborts pending work, rejects future preparations and silences old API references',async()=>{
  const f=fixture(),h=host(),pending=f.audio.prepare(h.context,h.output);await turn();
  const rejected=assert.rejects(pending,{name:'AbortError'});f.audio.dispose();await rejected;
  const old=f.requests[0];old.task.resolve(old.device);await turn();await turn();
  assert.equal(old.device.disposeCalls,1);assert.equal(h.gains[0].gain.value,0);assert.equal(f.audio.isPreparing(),false);
  await assert.rejects(f.audio.prepare(h.context,h.output),/disposed/);assert.equal(f.requests.length,1);
  f.audio.dispose();assert.equal(h.gains[0].disconnects,1);assert.equal(h.context.closeCalls,0);
  const g=fixture(),ready=g.audio.prepare(h.context,h.output);await turn();
  const request=g.requests[0];request.task.resolve(request.device);const psg=await ready;
  g.audio.dispose();const count=request.writes.length;psg.tone(0,{frequency:440});
  assert.equal(request.writes.length,count,'a reference to a retired facade cannot post new note data');
});

test('initial and post-ready failures retire only their owner and allow a clean retry',async()=>{
  const f=fixture(),h=host(),first=f.audio.prepare(h.context,h.output);await turn();
  f.requests[0].task.reject(new Error('module failed'));await assert.rejects(first,/module failed/);
  assert.equal(f.audio.getPsg(),null);assert.equal(f.audio.isPreparing(),false);assert.equal(h.gains[0].disconnects,1);assert.equal(f.errors.length,1);
  const retry=f.audio.prepare(h.context,h.output);await turn();const request=f.requests[1];request.task.resolve(request.device);await retry;
  f.audio.setEnabled(true);request.options.onError(new Error('processor failed'));
  assert.equal(f.audio.getPsg(),null);assert.equal(request.device.disposeCalls,1);assert.equal(h.gains[1].gain.value,0);
  assert.equal(f.errors.length,2);request.options.onError(new Error('duplicate'));assert.equal(f.errors.length,2);
  const latest=f.audio.prepare(h.context,h.output);await turn();const next=f.requests[2];next.task.resolve(next.device);const api=await latest;
  request.options.onError(new Error('obsolete failure'));assert.equal(f.audio.getPsg(),api);assert.equal(f.errors.length,2);
  f.audio.dispose();
});

test('invalid routes and levels fail before disrupting an existing prepared endpoint',async()=>{
  const f=fixture(),h=host(),pending=f.audio.prepare(h.context,h.output);await turn();
  const request=f.requests[0];request.task.resolve(request.device);const api=await pending;
  f.audio.setEnabled(true);const gain=h.gains[0].gain.value;
  for(const invalid of [-1,3.81,NaN,Infinity,'1',null])assert.throws(()=>f.audio.setVolume(invalid),/0\.\.3\.8/);
  assert.throws(()=>f.audio.setEnabled(1),/boolean/);
  await assert.rejects(f.audio.prepare(h.context,{context:{}}),/open AudioContext/);
  await assert.rejects(f.audio.prepare({state:'closed',createGain(){}},{context:{}}),/open AudioContext/);
  assert.equal(f.audio.getPsg(),api);assert.equal(h.gains[0].gain.value,gain);assert.equal(request.device.disposeCalls,0);
  f.audio.dispose();
});

test('software envelope commands validate and detach settings, preserve raw latch targets and stop release tails on disable',async()=>{
  const f=fixture(),h=host(),pending=f.audio.prepare(h.context,h.output);await turn();
  const request=f.requests[0];request.task.resolve(request.device);const api=await pending;
  api.stopEnvelopes();api.envelopeNoteOff(0);api.setEnvelopeAttenuation(6);
  assert.deepEqual(request.writes,offWrites,'unused envelopes do not add commands to the raw Off path');
  const value={enabled:true,attackMs:20,decayMs:100,sustain:50,releaseMs:200};api.envelopeNoteOn(0,value,4);value.attackMs=500;
  assert.deepEqual(request.writes.at(-1),{method:'envelopeNoteOn',args:[0,{...value,attackMs:20},4]});
  api.setFrequency(0,440);
  assert.equal(request.writes.at(-1).method,'write');assert.equal(request.writes.at(-1).psgRegister,0,'high period byte retains its target across envelope register writes');
  api.envelopeNoteOff(0);assert.deepEqual(request.writes.at(-1),{method:'envelopeNoteOff',args:[0]});
  api.setEnvelopeAttenuation(8);assert.deepEqual(request.writes.at(-1),{method:'setEnvelopeAttenuation',args:[8]});
  const count=request.writes.length;
  for(const ch of [-1,4,.5]){assert.throws(()=>api.envelopeNoteOn(ch,value,4));assert.throws(()=>api.envelopeNoteOff(ch));}
  assert.throws(()=>api.envelopeNoteOn(0,{enabled:'yes'},4));assert.throws(()=>api.envelopeNoteOn(0,value,16));assert.throws(()=>api.setEnvelopeAttenuation(-1));
  assert.equal(request.writes.length,count,'invalid software control never posts partial commands');
  f.audio.setEnabled(false);
  assert.deepEqual(request.writes.slice(-5),[{method:'stopEnvelopes',args:[]},...offWrites],'disable stops released envelopes before clearing the hardware');
  f.audio.setEnabled(true);assert.deepEqual(request.writes.slice(-4),offWrites);
  api.setFrequency(0,440);assert.equal(Object.hasOwn(request.writes.at(-1),'psgRegister'),false,'cleared software control returns to the original raw transport');
  f.audio.dispose();
});
