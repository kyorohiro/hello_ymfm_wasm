// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSidImport,preflightSidImport} from './sid_import.js';
import {readPreset} from './preset.js';
import {validatePlayerSid,createPlayerCore} from '../sid-player/models.js';
import {createSidPairFixture} from '../../test/helpers/sid_voice_pair_fixtures.mjs';
import {createSidPlayerTestFixture} from '../../test/helpers/sid_player_fixtures.mjs';
import {createPsidCiaFixture} from '../../test/helpers/psid_cia_fixtures.mjs';
import {createRsidFixture} from '../../test/helpers/rsid_fixtures.mjs';
import {createSid8580MachineFixture} from '../../test/helpers/sid8580_machine_fixtures.mjs';
import {PSID_MAX_FILE_BYTES} from '../js/sid_psid.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const file=(bytes,name='original.sid')=>({name,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
const authored=(model='6581')=>createSidPairFixture({model,sync:true,ring:true,voice3off:true}).bytes;
function snapshot(model='6581'){
  const fixture=createSidPairFixture({model,sync:true,ring:true,voice3off:true});
  return {model,clockHz:985248,sampleRate:48000,positionFrames:8192,playing:true,registers:fixture.registers.slice(),
    voices:[{envelope:255,phase:123},{envelope:0,phase:0},{envelope:0,phase:456}]};
}
function harness(){
  const updates=[],cores=[],engines=[],events=[],used=[],config={};let revision=0,master=.7;
  const controller=createSidImport({
    onUpdate:state=>updates.push(state),getInstrumentRevision:()=>revision,getVolume:()=>master,
    createCore:async options=>{
      const core={options,loads:[],disposeCount:0,load(bytes,load){this.loads.push({bytes:Uint8Array.from(bytes),options:{...load}});},dispose(){this.disposeCount++;}};
      cores.push(core);const wait=config.coreWait;config.coreWait=null;if(wait)await wait.promise;return core;
    },
    preflight:async(core,signal)=>{
      events.push(['preflight',core]);const wait=config.preflightWait;config.preflightWait=null;if(wait)await wait.promise;
      if(config.preflightError){const error=config.preflightError;config.preflightError=null;throw error;}signal.throwIfAborted();
    },
    createAudio:options=>{
      const model=options.backend==='8580'?'8580':'6581';
      const engine={options,model,messages:[],volumes:[],disposeCount:0,closed:false,loaded:null,
        async command(method,args=[]){
          this.messages.push({method,args});events.push([method,this]);
          const wait=config[method+'Wait'];config[method+'Wait']=null;if(wait)await wait.promise;
          if(method==='load')this.loaded={bytes:Uint8Array.from(args[0]),options:{...args[1]}};
          return snapshot(model);
        },
        read(){this.messages.push({method:'read'});const wait=config.readWait;config.readWait=null;return wait?wait.promise:Promise.resolve(snapshot(model));},
        setVolume(value){this.volumes.push(value);},
        dispose(){this.disposeCount++;events.push(['dispose',this]);const wait=config.closeWait;config.closeWait=null;
          if(wait)return wait.promise.then(()=>{this.closed=true;});this.closed=true;return Promise.resolve();},
      };
      engines.push(engine);events.push(['createAudio',engine]);const wait=config.audioWait;config.audioWait=null;
      return wait?wait.promise.then(()=>engine):Promise.resolve(engine);
    },
    onPreviewStart:async(engine,context)=>{events.push(['previewStart',engine,context]);const wait=config.hookWait;config.hookWait=null;if(wait)await wait.promise;},
    onPreviewStop:engine=>events.push(['previewStop',engine]),
    onUsePreset:async preset=>{events.push(['use',preset]);used.push(preset);if(config.ownRevisionChange)revision++;if(config.useError)throw config.useError;},
  });
  return {controller,updates,cores,engines,events,used,config,edit(){revision++;},setMaster(value){master=value;controller.setVolume(value);}};
}
async function captured(h,bytes=authored()){
  assert.equal(await h.controller.loadFile(file(bytes)),true);assert.equal(await h.controller.play(),true);
  assert.equal(await h.controller.capture(),true);return h.controller.read().snapshot;
}

