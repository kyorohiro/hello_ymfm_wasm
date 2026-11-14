// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHuc6280SongControls} from './song_controls.js';
import {createHuc6280CodeProject} from './code_project.js';
import {transferVirtualFiles} from '../js/tetorica_virtual_files/filesystem.js';
import {createHuc6280RegisterState} from './song_state.js';
import {wave} from './song_test_helpers.mjs';

class Element{
  constructor(){this.listeners=new Map();this.children=[];this.dataset={};this.attributes={};this.value='';this.textContent='';}
  addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}
  replaceChildren(...nodes){this.children=nodes;}blur(){this.blurred=true;this.onBlur?.();}fire(type,event={}){return this.listeners.get(type)?.(event);}
  setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name]??null;}
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const add=(project,name,value=1)=>project.importFiles([{path:'/vgm/'+name,type:'binary',data:Uint8Array.of(value)}]);
function fixture(t,{project=createHuc6280CodeProject({starterCode:'// kept'}),load,onCapture,mixer=false,seek=false,cache=false,seekWork,cancelWork}={}){
  const ids=['Player','Select','PlayButton','StopButton','Status','Position','CaptureButton','CaptureStatus'],nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
  if(mixer){nodes.Channels=new Element();for(let ch=1;ch<=6;ch++)nodes[`Channel${ch}Toggle`]=new Element();}
  if(seek)for(const id of ['Seek','SeekPosition','CancelSeek'])nodes[id]=new Element();
  if(cache)for(const id of ['CacheEnabled','ClearCache','CacheStatus'])nodes[id]=new Element();
  const doc=Object.assign(new Element(),{getElementById:id=>nodes[id.slice('hucSong'.length)],createElement:()=>new Element()}),calls=[],states=[],statuses=[],views=[],captures=[];
  let notify,generation=0,audioRequests=0,beforeCalls=0;
  let state={playback:'stopped',hasSource:false,playing:false,paused:false,loading:false,busy:false,positionFrames:0,positionSeconds:0,bufferedFrames:0,durationSeconds:2,channelEnabled:Array(6).fill(true),channelMuteMask:0,seeking:false,seekPreparing:false,canSeek:true};
  const emit=patch=>{state={...state,...patch};notify?.({...state});};
  const preview={getState:()=>({...state,channelEnabled:[...state.channelEnabled]}),
    async load(bytes,name,{signal}={}){
      const token=++generation;calls.push(['load',name,bytes.slice()]);emit({loading:true});
      try{await load?.(bytes,name);if(signal?.aborted||token!==generation)throw new DOMException('Cancelled','AbortError');emit({loading:false,hasSource:true,name,playback:'stopped',playing:false,paused:false});return true;}
      finally{if(token===generation)emit({loading:false});}
    },
    async play(){calls.push(['play']);await options.beforePlay({isCurrent:()=>true});await options.getAudio();emit({playback:'playing',playing:true,paused:false});},
    pause(){calls.push(['pause']);emit({playback:'paused',playing:false,paused:true});},
    async resume(){calls.push(['resume']);await options.beforePlay({isCurrent:()=>true});await options.getAudio();emit({playback:'playing',playing:true,paused:false});},
    stop(){generation++;calls.push(['stop']);emit({playback:'stopped',playing:false,paused:false,loading:false,positionFrames:0,positionSeconds:0});},
    clear(){calls.push(['clear']);emit({hasSource:false,name:'',playback:'stopped',playing:false,paused:false});},
    setLiveEnabled(value){calls.push(['live',value]);emit({liveEnabled:value});return {...state};},
    getManualSelection(channel){calls.push(['manualSelection',channel]);return{channel,epoch:state.manualEpoch,available:true,editable:true,playable:channel!==3,source:channel===3?'dda':'wave',reason:channel===3?'DDA is a changing code.':''};},
    applyEdit(edit,options){calls.push(['manualEdit',structuredClone(edit),options]);return true;},
    noteOn(id,midi,channel,options){calls.push(['manualOn',id,midi,channel,options]);return{channel};},
    noteOff(id,options){calls.push(['manualOff',id,options]);return true;},
    setPitch(value,options){calls.push(['manualPitch',value,options]);return true;},
    releaseKeyboard(options){calls.push(['manualRelease',options]);return true;},
    setCacheEnabled(value){calls.push(['cache',value]);emit({seekCache:{...state.seekCache,enabled:value,count:0,bytes:0,hits:0}});return {...state};},
    clearSeekCache(){calls.push(['clearCache']);emit({seekCache:{...state.seekCache,count:0,bytes:0,hits:0}});return {...state};},
    setChannelEnabled(channel,enabled){calls.push(['channel',channel,enabled]);const channelEnabled=[...state.channelEnabled];channelEnabled[channel]=enabled;
      emit({channelEnabled,channelMuteMask:channelEnabled.reduce((mask,on,index)=>on?mask:mask|(1<<index),0)});return {...state,channelEnabled:[...channelEnabled]};},
    async seek(seconds){calls.push(['seek',seconds]);if(seekWork)return seekWork(seconds);
      emit({positionSeconds:seconds,positionFrames:Math.round(seconds*44100),playback:state.playing?'playing':'paused',paused:!state.playing,seeking:false});return true;},
    async cancelSeek(){calls.push(['cancelSeek']);if(cancelWork)await cancelWork();emit({seeking:false,seekPreparing:false,busy:false,playback:'paused',paused:true,playing:false});return true;},
    async whenIdle(){calls.push(['whenIdle']);},
    dispose(){generation++;calls.push(['dispose']);},
  };
  let options;
  const controls=setupHuc6280SongControls({project,document:doc,getAudio:async()=>{audioRequests++;return{};},beforePlay:async()=>{beforeCalls++;},onState:value=>states.push(value),onStatus:value=>statuses.push(value),
    onCapture:async(payload,options)=>{captures.push({payload,options});return onCapture?onCapture(payload,options):true;},onViewChange:(target,options)=>views.push([target,options]),
    createPreview:value=>{options=value;notify=value.onState;return preview;}});
  t.after(()=>controls.dispose());
  return{controls,project,doc,nodes,calls,states,statuses,views,captures,emit,get audioRequests(){return audioRequests;},get beforeCalls(){return beforeCalls;}};
}

