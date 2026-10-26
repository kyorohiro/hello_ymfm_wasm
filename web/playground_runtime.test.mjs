import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { createPlaygroundRuntime } from './playground_runtime.js';
import {createNativeFXController} from './native_fx.js';
import {createAy8910Client} from './playground_ay8910.js';
import {createOplClient} from './playground_opl.js';
import {YM2413Synth,YM2413_INSTRUMENTS,YM2413_USER_PRESETS} from './ym2413synth.js';
import {createYm2413Client} from './playground_ym2413.js';
import {OPLSynth,OPL_PRESETS} from './opl_synth.js';
import {LiveFX} from './custom_fx.js';
import {createYm2608Client} from './playground_ym2608.js';
import {GameboySynth} from './gameboysynth.js';
import {YM2203Synth} from './ym2203synth.js';
import {YM2608Synth} from './ym2608synth.js';
import {YM2610BSynth, NeoGeoFMSynth} from './ym2610bsynth.js';
import {createSegaPsgClient} from './playground_segapsg.js';
import {createSnesClient} from './playground_snes.js';
import {SnesSynth} from './snessynth.js';
import {WonderSwanSynth} from './wonderswansynth.js';
import {createRf5c164Client, createRf5c164Control} from './playground_rf5c164.js';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Async boundary was not reached');
}
function setup(t, capabilities, runtimeOptions = {}, createRuntime = createPlaygroundRuntime) {
  const listeners = new Set(), statuses = [], logs = [];
  const previous = globalThis.window;
  globalThis.window = {
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn), setTimeout,
  };
  const media = () => ({ stop() {}, stopAll() {}, pause() {}, list: () => [], unload() {} });
  const megaDrive = {
    capabilities, state: 'idle', audioContext: { currentTime: 0 },
    fm: { setPreset() {}, noteOff() {} }, psg: {},
    sample: media(), stream: media(),
    async start() { this.state = 'ready'; }, async resume() {}, async close() {},
    clearFXChain: () => [],
  };
  const runtime = createRuntime({ megaDrive, guardExecution: false, onStatus: s => statuses.push(s), onLog: line => logs.push(line), ...runtimeOptions });
  t.after(() => {
    runtime.stop();
    globalThis.window = previous;
    delete globalThis.playgroundReview;
  });
  return { runtime, megaDrive, listeners, statuses, logs };
}

// Inject a deterministic audio endpoint into the real runtime, keeping its
// production factory and public options unchanged. Other imports retain their
// actual implementations, including the independent OPN client and Keyboard.
let injectedRuntimeSequence=0;
async function runtimeWithOpnAudio(factory,functionName='createOpnAudio'){
  const sourceUrl=new URL('./playground_runtime.js',import.meta.url),key=`__runtimeOpnAudio${++injectedRuntimeSequence}`;
  globalThis[key]=factory;
  const source=(await readFile(sourceUrl,'utf8'))
    .replace(new RegExp(`^import \\{${functionName}\\} from ['"][^'"]+['"];$`,'m'),`const ${functionName}=globalThis[${JSON.stringify(key)}];`)
    .replace(/from\s*(['"])(\.[^'"]+)\1/g,(_match,_quote,path)=>`from ${JSON.stringify(new URL(path,sourceUrl).href)}`)
    .replaceAll('import.meta.url',JSON.stringify(sourceUrl.href));
  try{return (await import(`data:text/javascript,${encodeURIComponent(source)}`)).createPlaygroundRuntime;}
  finally{delete globalThis[key];}
}
function independentOpnFixture(){
  const events=[],devices=[];
  const factory=async()=>{
    const entry={id:devices.length,disposed:false,disconnected:false};devices.push(entry);events.push(['create',entry.id]);
    const port={start(){},close(){events.push(['port-close',entry.id]);},postMessage(command){
      if(entry.disposed)throw new Error('Independent OPN client was disposed before cleanup');
      events.push(['command',entry.id,command.method,command.args]);
      if(command.id!==undefined)queueMicrotask(()=>port.onmessage({data:{id:command.id}}));
    }};
    return {port,node:{port:{postMessage(){},addEventListener(){},removeEventListener(){},start(){}},disconnect(){entry.disconnected=true;events.push(['disconnect',entry.id]);}},
      dispose(){entry.disposed=true;events.push(['dispose',entry.id]);}};
  };
  return {events,devices,factory};
}
function independentRfFixture(gate){
  const events=[],devices=[];
  const factory=async()=>{
    const entry={id:devices.length,disposed:false,disconnected:false,waiting:false};devices.push(entry);events.push(['create',entry.id]);
    const port={start(){},close(){events.push(['port-close',entry.id]);},postMessage(command){
      if(entry.disposed)throw new Error('RF endpoint disposed before cleanup');
      events.push(['command',entry.id,command.method,command.args]);
      if(command.id===undefined)return;
      const reply=()=>queueMicrotask(()=>port.onmessage?.({data:{id:command.id}}));
      if(gate&&entry.id===0&&command.method==='keyOff'&&!entry.waiting){entry.waiting=true;gate.promise.then(reply);}else reply();
    }};
    return {port,node:{port:{postMessage(){},addEventListener(){},removeEventListener(){},start(){}},disconnect(){entry.disconnected=true;events.push(['disconnect',entry.id]);}},dispose(){entry.disposed=true;events.push(['dispose',entry.id]);}};
  };
  return {events,devices,factory};
}

function attachPrimaryPcm(megaDrive) {
  const writes = [], memory = [];
  const control = createRf5c164Control({writeRegister:(...args)=>writes.push(args),loadMemory:(...args)=>memory.push(args),reset(){},dispose(){throw Error('Primary disposed');}});
  const port = {start(){},close(){throw Error('Primary port closed');},postMessage({id,method,args=[]}) {
    const value = method === 'clock' ? undefined : method==='stopVoices'?Array.from({length:8},(_,channel)=>control.keyOff(channel)):control[method](...args);
    if (id !== undefined) queueMicrotask(()=>port.onmessage({data:{id,value}}));
  }};
  megaDrive.pcm = createRf5c164Client(port,async source=>source);
  Object.defineProperty(megaDrive.pcm,'id',{value:'rf5c164'});
  return {writes,memory};
}

test('Mega CD useSoundChip borrows primary PCM, keeps RAM and tuning across Stop, and accepts decoded PCM',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'ym2612',fmChannels:6,psg:true,dac:true});
  const {writes,memory}=attachPrimaryPcm(megaDrive);
  await runtime.playSource(`
    const [pcm,again]=await Promise.all([useSoundChip('rf5c164'),useSoundChip('rf5c164')]);
    if(pcm!==again||pcm.id!=='rf5c164'||typeof pcm.dispose!=='undefined')throw Error('Independent PCM');
    const wave=await pcm.loadSample({channels:[new Float32Array([0,.5,-.5,0])],sampleRate:16000});
    await pcm.setChannel(7,{...wave,volume:180,pan:{left:15,right:8}});
    await pcm.setClock(10000000);await pcm.keyOn(7);
  `);
  assert.equal(memory.length,1); assert.equal(megaDrive.pcm.clock,10000000);
  const before=writes.length; await runtime.stop();
  assert.equal(writes.at(-1)[0],8); assert.equal(writes.at(-1)[1],255);
  assert(!writes.slice(before).some(([register])=>register!==8),'Stop only gates voices, preserving channel settings');
  await runtime.playSource(`const pcm=await useSoundChip('rf5c164');if(pcm.clock!==10000000)throw Error('Lost tuning');await pcm.keyOn(7);`);
  assert.equal(memory.length,1,'waveform RAM is reused');
  assert.equal(writes.at(-1)[1],127,'the eighth voice can retrigger after Stop');
});

test('Main Run waits for all old primary PCM release acknowledgements while Stop stays immediate',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'ym2612',fmChannels:6,psg:true,dac:true});
  const pending=[],events=[];let delay=true;
  megaDrive.pcm={keyOff(channel){
    const apply=()=>events.push(['off',channel]);
    if(!delay){apply();return Promise.resolve();}
    return new Promise(resolve=>pending.push(()=>{apply();resolve();}));
  },keyOn(channel){events.push(['on',channel]);return Promise.resolve();}};
  await runtime.playSource('');assert.equal(runtime.stop(),undefined);
  assert.equal(pending.length,8);
  const next=runtime.playSource(`const pcm=await useSoundChip('rf5c164');await pcm.keyOn(0);`);
  for(let i=0;i<7;i++)pending[i]();
  await Promise.resolve();await Promise.resolve();assert(!events.some(([kind])=>kind==='on'));
  delay=false;pending[7]();await next;
  assert.deepEqual(events,[...[0,1,2,3,4,5,6,7].map(channel=>['off',channel]),['on',0]]);
});

test('stopping a Main PCM liveLoop releases its voices without muting a replacement owner',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'ym2612',fmChannels:6,psg:true,dac:true});
  const {writes}=attachPrimaryPcm(megaDrive);
  await runtime.playSource(`const pcm=await useSoundChip('rf5c164');liveLoop('held',async()=>{await pcm.keyOn(0);await pcm.keyOn(1);try{await sleep(60);}finally{await pcm.keyOff(1);}});`);
  await until(()=>writes.some(([r,v])=>r===8&&v===252));
  const before=writes.length;
  await runtime.playSource(`const pcm=await useSoundChip('rf5c164');await pcm.keyOn(1);stopLoop('held');`);
  await until(()=>writes.slice(before).some(([r,v])=>r===8&&v===253));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert(!writes.slice(before).some(([r,v])=>r===8&&v===255),'retired finally cannot mute the replacement channel');
});

test('Main audio input exposes decoded PCM, aborts on Stop and rejects stale completion',async t=>{
  let receivedOptions, signal;
  const gate=deferred();
  const {runtime}=setup(t,undefined,{inputAudio:(options,context)=>{receivedOptions=options;signal=context.signal;return gate.promise;}});
  globalThis.playgroundReview={};
  const playing=runtime.playSource(`try{const value=await inputAudio({title:'Sampler'});context.value=value;}catch(error){globalThis.playgroundReview.error=error.name;throw error;}`);
  await until(()=>signal);
  assert.deepEqual(receivedOptions,{title:'Sampler'});assert.equal(signal.aborted,false);
  runtime.stop();assert.equal(signal.aborted,true);
  gate.resolve({name:'voice.wav',source:'file',channels:[new Float32Array(8)],sampleRate:16000});
  await playing;assert.equal(globalThis.playgroundReview.error,'AbortError');
  assert.equal(runtime.context.value,undefined);
});

test('a new Main Run aborts an older audio input, and pg.inputAudio preserves cancellation',async t=>{
  const gates=[],signals=[];
  const {runtime}=setup(t,undefined,{inputAudio:(_,context)=>{signals.push(context.signal);const gate=deferred();gates.push(gate);return gate.promise;}});
  const old=runtime.playSource(`await inputAudio();`);
  await until(()=>signals.length===1);
  const next=runtime.playSource(`context.input=await pg.inputAudio();`);
  await until(()=>signals.length===2);assert.equal(signals[0].aborted,true);
  gates[0].resolve(null);await old;
  gates[1].resolve(null);await next;assert.equal(runtime.context.input,null);
});

test('Main keyboard cleanup stays active without a polling loop and runs on replacement and Stop',async t=>{
  const {runtime,listeners}=setup(t);
  globalThis.playgroundReview=[];
  const source=label=>`onKeyboardReleaseKey('sampler',event=>globalThis.playgroundReview.push(['key',event.editable]));liveCleanup(['sampler'],()=>globalThis.playgroundReview.push('${label}'));`;
  await runtime.playSource(source('old'));assert.deepEqual(globalThis.playgroundReview,[]);
  [...listeners][0]({type:'keyup',code:'KeyZ',target:{isContentEditable:true}});
  await Promise.resolve();assert.deepEqual(globalThis.playgroundReview,[['key',true]]);
  await runtime.playSource(source('new'));assert.deepEqual(globalThis.playgroundReview,[['key',true],'old']);
  await runtime.playSource('');assert.deepEqual(globalThis.playgroundReview,[['key',true],'old','new']);
  await runtime.playSource(source('stop'));runtime.stop();assert.deepEqual(globalThis.playgroundReview,[['key',true],'old','new','stop']);
});

test('Main musical keyboard commits one Run-owned binding, preserves press identity and retires on omission',async t=>{
  const targets=[];const {runtime}=setup(t,undefined,{onKeyboardTargetChange:target=>targets.push(target)});
  globalThis.playgroundReview=[];
  await runtime.playSource(`if(keyboard!==pg.keyboard)throw Error('Separate keyboard');keyboard.bind('bass',{
    noteOn:event=>globalThis.playgroundReview.push(['on',event]),noteOff:event=>globalThis.playgroundReview.push(['off',event]),
    allNotesOff:()=>globalThis.playgroundReview.push(['all'])});`);
  const target=runtime.getKeyboardTarget();assert.equal(target.name,'bass');assert.equal(targets.at(-1),target);
  await target.noteOn({id:'string1',midi:60});await target.noteOn({id:'string2',midi:60,velocity:90});
  await target.noteOn({id:'string1',midi:60});assert.equal(globalThis.playgroundReview.length,2);
  const first=globalThis.playgroundReview[0][1];assert.equal(first.velocity,100);
  assert.notEqual(first.id,globalThis.playgroundReview[1][1].id);
  await target.noteOff({id:'string1',midi:60});assert.deepEqual(globalThis.playgroundReview.at(-1),['off',first]);
  await target.noteOn({id:'string1',midi:60});assert.notEqual(globalThis.playgroundReview.at(-1)[1].id,first.id,'a new press has its own identity');
  await assert.rejects(runtime.playSource(`keyboard.bind('bad',{noteOn(){}});`),/noteOff/);
  assert.equal(runtime.getKeyboardTarget(),target,'failed evaluation preserves the committed binding');
  await runtime.playSource('');assert.equal(runtime.getKeyboardTarget(),null);assert.equal(targets.at(-1),null);
  assert.equal(globalThis.playgroundReview.at(-1)[0],'all');
  const count=globalThis.playgroundReview.length;await target.noteOn({id:'late',midi:64});assert.equal(globalThis.playgroundReview.length,count);
});

test('Main musical keyboard all-notes-off and Stop cancel awaited PCM note starts before a later binding',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'ym2612',fmChannels:6,psg:true,dac:true});
  const gate=deferred(),notes=[];let entered=false;
  megaDrive.pcm={setChannel(){entered=true;return gate.promise;},keyOn:channel=>notes.push(channel),keyOff(){}};
  const binding=`const pcm=await useSoundChip('rf5c164');keyboard.bind('sampler',{
    async noteOn(){await pcm.setChannel(0,{step:1000});await pcm.keyOn(0);},noteOff(){return pcm.keyOff(0);},allNotesOff(){return pcm.keyOff(0);}});`;
  await runtime.playSource(binding);const old=runtime.getKeyboardTarget();
  const pending=old.noteOn({id:'held',midi:60});await until(()=>entered);
  await old.allNotesOff();runtime.stop();
  await runtime.playSource(`keyboard.bind('next',{noteOn(){fm.keyOn(CH1);},noteOff(){fm.keyOff(CH1);},allNotesOff(){fm.keyOff(CH1);}});`);
  gate.resolve();await pending;assert.deepEqual(notes,[],'old RPC continuation cannot key on the next Run');
  assert.equal(runtime.getKeyboardTarget().name,'next');
});