test('opening a local SID is audio-free, owns its bytes, exposes only detached metadata and bounds reads first',async()=>{
  const h=harness();assert.equal(h.engines.length,0);assert.equal(h.controller.read().selection,null);
  const bytes=authored(),original=bytes.slice();assert.equal(await h.controller.loadFile(file(bytes,'plain-file.sid')),true);
  assert.equal(h.engines.length,0);assert.equal(h.cores.length,1);assert.equal(h.cores[0].disposeCount,1);
  const state=h.controller.read();assert.equal(state.selection.name,'plain-file.sid');assert.equal(state.selection.title,'Tetorica 6581 pair 3-1');
  assert.equal(state.selection.model,'6581');assert.equal(state.selection.modelSelection,'auto');assert.equal(state.canPlay,true);
  assert(!JSON.stringify(state).includes('originalBytes'));assert.equal(state.selection.bytes,undefined);state.selection.name='external mutation';
  bytes.fill(0);assert.equal(await h.controller.play(),true);assert.deepEqual(h.engines[0].loaded.bytes,original);
  assert.equal(h.controller.read().selection.name,'plain-file.sid');
  let reads=0;assert.equal(await h.controller.loadFile({name:'too-big.sid',size:PSID_MAX_FILE_BYTES+1,arrayBuffer(){reads++;throw Error('Must not read');}}),false);
  assert.equal(reads,0);assert.match(h.controller.read().message,/exceeds.*Current instrument.*kept/);assert(h.controller.read().playing);
  assert.equal(await h.controller.loadFile({name:'changed.sid',size:100,arrayBuffer:async()=>new ArrayBuffer(99)}),false);
  assert.match(h.controller.read().message,/size changed/);assert(h.controller.read().playing);
  await h.controller.dispose();
});

test('file cancellation and rejected candidates preserve accepted playback and the captured instrument',async()=>{
  const h=harness(),saved=await captured(h),accepted=h.controller.read().selection,engine=h.engines[0];
  const token=h.controller.beginFileSelection();assert(h.controller.read().choosingFile);assert(h.controller.read().playing);
  assert.equal(h.controller.cancelFileSelection(token),true);assert.match(h.controller.read().message,/cancelled/);
  assert.deepEqual(h.controller.read().selection,accepted);assert.deepEqual(h.controller.read().snapshot,saved);assert.equal(engine.disposeCount,0);
  assert.equal(await h.controller.loadFile(file(new Uint8Array([1,2,3]),'bad.sid')),false);
  h.config.preflightError=Error('ROM is required');assert.equal(await h.controller.loadFile(file(authored('8580'),'rom-dependent.sid')),false);
  assert.deepEqual(h.controller.read().selection,accepted);assert.deepEqual(h.controller.read().snapshot,saved);
  assert.equal(h.engines.length,1);assert.equal(engine.disposeCount,0);assert.equal(h.used.length,0);
  assert.match(h.controller.read().message,/ROM.*SID Player/);await h.controller.dispose();
});

test('latest file selection wins and a stale chooser token cannot commit after Stop',async()=>{
  const h=harness(),slow=deferred(),first=h.controller.beginFileSelection();
  const pending=h.controller.loadFile({name:'slow.sid',size:authored().length,arrayBuffer:()=>slow.promise},{selectionToken:first});
  const next=h.controller.beginFileSelection();assert.equal(await h.controller.loadFile(file(authored('8580'),'new.sid'),{selectionToken:next}),true);
  const updates=h.updates.length;slow.resolve(authored().buffer);assert.equal(await pending,false);assert.equal(h.updates.length,updates);
  assert.equal(h.controller.read().selection.name,'new.sid');assert.equal(h.controller.read().selection.model,'8580');
  const old=h.controller.beginFileSelection();await h.controller.stop();assert.equal(await h.controller.loadFile(file(authored()),{selectionToken:old}),false);
  assert.equal(h.controller.read().selection.name,'new.sid');await h.controller.dispose();
});