test('raw Files are listed and validated passively with no audio, Code changes or repeated binary reads',async t=>{
  const project=createHuc6280CodeProject({starterCode:'// untouched'});project.setCodeState({mode:'code',path:'/index.js'});add(project,'song.VGZ',255);
  const f=fixture(t,{project});await turn();assert.deepEqual(f.calls,[['load','song.VGZ',Uint8Array.of(255)]]);
  assert.equal(f.audioRequests,0);assert.equal(f.beforeCalls,0);assert.equal(f.controls.read().selectedPath,'/vgm/song.VGZ');
  assert.equal(f.nodes.PlayButton.textContent,'Play');assert.equal(f.nodes.PlayButton.disabled,false);
  let reads=0;const get=project.fs.get.bind(project.fs);project.fs.get=path=>{if(path.startsWith('/vgm/'))reads++;return get(path);};
  project.select('/index.js');project.setCodeState({mode:'keyboard',path:'/index.js'});await turn();assert.equal(reads,0);
  assert.equal(project.fs.get('/index.js').data,'// untouched');assert.deepEqual(project.getCodeState(),{mode:'keyboard',path:'/index.js'});
});

test('explicit Play/Pause/Resume/Stop forward the host guard and retain the selected source',async t=>{
  const f=fixture(t);add(f.project,'song.vgm');await turn();
  f.nodes.PlayButton.fire('click');await turn();assert.equal(f.nodes.PlayButton.textContent,'Pause');assert(f.controls.isPlaying());
  assert.equal(f.audioRequests,1);assert.equal(f.beforeCalls,1);
  f.nodes.PlayButton.fire('click');assert.equal(f.nodes.PlayButton.textContent,'Resume');assert(f.controls.isActive());
  f.nodes.PlayButton.fire('click');await turn();assert.equal(f.nodes.PlayButton.textContent,'Pause');assert.equal(f.audioRequests,2);assert.equal(f.beforeCalls,2);
  f.nodes.StopButton.fire('click');assert(!f.controls.isActive());assert.equal(f.nodes.PlayButton.textContent,'Play');assert.equal(f.controls.getState().selectedPath,'/vgm/song.vgm');
  assert.deepEqual(f.calls.filter(call=>call[0]!=='load'),[['play'],['pause'],['resume'],['stop']]);
});

test('invalid selection retains the accepted playing song and can be retried after a new revision',async t=>{
  const f=fixture(t,{load:async bytes=>{if(bytes[0]===0)throw Error('Unsupported chip. Current song kept.');}});add(f.project,'good.vgm');await turn();
  f.nodes.PlayButton.fire('click');await turn();add(f.project,'bad.vgm',0);
  assert.equal(await f.controls.selectPath('/vgm/bad.vgm'),false);assert.equal(f.controls.getState().selectedPath,'/vgm/good.vgm');assert(f.controls.isPlaying());
  assert.equal(f.nodes.Select.value,'/vgm/good.vgm');assert.match(f.nodes.Status.textContent,/Unsupported chip/);
  const count=f.calls.length;f.project.select('/index.js');await turn();assert.equal(f.calls.length,count);
  add(f.project,'bad.vgm',2);assert.equal(await f.controls.selectPath('/vgm/bad.vgm'),true);assert.equal(f.controls.getState().selectedPath,'/vgm/bad.vgm');assert(!f.controls.isActive());
});

test('a superseded asynchronous selection cannot replace the newer song or publish after disposal',async t=>{
  const gate=deferred(),f=fixture(t,{load:async bytes=>{if(bytes[0]===1)await gate.promise;}});
  add(f.project,'slow.vgm',1);await Promise.resolve();add(f.project,'fast.vgm',2);
  assert.equal(await f.controls.selectPath('/vgm/fast.vgm'),true);gate.resolve();await turn();
  assert.equal(f.controls.getState().selectedPath,'/vgm/fast.vgm');assert.equal(f.nodes.Select.value,'/vgm/fast.vgm');
  f.controls.dispose();const count=f.states.length;f.emit({playback:'playing',playing:true});assert.equal(f.states.length,count);
});

test('Stop during validation cancels a pending load without audio, error or late selection commit',async t=>{
  const gate=deferred(),f=fixture(t,{load:()=>gate.promise});add(f.project,'slow.vgm');await Promise.resolve();
  assert.equal(f.nodes.StopButton.disabled,false);f.nodes.StopButton.fire('click');gate.resolve();await turn();
  assert.equal(f.controls.getState().selectedPath,null);assert.equal(f.nodes.Select.value,'');assert.equal(f.nodes.Status.dataset.error,'false');assert.equal(f.audioRequests,0);
});