test('Stop silences independent chips immediately, then awaits custom Keyboard releases before disposal and ID reuse',async t=>{
  const fixture=independentOpnFixture(),createRuntime=await runtimeWithOpnAudio(fixture.factory);
  const {runtime,megaDrive,logs}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};
  const gate=deferred();globalThis.playgroundReview={gate,entered:false};
  await runtime.playSource(`const extra=await createSoundChip('ym2612',{id:'extra'});
    keyboard.bind('extra',{noteOn(){extra.keyOn(0);},noteOff(){extra.keyOff(0);},
      async allNotesOff(){globalThis.playgroundReview.entered=true;await globalThis.playgroundReview.gate.promise;extra.keyOff(0);}});`);
  await runtime.getKeyboardTarget().noteOn({id:'held',midi:60});
  const stopBoundary=fixture.events.length;
  assert.equal(runtime.stop(),undefined);
  assert.equal(fixture.devices[0].disconnected,true,'Stop disconnects audible output synchronously');
  assert.equal(fixture.devices[0].disposed,false,'async cleanup keeps the original client alive');
  assert.deepEqual(runtime.chipInspector.list(),[],'a retiring device is no longer selectable');
  await until(()=>globalThis.playgroundReview.entered);
  let started=false;const next=runtime.playSource(`await createSoundChip('ym2612',{id:'extra'});`).then(()=>{started=true;});
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(started,false);assert.equal(fixture.devices.length,1,'next Run cannot reuse the retiring ID early');
  gate.resolve();await next;
  assert.equal(fixture.devices[0].disposed,true);assert.equal(fixture.devices.length,2);
  const off=fixture.events.findIndex(([kind,id,method,args],index)=>index>=stopBoundary&&kind==='command'&&id===0&&method==='write'&&args[1]===0x28&&args[2]===0);
  const disposed=fixture.events.findIndex(([kind,id])=>kind==='dispose'&&id===0),created=fixture.events.findIndex(([kind,id])=>kind==='create'&&id===1);
  assert(off>=0&&off<disposed&&disposed<created,'cleanup reaches the old client before disposal and replacement creation');
  assert.deepEqual(logs,[]);
  await runtime.finalize();assert(fixture.devices.every(device=>device.disposed));
});

test('finalize waits for independent custom Keyboard cleanup before closing the primary AudioContext',async t=>{
  const fixture=independentOpnFixture(),createRuntime=await runtimeWithOpnAudio(fixture.factory);
  const {runtime,megaDrive,logs}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};
  const gate=deferred();globalThis.playgroundReview={gate,entered:false};let closed=false;
  megaDrive.close=async()=>{closed=true;fixture.events.push(['primary-close']);};
  await runtime.playSource(`const extra=await createSoundChip('ym2612',{id:'extra'});
    keyboard.bind('extra',{noteOn(){},noteOff(){},async allNotesOff(){
      globalThis.playgroundReview.entered=true;await globalThis.playgroundReview.gate.promise;extra.keyOff(0);}});`);
  const finalizing=runtime.finalize();await until(()=>globalThis.playgroundReview.entered);
  assert.equal(fixture.devices[0].disconnected,true);assert.equal(fixture.devices[0].disposed,false);assert.equal(closed,false);
  gate.resolve();await finalizing;
  assert.equal(fixture.devices[0].disposed,true);assert.equal(closed,true);assert.deepEqual(logs,[]);
  assert(fixture.events.findIndex(([kind])=>kind==='dispose')<fixture.events.findIndex(([kind])=>kind==='primary-close'));
});

test('custom Keyboard cleanup can await pg.stopAll without waiting on its own device retirement',async t=>{
  const fixture=independentOpnFixture(),createRuntime=await runtimeWithOpnAudio(fixture.factory);
  const {runtime,megaDrive,logs}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};
  globalThis.playgroundReview={released:false};
  await runtime.playSource(`const extra=await createSoundChip('ym2612',{id:'extra'});
    keyboard.bind('extra',{noteOn(){},noteOff(){},async allNotesOff(){
      await pg.stopAll();extra.keyOff(0);globalThis.playgroundReview.released=true;}});`);
  runtime.stop();await runtime.finalize();
  assert.equal(globalThis.playgroundReview.released,true);assert.equal(fixture.devices[0].disposed,true);assert.deepEqual(logs,[]);
});

test('Stop silences RF output immediately but retains the real client until async liveCleanup acknowledgements and same-ID reuse',async t=>{
  const gate=deferred(),fixture=independentRfFixture(gate),createRuntime=await runtimeWithOpnAudio(fixture.factory,'createRf5c164Audio');
  const {runtime,megaDrive,logs}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};
  globalThis.playgroundReview={finished:false};
  await runtime.playSource(`const pcm=await createSoundChip('rf5c164',{id:'cleanup-pcm'});await pcm.keyOn(0);
    liveLoop('rf-held',async()=>{await sleep(60);});
    liveCleanup(['rf-held'],async()=>{await pcm.keyOff(0);await pcm.keyOff(1);globalThis.playgroundReview.finished=true;});`);
  assert.equal(runtime.stop(),undefined);assert.equal(fixture.devices[0].disconnected,true);assert.equal(fixture.devices[0].disposed,false);
  await until(()=>fixture.devices[0].waiting);let restarted=false;
  const next=runtime.playSource(`await createSoundChip('rf5c164',{id:'cleanup-pcm'});`).then(()=>{restarted=true;});
  for(let i=0;i<10;i++)await Promise.resolve();assert.equal(restarted,false);assert.equal(fixture.devices.length,1);
  gate.resolve();await next;assert.equal(globalThis.playgroundReview.finished,true);assert.equal(fixture.devices[0].disposed,true);assert.equal(fixture.devices.length,2);
  const lastRelease=fixture.events.findIndex(([kind,id,method,args])=>kind==='command'&&id===0&&method==='keyOff'&&args[0]===1),disposed=fixture.events.findIndex(([kind,id])=>kind==='dispose'&&id===0),replaced=fixture.events.findIndex(([kind,id])=>kind==='create'&&id===1);
  assert(lastRelease<disposed&&disposed<replaced);assert.deepEqual(logs,[]);await runtime.finalize();
});

test('finalize and repeated Stop await asynchronous liveCleanup even without an additional audio device',async t=>{
  const gate=deferred(),{runtime,megaDrive,logs}=setup(t);let closed=false;megaDrive.close=async()=>{closed=true;};
  globalThis.playgroundReview={gate,finished:false};
  await runtime.playSource(`liveLoop('cleanup-delay',async()=>{await sleep(60);});liveCleanup(['cleanup-delay'],async()=>{await globalThis.playgroundReview.gate.promise;globalThis.playgroundReview.finished=true;});`);
  runtime.stop();const finishing=runtime.finalize();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(closed,false);
  gate.resolve();await finishing;assert.equal(globalThis.playgroundReview.finished,true);assert.equal(closed,true);assert.deepEqual(logs,[]);
});

test('async liveCleanup may await pg.stopAll after an arbitrary promise without waiting on its own retirement',async t=>{
  const gate=deferred(),fixture=independentRfFixture(),createRuntime=await runtimeWithOpnAudio(fixture.factory,'createRf5c164Audio');
  const {runtime,megaDrive,logs}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};globalThis.playgroundReview={gate,finished:false};
  await runtime.playSource(`const pcm=await createSoundChip('rf5c164',{id:'nested-cleanup'});liveLoop('nested',async()=>{await sleep(60);});
    liveCleanup(['nested'],async()=>{await globalThis.playgroundReview.gate.promise;await pg.stopAll();await pcm.keyOff(0);globalThis.playgroundReview.finished=true;});`);
  runtime.stop();gate.resolve();await runtime.finalize();assert.equal(globalThis.playgroundReview.finished,true);assert.equal(fixture.devices[0].disposed,true);assert.deepEqual(logs,[]);
});

test('ordinary pg.stopAll still awaits the additional device disposal fence',async t=>{
  const fixture=independentRfFixture(),createRuntime=await runtimeWithOpnAudio(fixture.factory,'createRf5c164Audio');
  const {runtime,megaDrive,logs}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};
  globalThis.playgroundReview={finished:false};await runtime.playSource(`await createSoundChip('rf5c164',{id:'ordinary-stop'});await pg.stopAll();globalThis.playgroundReview.finished=true;`);
  assert.equal(globalThis.playgroundReview.finished,true);assert.equal(fixture.devices[0].disposed,true);assert.deepEqual(logs,[]);
});

test('the running AudioContext fade path waits for liveCleanup RF acknowledgement and disposal after reaching silence',async t=>{
  const gate=deferred(),fixture=independentRfFixture(gate),createRuntime=await runtimeWithOpnAudio(fixture.factory,'createRf5c164Audio');
  const {runtime,megaDrive,logs}=setup(t,undefined,{},createRuntime);
  const gain={value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;},setValueCurveAtTime(){},linearRampToValueAtTime(){}};
  megaDrive.audioContext={state:'running',currentTime:0,destination:{},createGain:()=>({gain,connect(){},disconnect(){}})};
  megaDrive.audio={masterInputNode:{},outputNode:null,connectOutput(){}};
  await runtime.playSource(`const pcm=await createSoundChip('rf5c164',{id:'fading-cleanup'});liveLoop('fade-held',async()=>{await sleep(60);});liveCleanup(['fade-held'],async()=>{await pcm.keyOff(0);});`);
  let finished=false;const fading=runtime.stopWithFade().then(()=>{finished=true;});megaDrive.audioContext.currentTime=.125;
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(gain.value,0);assert.equal(fixture.devices[0].disconnected,true);assert.equal(fixture.devices[0].disposed,false);assert.equal(finished,false);
  gate.resolve();await fading;assert.equal(fixture.devices[0].disposed,true);assert.deepEqual(logs,[]);await runtime.finalize();
});

test('Main shared PCM sample factory releases started voices across separate key callback leases',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'ym2612',fmChannels:6,psg:true,dac:true});
  const {writes}=attachPrimaryPcm(megaDrive);
  await runtime.playSource(`const instrument=await createSampleInstrument({channels:[new Float32Array([0,.5,-.5,0])],sampleRate:16000});keyboard.bind('sampler',instrument);`);
  const target=runtime.getKeyboardTarget();
  await target.noteOn({id:'first',midi:60});assert.equal(writes.at(-1)[1],254);
  await target.noteOff({id:'first',midi:60});assert.equal(writes.at(-1)[1],255,'key release reaches the primary device');
  await target.noteOn({id:'second',midi:60});assert.equal(writes.at(-1)[1],254);
  await target.allNotesOff();assert.equal(writes.at(-1)[1],255,'all-notes-off shares the binding audio owner');
});

test('Main shared Game Boy sample factory releases wave RAM notes from another callback lease',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'gameboy',fmChannels:0,psg:false,dac:false});
  const writes=[];megaDrive.fm=null;
  megaDrive.gameboy=new GameboySynth({transport:{reset(){},writeRegister:(...args)=>writes.push(args)}});megaDrive.gameboy.initialize();
  await runtime.playSource(`const instrument=await createSampleInstrument({channels:[new Float32Array([0,.5,-.5,0])],sampleRate:16000,waveform:new Uint8Array(32).fill(8)});keyboard.bind('sampler',instrument);`);
  const target=runtime.getKeyboardTarget();
  await target.noteOn({id:'wave',midi:60});assert(writes.some(([register,value])=>register===14&&(value&128)));
  const before=writes.length;await target.noteOff({id:'wave',midi:60});
  assert(writes.slice(before).some(([register,value])=>register===10&&!(value&128)),'wave key release reaches the mono primary device');
});

test('Main native PSG musical binding releases the channel across separate key callback leases',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'segapsg',fmChannels:0,psg:true,dac:false});
  const writes=[],raw=createSegaPsgClient({postMessage:command=>writes.push(command),start(){},close(){}});
  megaDrive.fm=null;megaDrive.psg=raw;megaDrive.primaryEndpoints=[{name:'segapsg',globalName:'psg',client:raw}];megaDrive.stopAllNative=()=>raw.allNotesOff();
  await runtime.playSource(`keyboard.bind('psg',{noteOn(){psg.tone(0,{note:'C4',attenuation:7});},noteOff(){psg.off(0);},allNotesOff(){psg.allNotesOff();}});`);
  const target=runtime.getKeyboardTarget();await target.noteOn({id:'tone',midi:60});assert.equal(writes.at(-1).args[0],0x97);
  await target.noteOff({id:'tone',midi:60});assert.equal(writes.at(-1).args[0],0x9f);
});

test('Main shared sample factory retains queued input leases and rejects a retired voice continuation',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'ym2612',fmChannels:6,psg:true,dac:true});
  const {writes}=attachPrimaryPcm(megaDrive),gate=deferred();
  const setChannel=megaDrive.pcm.setChannel.bind(megaDrive.pcm);let entered=false;
  megaDrive.pcm.setChannel=(...args)=>{entered=true;return gate.promise.then(()=>setChannel(...args));};
  await runtime.playSource(`
    if(createSampleInstrument!==pg.createSampleInstrument)throw Error('Separate factory');
    const instrument=await createSampleInstrument({channels:[new Float32Array([0,.5,-.5,0])],sampleRate:16000});
    keyboard.bind(instrument.name,instrument);
  `);
  const old=runtime.getKeyboardTarget();assert.match(old.name,/RF5C164/);
  const on=old.noteOn({id:'held',midi:60});await until(()=>entered);
  await old.allNotesOff();runtime.stop();await runtime.playSource('');
  const boundary=writes.length;gate.resolve();await on;
  assert(!writes.slice(boundary).some(([register,value])=>register===8&&value!==255),
    'an awaited voice FIFO cannot trigger a note after its input lease retires');
});

test('Main audio input forwards saved asset options without bypassing strict option validation',async t=>{
  const requests=[];const {runtime}=setup(t,undefined,{inputAudio:options=>{requests.push(options);return Promise.resolve(null);}});
  await runtime.playSource(`await inputAudio({title:'Restore',asset:'/instruments/voice.sample.json',edit:false});`);
  assert.deepEqual(requests,[{title:'Restore',asset:'/instruments/voice.sample.json',edit:false}]);
  await assert.rejects(runtime.playSource(`await inputAudio({asset:4});`),/inputAudio supports/);
  await assert.rejects(runtime.playSource(`await inputAudio({edit:'no'});`),/inputAudio supports/);
});

test('primary Game Boy exposes shared initialized controls without FM shortcuts and survives Stop', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'gameboy',fmChannels:0,psg:false,dac:false});
  const writes=[];
  megaDrive.fm=null;
  megaDrive.gameboy=new GameboySynth({transport:{reset(){},writeRegister:(...args)=>writes.push(args)}});
  megaDrive.gameboy.initialize();
  await runtime.playSource(`
    const prepared=await livePrepare('gameboy',api=>({gameboy:api.gameboy,keys:Object.keys(api)}));
    if(gameboy!==pg.gameboy || prepared.gameboy!==gameboy || await useSoundChip('gameboy')!==gameboy)throw Error('Separate primary APU');
    if(typeof gameboy.dispose!=='undefined')throw Error('Primary lifetime leaked');
    for(const name of ['fm','psg','dac','midi','play','write','CH1','OP1','FM_PRESETS','noteToBlockFnum']) {
      if(name in pg || prepared.keys.includes(name))throw Error('OPN shortcut '+name);
    }
    if(typeof fm!=='undefined'||typeof play!=='undefined'||typeof write!=='undefined'||typeof CH1!=='undefined')throw Error('Unexpected OPN global');
    gameboy.pulse.setVoice(0,{volume:13}); gameboy.pulse.noteOn(0,'A4');
    gameboy.wave.noteOn('C3'); gameboy.noise.keyOn();
  `);
  assert.equal(runtime.fm,null); assert.equal(runtime.gameboy,megaDrive.gameboy);
  assert(writes.some(([reg,v])=>reg===4&&(v&128)));
  const before=writes.length;
  await runtime.stop();
  for(const register of [2,7,10,17])assert(writes.slice(before).some(([r,v])=>r===register&&v===0));
  const stopped=writes.length;
  await runtime.playSource(`gameboy.pulse.noteOn(0,'C4');`);
  assert(writes.slice(stopped).some(([reg,v])=>reg===2&&(v>>4)===13),'Stop retains pulse voice without initialize/reset');
});