test('Stop cancels a disposable preflight, while a keyboard-only Stop can preserve silent file loading',async()=>{
  const h=harness(),wait=deferred();h.config.preflightWait=wait;
  const pending=h.controller.loadFile(file(authored(),'late.sid'));await flush();assert(h.controller.read().loading);
  await h.controller.stop();assert(!h.controller.read().busy);const updates=h.updates.length;wait.resolve();assert.equal(await pending,false);
  assert.equal(h.updates.length,updates);assert.equal(h.cores[0].disposeCount,1);assert.equal(h.controller.read().selection,null);
  const passive=deferred();h.config.preflightWait=passive;const next=h.controller.loadFile(file(authored(),'passive.sid'));await flush();
  await h.controller.stop({cancelLoad:false});assert(h.controller.read().loading);passive.resolve();assert.equal(await next,true);
  assert.equal(h.controller.read().selection.name,'passive.sid');assert.equal(h.engines.length,0);await h.controller.dispose();
});

test('Auto follows known declarations and explicit model changes resolve unknown hints without rewriting the header',async()=>{
  const h=harness(),unknown=authored();new DataView(unknown.buffer).setUint16(118,0);const original=unknown.slice();
  assert.equal(await h.controller.loadFile(file(unknown)),true);assert.equal(h.controller.read().selection.model,'6581');
  assert.equal(await h.controller.setModel('8580'),true);assert.equal(h.controller.read().selection.model,'8580');
  assert.equal(h.controller.read().selection.modelSelection,'8580');assert.equal(h.controller.read().selection.declaredModel,'unknown');
  assert.equal(await h.controller.play(),true);assert.deepEqual(h.engines.at(-1).loaded.bytes,original);assert.equal(h.engines.at(-1).options.backend,'8580');
  await h.controller.stop();assert.equal(await h.controller.setModel('auto'),true);assert.equal(h.controller.read().selection.model,'6581');
  assert.equal(await h.controller.loadFile(file(authored('6581'))),true);const selected=h.controller.read().selection;
  assert.equal(await h.controller.setModel('8580'),false);assert.deepEqual(h.controller.read().selection,selected);assert.match(h.controller.read().message,/declares 6581/);
  assert.throws(()=>h.controller.setModel('invalid'),RangeError);await h.controller.dispose();
});

test('accepted subtune changes stop the old preview, retain old snapshots and need an explicit new Play',async()=>{
  const h=harness(),bytes=createSidPlayerTestFixture();await captured(h,bytes);const saved=h.controller.read().snapshot;
  assert.equal(await h.controller.setSubtune(2),true);assert.equal(h.controller.read().selection.subtune,2);assert.equal(h.controller.read().playing,false);
  assert.deepEqual(h.controller.read().snapshot,saved);assert.equal(h.engines[0].disposeCount,1);assert.equal(h.engines.length,1);
  assert.equal(h.cores.at(-1).loads[0].options.subtune,2);assert.equal(h.controller.read().canPlay,true);
  assert.throws(()=>h.controller.setSubtune(3),RangeError);assert.throws(()=>h.controller.setSubtune('2'),RangeError);
  assert.equal(await h.controller.play(),true);assert.equal(h.engines.at(-1).loaded.options.subtune,2);
  assert.equal(await h.controller.capture(),true);assert.equal(h.controller.read().snapshot.subtune,2);
  assert.match(h.controller.read().selected.preset.name,/Song 2/);await h.controller.dispose();
});

