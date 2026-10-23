import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker,MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createDx7Client} from './playground_dx7.js';
import {createInitVoice,createVoiceSysex,createBankSysex} from './msfa_dx7/src/sysex.js';
import {presetToVoice,voiceToPreset} from './msfa_dx7/src/preset.js';
import {EXTRA_DX7_VOICE_HELD_ERROR} from './native_genesis_extra_dx7.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional DX7 test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t,{holdResponse=()=>false}={}){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native DX7 attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{
    constructor(){this.pending=[];this.messages=[];this.heldResponses=[];this.ready=false;workers.push(this);this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});this.worker.on('error',error=>this.onerror?.({message:error.message}));}
    postMessage(message,transfer){if(holdResponse(message)){this.heldResponses.push([message,transfer]);return;}if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    releaseResponses(){for(const [message,transfer]of this.heldResponses.splice(0))this.worker.postMessage(message,transfer);}
    terminate(){return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});return workers;
}
function source(instance){return {instance,voices:[createInitVoice()],selectedVoice:0,cohorts:[1],nextCohort:1,notes:new Map(),manual:new Map()};}
function fixture(t,{mode='genesis',future=false}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),queue=[],waiters=[],primary=source(0);let gate=null,commandGate=null,offset=0;const started=Date.now(),now=()=>future?offset:Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  const value=s=>({voices:s.voices.map(v=>Array.from(v)),selectedVoice:s.selectedVoice,activeNotes:[...s.notes].map(([midi,n])=>({midi,velocity:n.velocity})),held:[...s.manual.keys()],pendingCommands:queue.filter(c=>c.instance===s.instance&&c.message.id).map(c=>c.message.id)});
  const snapshot=instance=>{const s=rack.get(instance);if(!s)throw Error('Additional sound chip is not connected');return {dx7:value(s),sampleRate:48000,frame:status().frame,revision:calls.length};};
  function settle(){for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(!rack.has(w.instance)){waiters.splice(i,1);w.reject(new DOMException('Disposed','AbortError'));}else if(!queue.some(c=>c.instance===w.instance&&c.message.id===w.after)){waiters.splice(i,1);w.resolve(snapshot(w.instance));}}}
  const patch=m=>['load-bank','select-voice','set-preset','edit-voice'].includes(m.method);
  function cancelWhere(predicate){for(let i=queue.length-1;i>=0;i--)if(predicate(queue[i],queue[i].message))queue.splice(i,1);for(const s of rack.values())for(const [midi,n]of s.notes)if(!s.manual.has(midi)&&predicate(n,{group:n.group}))s.notes.delete(midi);}
  function apply(s,m,c={}){
    if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;return;}
    if(m.method==='cancel-main-owner'){cancelWhere((c,message)=>message.group===m.targetGroup);return;}
    if(patch(m)&&s.manual.size&&!m.audition)throw Error(EXTRA_DX7_VOICE_HELD_ERROR);
    if(m.method==='load-bank'){s.voices=m.voices.map(v=>new Uint8Array(v));s.selectedVoice=0;s.cohorts=s.voices.map(()=>++s.nextCohort);s.notes.clear();s.manual.clear();}
    else if(m.method==='set-preset'){if(m.indices)for(const index of m.indices)s.voices[s.selectedVoice][index]=m.voice[index];else s.voices[s.selectedVoice]=new Uint8Array(m.voice);s.cohorts[s.selectedVoice]=++s.nextCohort;}
    else if(m.method==='edit-voice'){for(const index of m.indices)s.voices[s.selectedVoice][index]=m.voice[index];for(const note of s.notes.values())if(note.cohort===s.cohorts[s.selectedVoice])note.liveEdits++;}
    else if(m.method==='select-voice')s.selectedVoice=m.index;
    else if(m.method==='note-on'){
      if(s.manual.has(m.note)&&!m.audition)return;
      if(!s.notes.has(m.note)&&s.notes.size>=16){const victim=[...s.notes.keys()].find(note=>!s.manual.has(note));if(victim===undefined)return;s.notes.delete(victim);}
      s.notes.set(m.note,{velocity:m.velocity,voice:m.voice,cohort:s.cohorts[s.selectedVoice],liveEdits:0,group:m.group,performance:c.performance,owner:c.owner});if(m.audition)s.manual.set(m.note,m.voice);
    }else if(m.method==='note-off'){
      const n=s.notes.get(m.note);if(s.manual.has(m.note)&&!m.audition)return;if(m.voice!==undefined&&n?.voice!==m.voice)return;if(m.group!==undefined&&n?.group!==m.group&&!m.audition)return;if(c.owner!==undefined&&n?.owner!==c.owner&&!m.audition)return;s.notes.delete(m.note);s.manual.delete(m.note);
    }else if(['panic','all-notes-off'].includes(m.method))for(const [midi,n]of s.notes)if(!s.manual.has(midi)&&(m.group===undefined||n.group===m.group))s.notes.delete(midi);
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});const match=/^native_genesis_extra_dx7_(create|dispose|status)$/.exec(command);
    if(match){const op=match[1];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');rack.set(args.instance,source(args.instance));}if(op==='dispose'){rack.delete(args.instance);settle();return true;}if(args.after&&queue.some(c=>c.instance===args.instance&&c.message.id===args.after))return new Promise((resolve,reject)=>waiters.push({instance:args.instance,after:args.after,resolve,reject}));return snapshot(args.instance);}
    if(command==='native_genesis_dx7_status')return value(primary);
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();queue.length=0;settle();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner')cancelWhere(c=>c.performance===args.performance&&c.owner===args.owner);
    if(command==='native_genesis_commands'){
      if(commandGate&&args.commands.some(c=>c.type==='extra-dx7'))await commandGate.promise;
      for(const c of args.commands)if(c.type==='extra-dx7'&&patch(c.message)&&rack.get(c.instance)?.manual.size&&!c.message.audition)throw Error(EXTRA_DX7_VOICE_HELD_ERROR);
      for(const c of args.commands)if(c.type==='extra-dx7'){const s=rack.get(c.instance);if(!s)throw Error('Additional sound chip is not connected');if(future&&c.frame>status().frame)queue.push(c);else apply(s,c.message,c);}else if(c.type==='dx7')apply(primary,c.message,c);
    }
    settle();return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());return {synth,runtime,calls,errors,logs,rack,queue,waiters,gate:value=>{gate=value;},commandGate:value=>{commandGate=value;},commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]),advance(frame){offset=frame/48;for(const c of queue.splice(0).sort((a,b)=>a.frame-b.frame)){if(c.frame<=frame)apply(rack.get(c.instance),c.message,c);else queue.push(c);}settle();}};
}
test('Native additional DX7 owns its INIT bank, six operators, sixteen voices and Mixer without Web Audio',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('dx7',{id:'a'});context.b=await createSoundChip('dx7',{id:'b'});`);const {a,b}=f.runtime.context;
  assert.equal(a.initialize,undefined);assert.equal(a.clock,undefined);assert.equal(a.sampleRate,48000);assert.equal(a.internalSampleRate,44100);assert.deepEqual(a.voices,[{index:0,name:'INIT SINE'}]);await a.setPreset({name:'SIDE A',algorithm:5,feedback:2,operators:{1:{coarse:3,outputLevel:77}}});await b.setPreset({name:'SIDE B',feedback:6});await a.setOperator(1,{fine:17});await a.setOperators([[2,{coarse:4}],[6,{outputLevel:60}]]);await a.setFeedback(7);
  const one=await a.getPreset(),two=await b.getPreset();assert.equal(one.name,'SIDE A');assert.equal(one.algorithm,5);assert.equal(one.feedback,7);assert.equal(one.operators[1].fine,17);assert.equal(two.name,'SIDE B');assert.equal(two.feedback,6);assert.equal(two.algorithm,31);assert.equal(f.synth.extraDx7Devices.size,2);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  f.synth.mixer.set('a',{volume:.3,pan:-.5});await f.synth.flush();assert.equal([...f.rack.values()][0].volume,.3);assert.deepEqual(f.errors,[]);
});
test('Native additional DX7 copies SysEx and validates whole presets and operator batches before admission',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('dx7',{id:'a'});`);const a=f.runtime.context.a,bytes=createBankSysex(Array.from({length:32},(_,index)=>presetToVoice({name:`VOICE ${index}`,feedback:index%8}))),backing=new Uint8Array(9000);backing.set(bytes,19);const upload=a.loadSysex(backing.subarray(19,19+bytes.length));backing.fill(0);await upload;assert.equal(a.voices.length,32);a.selectVoice(31);assert.equal(a.selectedVoice,31);assert.equal((await a.getPreset()).name,'VOICE 31');const before=f.commands().length;await assert.rejects(a.setPreset({algorithm:32}));await assert.rejects(a.setOperators([[1,{fine:30}],[7,{coarse:3}]]));assert.throws(()=>a.noteOn(128));assert.throws(()=>a.selectVoice(32));await assert.rejects(a.loadSysex(new Uint8Array(163)));assert.equal(f.commands().length,before);await assert.rejects(f.runtime.playSource(`await createSoundChip('dx7',{clock:44100});`),/supports/);assert.deepEqual(f.errors,[]);
});
test('Native additional DX7 applied inspector and masked edits retain accepted future author projections',async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.synth.start();const d=await f.synth.createExtraDx7({id:'a'}),e=d.endpoint;
  await e.dispatch({method:'setPreset',args:[{name:'FUTURE',algorithm:7,operators:{1:{coarse:9,fine:12}}}],id:1},{time:2});assert.equal(d.client.voices[0].name,'FUTURE');assert.equal((await d.client.getPreset()).algorithm,7);let view=await e.read();assert.equal(view.preset.name,'INIT SINE');assert.equal(view.logical.preset.name,'FUTURE');await e.invoke('setPreset',[{feedback:4}]);view=await e.read();assert.equal(view.preset.feedback,4);assert.equal(view.preset.algorithm,31);assert.equal(view.logical.preset.algorithm,7);await e.invoke('setPreset',[{operators:{1:{outputLevel:71}}}]);const last=f.commands().filter(c=>c.type==='extra-dx7'&&c.message.method==='set-preset').at(-1).message;assert.deepEqual(last.indices,[121]);assert.equal(last.voice[121],71);assert.equal((await d.client.getPreset()).operators[1].coarse,9);assert.equal(f.queue.length,1);f.advance(96000);assert.equal((await e.read()).preset.name,'FUTURE');assert.deepEqual(f.errors,[]);
});
test('Native additional DX7 protects sixteen allocated manual notes, edits live, and fences stale releases',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('dx7',{id:'a'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  for(let n=0;n<16;n++)await i.invoke('a','auditionOn',[0,48+n,`old${n}`]);assert.equal((await i.read('a')).auditions.length,16);a.noteOn(90);a.panic();a.allNotesOff();await f.synth.flush();assert.equal((await i.read('a')).activeNotes.length,16);await assert.rejects(a.setPreset({name:'BLOCKED'}),/manually held/);assert.equal(f.synth.state,'ready');await i.invoke('a','setOperator',[1,{outputLevel:72}]);assert.equal((await i.read('a')).preset.operators[1].outputLevel,72);await i.invoke('a','auditionOn',[0,48,'new']);await i.invoke('a','auditionOff',[0,'old0']);let view=await i.read('a');assert.equal(view.auditions.length,16);assert(view.auditions.some(a=>a.id==='new'));await assert.rejects(i.invoke('a','auditionOn',[0,90,'overflow']),/16/);await i.invoke('a','auditionAllOff');assert.equal((await i.read('a')).activeNotes.length,0);await a.setPreset({name:'AFTER'});assert.equal((await a.getPreset()).name,'AFTER');assert.deepEqual(f.errors,[]);
});
for(const execution of ['main','worker'])test(`Native additional DX7 ${execution} async preset continuation keeps loop ownership`,{timeout:15000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await useSoundChip('dx7');let ready=false;liveLoop('one',async()=>{const s=await useSoundChip('dx7');await s.setOperator(1,{fine:7});s.noteOn(60);ready=true;log('one-ready');await beat(100);});liveLoop('two',async()=>{while(!ready)await beat(.001);const s=await useSoundChip('dx7');await s.getPreset();s.noteOn(64);log('two-ready');await beat(100);});${execution==='main'?"context.cancel=()=>stopLoop('one');":"keyboard.bind('cancel',{noteOn(){stopLoop('one');log('cancelled');},noteOff(){},allNotesOff(){}});"}`,{execution});
  await until(()=>f.logs.includes('one-ready')&&f.logs.includes('two-ready')&&f.commands().filter(c=>c.type==='extra-dx7'&&c.message.method==='note-on').length===2&&(execution==='main'||f.runtime.getKeyboardTarget()));const notes=f.commands().filter(c=>c.type==='extra-dx7'&&c.message.method==='note-on');assert.equal(new Set(notes.map(c=>execution==='worker'?c.owner:c.message.group)).size,2);if(execution==='main')f.runtime.context.cancel();else{f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));}await f.synth.flush();const view=await f.synth.chipInspector.read('dx7:shared');assert(!view.activeNotes.some(n=>n.midi===60));assert(view.activeNotes.some(n=>n.midi===64));assert.deepEqual(f.errors,[]);
});
for(const late of [false,true])test(`Native additional DX7 Worker cancellation disposes ${late?'late response':'pending creation'}`,{timeout:10000},async t=>{
  const workers=installWorkers(t,{holdResponse:message=>late&&message.type==='response'&&message.value?.id==='pending'}),f=fixture(t),gate=deferred();if(!late)f.gate(gate);
  await f.runtime.playSource(`liveLoop('make',async()=>{const a=await createSoundChip('dx7',{id:'pending'});await a.setPreset({name:'STALE'});a.noteOn(60);await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('make');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>(late?workers[0].heldResponses.length===1:f.calls.some(c=>c.command==='native_genesis_extra_dx7_create'))&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));if(!late)await until(()=>f.synth.extraDevices.size===0);if(late)workers[0].releaseResponses();else gate.resolve();await until(()=>!f.rack.size&&f.calls.some(c=>c.command==='native_genesis_extra_dx7_dispose'));assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-dx7'&&['set-preset','note-on'].includes(c.message.method)));assert.deepEqual(f.errors,[]);
});
test('Native additional DX7 primary borrowing, shared cache eviction, sixteen slots and same-ID fences',async t=>{
  installWorkers(t);const f=fixture(t,{mode:'dx7'});await f.runtime.playSource(`context.p=await useSoundChip('dx7');context.a=await createSoundChip('dx7',{id:'side'});context.api={useSoundChip,createSoundChip};`);assert.equal(f.runtime.context.p.id,'dx7');assert.equal(f.runtime.context.p.dispose,undefined);const token=f.synth.chipInspector.getConnectionToken('side');f.runtime.context.a.dispose();await f.runtime.playSource(`context.a=await createSoundChip('dx7',{id:'side'});context.api={useSoundChip,createSoundChip};`);assert.notEqual(f.synth.chipInspector.getConnectionToken('side'),token);for(let n=0;n<15;n++)await f.runtime.context.api.createSoundChip('dx7',{id:`n${n}`});await assert.rejects(f.runtime.context.api.createSoundChip('dx7'),/at most 16/);await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.deepEqual(f.errors,[]);
});
test('Native additional DX7 Worker future preset acknowledges preparation and owner cancellation preserves applied voice', {timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('dx7',{id:'a'});liveLoop('future',async()=>{await a.setPreset({name:'FUTURE'});log('prepared');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('future');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('prepared')&&f.queue.length&&f.runtime.getKeyboardTarget());assert.equal((await f.synth.chipInspector.read('a')).preset.name,'INIT SINE');assert.equal((await f.synth.chipInspector.read('a')).logical.preset.name,'FUTURE');f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));await until(()=>f.queue.length===0);assert.equal((await f.synth.chipInspector.read('a')).logical.preset.name,'INIT SINE');assert.deepEqual(f.errors,[]);
});
test('Native DX7 client async continuations restore owner and cancelled client disposal bypasses stopped guards',async t=>{
  const channel=new MessageChannel(),messages=[];let context={name:'one'},stopped=false;channel.port2.on('message',message=>messages.push(message));const client=createDx7Client(channel.port1,{native:true,sampleRate:48000,voices:[{index:0,name:'INIT SINE'}],selectedVoice:0},{captureContext:()=>context,restoreContext:value=>{context=value;},isStopped:()=>stopped});t.after(()=>{client.dispose();channel.port2.close();});const read=client.getPreset();context={name:'two'};await until(()=>messages.length);channel.port2.postMessage({id:messages[0].id,value:{name:'PATCH'}});assert.deepEqual(await read,{name:'PATCH'});assert.equal(context.name,'one');const next=client.getPreset(),rejected=assert.rejects(next,/stopped|disposed/);await until(()=>messages.length===2);stopped=true;channel.port2.postMessage({id:messages[1].id,value:{name:'STALE'}});await rejected;client.dispose();await until(()=>messages.some(m=>m.method==='dispose'));
});
test('Native additional DX7 stale in-flight edits cancel without failing a replacement with the same Mixer ID',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();const old=await f.synth.createExtraDx7({id:'same'}),gate=deferred();f.commandGate(gate);const loading=old.client.setPreset({name:'STALE'}),rejected=assert.rejects(loading,error=>error.name==='AbortError');await until(()=>f.commands().some(c=>c.type==='extra-dx7'&&c.message.method==='set-preset'));old.dispose();const replacement=f.synth.createExtraDx7({id:'same'});gate.resolve();await rejected;const next=await replacement;assert.notEqual(next.nativeInstance,old.nativeInstance);assert.equal((await next.client.getPreset()).name,'INIT SINE');assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});
test('Native additional DX7 Main pending creation cancellation and shared cache eviction release every reservation',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);await f.runtime.playSource(`liveLoop('make',async()=>{const a=await createSoundChip('dx7',{id:'pending'});a.noteOn(60);await beat(100);});context.cancel=()=>stopLoop('make');`);await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_dx7_create'));f.runtime.context.cancel();await until(()=>f.synth.extraDevices.size===0);gate.resolve();await until(()=>f.rack.size===0&&f.calls.some(c=>c.command==='native_genesis_extra_dx7_dispose'));f.gate(null);await f.runtime.playSource(`context.a=await useSoundChip('dx7');context.a.dispose();context.b=await useSoundChip('dx7');`);assert.notEqual(f.runtime.context.a,f.runtime.context.b);assert.equal(f.runtime.context.b.id,'dx7:shared');assert.equal(f.synth.extraDevices.size,1);assert.equal(f.synth.mixer.reservedIds.size,0);assert.deepEqual(f.errors,[]);
});