test('renaming or deleting a playing source stops it and only passively prepares the remaining Files',async t=>{
  const f=fixture(t);add(f.project,'source.vgm');await turn();f.nodes.PlayButton.fire('click');await turn();
  transferVirtualFiles(f.project.fs,'/vgm/source.vgm','/vgm/renamed.vgm');await turn();
  assert(!f.controls.isActive());assert.equal(f.controls.getState().selectedPath,'/vgm/renamed.vgm');assert.equal(f.audioRequests,1);
  assert(f.calls.some(call=>call[0]==='clear'));assert.equal(f.nodes.PlayButton.textContent,'Play');
  f.project.fs.remove('/vgm/renamed.vgm');await turn();assert.equal(f.controls.getState().selectedPath,null);assert.equal(f.nodes.PlayButton.disabled,true);
});

test('transport display separates consumed frames from rendered lookahead and reports ended/errors',async t=>{
  const f=fixture(t);add(f.project,'source.vgm');await turn();
  f.emit({playback:'playing',playing:true,positionFrames:4410,bufferedFrames:2205,positionSeconds:.1,durationSeconds:65});
  assert.equal(f.nodes.Player.dataset.positionFrames,'4410');assert.equal(f.nodes.Player.dataset.renderedFrames,'6615');assert.equal(f.nodes.Position.textContent,'0:00 / 1:05');
  f.emit({playback:'ended',playing:false});assert.equal(f.nodes.Status.textContent,'Finished.');assert(!f.controls.isActive());
  f.emit({playback:'error',errorMessage:'Renderer failed'});assert.equal(f.nodes.Status.textContent,'Renderer failed');assert.equal(f.nodes.Status.dataset.error,'true');
});

test('Live toggles forward without acquiring audio or changing the project/transport',async t=>{
  const f=fixture(t);add(f.project,'source.vgm');await turn();
  f.emit({playback:'playing',playing:true,liveEnabled:true,liveState:{positionFrames:123,registers:[[],[],[],[],[],[]]}});
  const state=f.controls.setLiveEnabled(false);assert.equal(state.liveEnabled,false);assert.equal(f.nodes.Player.dataset.liveEnabled,'false');
  assert.equal(f.nodes.Player.dataset.livePositionFrames,'123');assert.equal(state.selectedPath,'/vgm/source.vgm');assert(f.controls.isPlaying());
  assert.deepEqual(f.calls.at(-1),['live',false]);assert.equal(f.audioRequests,0);assert.equal(f.beforeCalls,0);
});

function knownSnapshot(frame=123,{dda=false,muted=false}={}){
  const state=createHuc6280RegisterState(),write=state.write;write(1,255);write(9,0);write(0,0);write(4,64);write(4,0);
  for(const value of wave)write(6,value);write(2,10);write(3,1);write(5,255);write(4,(dda?223:159)&(muted?127:255));
  return state.snapshot(frame);
}
const pauseAt=(f,frame=123,options={})=>f.emit({playback:'paused',paused:true,playing:false,hasSource:true,busy:false,positionFrames:frame,liveState:knownSnapshot(frame,options),liveActive:true,liveError:false});

test('paused physical view prepares a capture payload; successful Capture requests Synth after commit and keeps the reference paused',async t=>{
  const f=fixture(t);add(f.project,'source.vgm');await turn();pauseAt(f);assert.equal(f.nodes.CaptureButton.disabled,true,'Synth has no selected song voice');
  f.controls.setView(0,{notify:false});const selection=f.controls.getPausedSelection();assert(selection.key);assert.equal(selection.channel,0);assert.equal(selection.positionFrames,123);
  assert.equal(f.controls.getPausedSelection(),selection,'same frozen snapshot reuses its validated preparation');
  assert.equal(selection.prepared.capturable,true);assert.equal(f.nodes.CaptureButton.disabled,false);
  const before=f.calls.length;assert.equal(await f.controls.capture(),true);
  assert.equal(f.captures.length,1);assert.equal(f.captures[0].payload.frame,123);assert.deepEqual(f.captures[0].payload.preset.wave,wave);
  assert.equal(f.calls.length,before,'capture does not invoke native transport');assert(f.controls.read().paused);assert.equal(f.controls.read().positionFrames,123);
  assert.equal(f.controls.read().viewTarget,'synth');assert.deepEqual(f.views.at(-1),['synth',{reason:'capture'}]);assert.match(f.nodes.CaptureStatus.textContent,/remains paused/);
  assert.equal(f.audioRequests,0);
});

test('known muted config can capture while DDA and mismatched/future snapshots remain unavailable',async t=>{
  const f=fixture(t);add(f.project,'source.vgm');await turn();f.controls.setView(0,{notify:false});pauseAt(f,123,{muted:true});
  assert.equal(f.controls.getCapturePayload().capturable,true);assert.equal(f.controls.getCapturePayload().playable,false);assert.equal(f.nodes.CaptureButton.disabled,false);
  assert.equal(await f.controls.capture(),true);f.controls.setView(0,{notify:false});pauseAt(f,123,{dda:true});
  assert.equal(f.nodes.CaptureButton.disabled,true);assert.equal(await f.controls.capture(),false);assert.equal(f.captures.length,1);assert.match(f.nodes.CaptureStatus.textContent,/not a complete sample/);
  f.emit({positionFrames:124});assert.equal(f.controls.getPausedSelection(),null);assert.equal(f.nodes.CaptureButton.disabled,true);
});