test('Play invokes the gesture-resuming factory synchronously and fences a late prepared engine',async()=>{
  const h=harness();await h.controller.loadFile(file(authored()));const wait=deferred();h.config.audioWait=wait;
  const pending=h.controller.play();assert.equal(h.engines.length,1);assert(h.controller.read().starting);
  assert.equal(await h.controller.play(),false);await h.controller.stop();const updates=h.updates.length;wait.resolve();
  assert.equal(await pending,false);await flush();assert.equal(h.updates.length,updates);assert.equal(h.engines[0].disposeCount,1);
  assert.equal(h.events.filter(e=>e[0]==='previewStart').length,0);assert.equal(h.engines[0].messages.length,0);
  assert(!h.controller.read().playing);await h.controller.dispose();
});

test('replacement Play resumes in its gesture but waits for the accepted old preview to finish closing',async()=>{
  const h=harness();await captured(h);const wait=deferred();h.config.closeWait=wait;
  assert.equal(await h.controller.loadFile(file(authored('8580'),'replacement.sid')),true);
  assert.equal(h.engines[0].closed,false);assert.equal(h.engines[0].disposeCount,1);
  const pending=h.controller.play();assert.equal(h.engines.length,2);await flush();
  assert.equal(h.events.filter(e=>e[0]==='previewStart').length,1);
  assert.equal(h.engines[1].messages.length,0);assert(h.controller.read().starting);
  wait.resolve();assert.equal(await pending,true);assert.equal(h.engines[0].closed,true);
  assert.equal(h.events.filter(e=>e[0]==='previewStart').length,2);
  assert.deepEqual(h.engines[1].messages.map(m=>m.method),['load','start']);await h.controller.dispose();
});

test('the preview hook has a current-owner predicate and Stop preempts pending hook, load and Start replies',async()=>{
  for(const phase of ['hook','load','start']){
    const h=harness();await h.controller.loadFile(file(authored()));const wait=deferred();h.config[phase+'Wait']=wait;
    const pending=h.controller.play();await flush();assert(h.controller.read().starting);const engine=h.engines[0];
    const hook=h.events.find(e=>e[0]==='previewStart');assert(hook);assert(hook[2].isCurrent());assert(!hook[2].signal.aborted);
    await h.controller.stop();assert(!hook[2].isCurrent());assert(hook[2].signal.aborted);const updates=h.updates.length;
    wait.resolve();assert.equal(await pending,false);await flush();assert.equal(h.updates.length,updates);assert.equal(engine.disposeCount,1);
    if(phase!=='start')assert(!engine.messages.some(m=>m.method==='start'));
    assert(!h.controller.read().playing);await h.controller.dispose();
  }
});

test('preview volume changes follow both the preparing owner and the next explicit Play',async()=>{
  const h=harness();await h.controller.loadFile(file(authored()));h.setMaster(2.5);const wait=deferred();h.config.loadWait=wait;
  const pending=h.controller.play();await flush();assert.equal(h.engines[0].options.volume,2.5);h.setMaster(3.8);assert.equal(h.engines[0].volumes.at(-1),3.8);
  wait.resolve();assert.equal(await pending,true);assert.equal(h.engines[0].volumes.at(-1),3.8);
  assert.throws(()=>h.controller.setVolume(-1),RangeError);assert.throws(()=>h.controller.setVolume(3.81),RangeError);
  await h.controller.stop();h.setMaster(.3);await h.controller.play();assert.equal(h.engines[1].options.volume,.3);await h.controller.dispose();
});

test('capture reads one coherent Worklet state and exposes detached candidates without song data',async()=>{
  const h=harness();assert.equal(await h.controller.capture(),false);assert.match(h.controller.read().message,/Start playback/);
  await h.controller.loadFile(file(authored(),'file-name.sid'));await h.controller.play();const wait=deferred();h.config.readWait=wait;
  const pending=h.controller.capture();assert(h.controller.read().capturing);assert.equal(await h.controller.capture(),false);
  h.controller.selectVoice(0);wait.resolve(snapshot());assert.equal(await pending,true);
  const view=h.controller.read();assert.equal(view.snapshot.name,'Tetorica 6581 pair 3-1');assert.equal(view.snapshot.subtune,1);
  assert.equal(view.snapshot.voices.length,3);assert.equal(view.selected.available,true);assert.equal(view.canUse,true);
  assert.deepEqual(view.selected.preset.modulation,{sync:true,ring:true,ratio:1.5});assert.match(view.message,/Use this voice/);
  view.snapshot.voices[0].preset.name='external mutation';view.selected.preset.modulation.ratio=8;
  assert.notEqual(h.controller.read().selected.preset.name,'external mutation');assert.equal(h.controller.read().selected.preset.modulation.ratio,1.5);
  assert.equal(h.engines[0].messages.filter(m=>m.method==='read').length,1);assert.equal(h.used.length,0);await h.controller.dispose();
});