test('native SNES Stop sends no OPN audition commands and its primary BRR port remains usable', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'snes',fmChannels:0,psg:false,dac:false});
  const backend=new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},dispose(){}}});
  const port={start(){},close(){},postMessage({method,args=[],id}) {
    const value=backend[method](...args);
    if(id!==undefined)queueMicrotask(()=>port.onmessage({data:{id,value}}));
  }};
  const raw=createSnesClient(port);
  megaDrive.fm=null;
  megaDrive.node={port:{postMessage(command){throw Error('Unexpected OPN node command: '+JSON.stringify(command));}}};
  megaDrive.primaryEndpoints=[{name:'snes',globalName:'snes',client:raw,node:megaDrive.node}];
  megaDrive.stopAllNative=()=>raw.allNotesOff();
  const source=`const tone=await snes.loadBRR(new Uint8Array([0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf]),{baseFrequencyHz:2000,loopStartSamples:0});snes.setPreset(0,{sample:tone});snes.noteOn(0,'C4');`;
  await runtime.playSource(source);
  runtime.stop();
  await runtime.playSource(source);
  assert.equal(backend.samples.length,2,'a second BRR upload resolves after Stop');
  assert.equal(runtime.fm,null);
});

function attachDx7Primary(megaDrive) {
  const writes=[],raw={
    noteOn:(...args)=>writes.push(['noteOn',...args]),noteOff:note=>writes.push(['noteOff',note]),
    allNotesOff:()=>writes.push(['allNotesOff']),panic:()=>writes.push(['panic']),
    _stopVoices:()=>writes.push(['stopVoices']),
    async setPreset(preset){raw.preset=structuredClone(preset);},
    dispose(){throw Error('Primary DX7 lifetime leaked');},
  };
  megaDrive.fm=null;megaDrive.psg=null;megaDrive.dx7=raw;
  megaDrive.primaryEndpoints=[{name:'dx7',globalName:'dx7',client:raw}];
  megaDrive.stopAllNative=()=>raw._stopVoices();
  return {raw,writes};
}

test('primary DX7 shares its API, hides OPN shortcuts and lifetime, supports Keyboard and retains its patch on Stop',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'dx7',fmChannels:0,psg:false,dac:false}),{raw,writes}=attachDx7Primary(megaDrive);
  await runtime.playSource(`
    const prepared=await livePrepare('dx7',api=>({dx7:api.dx7,keys:Object.keys(api)}));
    if(dx7!==pg.dx7||prepared.dx7!==dx7||await useSoundChip('dx7')!==dx7)throw Error('Separate DX7 primary');
    if(typeof dx7.dispose!=='undefined'||typeof dx7._stopVoices!=='undefined')throw Error('Lifetime leaked');
    for(const name of ['fm','psg','dac','midi','play','write','CH1','OP1','FM_PRESETS','noteToBlockFnum']){
      if(name in pg||prepared.keys.includes(name))throw Error('OPN shortcut '+name);
    }
    await dx7.setPreset({name:'PERSISTENT'});
    keyboard.bind('DX7',{noteOn:({midi,velocity})=>dx7.noteOn(midi,velocity??100),noteOff:({midi})=>dx7.noteOff(midi),allNotesOff:()=>dx7.panic()});
  `);
  const target=runtime.getKeyboardTarget();await target.noteOn({id:'a',midi:69,velocity:96});
  assert.deepEqual(writes.at(-1),['noteOn',69,96]);await target.noteOff({id:'a',midi:69});assert.deepEqual(writes.at(-1),['noteOff',69]);
  runtime.stop();assert.equal(raw.preset.name,'PERSISTENT');assert(writes.some(command=>command[0]==='stopVoices'));
  await runtime.playSource(`dx7.noteOn(60);`);assert.deepEqual(writes.at(-1),['noteOn',60]);assert.equal(runtime.fm,null);
});

test('stopping a DX7 Main liveLoop releases its note and cannot release a newer owner of the same MIDI note',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'dx7',fmChannels:0,psg:false,dac:false}),{writes}=attachDx7Primary(megaDrive);
  await runtime.playSource(`liveLoop('old',async()=>{dx7.noteOn(69);await sleep(60);});liveLoop('new',async()=>{dx7.noteOn(69);dx7.noteOn(72);await sleep(60);});context.old=()=>stopLoop('old');context.next=()=>stopLoop('new');`);
  await until(()=>writes.filter(command=>command[0]==='noteOn').length===3);
  const boundary=writes.length;runtime.context.old();assert.equal(writes.length,boundary);
  runtime.context.next();assert.deepEqual(writes.slice(boundary),[['noteOff',69],['noteOff',72]]);
});

test('a new Main DX7 Run waits for Stop snapshot acknowledgements before handing off primary state',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'dx7',fmChannels:0,psg:false,dac:false}),{raw,writes}=attachDx7Primary(megaDrive);
  await runtime.playSource('');const gate=deferred();megaDrive.stopAllNative=()=>gate.promise;
  runtime.stop();const next=runtime.playSource('dx7.noteOn(72);');
  await Promise.resolve();await Promise.resolve();assert(!writes.some(command=>command[0]==='noteOn'));
  gate.resolve();await next;assert.deepEqual(writes.at(-1),['noteOn',72]);
  megaDrive.stopAllNative=()=>raw._stopVoices();
});

for(const chip of ['dx7','snes','segapsg'])test(`${chip} keyboard audition waits for the preceding native Stop acknowledgement`,async t=>{
  const {runtime,megaDrive}=setup(t,{chip,fmChannels:0,psg:chip==='segapsg',dac:false});
  megaDrive.stopAllNative=()=>{};await runtime.initialize();const gate=deferred();
  megaDrive.stopAllNative=()=>gate.promise;runtime.stop();let ready=false;
  const audition=runtime.prepareAudition().then(()=>{ready=true;});
  for(let i=0;i<8;i++)await Promise.resolve();assert.equal(ready,false,'admin-port audition must not overtake a remote-port Stop');
  gate.resolve();await audition;assert.equal(ready,true);megaDrive.stopAllNative=()=>{};
});

test('primary PCM Keyboard waits for the applied Stop and retains its sample API',async t=>{
  const {runtime,megaDrive}=setup(t);await runtime.initialize();const gate=deferred();let stops=0;
  const pcm={_stopVoices(){stops++;return gate.promise;},_cancelClockRequests(){}};
  megaDrive.pcm=pcm;runtime.stop();assert.equal(stops,1);let ready=false;
  const pending=runtime.prepareAudition().then(()=>{ready=true;});
  for(let i=0;i<8;i++)await Promise.resolve();assert.equal(ready,false);
  gate.resolve();await pending;assert.equal(megaDrive.pcm,pcm);assert.equal(ready,true);
  megaDrive.pcm=null;
});

test('a newer Stop retires an older pending audition preparation before it can reopen audio',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'dx7',fmChannels:0,psg:false,dac:false});
  megaDrive.stopAllNative=()=>{};await runtime.initialize();const first=deferred(),second=deferred();let count=0;
  megaDrive.stopAllNative=()=>++count===1?first.promise:second.promise;
  runtime.stop();const expired=runtime.prepareAudition();const rejected=assert.rejects(expired,{name:'AbortError'});
  for(let i=0;i<8;i++)await Promise.resolve();runtime.stop();first.resolve();await rejected;
  let ready=false;const next=runtime.prepareAudition().then(()=>{ready=true;});
  for(let i=0;i<8;i++)await Promise.resolve();assert.equal(ready,false,'the successor audition must also wait for the latest Stop');
  second.resolve();await next;assert.equal(ready,true);megaDrive.stopAllNative=()=>{};
});

test('a fade started after an audition request retires that request rather than adopting the newer Stop',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'dx7',fmChannels:0,psg:false,dac:false});
  const gain={value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;},setValueCurveAtTime(){},linearRampToValueAtTime(){}};
  megaDrive.audioContext={state:'running',currentTime:0,destination:{},createGain:()=>({gain,connect(){},disconnect(){}})};
  megaDrive.audio={outputNode:null,connectOutput(){}};megaDrive.stopAllNative=()=>{};await runtime.ensureReady();
  const first=deferred(),second=deferred();let count=0;megaDrive.stopAllNative=()=>++count===1?first.promise:second.promise;
  runtime.stop();const audition=runtime.prepareAudition(),rejected=assert.rejects(audition,{name:'AbortError'});
  for(let i=0;i<8;i++)await Promise.resolve();
  let faded=false;const fade=runtime.stopWithFade().then(()=>{faded=true;});first.resolve();
  for(let i=0;i<16;i++)await Promise.resolve();megaDrive.audioContext.currentTime=.125;
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(faded,false,'fade completion also waits for its newer Stop barrier');second.resolve();await fade;await rejected;megaDrive.stopAllNative=()=>{};
});

test('stopping a Main Game Boy liveLoop releases its held voice', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'gameboy',fmChannels:0,psg:false,dac:false});
  const writes=[];
  megaDrive.fm=null;
  megaDrive.gameboy=new GameboySynth({transport:{reset(){},writeRegister:(...args)=>writes.push(args)}});
  megaDrive.gameboy.initialize();
  writes.length=0;
  await runtime.playSource(`liveLoop('held',async()=>{gameboy.pulse.noteOn(0,'C4');await sleep(60);});`);
  await until(()=>writes.some(([r,v])=>r===4&&(v&128)));
  const before=writes.length;
  await runtime.playSource(`stopLoop('held');`);
  assert(writes.slice(before).some(([r,v])=>r===2&&v===0));
});

test('a stopped Main Game Boy loop cannot release the next script replacement note', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'gameboy',fmChannels:0,psg:false,dac:false});
  const writes=[];
  megaDrive.fm=null;
  megaDrive.gameboy=new GameboySynth({transport:{reset(){},writeRegister:(...args)=>writes.push(args)}});
  megaDrive.gameboy.initialize(); writes.length=0;
  await runtime.playSource(`liveLoop('held',async()=>{gameboy.pulse.noteOn(0,'C4');try{await sleep(60);}finally{gameboy.pulse.keyOff(0);}});`);
  await until(()=>writes.some(([r,v])=>r===4&&(v&128)));
  const before=writes.length;
  await runtime.playSource(`gameboy.pulse.noteOn(0,'E4');stopLoop('held');`);
  await Promise.resolve();
  const replacement=writes.slice(before);
  assert(replacement.some(([r,v])=>r===4&&(v&128)));
  assert(!replacement.some(([r,v])=>r===2&&v===0),'retired loop cannot mute the script replacement');
});

test('primary OPNA exposes one shared SSG/rhythm/ADPCM API and Stop releases all sections', async t => {
  const {runtime, megaDrive} = setup(t, {chip:'ym2608', fmChannels:6, psg:false, dac:false});
  const writes = [], uploads = [], roms = [], canceled = [];
  megaDrive.fm = new YM2608Synth({transport:{reset() {},
    write:(port,register,value) => writes.push([port,register,value]), loadAdpcmMemory:(...args) => {uploads.push(args); return Promise.resolve();},
    loadRhythmRom:bytes => {roms.push(bytes); return Promise.resolve();}, cancelPending:reason => canceled.push(reason),
  }});
  await runtime.playSource(`
    const shared = await livePrepare('sections', ({ssg,rhythm,adpcm}) => ({ssg,rhythm,adpcm}));
    for (const name of ['ssg','rhythm','adpcm']) {
      if (shared[name] !== pg[name]) throw Error('Separate section ' + name);
    }
    if (ssg !== pg.ssg || rhythm !== pg.rhythm || adpcm !== pg.adpcm) throw Error('Separate global sections');
    const {setVolume} = ssg;
    setVolume(0, 12);
    ssg.noteOn(0, 'A4');
    await rhythm.loadRom(new ArrayBuffer(8192));
    rhythm.setVolume(48); rhythm.setVoice('snare', {volume:24, left:true, right:true}); rhythm.keyOn('snare');
    const sample = await adpcm.loadSample({channels:[new Float32Array([0,.5,-.5,0])],sampleRate:8000});
    adpcm.setVolume(180); adpcm.setPan(true,true); adpcm.keyOn({repeat:true});
    context.sections = [ssg,rhythm,adpcm];
  `);
  assert.equal(uploads.length, 1);
  assert.equal(roms.length, 1);
  assert(roms[0] instanceof Uint8Array);
  const before = writes.length;
  await runtime.stop();
  const stopWrites = writes.slice(before);
  for (let channel = 0; channel < 3; channel++) assert(stopWrites.some(([port,r,v]) => port === 0 && r === 8 + channel && v === 0));
  assert(stopWrites.some(([port,r,v]) => port === 0 && r === 0x10 && v === 0xbf));
  assert(stopWrites.some(([port,r,v]) => port === 1 && r === 0 && v === 1));
  assert.deepEqual(canceled, ['Run stopped']);
});

test('primary YM2203 exposes shared SSG tone/noise/envelope and Stop silences all three channels', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'ym2203',fmChannels:3,psg:false,dac:false});
  const writes=[];
  megaDrive.fm=new YM2203Synth({transport:{reset(){},write(port,register,value){writes.push([port,register,value]);}}});
  await runtime.playSource(`
    const prepared=await livePrepare('ssg',({ssg})=>ssg);
    if(ssg!==pg.ssg || prepared!==ssg)throw Error('Separate SSG');
    if(typeof adpcm!=='undefined' || typeof rhythm!=='undefined')throw Error('Unexpected ADPCM/rhythm');
    ssg.tone(0,{frequency:440,volume:12});
    ssg.noise(1,{period:16,volume:8});
    ssg.setEnvelope({period:2000,shape:9});
    ssg.tone(2,{frequency:880,envelope:true});
  `);
  const core=megaDrive.fm;
  assert.equal(core.ssg.registers[0]|core.ssg.registers[1]<<8,Math.round((4000000/2)/(16*440)));
  assert.equal(core.ssg.registers[6],16);
  assert.equal(core.ssg.registers[10],16);
  const before=writes.length;
  runtime.stop();
  for(let ch=0;ch<3;ch++)assert(writes.slice(before).some(([p,r,v])=>p===0&&r===8+ch&&v===0));
  assert.deepEqual(core.ssg._getState().levels,[12,8,16],'Stop retains configured volume/envelope');
});

test('Stop during primary ADPCM decoding prevents a late memory upload or retrigger', async t => {
  const {runtime, megaDrive} = setup(t, {chip:'ym2608', fmChannels:6, psg:false, dac:false});
  const decoded = deferred(), uploads = [], writes = [];
  megaDrive.fm = new YM2608Synth({transport:{reset() {}, write:(port,register,value) => writes.push([port,register,value]),
    loadAdpcmMemory:(...args) => {uploads.push(args); return Promise.resolve();},
  }});
  globalThis.playgroundReview = {decode:decoded.promise, requested:false};
  const running = runtime.playSource(`
    try {
      await adpcm.loadSample(new Uint8Array([1,2,3]), {decodeAudio:() => {
        globalThis.playgroundReview.requested = true;
        return globalThis.playgroundReview.decode;
      }});
      adpcm.keyOn({repeat:true});
    } catch (error) { globalThis.playgroundReview.error = error.message; }
  `);
  await until(() => globalThis.playgroundReview.requested);
  await runtime.stop();
  const stoppedWrites = writes.length;
  decoded.resolve({channels:[new Float32Array([0,.5,-.5,0])],sampleRate:8000});
  await running;
  assert.equal(globalThis.playgroundReview.error, 'Run stopped');
  assert.equal(uploads.length, 0);
  assert.equal(writes.length, stoppedWrites);
});