test('Stop, view/frame/source changes, Resume and disposal invalidate asynchronous capture commits',async t=>{
  const cases=[
    f=>f.controls.stop(),f=>f.controls.setView(1,{notify:false}),f=>pauseAt(f,124),
    f=>{add(f.project,'other.vgm',2);return f.controls.selectPath('/vgm/other.vgm');},
    f=>f.nodes.PlayButton.fire('click'),f=>f.controls.dispose(),
  ];
  for(const change of cases){const gate=deferred();let current;
    const f=fixture(t,{onCapture:async(_payload,{isCurrent})=>{current=isCurrent;await gate.promise;return true;}});add(f.project,'source.vgm');await turn();f.controls.setView(0,{notify:false});pauseAt(f);
    const result=f.controls.capture();assert.equal(current(),true);assert.equal(f.nodes.CaptureButton.disabled,true);await change(f);assert.equal(current(),false);
    gate.resolve();assert.equal(await result,false);assert(!f.views.some(([target,detail])=>target==='synth'&&detail.reason==='capture'));
  }
});

test('a failed capture preserves the selected CH and Pause; Auto toggle at the same immutable snapshot does not cancel it',async t=>{
  const gate=deferred();let current;const f=fixture(t,{onCapture:async(_payload,{isCurrent})=>{current=isCurrent;await gate.promise;return false;}});
  add(f.project,'source.vgm');await turn();f.controls.setView(0,{notify:false});pauseAt(f);const result=f.controls.capture();
  f.controls.setLiveEnabled(false);assert(current());gate.resolve();assert.equal(await result,false);
  assert.equal(f.controls.read().viewTarget,0);assert(f.controls.read().paused);assert.equal(f.nodes.CaptureButton.disabled,false);assert.equal(f.controls.getPausedSelection().positionFrames,123);
});

test('an observed paused-position change cannot revive an old capture by returning to its earlier frame',async t=>{
  const gate=deferred();let current;const f=fixture(t,{onCapture:async(_payload,{isCurrent})=>{current=isCurrent;await gate.promise;return true;}});
  add(f.project,'source.vgm');await turn();f.controls.setView(0,{notify:false});pauseAt(f);const result=f.controls.capture();assert(current());
  pauseAt(f,124);assert.equal(current(),false);pauseAt(f,123);assert.equal(current(),false,'invalidated operation stays invalid');
  gate.resolve();assert.equal(await result,false);assert.equal(f.controls.read().viewTarget,0);
});

test('optional VGM channel buttons start On, retain keyboard focus behavior and change only passive mixer flags',async t=>{
  const f=fixture(t,{mixer:true}),project=f.project.snapshot();assert.equal(f.nodes.Channels.hidden,true);
  for(let ch=1;ch<=6;ch++){const button=f.nodes[`Channel${ch}Toggle`];assert.equal(button.textContent,`CH ${ch} · On`);assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(button.getAttribute('aria-label'),`VGM CH${ch} output On`);}
  let prevented=false;f.nodes.Channel3Toggle.fire('pointerdown',{button:0,preventDefault(){prevented=true;}});assert(prevented);
  f.nodes.Channel3Toggle.fire('click');assert(f.nodes.Channel3Toggle.blurred);assert.equal(f.nodes.Channel3Toggle.textContent,'CH 3 · Off');assert.equal(f.nodes.Channel3Toggle.getAttribute('aria-pressed'),'false');
  assert.equal(f.nodes.Player.dataset.channelMuteMask,'4');assert.deepEqual(f.calls,[['channel',2,false]]);assert.equal(f.audioRequests,0);assert.equal(f.beforeCalls,0);assert.deepEqual(f.project.snapshot(),project);
  const state=f.controls.setChannelEnabled(5,false);state.channelEnabled[0]=false;assert.equal(f.controls.read().channelEnabled[0],true);assert.equal(f.controls.read().channelMuteMask,36);
  assert.throws(()=>f.controls.setChannelEnabled(6,true),/CH1–CH6/);assert.throws(()=>f.controls.setChannelEnabled(0,1),/boolean/);
});

test('mixer changes preserve paused view, Auto update, exact capture binding and source frame',async t=>{
  const gate=deferred();let current;const f=fixture(t,{mixer:true,onCapture:async(_payload,{isCurrent})=>{current=isCurrent;await gate.promise;return false;}});
  add(f.project,'source.vgm');await turn();assert.equal(f.nodes.Channels.hidden,false);f.controls.setView(0,{notify:false});pauseAt(f);f.controls.setLiveEnabled(false);
  const selection=f.controls.getPausedSelection(),capturing=f.controls.capture(),before=f.controls.read();assert(current());
  f.nodes.Channel1Toggle.fire('click');f.nodes.Channel2Toggle.fire('click');assert(current());
  const after=f.controls.read();assert.equal(after.positionFrames,before.positionFrames);assert.equal(after.viewTarget,0);assert.equal(after.liveEnabled,false);assert.equal(after.capturing,true);assert.equal(f.controls.getPausedSelection(),selection);
  assert.equal(after.selectedPath,'/vgm/source.vgm');assert.equal(after.channelMuteMask,3);assert.equal(f.views.length,0);
  gate.resolve();assert.equal(await capturing,false);assert.equal(f.controls.read().viewTarget,0);assert.equal(f.controls.read().positionFrames,123);
});