test('Stop and file selection discard late capture replies without publishing or erasing a saved snapshot',async()=>{
  for(const action of ['stop','file']){
    const h=harness(),saved=await captured(h),wait=deferred();h.config.readWait=wait;const pending=h.controller.capture();
    if(action==='stop')await h.controller.stop();else h.controller.beginFileSelection();
    const updates=h.updates.length;wait.resolve(snapshot('8580'));assert.equal(await pending,false);
    assert.equal(h.updates.length,updates);assert.deepEqual(h.controller.read().snapshot,saved);await h.controller.dispose();
  }
});

test('Use stops and closes preview before a detached validated preset commit, allowing the commit to change revision',async()=>{
  const h=harness();await captured(h);const expected=h.controller.read().selected.preset;h.config.ownRevisionChange=true;
  assert.equal(await h.controller.useVoice(),true);assert.equal(h.engines[0].closed,true);assert.equal(h.controller.read().playing,false);
  assert.deepEqual(h.used,[expected]);assert.deepEqual(readPreset(h.used[0]),expected);assert.equal(h.controller.read().canUse,true);
  assert(h.events.findIndex(e=>e[0]==='previewStop')<h.events.findIndex(e=>e[0]==='use'));
  h.used[0].name='changed externally';assert.deepEqual(h.controller.read().selected.preset,expected);assert.match(h.controller.read().message,/Play the keyboard/);
  await h.controller.dispose();
});

test('instrument edits, Stop or a new voice choice fence Use while preview disposal is pending',async()=>{
  for(const action of ['edit','stop','voice']){
    const h=harness();await captured(h);const wait=deferred();h.config.closeWait=wait;const pending=h.controller.useVoice();await flush();
    assert(h.controller.read().applying);if(action==='edit')h.edit();else if(action==='stop')void h.controller.stop();else h.controller.selectVoice(1);
    wait.resolve();assert.equal(await pending,false);assert.equal(h.used.length,0);assert.equal(h.controller.read().applying,false);
    if(action==='edit')assert.match(h.controller.read().message,/instrument changed/);await h.controller.dispose();
  }
});

test('unsupported candidate reasons prevent Use and a failed preset apply preserves the captured voice',async()=>{
  const h=harness();await captured(h);h.controller.selectVoice(2);assert.equal(h.controller.read().canUse,false);
  assert.equal(await h.controller.useVoice(),false);assert.match(h.controller.read().message,/Voice 3|waveform/);assert.equal(h.used.length,0);
  h.controller.selectVoice(0);h.config.useError=Error('Preset rejected');assert.equal(await h.controller.useVoice(),false);
  assert.match(h.controller.read().message,/Preset rejected.*Current preset kept/);assert(h.controller.read().selected.preset);assert(!h.controller.read().playing);await h.controller.dispose();
});

test('an actual preview failure retires only its owner and a stale failure cannot stop a replacement',async()=>{
  const h=harness(),saved=await captured(h),first=h.engines[0];first.options.onError(Error('Processor failed'));await flush();
  assert(!h.controller.read().playing);assert.equal(first.disposeCount,1);assert.deepEqual(h.controller.read().snapshot,saved);assert.match(h.controller.read().message,/Processor failed/);
  assert.equal(await h.controller.play(),true);first.options.onError(Error('late old failure'));assert(h.controller.read().playing);assert.equal(h.engines[1].disposeCount,0);
  await h.controller.dispose();
});