for (const chip of ['ym2610','ym2610b']) test(`primary ${chip} exposes shared SSG and ADPCM-A/B and Stop releases every section`, async t => {
  const {runtime,megaDrive} = setup(t,{chip,fmChannels:chip==='ym2610'?4:6,psg:false,dac:false});
  const writes=[],uploads=[],canceled=[];
  const core=new YM2610BSynth({transport:{reset(){},
    write:(port,register,value)=>writes.push([port,register,value]),
    loadAdpcmMemory:(type,bytes,address)=>{uploads.push({type,bytes,address});return Promise.resolve();},
    cancelPending:reason=>canceled.push(reason),
  }});
  megaDrive.fm=chip==='ym2610'?new NeoGeoFMSynth(core):core;
  await runtime.playSource(`
    const shared=await livePrepare('sections',({ssg,adpcmA,adpcmB,adpcm})=>({ssg,adpcmA,adpcmB,adpcm}));
    if(adpcm!==adpcmB || pg.adpcm!==adpcmB)throw Error('ADPCM-B alias');
    for(const name of ['ssg','adpcmA','adpcmB','adpcm'])if(shared[name]!==pg[name])throw Error('Separate section '+name);
    if(ssg!==pg.ssg || adpcmA!==pg.adpcmA || adpcmB!==pg.adpcmB)throw Error('Separate globals');
    const borrowed=await useSoundChip('${chip}');if(borrowed!==fm||borrowed.ssg!==ssg||borrowed.adpcmA!==adpcmA||borrowed.adpcm!==adpcmB)throw Error('Borrowed variant sections');
    if(typeof rhythm!=='undefined')throw Error('Unexpected OPNA rhythm');
    ssg.noise(2,{period:16,volume:10});
    await adpcmA.loadMemory(new Uint8Array(256).fill(0x17),256);
    adpcmA.setVolume(48);adpcmA.setVoice(5,{volume:24,left:true,right:true});
    adpcmA.setSample(5,{start:256,end:512});adpcmA.keyOn(5);
    await adpcmB.loadMemory(new ArrayBuffer(256),512);
    adpcmB.setSample({start:512,end:768});adpcmB.setPlaybackRate(8000);
    adpcmB.setVolume(180);adpcmB.setPan(true,true);adpcmB.keyOn({repeat:true});
    fm.setAlgo(${chip==='ym2610'?3:5},7,0);
  `);
  assert.deepEqual(uploads.map(({type,address,bytes})=>[type,address,bytes.length]),[[0,256,256],[1,512,256]]);
  assert(writes.some(([port,r])=>port===1&&r===0xb2),'highest logical FM channel maps to hardware channel 5');
  const before=writes.length;
  runtime.stop();
  const stopped=writes.slice(before);
  for(let ch=0;ch<3;ch++)assert(stopped.some(([port,r,v])=>port===0&&r===8+ch&&v===0));
  assert(stopped.some(([port,r,v])=>port===1&&r===0&&v===0xbf));
  assert(stopped.some(([port,r,v])=>port===0&&r===0x10&&v===1));
  assert.deepEqual(canceled,['Run stopped']);
});

test('Worker playback defaults to 500 ms independently of the DAC scheduler', t => {
  const {runtime} = setup(t);
  assert.equal(runtime.getTiming().workerLookaheadSeconds, .5);
  runtime.setTiming({lookaheadSeconds:.04});
  assert.equal(runtime.getTiming().workerLookaheadSeconds, .5, 'the DAC scheduler setting is independent');
});

for (const seconds of [0, .15, .085, .5, 2]) test(`Worker playback retains the explicit ${seconds} second lead`, async t => {
  const {runtime} = setup(t, undefined, {workerLookaheadSeconds:seconds});
  assert.equal(runtime.getTiming().workerLookaheadSeconds, seconds);
  await runtime.stop();
  assert.equal(runtime.getTiming().workerLookaheadSeconds, seconds, 'Stop preserves the chosen lead');
});

test('chip inspector stays audio-free until initialization and retains subscriptions across finalize/reinitialize',async t=>{
  const {runtime,megaDrive}=setup(t);
  const subscribers=new Set();let starts=0;
  megaDrive.mixer={subscribe:listener=>{subscribers.add(listener);return()=>subscribers.delete(listener);}};
  megaDrive.start=async function(){starts++;this.state='ready';this.psg={};this.node={port:{postMessage(){}}};};
  megaDrive.close=async function(){this.psg=null;this.node=null;this.state='closed';};
  const snapshots=[];const unsubscribe=runtime.chipInspector.subscribe(entries=>snapshots.push(entries.map(entry=>entry.id)));
  assert.deepEqual(runtime.chipInspector.list(),[]);
  await assert.rejects(runtime.chipInspector.read('segapsg'),/not connected/);
  assert.equal(starts,0);assert.equal(subscribers.size,0);
  await runtime.initialize();assert.equal(starts,1);assert.equal(subscribers.size,1);assert.deepEqual(snapshots.at(-1),['ym2612','segapsg']);
  await runtime.finalize();assert.equal(subscribers.size,0);assert.deepEqual(snapshots.at(-1),[]);
  await runtime.initialize();assert.equal(starts,2);assert.equal(subscribers.size,1);assert.deepEqual(snapshots.at(-1),['ym2612','segapsg']);
  await runtime.finalize();unsubscribe();
});

for (const [chip,kind] of [['gameboy','gameboy'],['nes','nes'],['x68000','ym2151'],['x68000','okim6258'],['huc6280','huc6280'],['dx7','dx7']]) test(`${chip} ${kind} inspector borrows its primary admin port without starting audio or taking the Worker port`,async t=>{
  const {runtime,megaDrive}=setup(t,{chip,fmChannels:0});
  megaDrive.stopAllNative=()=>{};
  const listeners=new Set(),messages=[];
  megaDrive.psg=null;
  assert.deepEqual(runtime.chipInspector.list(),[]);
  const port={addEventListener(_type,listener){listeners.add(listener);},removeEventListener(_type,listener){listeners.delete(listener);},start(){},postMessage(message){
    messages.push(message);queueMicrotask(()=>{for(const listener of listeners)listener({data:{type:'chip-inspector-result',id:message.id,value:{kind,channels:[]}}});});
  }};
  if(chip==='gameboy'){megaDrive.node={port};assert.deepEqual(runtime.chipInspector.list(),[],'an APU still loading cannot receive admin reads');megaDrive.gameboy={};}
  else megaDrive.primaryEndpoints=[{name:kind,globalName:kind==='ym2151'?'opm':kind==='okim6258'?'adpcm':kind==='huc6280'?'pce':kind==='dx7'?'dx7':'nes',client:{},node:{port}}];
  assert.deepEqual(runtime.chipInspector.list().map(({id,kind})=>({id,kind})),[{id:kind,kind}]);
  assert.equal(megaDrive.state,'idle');
  assert.equal((await runtime.chipInspector.read(kind)).kind,kind);
  await runtime.chipInspector.invoke(kind,'auditionOn',[0,69,'press']);
  assert.deepEqual(messages.map(({type,action})=>[type,action]),[['chip-inspector','read'],['chip-inspector','invoke']]);
  assert.equal(megaDrive.state,'idle');
  megaDrive.node=null;megaDrive.primaryEndpoints=[];runtime.chipInspector.notify();
  assert.equal(listeners.size,0);await assert.rejects(runtime.chipInspector.read(kind),/not connected/);
});

test('rerun replaces a liveLoop only after its current iteration completes', async t => {
  const {runtime} = setup(t);
  const old = deferred(), next = deferred(), events = [];
  globalThis.playgroundReview = {old: old.promise, next: next.promise, events};
  await runtime.playSource(`liveLoop('lead',async()=>{globalThis.playgroundReview.events.push('old-start');await globalThis.playgroundReview.old;globalThis.playgroundReview.events.push('old-end');});`);
  await runtime.playSource(`liveLoop('lead',async()=>{globalThis.playgroundReview.events.push('new-start');await globalThis.playgroundReview.next;});`);
  assert.deepEqual(events, ['old-start']);
  old.resolve();
  await until(()=>events.includes('new-start'));
  assert.deepEqual(events, ['old-start','old-end','new-start']);
});

test('Main executes bare and pg seconds timeline APIs', {timeout:2000}, async t => {
  const {runtime} = setup(t);
  globalThis.playgroundReview = [];
  await runtime.playSource(`
    const timeline = createTimeline();
    await timeline.waitUntil(0);
    globalThis.playgroundReview.push('bare');
    await pg.createTimeline().waitUntil(0);
    globalThis.playgroundReview.push('pg');
  `);
  assert.deepEqual(globalThis.playgroundReview,['bare','pg']);
});

test('Main timeline lets the current liveLoop iteration finish after rerun', {timeout:2000}, async t => {
  const {runtime} = setup(t);
  const old = deferred(), next = deferred(), events = [];
  globalThis.playgroundReview = {old:old.promise,next:next.promise,events,done:deferred()};
  await runtime.playSource(`liveLoop('lead',async()=>{
    const timeline = createTimeline();
    globalThis.playgroundReview.events.push('old-start');
    await globalThis.playgroundReview.old;
    await timeline.waitUntil(0);
    globalThis.playgroundReview.events.push('old-end');
  });`);
  await runtime.playSource(`liveLoop('lead',async()=>{
    globalThis.playgroundReview.events.push('new-start');
    globalThis.playgroundReview.done.resolve();
    await globalThis.playgroundReview.next;
  });`);
  assert.deepEqual(events,['old-start']);old.resolve();
  await globalThis.playgroundReview.done.promise;
  assert.deepEqual(events,['old-start','old-end','new-start']);
});

test('Main Stop cancels a pending seconds timeline and rejects later waits', {timeout:2000}, async t => {
  const {runtime} = setup(t);
  globalThis.playgroundReview = {};
  const playing = runtime.playSource(`
    const timeline = createTimeline();
    globalThis.playgroundReview.timeline = timeline;
    globalThis.playgroundReview.entered = true;
    try {
      await timeline.waitUntil(60);
      globalThis.playgroundReview.finished = true;
    } catch (error) {
      globalThis.playgroundReview.error = error.message;
    }
  `);
  await until(()=>globalThis.playgroundReview.entered);
  await runtime.stop();await playing;
  assert.equal(globalThis.playgroundReview.finished,undefined);
  assert.equal(globalThis.playgroundReview.error,'Run stopped');
  await assert.rejects(globalThis.playgroundReview.timeline.waitUntil(61),/Run stopped/);
});

test('rerun removes undeclared liveFx without stopping audio or the current loop', async t => {
  const {runtime,megaDrive} = setup(t);
  const processor = new LiveFX(48000), gate = deferred(), events = [];
  const fx = createNativeFXController(message => processor.command(message));
  megaDrive.audio = {createFXApi:()=>fx};
  megaDrive.getFXChain = ()=>[];
  let stops = 0;
  megaDrive.sample.stopAll = ()=>{stops++;};
  globalThis.playgroundReview = {gate:gate.promise,events};
  await runtime.playSource(`liveFx('distortion',{process(input,output){output.forEach((channel,c)=>channel.set(input[c]));}});liveLoop('lead',async()=>{globalThis.playgroundReview.events.push('old-start');await globalThis.playgroundReview.gate;});`);
  assert(processor.effects.has('distortion'));
  await runtime.playSource(`liveLoop('lead',async()=>{await globalThis.playgroundReview.gate;});`);
  assert(!processor.effects.has('distortion'));
  assert.deepEqual(events,['old-start']);
  assert.equal(stops,0);
});

test('cached livePrepare retains its liveFx on rerun and releases it when absent', async t => {
  const {runtime,megaDrive} = setup(t);
  const processor = new LiveFX(48000), fx = createNativeFXController(message=>processor.command(message));
  megaDrive.audio = {createFXApi:()=>fx};
  megaDrive.getFXChain = ()=>[];
  const source = `await livePrepare('custom-fx',({fx})=>{fx.liveFx('prepared',{process(input,output){output.forEach((channel,c)=>channel.set(input[c]));}});return {};});`;
  await runtime.playSource(source);
  const state = processor.effects.get('prepared').state;
  await runtime.playSource(source);
  assert.equal(processor.effects.get('prepared').state,state);
  await runtime.playSource('');
  assert(!processor.effects.has('prepared'));
  await runtime.playSource(source);
  assert(processor.effects.has('prepared'), 'cached preparation can reactivate its named FX');
});

test('caught errors retain their message and stack in the Playground console', async t => {
  const {runtime, logs} = setup(t);
  await runtime.playSource('try { throw new Error("OPM failure"); } catch (e) { console.log("e", e); } console.warn(new DOMException("Run stopped", "AbortError"));');
  assert.ok(logs.some(line => line.includes('e Error: OPM failure') && line.includes('\n')));
  assert.ok(logs.some(line => line.includes('[warn] AbortError: Run stopped')));
});

for (const route of ['evaluation', 'liveLoop', 'liveCleanup']) {
  test(`Main ${route} logs retain the error message when WebKit stacks contain only locations`, async t => {
    const {runtime, logs} = setup(t);
    t.mock.method(console, 'error', () => {});
    const failure = `const error = new Error('Unknown sample: sonic-pi/ambi-choir');
      error.stack = 'playSample@tauri://localhost/js/tetorica_audio_runtime.js:427:33';
      throw error;`;
    if (route === 'evaluation') {
      await assert.rejects(runtime.playSource(failure), /Unknown sample/);
    } else if (route === 'liveLoop') {
      await runtime.playSource(`liveLoop('choir', async () => { ${failure} });`);
    } else {
      await runtime.playSource(`liveLoop('choir', async () => { await sleep(60); });
        liveCleanup(['choir'], () => { ${failure} });`);
      await runtime.playSource('');
    }
    await until(() => logs.some(line => line.includes('Unknown sample: sonic-pi/ambi-choir')));
    const errorLog = logs.find(line => line.includes('Unknown sample: sonic-pi/ambi-choir'));
    assert.ok(errorLog.includes('Error: Unknown sample: sonic-pi/ambi-choir\nplaySample@tauri://localhost/'));
    if (route !== 'evaluation') assert.ok(errorLog.startsWith(`[${route}:choir] `));
    runtime.stop();
  });
}

test('Main evaluation and live loops retain native Tauri IPC while user network stays blocked', async t => {
  const {megaDrive} = setup(t);
  const requests = [], evaluation = deferred(), iteration = deferred();
  window.URL = URL;
  window.Headers = Headers;
  window.fetch = async (url, init) => {requests.push([url, init.method]);return "IPC ready";};
  const originalFetch = window.fetch;
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: command => `ipc://localhost/${encodeURIComponent(command)}`,
    invoke(command) {
      return window.fetch(this.convertFileSrc(command, "ipc"), {
        method:"POST", headers:{"Tauri-Invoke-Key":"test-key", "Tauri-Callback":"1", "Tauri-Error":"2"},
      });
    },
  };
  const runtime = createPlaygroundRuntime({megaDrive});
  t.after(() => runtime.stop());
  globalThis.playgroundReview = {evaluation:evaluation.promise, iteration:iteration.promise, entered:false, looping:false};
  const playing = runtime.playSource(`
    globalThis.playgroundReview.entered = true;
    await globalThis.playgroundReview.evaluation;
    liveLoop('choir', async () => {
      globalThis.playgroundReview.looping = true;
      await globalThis.playgroundReview.iteration;
    });
  `);
  await until(() => globalThis.playgroundReview.entered);
  assert.throws(() => window.fetch("https://example.com"), /Network access is disabled/);
  assert.equal(await window.__TAURI_INTERNALS__.invoke("mcp_status"), "IPC ready");
  evaluation.resolve();
  await playing;
  await until(() => globalThis.playgroundReview.looping);
  assert.throws(() => window.fetch("https://example.com"), /Network access is disabled/);
  assert.equal(await window.__TAURI_INTERNALS__.invoke("mcp_set"), "IPC ready");
  assert.deepEqual(requests, [["ipc://localhost/mcp_status", "POST"], ["ipc://localhost/mcp_set", "POST"]]);
  runtime.stop();
  iteration.resolve();
  await until(() => window.fetch === originalFetch);
});

test('re-running a prepared sample FX chain retains routing; Stop still detaches and disposes it',async t=>{
 const {runtime,megaDrive}=setup(t,{fmChannels:1});let cleared=0,disposed=0;
 const effect={input:{},output:{},dispose(){disposed++;}};
 let chain=[];
 megaDrive.getFXChain=()=>chain.slice();
 megaDrive.clearFXChain=()=>{cleared++;const previous=chain;chain=[];return previous;};
 globalThis.playgroundReview={setChain(){chain=[effect];},effect};
 const source='await livePrepare("choir-fx",()=>({reverb:globalThis.playgroundReview.effect}));globalThis.playgroundReview.setChain();';
 await runtime.playSource(source);await runtime.playSource(source);
 assert.equal(cleared,0);assert.equal(disposed,0);assert.deepEqual(chain,[effect]);
 runtime.stop();assert.equal(cleared,1);assert.equal(disposed,1);assert.deepEqual(chain,[]);
});