test('latest mixer flags persist through cancelled validation, Stop, clear and a new accepted source',async t=>{
  const gate=deferred(),f=fixture(t,{mixer:true,load:async bytes=>{if(bytes[0]===2)await gate.promise;}});add(f.project,'one.vgm',1);await turn();
  f.controls.setChannelEnabled(3,false);add(f.project,'two.vgm',2);const selecting=f.controls.selectPath('/vgm/two.vgm');await turn();
  assert.equal(f.nodes.Channels.hidden,false,'a retained accepted source keeps the output controls available during validation');
  f.nodes.Channel6Toggle.fire('click');assert.equal(f.controls.read().channelMuteMask,40);f.controls.stop();gate.resolve();assert.equal(await selecting,false);
  assert.equal(f.controls.read().channelMuteMask,40);assert.equal(f.controls.read().selectedPath,'/vgm/one.vgm');
  f.project.fs.remove('/vgm/one.vgm');f.project.fs.remove('/vgm/two.vgm');await turn();assert.equal(f.nodes.Channels.hidden,true);assert.equal(f.controls.read().channelMuteMask,40);
  add(f.project,'new.vgm',3);await turn();assert.equal(f.controls.read().selectedPath,'/vgm/new.vgm');assert.equal(f.controls.read().channelMuteMask,40);
  assert.equal(f.nodes.Channel4Toggle.getAttribute('aria-pressed'),'false');assert.equal(f.nodes.Channel6Toggle.getAttribute('aria-pressed'),'false');assert.equal(f.nodes.Channels.hidden,false);assert.equal(f.audioRequests,0);
});

test('Seek drag previews precise position without moving audio and commits only on change',async t=>{
  const f=fixture(t,{seek:true});assert(f.nodes.Seek.disabled);add(f.project,'source.vgm');await turn();
  assert.equal(f.nodes.Seek.disabled,false);assert.equal(f.nodes.Seek.max,'2');
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.25';f.nodes.Seek.fire('input');assert.equal(f.nodes.SeekPosition.textContent,'0:01.25');
  assert(!f.calls.some(call=>call[0]==='seek'));f.emit({positionSeconds:.5,positionFrames:22050});assert.equal(f.nodes.Seek.value,'1.25');
  f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');await turn();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',1.25]]);assert(f.nodes.Seek.blurred);assert.equal(f.nodes.Seek.getAttribute('aria-valuetext'),'0:01.25 of 0:02.00');
});