test('disposal fences delayed file/core/capture completions and clears an accepted preview only once',async()=>{
  for(const phase of ['file','core','capture']){
    const h=harness(),wait=deferred();let pending;
    if(phase==='file')pending=h.controller.loadFile({name:'late.sid',size:authored().length,arrayBuffer:()=>wait.promise});
    else if(phase==='core'){h.config.coreWait=wait;pending=h.controller.loadFile(file(authored()));await flush();}
    else {await captured(h);h.config.readWait=wait;pending=h.controller.capture();}
    await h.controller.dispose();const updates=h.updates.length;
    wait.resolve(phase==='file'?authored().buffer:phase==='capture'?snapshot():undefined);assert.equal(await pending,false);await flush();
    assert.equal(h.updates.length,updates);assert.equal(await h.controller.loadFile(file(authored())),false);assert.equal(await h.controller.play(),false);
    assert(h.cores.every(core=>core.disposeCount===1));assert(h.engines.every(engine=>engine.disposeCount===1));await h.controller.dispose();
  }
});

test('file labels remove control characters without changing ordinary filename letters',async()=>{
  const h=harness();await h.controller.loadFile(file(authored(),'music-file_001.sid'));assert.equal(h.controller.read().selection.name,'music-file_001.sid');
  await h.controller.loadFile(file(authored(),'name\u0000\u001f\u007f.sid'));assert.equal(h.controller.read().selection.name,'name   .sid');await h.controller.dispose();
});

test('real C64 preflight and capture reuse unchanged 6581/8580 VBI, CIA and RSID backends without an audio device',async()=>{
  const binaries={c64:await readFile(new URL('../generated/sid-rsid/sid-rsid.wasm',import.meta.url)),
    endpoint:await readFile(new URL('../generated/sid8580-machine/sid8580-endpoint.wasm',import.meta.url)),
    machine:await readFile(new URL('../generated/sid8580-machine/sid8580-machine.wasm',import.meta.url))};
  const makeCore=options=>createPlayerCore({...options,...(options.model==='8580'?{endpointBinary:binaries.endpoint,machineBinary:binaries.machine}:{wasmBinary:binaries.c64})});
  const cases=[{bytes:authored(),subtune:1},{bytes:createPsidCiaFixture().bytes,subtune:2},{bytes:createRsidFixture().bytes,subtune:1},
    ...['psid-vbi','psid-cia','rsid-cia-irq'].map(kind=>{const f=createSid8580MachineFixture(kind);return {bytes:f.bytes,subtune:f.subtune??1};})];
  for(const item of cases){
    const commits=[];let playedCore;
    const controller=createSidImport({createCore:makeCore,onUsePreset:preset=>commits.push(preset),
      createAudio:async({backend})=>{
        playedCore=await makeCore({model:backend==='8580'?'8580':'6581',backend,sampleRate:48000});
        return {command:async(method,args)=>{if(method==='load')playedCore.load(...args);if(method==='start')playedCore.render(8192);return playedCore.getState();},
          read:async()=>playedCore.getState(),setVolume(){},dispose:async()=>playedCore.dispose()};
      }});
    assert.equal(await controller.loadFile(file(item.bytes)),true);if(item.subtune!==controller.read().selection.subtune)assert.equal(await controller.setSubtune(item.subtune),true);
    assert.equal(await controller.play(),true);assert.equal(await controller.capture(),true);
    const expected=controller.read().snapshot;assert.equal(expected.model,validatePlayerSid(item.bytes,{subtune:item.subtune}).selectedModel);
    assert(expected.positionFrames>0);assert(expected.voices.some(row=>row.available));
    const choice=expected.voices.find(row=>row.available);controller.selectVoice(choice.voice);
    assert.equal(await controller.useVoice(),true);assert.deepEqual(commits,[choice.preset]);await controller.dispose();
  }
});