test('fade stop silences output before cleanup and a new Run waits for it', async t => {
  const {runtime, megaDrive} = setup(t, {fmChannels:1});
  const events=[];
  const gain={value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;events.push(['gain',value]);},
    linearRampToValueAtTime(value,time){events.push(['ramp',value,time]);},
    setValueCurveAtTime(curve,time,duration){events.push(['curve',Array.from(curve),time,duration]);}};
  megaDrive.audioContext={state:'running',currentTime:0,destination:{},createGain:()=>({gain,connect(){},disconnect(){}})};
  megaDrive.audio={outputNode:null,connectOutput(){}};
  megaDrive.fm.noteOff=()=>events.push(['cleanup',megaDrive.audioContext.currentTime]);
  await runtime.ensureReady();
  const stopping=runtime.stopWithFade();
  assert.equal(runtime.stopWithFade(),stopping);
  assert.equal(events[1][0],'curve');
  const curve=events[1][1];
  assert.equal(curve[0],1);assert.equal(curve.at(-1),0);
  assert.ok(curve.every((value,i)=>i===0||value<=curve[i-1]));
  assert.ok(curve[0]-curve[1]<0.001);assert.ok(curve.at(-2)<0.001);
  assert.deepEqual(events[1].slice(2),[0,0.12]);
  globalThis.playgroundReview={started:false};
  const restart=runtime.playSource('globalThis.playgroundReview.started=true;');
  await Promise.resolve();assert.equal(globalThis.playgroundReview.started,false);
  megaDrive.audioContext.currentTime=0.045;
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(!events.some(e=>e[0]==='cleanup'));
  megaDrive.audioContext.currentTime=0.125;
  await stopping;await restart;
  assert.ok(events.findIndex(e=>e[0]==='gain'&&e[1]===0)<events.findIndex(e=>e[0]==='cleanup'));
  assert.ok(events.some(e=>e[0]==='ramp'&&e[1]===1));
  assert.equal(globalThis.playgroundReview.started,true);
});

test('fade stop does not wait for a suspended audio clock', async t => {
  const {runtime,megaDrive}=setup(t);
  megaDrive.audioContext.state='suspended';
  await runtime.stopWithFade();
  assert.equal(runtime.getState().playback,'stopped');
});

test('keyboard audition requested during Stop reopens output after cleanup', async t => {
  const {runtime,megaDrive}=setup(t,{fmChannels:1});
  const events=[];
  const gain={value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;events.push(['gain',value]);},
    setValueCurveAtTime(){},linearRampToValueAtTime(value){events.push(['ramp',value]);}};
  megaDrive.audioContext={state:'running',currentTime:0,destination:{},createGain:()=>({gain,connect(){},disconnect(){}})};
  megaDrive.audio={outputNode:null,connectOutput(){}};
  megaDrive.fm.noteOff=()=>events.push(['cleanup']);
  await runtime.ensureReady();
  const stopping=runtime.stopWithFade();
  const audition=runtime.prepareAudition();
  assert.ok(!events.some(event=>event[0]==='ramp'));
  megaDrive.audioContext.currentTime=0.125;
  await stopping;
  assert.equal(await audition,megaDrive.fm);
  const cleanup=events.findIndex(event=>event[0]==='cleanup');
  const resume=events.findIndex(event=>event[0]==='ramp'&&event[1]===1);
  assert.ok(cleanup>=0&&resume>cleanup,'audition must reopen the output after Stop cleanup');
  assert.equal(runtime.getState().playback,'stopped','audition must not restart the script');
});

test('sample preparation completing after Stop cannot reopen output or start a voice', async t => {
  const {runtime,megaDrive}=setup(t,{fmChannels:1});
  const gate=deferred(), ramps=[];let entered=false, plays=0;
  const gain={value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;},
    setValueCurveAtTime(){},linearRampToValueAtTime(value){ramps.push(value);}};
  megaDrive.audioContext={state:'running',currentTime:0,destination:{},createGain:()=>({gain,connect(){},disconnect(){}})};
  megaDrive.audio={outputNode:null,connectOutput(){}};
  megaDrive.sample.play=()=>{plays++;};
  globalThis.playgroundReview={delayResume(){megaDrive.resume=()=>{entered=true;return gate.promise;};}};
  await runtime.playSource('globalThis.playgroundReview.delayResume(); liveLoop("choir",async()=>{await sample.play("choir");await sleep(60);});');
  await until(()=>entered);
  const stopping=runtime.stopWithFade();
  megaDrive.audioContext.currentTime=0.125;
  await stopping;
  gate.resolve();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(plays,0);
  assert.equal(gain.value,0);
  assert.deepEqual(ramps,[],'the old sample request must not fade the output back in');
  assert.equal(runtime.getState().playback,'stopped');
  megaDrive.resume=async()=>{};
  await runtime.playSource('liveLoop("new",async()=>{await sample.play("choir");await sleep(60);});');
  await until(()=>plays===1);
  assert.equal(plays,1,'an explicit new Run still starts audio');
  assert.deepEqual(ramps,[1]);
});

for (const example of ['chip-raw/gameboy-raw-write-sample', 'gameboy/gameboy-synth']) test(`Game Boy ${example} compiles with the full Playground global argument list`, async t => {
  const {runtime} = setup(t);
  const source = await readFile(new URL(`../docs/playground/examples/${example}.js`, import.meta.url), 'utf8');
  globalThis.playgroundReview = {compiled: false};
  // Compile the entire example in its real scope, without opening an audio device.
  await runtime.playSource('globalThis.playgroundReview.compiled = true; return;\n' + source);
  assert.equal(globalThis.playgroundReview.compiled, true);
});

test('stop prevents a late evaluation from registering loops and keyboard handlers', async t => {
  const { runtime, listeners } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, loops: 0 };
  const running = runtime.playSource(`
    globalThis.playgroundReview.entered = true;
    await globalThis.playgroundReview.gate;
    onKeyboardPressKey('late', () => {});
    liveLoop('late', async () => { globalThis.playgroundReview.loops++; await sleep(60); });
  `);
  await until(() => globalThis.playgroundReview.entered);
  runtime.stop(); gate.resolve(); await running;
  assert.equal(listeners.size, 0);
  assert.equal(globalThis.playgroundReview.loops, 0);
  assert.equal(runtime.getState().playback, 'stopped');
});

test('an older evaluation cannot replace a newer run or change its state', async t => {
  const { runtime, listeners } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, hits: 0 };
  const old = runtime.playSource('globalThis.playgroundReview.entered = true; await globalThis.playgroundReview.gate;');
  await until(() => globalThis.playgroundReview.entered);
  await runtime.playSource("onKeyboardPressKey('new', () => { globalThis.playgroundReview.hits++; });");
  gate.resolve(); await old;
  assert.equal(listeners.size, 1);
  for (const fn of listeners) fn({});
  assert.equal(globalThis.playgroundReview.hits, 1);
  assert.equal(runtime.getState().playback, 'running');
});

for (const execution of ['main', 'worker']) {
  test(`stop during audio initialization prevents ${execution} code from running`, async t => {
    const { runtime, megaDrive } = setup(t);
    const gate = deferred(); let entered = false;
    megaDrive.start = () => { entered = true; return gate.promise; };
    const previous = globalThis.Worker;
    globalThis.Worker = class { constructor() { assert.fail('Stopped run created a Worker'); } };
    t.after(() => { globalThis.Worker = previous; });
    globalThis.playgroundReview = { ran: false };
    const pending = runtime.playSource('globalThis.playgroundReview.ran = true;', { execution });
    await until(() => entered);
    runtime.stop(); gate.resolve(); await pending;
    assert.equal(globalThis.playgroundReview.ran, false);
    assert.equal(runtime.getState().playback, 'stopped');
  });
}

test('syntax errors leave stopped state and allow the next run', async t => {
  const { runtime, statuses } = setup(t);
  await assert.rejects(runtime.playSource('const = ;'), SyntaxError);
  assert.equal(runtime.getState().playback, 'stopped');
  assert.ok(statuses.some(s => s.startsWith('Error:')));
  await runtime.playSource("onKeyboardPressKey('valid', () => {});");
  assert.equal(runtime.getState().playback, 'running');
});

test('finalize settles pending Worker runs and main-mode stop waits; late Worker messages are ignored', { timeout: 1000 }, async t => {
  const { runtime, listeners } = setup(t);
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  t.after(() => { globalThis.Worker = previous; });
  const cancelled = assert.rejects(runtime.playSource('await sleep(60);', { execution: 'worker' }), { name: 'AbortError' });
  await until(() => workers.length > 0);
  const main = runtime.playSource("onKeyboardPressKey('late', () => {});");
  const lateMessage = workers[0].onmessage;
  await runtime.finalize();
  await cancelled; await main;
  lateMessage({ data: { type: 'complete', loopCount: 1 } });
  assert.equal(workers[0].terminated, true);
  assert.equal(listeners.size, 0);
  assert.equal(runtime.getState().playback, 'stopped');
});

test('removing a sounding loop releases its note', async t => {
  const { runtime, megaDrive } = setup(t);
  const notes = [];
  megaDrive.fm.noteOn = c => notes.push(['on', c]);
  megaDrive.fm.noteOff = c => notes.push(['off', c]);
  await runtime.playSource('liveLoop("lead", async () => { await play("C4", { duration: 60 }); });');
  await runtime.playSource('');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(notes, [['on', 0], ['off', 0]]);
});

test('cancelled loop does not release the replacement note on the same channel', async t => {
  const { runtime, megaDrive } = setup(t);
  const notes = [];
  megaDrive.fm.noteOn = c => notes.push(['on', c]);
  megaDrive.fm.noteOff = c => notes.push(['off', c]);
  await runtime.playSource('liveLoop("old", async () => { await play("C4", { duration: 60 }); });');
  await runtime.playSource('liveLoop("new", async () => { await play("D4", { duration: 60 }); });');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(notes, [['on', 0], ['on', 0]]);
});

test('late prepare completion cannot repopulate the cache after stop', async t => {
  const { runtime } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, value: null };
  const pending = runtime.playSource('await livePrepare("asset", async () => { globalThis.playgroundReview.entered = true; await globalThis.playgroundReview.gate; return "old"; });');
  await until(() => globalThis.playgroundReview.entered);
  runtime.stop();
  gate.resolve(); await pending;
  await runtime.playSource('globalThis.playgroundReview.value = await livePrepare("asset", () => "new");');
  assert.equal(globalThis.playgroundReview.value, 'new');
});

function workerBridge(t) {
  const workers=[],previous=globalThis.Worker;
  globalThis.Worker=class {
    constructor(){this.responses=[];this.messages=[];workers.push(this);}
    postMessage(message){
      this.messages.push(message);
      if(message.type==='run')queueMicrotask(()=>this.onmessage?.({data:{type:'complete',loopCount:2}}));
      if(message.type==='stop')queueMicrotask(()=>{
        this.onmessage?.({data:{type:'command',command:'audio.stopAll',args:[]}});
        this.onmessage?.({data:{type:'stopped'}});
      });
      if(message.type==='response')this.responses.push(message);
    }
    terminate(){this.terminated=true;}
    send(data){this.onmessage({data});}
  };
  t.after(()=>{globalThis.Worker=previous;});return workers;
}
for(const execution of ['main','worker'])test(`DX7 fatal primary failure restarts through Playground and reconnects ${execution} controls`,async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'dx7',fmChannels:0,psg:false,dac:false}),workers=workerBridge(t);let starts=0;
  megaDrive.start=async()=>{
    starts++;attachDx7Primary(megaDrive);megaDrive.state='ready';
    megaDrive.node={port:{postMessage(){}}};megaDrive.primaryEndpoints[0].node=megaDrive.node;
  };
  const source=`const instrument=await livePrepare('instrument',({dx7})=>dx7);if(context.previous===instrument||await useSoundChip('dx7')!==instrument)throw Error('Dead borrowed primary');context.previous=instrument;instrument.noteOn(60);`;
  await runtime.playSource(execution==='main'?source:'',{execution});
  megaDrive.state='error';megaDrive.dx7=null;megaDrive.primaryEndpoints=[];megaDrive.node=null;
  await runtime.playSource(execution==='main'?source:'',{execution});
  assert.equal(starts,2);assert.equal(runtime.getState().audio,'ready');
  if(execution==='worker'){
    assert.equal(workers.length,2);assert.equal(workers[0].terminated,true);
    const ports=workers[1].messages.find(message=>message.type==='native-primary-ports');
    assert.equal(ports.endpoints[0].name,'dx7');assert.equal(ports.endpoints[0].globalName,'dx7');
    for(const worker of workers)for(const message of worker.messages)for(const endpoint of message.endpoints??[])endpoint.port?.close();
  }
});
test('Main exposes a Worker musical binding and fences old UI callbacks after replacement and Stop',async t=>{
  const {runtime}=setup(t),workers=workerBridge(t);
  await runtime.playSource('',{execution:'worker'});const worker=workers[0],sent=[];
  const post=worker.postMessage.bind(worker);worker.postMessage=message=>{sent.push(message);return post(message);};
  worker.send({type:'musical-keyboard-binding',binding:{name:'Worker sampler',session:'worker:1'}});
  await until(()=>runtime.getKeyboardTarget()?.name==='Worker sampler');
  const old=runtime.getKeyboardTarget();await old.noteOn({id:'string1',midi:60});
  assert.equal(sent.at(-1).type,'musical-keyboard');assert.equal(sent.at(-1).session,'worker:1');
  assert.equal(sent.at(-1).event.velocity,100);
  worker.send({type:'musical-keyboard-binding',binding:{name:'Next',session:'worker:2'}});
  await until(()=>runtime.getKeyboardTarget()?.name==='Next');
  const count=sent.length;await old.noteOff({id:'string1',midi:60});assert.equal(sent.length,count);
  runtime.stop();assert.equal(runtime.getKeyboardTarget(),null);
});
test('Worker restart waits for Main primary PCM releases even when its stopped message arrives first',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'ym2612',fmChannels:6,psg:true,dac:true});
  const workers=workerBridge(t),pending=[];let delay=true;
  megaDrive.pcm={keyOff(){return delay?new Promise(resolve=>pending.push(resolve)):Promise.resolve();}};
  await runtime.playSource('',{execution:'worker'});
  const worker=workers[0];let starts=0;
  const post=worker.postMessage.bind(worker);worker.postMessage=message=>{if(message.type==='run')starts++;return post(message);};
  runtime.stop();const next=runtime.playSource('',{execution:'worker'});
  await until(()=>pending.length===8);
  assert.equal(starts,0);
  for(let i=0;i<7;i++)pending[i]();
  await Promise.resolve();await Promise.resolve();assert.equal(starts,0);
  delay=false;pending[7]();await next;assert.equal(starts,1);
});
test('a delayed Worker Stop must finish before the next Run is sent', async t => {
  const {runtime, megaDrive}=setup(t);
  const previous=globalThis.Worker, workers=[];
  globalThis.Worker=class {
    constructor(){this.runs=0;workers.push(this);}
    postMessage(message){
      if(message.type==='run') {this.runs++;queueMicrotask(()=>this.onmessage({data:{type:'complete',loopCount:1}}));}
      if(message.type==='stop')this.stopping=true;
    }
    terminate(){}
  };
  t.after(()=>{globalThis.Worker=previous;});
  await runtime.playSource('',{execution:'worker'});
  const worker=workers[0];runtime.stop();
  const restarting=runtime.playSource('',{execution:'worker'});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(worker.runs,1,'the old 100ms timeout must not allow another Run');
  let cleanupDone=false;
  megaDrive.sample.stopAll=()=>{cleanupDone=true;};
  worker.onmessage({data:{type:'command',command:'audio.stopAll',args:[]}});
  worker.onmessage({data:{type:'stopped'}});
  await restarting;
  assert.equal(cleanupDone,true);
  assert.equal(worker.runs,2);
  assert.equal(runtime.getState().playback,'running');
  runtime.stop();worker.onmessage({data:{type:'stopped'}});
});
test('stopWithFade without Web Audio waits for Worker cleanup and the subsequent native callback barrier',async t=>{
  const {runtime,megaDrive}=setup(t,{fmChannels:1});
  const previous=globalThis.Worker,workers=[],gate=deferred();let nativeStopping=false;
  megaDrive.audioContext=null;
  megaDrive.stopNativeAudio=()=>{nativeStopping=true;return gate.promise;};
  globalThis.Worker=class {
    constructor(){workers.push(this);}
    postMessage(message){if(message.type==='run')queueMicrotask(()=>this.onmessage({data:{type:'complete',loopCount:1}}));}
    terminate(){}
  };
  t.after(()=>{globalThis.Worker=previous;});
  await runtime.playSource('',{execution:'worker'});
  let finished=false;const stopping=runtime.stopWithFade().then(()=>{finished=true;});
  await Promise.resolve();assert.equal(finished,false);assert.equal(nativeStopping,false);
  workers[0].onmessage({data:{type:'command',command:'audio.stopAll',args:[]}});
  workers[0].onmessage({data:{type:'stopped'}});
  await until(()=>nativeStopping);await Promise.resolve();assert.equal(finished,false);
  gate.resolve();await stopping;assert.equal(finished,true);await runtime.finalize();
});
test('Worker play durations do not serialize independent live-loop notes or Stop',async t=>{
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t),notes=[],offs=[];
 megaDrive.fm.noteOn=ch=>notes.push(ch);megaDrive.fm.noteOff=ch=>offs.push(ch);
 await runtime.playSource('',{execution:'worker'});const w=workers[0];
 w.send({type:'request',id:1,command:'play',args:['E2',{channel:0,duration:60}]});
 w.send({type:'request',id:2,command:'play',args:['E4',{channel:1,duration:60}]});
 try{
  await until(()=>notes.length===2);
  assert.deepEqual(notes,[0,1]);assert.equal(w.responses.length,0,'each caller still waits for its own note');
  w.send({type:'command',command:'audio.stopAll',args:[]});
  await until(()=>offs.length>=6);
 }finally{await runtime.finalize();}
});
test('Worker -> Stop -> main live loop -> Stop cancels the main loop and releases notes',async t=>{
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t);let offs=0;
 megaDrive.fm.noteOff=()=>offs++;
 await runtime.playSource('',{execution:'worker'});runtime.stop();
 globalThis.playgroundReview={finished:false};
 await runtime.playSource(`liveLoop('main',async()=>{await sleep(60);globalThis.playgroundReview.finished=true;});`);
 assert.equal(workers[0].terminated,true);
 const before=offs;runtime.stop();assert(offs>before,'Stop must release main-mode voices');
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(globalThis.playgroundReview.finished,false);
 assert.equal(runtime.getState().playback,'stopped');
 await runtime.finalize();
});