test('Escape and pointer cancellation discard drafts; native keyboard changes remain usable',async t=>{
  const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.5';f.nodes.Seek.fire('input');let prevented=false,stopped=false;
  f.nodes.Seek.fire('keydown',{key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');
  assert(prevented&&stopped);assert.equal(f.nodes.Seek.value,'0');assert(!f.calls.some(call=>call[0]==='seek'));
  f.nodes.Seek.value='.4';f.nodes.Seek.fire('input');f.nodes.Seek.fire('keydown',{key:'ArrowRight'});f.nodes.Seek.fire('change');await turn();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',.4]]);assert(f.nodes.Seek.blurred);
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.9';f.nodes.Seek.fire('input');f.nodes.Seek.fire('pointercancel');f.nodes.Seek.fire('change');
  assert.equal(f.nodes.Seek.value,'0.4');assert.equal(f.calls.filter(call=>call[0]==='seek').length,1);
});

test('seeking publishes progress and retains CH, Auto and mixer controls without a paused capture',async t=>{
  const f=fixture(t,{seek:true,mixer:true});add(f.project,'source.vgm');await turn();f.controls.setView(0,{notify:false});pauseAt(f);
  f.emit({playback:'seeking',seeking:true,busy:true,paused:false,seekTargetSeconds:1.5,seekProgressSeconds:.25,positionSeconds:.1,positionFrames:4410});
  assert.equal(f.nodes.Player.dataset.seeking,'true');assert.equal(f.nodes.Player.dataset.seekTargetSeconds,'1.5');assert.equal(f.nodes.Player.dataset.seekProgressSeconds,'0.25');
  assert.equal(f.nodes.PlayButton.textContent,'Seeking…');assert(f.nodes.PlayButton.disabled);assert(!f.nodes.StopButton.disabled);assert.equal(f.nodes.CancelSeek.hidden,false);assert(f.controls.isActive());
  assert.match(f.nodes.Status.textContent,/0:01.50.*0:00.25 prepared/);assert.equal(f.nodes.SeekPosition.textContent,'0:01.50');assert.equal(f.nodes.CaptureButton.disabled,true);assert.equal(f.controls.getPausedSelection(),null);
  f.controls.setView(2,{notify:false});f.controls.setLiveEnabled(false);f.nodes.Channel4Toggle.fire('click');
  assert.equal(f.controls.read().viewTarget,2);assert.equal(f.controls.read().liveEnabled,false);assert.equal(f.controls.read().channelMuteMask,8);
  assert.equal(f.controls.read().positionFrames,4410);assert.equal(f.nodes.Channel4Toggle.disabled,undefined);
});

test('committing Seek immediately retires a pending Capture without changing the requested view',async t=>{
  const captureGate=deferred(),seekGate=deferred();let captureCurrent;
  const f=fixture(t,{seek:true,onCapture:async(_payload,{isCurrent})=>{captureCurrent=isCurrent;await captureGate.promise;return true;},seekWork:()=>seekGate.promise});
  add(f.project,'source.vgm');await turn();f.controls.setView(0,{notify:false});pauseAt(f);const capturing=f.controls.capture();assert(captureCurrent());
  const seeking=f.controls.seek(1);assert.equal(captureCurrent(),false);assert.equal(f.controls.read().capturing,false);assert.equal(f.controls.read().viewTarget,0);
  captureGate.resolve();assert.equal(await capturing,false);seekGate.resolve(true);assert.equal(await seeking,true);assert(!f.views.some(([target])=>target==='synth'));
});

test('Cancel awaits cleanup and Stop/source changes cannot commit an abandoned seek draft',async t=>{
  const gate=deferred(),f=fixture(t,{seek:true,cancelWork:()=>gate.promise});add(f.project,'source.vgm');await turn();
  f.emit({playback:'seeking',seeking:true,busy:true,seekPreparing:false,seekTargetSeconds:1});f.nodes.Seek.fire('pointercancel');await Promise.resolve();
  assert.equal(f.calls.at(-1)[0],'cancelSeek');f.emit({seeking:false,seekPreparing:true,canSeek:false});
  assert.equal(f.nodes.CancelSeek.hidden,false);assert.equal(f.nodes.CancelSeek.disabled,true);assert(f.nodes.Seek.disabled);assert.equal(f.nodes.PlayButton.textContent,'Cancelling…');assert(f.controls.isActive());
  assert.equal(await f.controls.seek(.5),false);gate.resolve();await turn();assert.equal(f.nodes.CancelSeek.hidden,true);
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.6';f.nodes.Seek.fire('input');f.controls.stop();f.nodes.Seek.fire('change');await turn();assert(!f.calls.some(call=>call[0]==='seek'));
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.8';f.nodes.Seek.fire('input');add(f.project,'other.vgm',2);await f.controls.selectPath('/vgm/other.vgm');f.nodes.Seek.fire('change');await turn();assert(!f.calls.some(call=>call[0]==='seek'));
  await f.controls.whenIdle();assert.equal(f.calls.at(-1)[0],'whenIdle');
});

test('seek errors stay readable and Escape/Cancel stop an active operation rather than creating a new one',async t=>{
  const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();
  f.emit({seeking:true,playback:'seeking',busy:true,seekTargetSeconds:1.25});f.nodes.Seek.fire('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});await turn();
  assert.equal(f.calls.filter(call=>call[0]==='cancelSeek').length,1);assert(!f.calls.some(call=>call[0]==='seek'));
  f.emit({seeking:true,playback:'seeking',busy:true});f.nodes.CancelSeek.fire('click');await turn();assert(f.nodes.CancelSeek.blurred);assert.equal(f.calls.filter(call=>call[0]==='cancelSeek').length,2);
  f.emit({seeking:false,busy:false,seekMessage:'Seek failed: invalid saved state.'});assert.equal(f.nodes.Status.dataset.error,'true');assert.match(f.nodes.Status.textContent,/invalid saved state/);
});

test('a held pointer cannot revive a cancelled seek draft after Escape, Cancel, Stop or a source change',async t=>{
  for(const action of ['escape','cancel','stop','source'])await t.test(action,async t=>{
    const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();
    f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.2';f.nodes.Seek.fire('input');
    if(action==='escape')f.nodes.Seek.fire('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});
    if(action==='cancel')await f.controls.cancelSeek();
    if(action==='stop')f.controls.stop();
    if(action==='source'){add(f.project,'other.vgm',2);await f.controls.selectPath('/vgm/other.vgm');}
    // The original drag is still physically held after cancellation. Its late
    // move/input and release/change belong to that discarded gesture.
    f.nodes.Seek.value='1.7';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');await turn();
    assert(!f.calls.some(call=>call[0]==='seek'),action);
    // A new pointerdown is a fresh user request and must remain usable.
    f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='.3';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');await turn();
    assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',.3]]);
  });
});

test('Cancel is acknowledged while an uncancellable factory is settling, with Stop and latest mixer flags still available',async t=>{
  const f=fixture(t,{seek:true,mixer:true});add(f.project,'source.vgm');await turn();
  f.emit({playback:'seeking',seeking:true,seekCancelling:true,seekPreparing:true,busy:true,seekTargetSeconds:1.5});
  assert.equal(f.nodes.Player.dataset.seekCancelling,'true');assert.equal(f.nodes.PlayButton.textContent,'Cancelling…');assert.equal(f.nodes.Status.textContent,'Cancelling seek…');
  assert.equal(f.nodes.CancelSeek.hidden,false);assert.equal(f.nodes.CancelSeek.disabled,true);assert(f.nodes.Seek.disabled);assert.equal(await f.controls.seek(.5),false);
  assert.equal(f.nodes.StopButton.disabled,false);f.nodes.Channel3Toggle.fire('click');assert.equal(f.controls.read().channelMuteMask,4);
  assert.equal(f.nodes.CaptureButton.disabled,true);assert.equal(f.controls.getPausedSelection(),null);assert(f.controls.isActive());
});

test('Home and End address exact transport boundaries despite a fractional range step, and fresh arrows remain usable',async t=>{
  const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();f.emit({durationSeconds:2.503});
  let prevented=0,stopped=0;const event=key=>({key,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  f.nodes.Seek.value='2.5';f.nodes.Seek.fire('keydown',event('End'));await turn();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',2.503]]);assert(f.nodes.Seek.blurred);
  f.nodes.Seek.fire('keydown',event('Home'));await turn();assert.deepEqual(f.calls.filter(call=>call[0]==='seek').at(-1),['seek',0]);
  assert.equal(prevented,2);assert.equal(stopped,2);
  f.nodes.Seek.fire('keydown',{key:'ArrowRight'});f.nodes.Seek.value='.01';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');await turn();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek').at(-1),['seek',.01]);
});

test('an exact End during a held drag cannot be reversed by that old gesture release',async t=>{
  const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();f.emit({durationSeconds:2.503});
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.1';f.nodes.Seek.fire('input');
  f.nodes.Seek.fire('keydown',{key:'End',preventDefault(){},stopPropagation(){}});await turn();
  f.nodes.Seek.value='1.7';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');await turn();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',2.503]]);
  f.nodes.Seek.fire('keydown',{key:'ArrowLeft'});f.nodes.Seek.value='2.49';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');await turn();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek').at(-1),['seek',2.49]);
});

