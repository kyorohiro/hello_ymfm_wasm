// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHuc6280SongControls} from './song_controls.js';
import {createHuc6280CodeProject} from './code_project.js';
import {transferVirtualFiles} from '../js/tetorica_virtual_files/filesystem.js';
import {createHuc6280RegisterState} from './song_state.js';
import {wave} from './song_test_helpers.mjs';

class Element{
  constructor(){this.listeners=new Map();this.children=[];this.dataset={};this.value='';this.textContent='';}
  addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}
  replaceChildren(...nodes){this.children=nodes;}blur(){this.blurred=true;}fire(type){return this.listeners.get(type)?.({});}
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const add=(project,name,value=1)=>project.importFiles([{path:'/vgm/'+name,type:'binary',data:Uint8Array.of(value)}]);
function fixture(t,{project=createHuc6280CodeProject({starterCode:'// kept'}),load,onCapture}={}){
  const ids=['Player','Select','PlayButton','StopButton','Status','Position','CaptureButton','CaptureStatus'],nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const doc={getElementById:id=>nodes[id.slice('hucSong'.length)],createElement:()=>new Element()},calls=[],states=[],statuses=[],views=[],captures=[];
  let notify,generation=0,audioRequests=0,beforeCalls=0;
  let state={playback:'stopped',hasSource:false,playing:false,paused:false,loading:false,busy:false,positionFrames:0,positionSeconds:0,bufferedFrames:0,durationSeconds:2};
  const emit=patch=>{state={...state,...patch};notify?.({...state});};
  const preview={getState:()=>({...state}),
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
    dispose(){generation++;calls.push(['dispose']);},
  };
  let options;
  const controls=setupHuc6280SongControls({project,document:doc,getAudio:async()=>{audioRequests++;return{};},beforePlay:async()=>{beforeCalls++;},onState:value=>states.push(value),onStatus:value=>statuses.push(value),
    onCapture:async(payload,options)=>{captures.push({payload,options});return onCapture?onCapture(payload,options):true;},onViewChange:(target,options)=>views.push([target,options]),
    createPreview:value=>{options=value;notify=value.onState;return preview;}});
  t.after(()=>controls.dispose());
  return{controls,project,nodes,calls,states,statuses,views,captures,emit,get audioRequests(){return audioRequests;},get beforeCalls(){return beforeCalls;}};
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