test('main MIDI output emits FM notes, uses fixed CH1 and Stop cancels held voices', async t => {
 const {runtime,megaDrive}=setup(t);const writes=[];
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 await runtime.playSource(`if(CH1!==0||CH16!==15||pg.CH16!==CH16)throw new Error('Channel constants'); const out=midi.output('tetorica-ym2612',{channel:CH1}); await out.setVoice(FM_PRESETS.sine); await out.noteOn('C4');`);
 assert(writes.some(([p,r,v])=>r===0x28&&v===240));
 runtime.stop();assert(writes.some(([p,r,v])=>r===0x28&&v===0));
});

test('MIDI file playback schedules FM/PSG at tempo-derived times and completes',async t=>{
 const {runtime,megaDrive}=setup(t);const scheduled=[];const started=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=> (performance.now()-started)/1000});
 megaDrive.fm.write=()=>{};megaDrive.fm.scheduleWrites=entries=>scheduled.push(...entries);megaDrive.psg.write=()=>{};
 const bytes=[77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,12,0,0x90,60,100,4,0x80,60,0,0,255,47,0];
 await runtime.playSource(`setTiming({lookaheadSeconds:.02,schedulerIntervalMs:5}); await midi.playFile(new Uint8Array(${JSON.stringify(bytes)}),[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}]);`);
 const writes=scheduled.filter(e=>e.type==='psg-write');assert(writes.length>=4);
 const on=writes[0].time,off=writes.find(e=>e.value===0x9f).time;
 assert(Math.abs(off-on-4*.5/96)<1e-9);
});

test('MIDI import applies full-scale bend from another track to the routed source channel',async t=>{
 const {runtime,megaDrive}=setup(t),scheduled=[];const started=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=> (performance.now()-started)/1000});
 megaDrive.fm.write=()=>{};megaDrive.fm.scheduleWrites=entries=>scheduled.push(...entries);megaDrive.psg.write=()=>{};
 const tracks=[ [2,0xe0,127,127,2,0xe0,0,64,0,255,47,0], [0,0x90,60,100,6,0x80,60,0,0,255,47,0] ];
 const bytes=[77,84,104,100,0,0,0,6,0,1,0,2,0,96];
 for(const tr of tracks)bytes.push(77,84,114,107,0,0,0,tr.length,...tr);
 await runtime.playSource(`setTiming({lookaheadSeconds:.02,schedulerIntervalMs:5}); await midi.playFile(new Uint8Array(${JSON.stringify(bytes)}),[{part:'[1,0,"",1]',destination:'tetorica-ym2612',channel:8,preset:'sine',bendRange:12}]);`);
 const highs=scheduled.filter(e=>e.register===0xa4);
 assert.equal(highs.length,3);assert.equal(highs[1].value,highs[0].value+8);assert.equal(highs[2].value,highs[0].value);
 assert(Math.abs(highs[1].time-highs[0].time-2*.5/96)<1e-9);
 assert.equal(scheduled.filter(e=>e.register===0x28&&e.value===240).length,1);
});

test('MIDI import applies cross-track CC at event time and releases sustain on pedal-up',async t=>{
 const {runtime,megaDrive}=setup(t),scheduled=[];const started=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=> (performance.now()-started)/1000});
 megaDrive.fm.write=()=>{};megaDrive.fm.scheduleWrites=entries=>scheduled.push(...entries);megaDrive.psg.write=()=>{};
 const tracks=[
  [0,0xb0,64,127,2,0xb0,11,0,2,0xb0,11,127,2,0xb0,64,0,2,255,47,0],
  [0,0x90,60,127,3,0x80,60,0,5,255,47,0],
 ];
 const bytes=[77,84,104,100,0,0,0,6,0,1,0,2,0,96];
 for(const tr of tracks)bytes.push(77,84,114,107,0,0,0,tr.length,...tr);
 await runtime.playSource(`setTiming({lookaheadSeconds:.02,schedulerIntervalMs:5}); await midi.playFile(new Uint8Array(${JSON.stringify(bytes)}),[{part:'[1,0,"",1]',destination:'tetorica-sega-psg',channel:CH16}]);`);
 const writes=scheduled.filter(e=>e.type==='psg-write');
 const origin=writes[0].time;
 const volumes=writes.filter(e=>(e.value&0xf0)===0x90);
 assert.deepEqual(volumes.map(e=>[Math.round((e.time-origin)*192),e.value]),[[0,0x90],[2,0x9f],[4,0x90],[6,0x9f]]);
});

test('main CC API reaches the rack and Stop silences a sustained FM voice',async t=>{
 const {runtime,megaDrive}=setup(t),writes=[];
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 await runtime.playSource(`const o=midi.output('tetorica-ym2612'); await o.cc(64,127);await o.noteOn('C4');await o.noteOff('C4');await o.cc(10,0);`);
 assert.equal(writes.filter(([p,r,v])=>r===0x28&&v===0).length,0);
 assert.equal(writes.at(-1)[2]&192,128);
 runtime.stop();assert(writes.some(([p,r,v])=>r===0x28&&v===0));
});

test('compiled standalone MIDI code plays through the main runtime without reading a MIDI asset',async t=>{
 const {midiToSource}=await import('./midi_source.js');
 const {runtime,megaDrive}=setup(t),writes=[];const start=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=>(performance.now()-start)/1000});
 megaDrive.fm.write=()=>{};megaDrive.psg.write=v=>writes.push(v);
 const bytes=Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,12,0,0x90,60,127,4,0x80,60,0,0,255,47,0]);
 const source=midiToSource(bytes,[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}]);
 await runtime.playSource(source);
 assert(writes.includes(0x90));assert.equal(writes.at(-1),0x9f);
});

test('main Worker bridge uses MIDI channel state with automatic voice allocation',async t=>{
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t),writes=[];
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 await runtime.playSource('',{execution:'worker'});const w=workers[0];let requestId=0;
 const request=async(method,args)=>{
  const id=++requestId;w.send({type:'request',id,command:'midi.invoke',args:[method,args]});
  await until(()=>w.responses.some(r=>r.id===id));const result=w.responses.find(r=>r.id===id);
  assert(!result.error);return result.value;
 };
 const note=await request('noteOn',['tetorica-ym2612',4,60,100]);
 assert(writes.some(([p,r,v])=>r===0x28&&v===240));writes.length=0;
 await request('pitchBend',['tetorica-ym2612',4,1]);
 assert.deepEqual(writes.map(([p,r])=>[p,r]),[[0,0xa4],[0,0xa0]]);
 await request('release',['tetorica-ym2612',4,60,note]);
 assert.equal(writes.at(-1)[2],0);await runtime.finalize();
});

test('generated MIDI module stops during sample wait and runs again on main',async t=>{
 const {midiToSource}=await import('./midi_source.js');
 const {runtime,megaDrive}=setup(t),writes=[];const start=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=>(performance.now()-start)/1000});
 megaDrive.fm.write=()=>{};megaDrive.psg.write=v=>writes.push(v);
 function entry(ticks) {
  const track=[0,0x90,60,127,ticks,0x80,60,0,0,255,47,0];
  const bytes=Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,track.length,...track]);
  const module=midiToSource(bytes,[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}],{module:true});
  return `const song=await(async()=>{${module.replace(/^export /gm,'')} return {initCh,runAllCh};})();await song.initCh(pg);await song.runAllCh();`;
 }
 const pending=runtime.playSource(entry(96));
 await until(()=>writes.includes(0x90));runtime.stop();await pending;
 assert.equal(runtime.getState().playback,'stopped');assert(writes.includes(0x9f));
 writes.length=0;await runtime.playSource(entry(1));
 assert(writes.includes(0x90));assert.equal(writes.at(-1),0x9f);
});

test('fixed channel configuration reaches the main and Worker rack',async t=>{
 const {runtime,megaDrive}=setup(t),writes=[],workers=workerBridge(t);
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 await runtime.playSource(`await midi.enableSoundChip('tetorica-ym2612',{roundRobin:false});await midi.output('tetorica-ym2612',{channel:CH4}).noteOn('C4');`);
 assert(writes.some(([p,r,v])=>r===0x28&&v===0xf4));runtime.stop();writes.length=0;
 await runtime.playSource('',{execution:'worker'});const worker=workers[0];
 worker.send({type:'request',id:101,command:'midi.invoke',args:['enableSoundChip',['tetorica-ym2612',{roundRobin:false}]]});
 await until(()=>worker.responses.some(r=>r.id===101));assert(!worker.responses.find(r=>r.id===101).error);
 worker.send({type:'request',id:102,command:'midi.invoke',args:['noteOn',['tetorica-ym2612',5,60,100]]});
 await until(()=>worker.responses.some(r=>r.id===102));assert(writes.some(([p,r,v])=>r===0x28&&v===0xf6));
});

test('Stop during a held MIDI liveLoop note completes hard mute and allows restart',async t=>{
 const {runtime,megaDrive}=setup(t),writes=[];
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 globalThis.playgroundReview={held:false};
 await runtime.playSource(`
  const lead=midi.output('tetorica-ym2612',{channel:CH4});
  liveLoop('held-midi',async()=>{
   await lead.noteOn('C4');
   globalThis.playgroundReview.held=true;
   await beat(100);
   await lead.noteOff('C4');
  });
 `);
 await until(()=>globalThis.playgroundReview.held);
 writes.length=0;
 assert.doesNotThrow(()=>runtime.stop());
 assert.equal(runtime.getState().playback,'stopped');
 assert(writes.some(([p,r,v])=>r===0x28&&v===0));
 assert(writes.some(([p,r,v])=>r===0x40&&v===127));
 await runtime.playSource(`const lead=midi.output('tetorica-ym2612');await lead.noteOn('E4');`);
 assert(writes.some(([p,r,v])=>r===0x28&&v===0xf0));
});

test('Worker observer updates synth state without sending audio or waiting for a reply', async t => {
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t);
 const writes=[];
 const {YM2612Synth}=await import('./ym2612synth.js');
 megaDrive.fm=new YM2612Synth({transport:{write(port,register,value){writes.push([port,register,value]);},clearDacPlayback(){}}});
 await runtime.playSource('',{execution:'worker'});
 writes.length=0;
 workers[0].send({type:'chip-observer',event:{method:'setAlgo',args:[0,5,3]}});
 assert.equal(megaDrive.fm.channels[0].algorithm,5);
 assert.equal(writes.length,0);
 assert.equal(workers[0].responses.length,0);
 megaDrive.fm.setAlgo(0,4,2);
 assert.ok(writes.length>0,'normal UI transport is restored after observation');
 await runtime.finalize();
});

test('OPNA Worker observations preserve remembered SSG volume and UI snapshots wait for completed shadows', async t => {
 const {runtime,megaDrive}=setup(t,{chip:'ym2608',fmChannels:6,psg:false,dac:false},{onMegaDriveEvent(){}});
 const workers=workerBridge(t),writes=[],messages=[];
 let listener;
 megaDrive.addListener=fn=>{listener=fn;return()=>{listener=null;};};
 megaDrive.fm=new YM2608Synth({transport:{write(port,register,value){
  writes.push([port,register,value]);listener?.({type:'write',port,register,value});
 }}});
 await runtime.playSource('',{execution:'worker'});
 const worker=workers[0],post=worker.postMessage.bind(worker);
 worker.postMessage=message=>{messages.push(message);post(message);};
 writes.length=0;
 worker.send({type:'chip-observer',event:{method:'write',args:[0,8,0]}});
 worker.send({type:'chip-observer',event:{method:'ssgState',args:[{
  registers:Array.from(megaDrive.fm.ssg.registers),levels:[12,0,0],
 }]}});
 assert.equal(writes.length,0,'observer updates must not send duplicate audio');
 assert.equal(megaDrive.fm.ssg._getState().levels[0],12);
 megaDrive.fm.ssg.keyOn(0);
 assert.equal(writes.at(-1)[2],12);
 megaDrive.fm.ssg.keyOff(0);
 assert.equal(messages.length,0,'snapshot waits until keyOff restores its remembered volume');
 await Promise.resolve();
 const state=messages.filter(message=>message.type==='chip-state').at(-1).state;
 assert.equal(state.ssg.registers[8],0);
 assert.equal(state.ssg.levels[0],12);
 await runtime.finalize();
});

test('main scheduleWritesSamples routes mixed FM and PSG tuples on the shared sample clock',async t=>{
 const {runtime,megaDrive}=setup(t),scheduled=[];
 megaDrive.fm.scheduleWrites=entries=>scheduled.push(...entries);
 await runtime.playSource(`const start=beginSampleSchedule(); scheduleWritesSamples(start, [[0,0,0x22,8],[0,'psg',0x85],[0,'psg',0x12]]);`);
 assert.deepEqual(scheduled.map(e=>e.type??'fm'),['fm','psg-write','psg-write']);
 assert.equal(new Set(scheduled.map(e=>e.time)).size,1);
 assert.deepEqual(scheduled.map(e=>e.value),[8,0x85,0x12]);
});