test('Native additional DX7 explicit applied reads do not publish another inspector refresh',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();const device=await f.synth.createExtraDx7({id:'quiet'});let updates=0;const detach=f.synth.chipInspector.subscribe(()=>updates++);const before=updates;for(let n=0;n<3;n++)await f.synth.chipInspector.read('quiet');assert.equal(updates,before);await device.client.setFeedback(3);assert(updates>before);detach();assert.deepEqual(f.errors,[]);
});

test('Native additional DX7 inspector partial presets start a new cohort while feedback and operator edits retain it',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();const device=await f.synth.createExtraDx7({id:'cohort'}),endpoint=device.endpoint;await device.client.setPreset({name:'PREVIOUS',algorithm:5,operators:{1:{coarse:3,fine:17}}});await endpoint.invoke('auditionOn',[0,60,'old']);const native=[...f.rack.values()][0],oldCohort=native.notes.get(60).cohort;
  await endpoint.invoke('setPreset',[{algorithm:7}]);const replacement=f.commands().filter(c=>c.type==='extra-dx7'&&c.message.method==='set-preset').at(-1).message;assert.deepEqual(replacement.indices,[134]);assert.equal(replacement.voice[134],7);let view=await endpoint.read();assert.equal(view.preset.name,'PREVIOUS');assert.equal(view.preset.operators[1].coarse,3);assert.equal(view.preset.operators[1].fine,17);assert.notEqual(native.cohorts[0],oldCohort);assert.equal(native.notes.get(60).cohort,oldCohort);
  await endpoint.invoke('setOperator',[1,{outputLevel:71}]);assert.equal(native.notes.get(60).liveEdits,0);await endpoint.invoke('auditionOn',[0,64,'new']);const newCohort=native.notes.get(64).cohort;await endpoint.invoke('setPreset',[{feedback:6}]);const feedback=f.commands().filter(c=>c.type==='extra-dx7').at(-1).message;assert.equal(feedback.method,'edit-voice');assert.deepEqual(feedback.indices,[135]);assert.equal(native.cohorts[0],newCohort);assert.equal(native.notes.get(60).liveEdits,0);assert.equal(native.notes.get(64).liveEdits,1);assert.deepEqual(f.errors,[]);
});