const escapeEvent=(target={})=>({key:'Escape',target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}});
test('body-focused Escape cancels an unfocused native range drag without opening audio or committing its release',async t=>{
  const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.2';f.nodes.Seek.fire('input');
  const bodyEscape=escapeEvent();f.doc.fire('keydown',bodyEscape);assert(bodyEscape.defaultPrevented&&bodyEscape.stopped);
  f.nodes.Seek.value='1.7';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');await turn();
  assert(!f.calls.some(call=>call[0]==='seek'||call[0]==='cancelSeek'));assert.equal(f.audioRequests,0);assert.equal(f.beforeCalls,0);assert.equal(f.nodes.Seek.value,'0');
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='.3';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');await turn();assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',.3]]);
});

test('document Escape respects handled/text-control events and does not duplicate the range handler',async t=>{
  const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();f.emit({seeking:true,playback:'seeking',busy:true});
  const handled=escapeEvent();handled.defaultPrevented=true;f.doc.fire('keydown',handled);
  for(const kind of ['input','select','textarea','dialog']){
    const control={matches:()=>false,kind},event=escapeEvent({closest:()=>control});f.doc.fire('keydown',event);assert.equal(event.defaultPrevented,false);
  }
  assert(!f.calls.some(call=>call[0]==='cancelSeek'));
  const rangeEscape=escapeEvent(f.nodes.Seek);f.nodes.Seek.fire('keydown',rangeEscape);f.doc.fire('keydown',rangeEscape);await turn();
  assert.equal(f.calls.filter(call=>call[0]==='cancelSeek').length,1);
  f.emit({seeking:true,playback:'seeking',busy:true});const bodyEscape=escapeEvent();f.doc.fire('keydown',bodyEscape);await turn();assert(bodyEscape.defaultPrevented);assert.equal(f.calls.filter(call=>call[0]==='cancelSeek').length,2);
  f.controls.dispose();assert.equal(f.doc.listeners.has('keydown'),false);
});

test('synchronous native change on blur cannot turn range/body Escape or pointer cancellation into a seek',async t=>{
  for(const action of ['range Escape','body Escape','pointercancel'])await t.test(action,async t=>{
    const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();let blurs=0;
    f.nodes.Seek.onBlur=()=>{assert(++blurs<10,'ignored recursive changes must not blur again');f.nodes.Seek.fire('change');};
    f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.2';f.nodes.Seek.fire('input');
    if(action==='range Escape')f.nodes.Seek.fire('keydown',escapeEvent(f.nodes.Seek));
    if(action==='body Escape')f.doc.fire('keydown',escapeEvent());
    if(action==='pointercancel')f.nodes.Seek.fire('pointercancel');
    f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');await turn();
    assert(!f.calls.some(call=>call[0]==='seek'||call[0]==='cancelSeek'));assert.equal(f.audioRequests,0);assert.equal(f.nodes.Seek.value,'0');assert(blurs>=1);
  });
});

test('Home/End and a valid range change commit exactly once when blur synchronously emits another change',async t=>{
  for(const action of ['Home','End','change'])await t.test(action,async t=>{
    const f=fixture(t,{seek:true});add(f.project,'source.vgm');await turn();f.emit({durationSeconds:2.503});let blurs=0;
    f.nodes.Seek.onBlur=()=>{assert(++blurs<10);f.nodes.Seek.fire('change');};
    f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='1.2';f.nodes.Seek.fire('input');
    if(action==='change')f.nodes.Seek.fire('change');else f.nodes.Seek.fire('keydown',{key:action,preventDefault(){},stopPropagation(){}});
    f.nodes.Seek.fire('pointerup');await turn();
    assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',action==='Home'?0:action==='End'?2.503:1.2]]);
  });
});