test('useSoundChip returns existing FM, supports const fm and preserves play and reevaluation',async t=>{
 const {runtime,megaDrive}=setup(t);const notes=[];
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=>performance.now()/1000});
 megaDrive.fm.noteOn=(...args)=>notes.push(args);
 globalThis.playgroundReview={};
 await runtime.playSource(`
  const fm = await useSoundChip('ym2612');
  if (fm !== pg.fm || fm !== await pg.useSoundChip('ym2612')) throw Error('Different FM');
  const pair = await Promise.all([useSoundChip('ym2612'),useSoundChip('ym2612')]);
  if (pair[0] !== fm || pair[1] !== fm) throw Error('Concurrent identity');
  globalThis.playgroundReview.fm=fm;
  fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
  await play('C4', {channel:CH1,duration:0.001});
 `);
 await runtime.playSource(`
  if (await useSoundChip('ym2612') !== globalThis.playgroundReview.fm) throw Error('Not reused');
  fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
  await play('C4',{channel:CH1,duration:0.001});
 `);
 assert.equal(notes.length,2);assert.deepEqual(notes[0],notes[1]);
 runtime.stop();await runtime.playSource(`const fm = await useSoundChip('ym2612'); if(fm!==pg.fm)throw Error('Restart identity');`);
});
test('useSoundChip rejects unsupported options on Main',async t=>{
 const {runtime}=setup(t);
 await assert.rejects(runtime.playSource(`await useSoundChip('ym2612',{id:'fm1'});`),/options/);
});


for(const [chip,channels] of [['ym2203',3],['ym2610',4],['ym2610b',6]])test(`Main useSoundChip ${chip} aliases selected FM and preserves play`,async t=>{
 const {runtime,megaDrive}=setup(t,{chip,fmChannels:channels,psg:false,dac:false});
 const notes=[];megaDrive.fm.noteOn=(...args)=>notes.push(args);
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=>performance.now()/1000});
 await runtime.playSource(`
  const fm = await useSoundChip('${chip}');
  if(fm!==pg.fm)throw Error('Different FM');
  const [a,b]=await Promise.all([useSoundChip('${chip}'),useSoundChip('${chip}')]);
  if(a!==fm || b!==fm)throw Error('Different instances');
  context.fm=fm;fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
  await play('C4',{channel:CH1,duration:0.001});
 `);
 await runtime.playSource(`if(await useSoundChip('${chip}')!==context.fm)throw Error('Not reused');`);
 assert.equal(notes.length,1);
 runtime.stop();await runtime.playSource(`const fm=await useSoundChip('${chip}');if(fm!==pg.fm)throw Error('Restart');`);
});

test('YM2203 startup and exported FM presets work with the real mono synth',async t=>{
 const {runtime,megaDrive}=setup(t,{chip:'ym2203',fmChannels:3,psg:false,dac:false});
 const writes=[];
 megaDrive.fm=new YM2203Synth({transport:{write:(port,register,value)=>writes.push([port,register,value])}});
 await runtime.playSource(`
  const fm=await useSoundChip('ym2203');
  if(fm!==pg.fm)throw Error('Different primary FM');
  for(const preset of Object.values(FM_PRESETS))fm.setPreset(CH1,preset);
  fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
 `);
 assert.equal(megaDrive.fm.channels[0].algorithm,7);
 assert(writes.length>0);
 assert(writes.every(([port])=>port===0));
});

test('selected YM2608 keeps useSoundChip full-client ownership and import APIs',async t=>{
 const {runtime}=setup(t,{chip:'ym2608',fmChannels:6,psg:false,dac:false});
 const clients=[],commands=[];
 // Exercise registry selection without opening an AudioWorklet in Node. The
 // full client deliberately differs from the selected global FM facade.
 globalThis.playgroundReview={create:async(name,options)=>{
  assert.equal(name,'ym2608');assert.deepEqual(options,{id:'ym2608:shared'});
  const port={start(){},close(){},postMessage(message){commands.push(message);if(message.id)queueMicrotask(()=>port.onmessage({data:{id:message.id}}));}};
  const client=createYm2608Client(port);clients.push(client);return client;
 }};
 t.after(()=>clients.forEach(client=>client.dispose()));
 const source=`
  pg.createSoundChip=globalThis.playgroundReview.create;
  const [opna,again]=await Promise.all([useSoundChip('ym2608'),useSoundChip('ym2608')]);
  if(opna!==again||opna===pg.fm)throw Error('Full-client identity');
  if(typeof opna.setAlgo!=='function'||!opna.ssg||!opna.rhythm||!opna.adpcm)throw Error('Missing OPNA controls');
  await opna.setClock(7987200);
  opna.resetRegisters();opna.rhythm.setVolume(40);
  await opna.adpcm.loadMemory(new Uint8Array([0x12]),8);
  await opna.prepareTimeline([[0,0,8,15]],[],1);await opna.playTimeline();
  context.opna=opna;
 `;
 await runtime.playSource(source);
 await runtime.playSource(`if(await useSoundChip('ym2608')!==context.opna)throw Error('Not reused');`);
 assert.equal(clients.length,1);
 for(const method of ['clock','reset','memory','prepareTimeline','playTimeline'])assert(commands.some(command=>command.method===method),method);
 runtime.stop();await runtime.playSource(source);assert.equal(clients.length,2);
});

for(const method of ['sleep','sleepSamples','beat'])test(`Main tracked failure ends its loop during ${method} without retrying`,async t=>{
 const {runtime,statuses}=setup(t);let reject;
 globalThis.playgroundReview={task:new Promise((_,r)=>{reject=r;}),runs:0,after:false};
 await runtime.playSource(`liveLoop('upload',async()=>{globalThis.playgroundReview.runs++;pg.trackAsync(globalThis.playgroundReview.task);await ${method}(600000);globalThis.playgroundReview.after=true;});`);
 reject(new Error('memory transfer failed'));
 for(let i=0;i<100&&!statuses.includes('Loop error: upload');i++)await new Promise(r=>setTimeout(r,1));
 assert.ok(statuses.includes('Loop error: upload'));assert.equal(globalThis.playgroundReview.runs,1);assert.equal(globalThis.playgroundReview.after,false);
});

for (const stereoEnabled of [true,false]) test(`primary ${stereoEnabled ? 'Game Gear' : 'Master System'} shares PSG without FM shortcuts, and stopping its loop silences tone and noise`, async t => {
  const {runtime,megaDrive}=setup(t,{chip:'segapsg',fmChannels:0,psg:true,dac:false});
  const writes=[];
  const raw=createSegaPsgClient({postMessage:command=>writes.push(command),start(){},close(){}},{stereoEnabled});
  megaDrive.fm=null; megaDrive.psg=raw;
  megaDrive.primaryEndpoints=[{name:'segapsg',globalName:'psg',client:raw}];
  megaDrive.stopAllNative=()=>raw.allNotesOff();
  await runtime.playSource(`
    const prepared=await livePrepare('psg',api=>({psg:api.psg,keys:Object.keys(api)}));
    if(psg!==pg.psg || prepared.psg!==psg || await useSoundChip('segapsg')!==psg) throw Error('Separate PSG primary');
    if(typeof psg.dispose!=='undefined')throw Error('Primary lifetime leaked');
    if(typeof psg.setStereo!=='${stereoEnabled ? 'function' : 'undefined'}')throw Error('Wrong stereo API');
    if(PSG1!==0||PSG2!==1||PSG3!==2)throw Error('Missing PSG channels');
    for(const name of ['fm','dac','midi','play','write','CH1','OP1','FM_PRESETS','noteToBlockFnum']) {
      if(name in pg || prepared.keys.includes(name)) throw Error('OPN shortcut '+name);
    }
    liveLoop('held',async()=>{psg.tone(PSG1,{note:'C4',attenuation:7});psg.noise({attenuation:9});await sleep(60);});
  `);
  await until(()=>writes.some(data=>data.method==='write'&&data.args[0]===0xf9));
  const before=writes.length;
  await runtime.playSource(`stopLoop('held');`);
  assert(writes.slice(before).some(data=>data.method==='write'&&data.args[0]===0x9f));
  assert(writes.slice(before).some(data=>data.method==='write'&&data.args[0]===0xff));
  assert.deepEqual(raw._getState().attenuations.slice(0,1),[7]);
  const configured = raw._getState();
  await runtime.stop();
  assert.deepEqual(raw._getState().attenuations,configured.attenuations,'Stop retains configured PSG attenuation');
  assert.equal(writes.filter(data=>data.method==='reset').length,0,'Stop must not reset the primary PSG');
  assert.deepEqual(writes.filter(data=>data.method==='write').slice(-4).map(data=>data.args[0]),[0x9f,0xbf,0xdf,0xff]);
});

for (const latch of [0x9f,0xff]) test(`stopping a Main raw PSG loop releases continuation-keyed ${latch === 0xff ? 'noise' : 'tone'}`, async t => {
  const {runtime,megaDrive}=setup(t,{chip:'segapsg',fmChannels:0,psg:true,dac:false});
  const writes=[], raw=createSegaPsgClient({postMessage:command=>writes.push(command),start(){},close(){}});
  megaDrive.fm=null; megaDrive.psg=raw;
  megaDrive.primaryEndpoints=[{name:'segapsg',globalName:'psg',client:raw}]; megaDrive.stopAllNative=()=>raw.allNotesOff();
  await runtime.playSource(`liveLoop('raw',async()=>{psg.write(0x8a);psg.write(0x10);psg.write(${latch});psg.write(0x01);await sleep(60);});`);
  await until(()=>writes.some(command=>command.method==='write'&&command.args[0]===1));
  const before=writes.length; await runtime.playSource(`stopLoop('raw');`);
  assert.deepEqual(writes.slice(before).map(command=>command.args[0]),[latch]);
});

test('an older Main raw PSG loop cannot turn off a replacement through the shared volume latch', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'segapsg',fmChannels:0,psg:true,dac:false});
  const writes=[], raw=createSegaPsgClient({postMessage:command=>writes.push(command),start(){},close(){}});
  megaDrive.fm=null; megaDrive.psg=raw;
  megaDrive.primaryEndpoints=[{name:'segapsg',globalName:'psg',client:raw}]; megaDrive.stopAllNative=()=>raw.allNotesOff();
  await runtime.playSource(`liveLoop('old',async()=>{psg.write(0x90);await sleep(.01);psg.write(0x0f);context.attempted=true;await sleep(60);});liveLoop('new',async()=>{psg.write(0x91);await sleep(60);});context.stopOld=()=>stopLoop('old');context.stopNew=()=>stopLoop('new');`);
  await until(()=>writes.some(command=>command.method==='write'&&command.args[0]===0x91));
  const before=writes.length; megaDrive.audioContext.currentTime=.1; await new Promise(resolve=>setTimeout(resolve,25)); assert.equal(runtime.context.attempted,true);
  assert.equal(writes.length,before,'stale raw continuation-off must not reach the chip');
  runtime.context.stopOld(); assert.equal(writes.length,before);
  runtime.context.stopNew(); assert.equal(writes.at(-1).args[0],0x9f);
});

test('Main OPL source receives real presets as both bare and pg globals while OPN helpers stay unavailable',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'ym3812',fmChannels:0,psg:false,dac:false}),writes=[];
  const author=new OPLSynth({chip:'ym3812',transport:{writeRegister:(...args)=>writes.push(args),reset(){}}});author.initialize();
  megaDrive.primaryEndpoints=[{name:'ym3812',globalName:'opl',client:author}];megaDrive.stopAllNative=()=>author.allNotesOff();
  globalThis.playgroundReview={presets:OPL_PRESETS};
  await runtime.playSource(`
    if(OPL_PRESETS!==pg.OPL_PRESETS||OPL_PRESETS!==globalThis.playgroundReview.presets)throw Error('Missing real OPL presets');
    if(typeof play!=='undefined'||typeof FM_PRESETS!=='undefined')throw Error('Unexpected OPN helpers');
    const shared=await useSoundChip('ym3812');if(shared!==opl||pg.opl!==opl)throw Error('Wrong OPL primary');
    const prepared=await livePrepare('instrument',({opl})=>opl);if(prepared!==opl)throw Error('Missing prepared OPL');
    opl.setPreset(0,OPL_PRESETS.sine);pg.opl.noteOn(0,69);
  `);
  assert.equal(author.getRegisterSnapshot()[0x43]&63,OPL_PRESETS.sine.operators[1].tl);assert(writes.some(([register,value])=>register===0xb0&&(value&32)));
});

test('Master System Main source borrows both PSG and OPLL, exposes real OPLL constants and releases melodic/drum loop owners',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'segapsg',fmChannels:0,psg:true,dac:false}),psgWrites=[],opllWrites=[];
  const psgClient=createSegaPsgClient({start(){},close(){},postMessage:message=>psgWrites.push(message)},{stereoEnabled:false});
  const opllPort={start(){},close(){},postMessage:message=>{opllWrites.push(message);if(message.id!==undefined)queueMicrotask(()=>opllPort.onmessage?.({data:{id:message.id,value:true}}));}},opllClient=createYm2413Client(opllPort);opllClient.initialize();
  megaDrive.fm=null;megaDrive.psg=psgClient;megaDrive.opll=opllClient;megaDrive.primaryEndpoints=[{name:'segapsg',globalName:'psg',client:psgClient},{name:'ym2413',globalName:'opll',client:opllClient}];megaDrive.stopAllNative=()=>Promise.all([psgClient._stopVoices(),opllClient._stopVoices()]);
  globalThis.playgroundReview={instruments:YM2413_INSTRUMENTS,patches:YM2413_USER_PRESETS};
  await runtime.playSource(`
    if(OPLL_INSTRUMENTS!==pg.OPLL_INSTRUMENTS||OPLL_INSTRUMENTS!==globalThis.playgroundReview.instruments||OPLL_USER_PRESETS!==globalThis.playgroundReview.patches)throw Error('Wrong constants');
    if(await useSoundChip('ym2413')!==opll||await useSoundChip('segapsg')!==psg)throw Error('Extra primary');
    const prepared=await livePrepare('both',({psg,opll})=>({psg,opll}));if(prepared.psg!==psg||prepared.opll!==opll)throw Error('Prepare lost endpoint');
    if(typeof play!=='undefined'||typeof fm!=='undefined')throw Error('Unexpected OPN helpers');
    opll.setPreset(0,{userPatch:OPLL_USER_PRESETS.sine,attenuation:3});opll.setRhythmLevels({bassDrum:3,snare:4,hiHat:5});opll.setRhythm({enabled:true});
    liveLoop('melody',async()=>{opll.noteOn(0,69);psg.tone(PSG1,{note:'C4',attenuation:9});await sleep(60);});
    liveLoop('drums',async()=>{opll.setRhythm({snare:true,hiHat:true});await sleep(60);});
  `);
  await until(()=>opllWrites.some(message=>message.method==='writeRegister'&&message.args[0]===0x0e&&(message.args[1]&9)===9));const before=opllWrites.length;
  await runtime.playSource(`stopLoop('melody');stopLoop('drums');`);
  const stopped=opllWrites.slice(before);assert(stopped.some(message=>message.method==='forceKeyOff'&&message.args[0]===0));assert(stopped.some(message=>message.method==='forceRhythmOff'&&message.args[0]===1));assert(stopped.some(message=>message.method==='forceRhythmOff'&&message.args[0]===4));
  assert(psgWrites.some(message=>message.method==='write'&&message.args[0]===0x9f));await runtime.stop();assert.equal(opllClient._getState().registers[0x30],3);assert.equal(opllClient._getState().registers[0x0e]&31,0);
});

test('MSX Audio Main code borrows all three primaries and livePrepare receives AY, OPLL and OPL without OPN helpers',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'msx-audio',fmChannels:0,psg:false,dac:false}),writes=[];
  const port=()=>{const endpoint={start(){},close(){},postMessage:message=>{writes.push(message);if(message.id!==undefined)queueMicrotask(()=>endpoint.onmessage?.({data:{id:message.id,value:true}}));}};return endpoint;};
  const ay=createAy8910Client(port()),opll=createYm2413Client(port()),opl=createOplClient(port(),{chip:'y8950'});for(const api of [ay,opll,opl])api.initialize();megaDrive.fm=null;megaDrive.psg=null;megaDrive.ay=ay;megaDrive.opll=opll;megaDrive.opl=opl;megaDrive.primaryEndpoints=[{name:'ay8910',globalName:'ay',client:ay},{name:'ym2413',globalName:'opll',client:opll},{name:'y8950',globalName:'opl',client:opl}];megaDrive.stopAllNative=()=>Promise.all([ay._stopVoices(),opll._stopVoices(),opl._stopVoices()]);
  await runtime.playSource(`
    if(await useSoundChip('ay8910')!==ay||await useSoundChip('ym2413')!==opll||await useSoundChip('y8950')!==opl)throw Error('Separate primary');
    const prepared=await livePrepare('all',({ay,opll,opl})=>({ay,opll,opl}));if(prepared.ay!==ay||prepared.opll!==opll||prepared.opl!==opl||pg.ay!==ay)throw Error('Missing endpoint');
    if(typeof play!=='undefined'||typeof fm!=='undefined'||typeof psg!=='undefined'||typeof FM_PRESETS!=='undefined')throw Error('OPN helpers in MSX');
    ay.setEnvelope({period:2345,shape:10});opll.setVoice(8,{instrument:4,attenuation:3});opl.setPreset(8,OPL_PRESETS.sine);
    liveLoop('old-ay',async()=>{ay.tone(2,{note:'A4',volume:6});await sleep(60);});
    liveLoop('fm',async()=>{opll.noteOn(8,69);opl.noteOn(8,69);await sleep(60);});
  `);await until(()=>ay._getState().registers[10]===6);const before=writes.length;
  await runtime.playSource(`ay.tone(2,{note:'C5',volume:7});stopLoop('old-ay');stopLoop('fm');`);
  assert(!writes.slice(before).some(message=>message.method==='forceKeyOff'&&message.args[0]===2),'stale AY loop cleanup cannot stop a replacement');assert.equal(ay._getState().registers[10],7);assert(writes.slice(before).some(message=>message.method==='forceKeyOff'&&message.args[0]===8));await runtime.stop();assert.deepEqual(ay._getState().registers.slice(8,11),[0,0,0]);assert.equal(ay._getState().levels[2],7);assert.equal(ay._getState().registers[11]|(ay._getState().registers[12]<<8),2345);
});

test('MSX Main source shares AY and OPLL while omitting the MSX Audio OPL global',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'msx',fmChannels:0,psg:false,dac:false});
  const port=()=>{const value={start(){},close(){},postMessage:message=>{if(message.id!==undefined)queueMicrotask(()=>value.onmessage?.({data:{id:message.id,value:true}}));}};return value;};
  const ay=createAy8910Client(port()),opll=createYm2413Client(port());ay.initialize();opll.initialize();megaDrive.fm=null;megaDrive.psg=null;megaDrive.primaryEndpoints=[{name:'ay8910',globalName:'ay',client:ay},{name:'ym2413',globalName:'opll',client:opll}];megaDrive.stopAllNative=()=>Promise.all([ay._stopVoices(),opll._stopVoices()]);
  await runtime.playSource(`
    if(await useSoundChip('ay8910')!==ay||await useSoundChip('ym2413')!==opll||pg.ay!==ay||pg.opll!==opll)throw Error('Separate MSX primary');
    const prepared=await livePrepare('two',api=>({ay:api.ay,opll:api.opll,opl:api.opl}));if(prepared.ay!==ay||prepared.opll!==opll||prepared.opl!==undefined)throw Error('Wrong MSX endpoints');
    if(typeof opl!=='undefined'||'opl' in pg||typeof play!=='undefined'||typeof psg!=='undefined'||typeof fm!=='undefined')throw Error('Extra primary global');
    ay.tone(2,{note:'A4',volume:6});opll.setVoice(8,{instrument:2,attenuation:4});opll.noteOn(8,69);
  `);assert.equal(ay.getRegisterSnapshot()[10],6);assert(opll.getRegisterSnapshot()[0x28]&16);await runtime.stop();assert.equal(ay._getState().levels[2],6);assert.equal(opll.getRegisterSnapshot()[0x38],0x24);
});

test('MSX Audio Main cancels an ADPCM load after its loop stops without configuring or starting its sample',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'msx-audio',fmChannels:0,psg:false,dac:false}),writes=[],gate=deferred();
  const port={start(){},close(){},postMessage(message){
    writes.push(message);if(message.id===undefined)return;
    const reply=()=>queueMicrotask(()=>port.onmessage?.({data:{id:message.id,value:true}}));
    if(message.method==='loadAdpcmMemory')gate.promise.then(reply);else reply();
  }};
  const opl=createOplClient(port,{chip:'y8950'});opl.initialize();
  megaDrive.fm=null;megaDrive.psg=null;megaDrive.opl=opl;
  megaDrive.primaryEndpoints=[{name:'y8950',globalName:'opl',client:opl}];
  megaDrive.stopAllNative=()=>opl._stopVoices();
  await runtime.playSource(`
    liveLoop('loading-sample',async()=>{
      await opl.adpcm.loadSample({channels:[new Float32Array(128)],sampleRate:16000});
      opl.adpcm.keyOn();await sleep(60);
    });
  `);
  await until(()=>writes.some(message=>message.method==='loadAdpcmMemory'));
  await runtime.playSource(`stopLoop('loading-sample');`);
  const before=writes.length;gate.resolve();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert(!writes.slice(before).some(message=>message.method==='writeRegister'&&[7,8,9,10,11,12,16,17].includes(message.args[0])),
    'late upload acknowledgement cannot configure or key on a cancelled sample');
  await runtime.stop();
});

test('MSX Audio Main tracks ADPCM separately from FM and preserves a replacement sample owner',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'msx-audio',fmChannels:0,psg:false,dac:false}),writes=[];
  const port={start(){},close(){},postMessage(message){writes.push(message);if(message.id!==undefined)queueMicrotask(()=>port.onmessage?.({data:{id:message.id,value:true}}));}};
  const opl=createOplClient(port,{chip:'y8950'});opl.initialize();
  megaDrive.fm=null;megaDrive.psg=null;megaDrive.opl=opl;
  megaDrive.primaryEndpoints=[{name:'y8950',globalName:'opl',client:opl}];megaDrive.stopAllNative=()=>opl._stopVoices();
  await runtime.playSource(`
    liveLoop('fm-owner',async()=>{opl.noteOn(2,'C4');await sleep(60);});
    liveLoop('old-adpcm',async()=>{opl.adpcm.keyOn();await sleep(60);});
  `);
  const replaced=writes.length;
  await runtime.playSource(`opl.adpcm.keyOn();stopLoop('old-adpcm');liveLoop('fm-owner',async()=>{await sleep(60);});`);
  assert(!writes.slice(replaced).some(message=>message.method==='writeRegister'&&message.args[0]===7&&message.args[1]===1),
    'a cancelled old owner cannot stop the replacement ADPCM');
  await runtime.playSource(`opl.adpcm.reset();liveLoop('fm-owner',async()=>{await sleep(60);});`);
  const reset=writes.length;
  await runtime.playSource(`stopLoop('fm-owner');`);
  assert(writes.slice(reset).some(message=>message.method==='forceKeyOff'&&message.args[0]===2),
    'ADPCM reset retains the unrelated FM owner so its loop can still release');
  await runtime.stop();
});

test('MSX Audio Main stopAll cancels a top-level ADPCM decode while retaining a reusable primary client',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'msx-audio',fmChannels:0,psg:false,dac:false}),writes=[];
  const port={start(){},close(){},postMessage(message){writes.push(message);if(message.id!==undefined)queueMicrotask(()=>port.onmessage?.({data:{id:message.id,value:true}}));}};
  const opl=createOplClient(port,{chip:'y8950'});opl.initialize();
  megaDrive.fm=null;megaDrive.psg=null;megaDrive.opl=opl;
  megaDrive.primaryEndpoints=[{name:'y8950',globalName:'opl',client:opl}];megaDrive.stopAllNative=()=>opl._stopVoices();
  await runtime.playSource(`
    let cancelled=false,stopping;
    try{
      await opl.adpcm.loadSample(new Uint8Array([1,2]),{decodeAudio:async()=>{
        stopping=pg.stopAll();return {channels:[new Float32Array(128)],sampleRate:16000};
      }});
    }catch(error){cancelled=error.name==='AbortError';}
    if(!cancelled)throw Error('stopAll allowed top-level sample decode to resume');
    await stopping;
    await opl.adpcm.loadSample({channels:[new Float32Array(128)],sampleRate:16000});
    opl.adpcm.setVolume(120);opl.adpcm.keyOn();opl.adpcm.keyOff();
  `);
  assert.equal(writes.filter(message=>message.method==='loadAdpcmMemory').length,1,'only the new sample reaches RAM');
  await runtime.stop();
});

for(const selected of ['ym2610','ym2610b'])for(const backend of [undefined,'native-genesis'])test(`Main ${selected} ${backend??'web'} borrows only the exact variant`,async t=>{
 const f=independentOpnFixture(),createRuntime=await runtimeWithOpnAudio(f.factory);
 const {runtime,megaDrive}=setup(t,{chip:selected,fmChannels:selected==='ym2610'?4:6,backend}, {},createRuntime);
 const other=selected==='ym2610'?'ym2610b':'ym2610';megaDrive.audio={masterInputNode:{}};megaDrive.createFXApi=()=>({});
 // A host without dynamicSoundChipKinds uses the Browser factory in this fixture;
 // the lookup rules themselves must stay identical to a Native host's rules.
 await runtime.playSource(`
  const primary=await useSoundChip('${selected}');if(primary!==fm)throw Error('Did not borrow exact primary');
  context.extra=await useSoundChip('${other}');
  if(context.extra===primary||context.extra.id!=='${other}:shared'||context.extra.channelCount!==${other==='ym2610'?4:6})throw Error('Borrowed the wrong variant');
  if(await useSoundChip('${other}')!==context.extra)throw Error('Lost shared cache');
 `);
 assert.equal(f.devices.length,1);
});

test('Main additional YM2612 snapshots its engine before ID reuse waits and passes physical engine to client and Mixer',async t=>{
 const fixture=independentOpnFixture(),requested=[],mixes=[];
 const factory=async(context,destination,name,options)=>{
  requested.push({name,...options});const device=await fixture.factory();Object.defineProperty(device,'engine',{value:options.engine??'ymfm',enumerable:true});return device;
 };
 const createRuntime=await runtimeWithOpnAudio(factory),{runtime,megaDrive}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};
 megaDrive.mixer={list:()=>[],connect(id,name,node,destination,context,options){mixes.push({id,name,...options});return()=>{};}};
 globalThis.playgroundReview={};
 await runtime.playSource(`
  const options={id:'engine-captured',engine:'nuked'};
  const pending=createSoundChip('ym2612',options);options.engine='ymfm';options.id='mutated';
  const chip=await pending;globalThis.playgroundReview.chip=chip;
  if(chip.engine!=='nuked'||chip.id!=='engine-captured')throw Error('Creation options changed');
  let readonly=false;try{chip.engine='ymfm';}catch{readonly=true;}if(chip.engine!=='nuked'||!readonly)throw Error('Mutable engine');
 `);
 assert.equal(requested.length,1);assert.equal(requested[0].engine,'nuked');assert.equal(requested[0].id,'engine-captured');
 assert.deepEqual(mixes,[{id:'engine-captured',name:'ym2612',engine:'nuked'}]);
 const listed=runtime.chipInspector.list().find(entry=>entry.id==='engine-captured');assert.equal(listed.engine,'nuked');assert.equal(listed.kind,'ym2612');assert.equal(listed.label,'YM2612 (Nuked) · engine-captured');
 runtime.stop();await runtime.finalize();assert(fixture.devices.every(device=>device.disposed));
});

test('Main rejects invalid engine selectors and selectors for another chip before allocating any audio endpoint',async t=>{
 let created=0;const createRuntime=await runtimeWithOpnAudio(async()=>{created++;throw Error('allocation');});
 const {runtime,megaDrive}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};
 for(const code of [
  `await createSoundChip('ym2612',{engine:'other'});`,
  `await createSoundChip('ym2612',{engine:null});`,
  `await createSoundChip('ym2610b',{engine:'nuked'});`,
  `await createSoundChip('rf5c164',{engine:'nuked'});`,
 ])await assert.rejects(runtime.playSource(code),/engine|supports/);
 assert.equal(created,0);
});

test('Main WonderSwan allNotesOff releases its loop gates while retaining a sibling loop and its retirement owner',async t=>{
  const {runtime,megaDrive}=setup(t,{chip:'wonderswan',fmChannels:0,psg:false,dac:false}),writes=[],registers=new Uint8Array(32);
  const raw=new WonderSwanSynth({transport:{reset(){registers.fill(0);},writeMemory(){},writeRegister(address,value,channel,controlMask){
    writes.push({address,value,channel,controlMask});registers[address-128]=address===0x90?(registers[16]&~(controlMask??255))|(value&(controlMask??255)):value;
  }}});raw.initialize();megaDrive.fm=null;megaDrive.ws=raw;
  megaDrive.primaryEndpoints=[{name:'wonderswan',globalName:'ws',client:raw}];megaDrive.stopAllNative=()=>raw.allNotesOff();
  await runtime.playSource(`
    liveLoop('old',async()=>{ws.noteOn(0,'C4');await sleep(.01);ws.allNotesOff();context.attempted=true;await sleep(60);});
    liveLoop('new',async()=>{ws.noteOn(1,'E4');await sleep(60);});
    context.stopOld=()=>stopLoop('old');context.stopNew=()=>stopLoop('new');
  `);
  await until(()=>registers[16]===3);megaDrive.audioContext.currentTime=.1;await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(runtime.context.attempted,true);assert.equal(registers[16],2,'an older loop releases CH1 while retaining the sibling CH2');
  const before=writes.length;runtime.context.stopOld();assert.equal(registers[16],2);assert.equal(writes.length,before,'already released owner has no retirement gate');
  runtime.context.stopNew();assert.equal(registers[16],0,'sibling retirement still owns and releases CH2');
});

for(const allocation of ['useSoundChip','createSoundChip'])test(`Main WonderSwan ${allocation} extra retains sibling loop gates and releases each retiring owner`,async t=>{
  const devices=[];
  const factory=async()=>{
    const registers=new Uint8Array(32),entry={registers,disposed:false};devices.push(entry);
    const port={start(){},close(){},postMessage(command){
      if(command.method==='reset')registers.fill(0);
      else if(command.method==='writeRegister'){const[address,value]=command.args,mask=command.controlMask??255;registers[address-128]=address===0x90?(registers[16]&~mask)|(value&mask):value;}
      if(command.id!==undefined)queueMicrotask(()=>port.onmessage?.({data:{id:command.id,value:true}}));
    }};
    return{port,clock:3072000,node:{port:{postMessage(){},addEventListener(){},removeEventListener(){},start(){}},disconnect(){}},dispose(){entry.disposed=true;}};
  };
  const createRuntime=await runtimeWithOpnAudio(factory,'createWonderSwanAudio');
  const {runtime,megaDrive}=setup(t,undefined,{},createRuntime);megaDrive.audio={masterInputNode:{}};
  await runtime.playSource(`
    const extra=await ${allocation}('wonderswan');
    liveLoop('old',async()=>{extra.noteOn(0,'C4');await sleep(.01);extra.allNotesOff();context.attempted=true;try{await sleep(60);}finally{extra.reset();context.retiredResetAttempted=true;}});
    liveLoop('new',async()=>{extra.noteOn(1,'E4');await sleep(60);});
    context.stopOld=()=>stopLoop('old');context.stopNew=()=>stopLoop('new');
  `);
  assert.equal(devices.length,1);await until(()=>devices[0].registers[16]===3);
  megaDrive.audioContext.currentTime=.1;await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(runtime.context.attempted,true);assert.equal(devices[0].registers[16],2,'allNotesOff keeps the sibling extra voice');
  runtime.context.stopOld();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(runtime.context.retiredResetAttempted,true);assert.equal(devices[0].registers[16],2,'retired finally cannot reset the shared extra voice');
  runtime.context.stopNew();assert.equal(devices[0].registers[16],0,'retiring the sibling releases its extra voice');
  await runtime.finalize();assert(devices.every(device=>device.disposed),'extra endpoints are disposed');
});