test('Seek cache controls are passive and never change the paused view, capture ticket or channel output flags',async t=>{
  const f=fixture(t,{cache:true,mixer:true});assert(f.nodes.CacheEnabled.checked);assert.equal(f.audioRequests,0);
  f.nodes.CacheEnabled.checked=false;f.nodes.CacheEnabled.fire('change');assert(f.nodes.CacheEnabled.blurred);assert.deepEqual(f.calls,[['cache',false]]);
  assert.equal(f.audioRequests,0);assert.match(f.nodes.CacheStatus.textContent,/Cache Off/);
  add(f.project,'source.vgm');await turn();f.controls.setView(0,{notify:false});pauseAt(f);const selected=f.controls.getPausedSelection();
  f.emit({seekCache:{enabled:true,available:true,count:3,bytes:2048,hits:2,restoredFrame:44100,reconstructedFrames:100},sampleRate:44100});
  assert.equal(f.nodes.Player.dataset.cacheCount,'3');assert.equal(f.nodes.Player.dataset.cacheRestoredFrame,'44100');assert.equal(f.nodes.Player.dataset.cacheReconstructedFrames,'100');
  f.nodes.ClearCache.fire('click');assert(f.nodes.ClearCache.blurred);assert.equal(f.nodes.Player.dataset.cacheCount,'0');
  assert.equal(f.controls.getPausedSelection(),selected);assert.deepEqual(f.controls.read().channelEnabled,Array(6).fill(true));assert.equal(f.controls.read().paused,true);
  assert.equal(f.audioRequests,0);assert.throws(()=>f.controls.setCacheEnabled('true'),/boolean/);
});

test('playing-song manual controls forward exact epochs without audio acquisition, source changes or capture invalidation',async t=>{
  const f=fixture(t);add(f.project,'song.vgm');await turn();
  f.emit({playback:'playing',playing:true,paused:false,manualReady:true,manualEpoch:12,manualTainted:false,manualHeldCount:1,manualLastFrame:2048});
  const before=f.project.snapshot(),path=f.controls.read().selectedPath;f.calls.length=0;
  assert.equal(f.controls.getManualSelection(0).playable,true);
  assert.match(f.controls.getManualSelection(3).reason,/DDA/);
  assert.equal(f.controls.applyEdit({channel:0,changes:{volume:10}},{epoch:12}),true);
  assert.deepEqual(f.controls.noteOn('hand',64,0,{epoch:12}),{channel:0});
  assert.equal(f.controls.setPitch(.5,{epoch:12}),true);assert.equal(f.controls.noteOff('hand',{epoch:12}),true);
  assert.equal(f.controls.releaseKeyboard({epoch:12}),true);
  assert.deepEqual(f.calls,[['manualSelection',0],['manualSelection',3],['manualEdit',{channel:0,changes:{volume:10}},{epoch:12}],['manualOn','hand',64,0,{epoch:12}],['manualPitch',.5,{epoch:12}],['manualOff','hand',{epoch:12}],['manualRelease',{epoch:12}]]);
  assert.equal(f.audioRequests,0);assert.equal(f.beforeCalls,0);assert.equal(f.controls.read().selectedPath,path);assert.deepEqual(f.project.snapshot(),before);
  assert.equal(f.nodes.Player.dataset.manualReady,'true');assert.equal(f.nodes.Player.dataset.manualEpoch,'12');assert.equal(f.nodes.Player.dataset.manualHeldCount,'1');assert.equal(f.nodes.Player.dataset.manualLastFrame,'2048');
});

test('stale or unavailable manual controls cannot reach a new song or a paused/starting/seeking run',async t=>{
  const f=fixture(t);add(f.project,'song.vgm');await turn();
  const edit={channel:0,changes:{volume:10}};
  for(const patch of [
    {playing:true,playback:'playing',manualReady:true,manualEpoch:2},
    {playing:false,paused:true,playback:'paused',manualReady:false,manualEpoch:3},
    {playing:false,paused:false,playback:'starting',busy:true,manualReady:false,manualEpoch:3},
    {playing:false,playback:'seeking',busy:true,seeking:true,manualReady:false,manualEpoch:3},
  ]){
    f.emit({busy:false,seeking:false,paused:false,...patch});f.calls.length=0;
    assert.equal(f.controls.applyEdit(edit,{epoch:1}),false);assert.equal(f.controls.noteOn('old',60,0,{epoch:1}),false);assert.equal(f.controls.setPitch(0,{epoch:1}),false);assert.equal(f.controls.noteOff('old',{epoch:1}),false);assert.equal(f.controls.releaseKeyboard({epoch:1}),false);
    assert.equal(f.calls.length,0);
  }
  f.emit({playback:'paused',playing:false,paused:true,busy:false,seeking:false,manualEpoch:4});f.calls.length=0;
  assert.equal(f.controls.getManualSelection(0).available,false);assert.equal(f.controls.applyEdit(edit,{epoch:4}),false);
  assert.equal(f.controls.releaseKeyboard({epoch:4}),true,'current paused cleanup is allowed');
  assert.deepEqual(f.calls,[['manualRelease',{epoch:4}]]);
});

test('accepted-song keyup still reaches its owner while replacement source validation is pending or fails',async t=>{
  const gate=deferred(),f=fixture(t,{load:async bytes=>{if(bytes[0]===2){await gate.promise;throw Error('Invalid replacement');}}});
  add(f.project,'accepted.vgm',1);await turn();f.emit({playing:true,playback:'playing',manualReady:true,manualEpoch:12});
  add(f.project,'pending.vgm',2);const choosing=f.controls.selectPath('/vgm/pending.vgm');await turn();f.calls.length=0;
  assert.equal(f.controls.noteOn('new',60,0,{epoch:12}),false);
  assert.equal(f.controls.noteOff('accepted-key',{epoch:12}),true);assert.equal(f.controls.releaseKeyboard({epoch:12}),true);
  assert.deepEqual(f.calls,[['manualOff','accepted-key',{epoch:12}],['manualRelease',{epoch:12}]]);
  gate.resolve();assert.equal(await choosing,false);assert.equal(f.controls.read().selectedPath,'/vgm/accepted.vgm');assert(f.controls.isPlaying());
});
