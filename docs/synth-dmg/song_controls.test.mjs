import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGameboySongControls} from './song_controls.js';
import {createGameboyCodeProject} from './code_project.js';

class Element {
  constructor(){this.listeners=new Map();this.children=[];this.dataset={};this.value='';this.checked=true;this.textContent='';}
  addEventListener(type,fn){this.listeners.set(type,fn);} removeEventListener(type){this.listeners.delete(type);}
  replaceChildren(...nodes){this.children=nodes;} blur(){this.blurred=true;}
  fire(type){return this.listeners.get(type)?.({});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{project=createGameboyCodeProject(),load}={}){
  const ids=['Player','Select','PlayButton','StopButton','Status','LiveEnabled','ChannelSelect','LiveStatus','Position'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));nodes.ChannelSelect.value='0';
  const doc={getElementById:id=>nodes[id.slice('dmgSong'.length)],createElement:()=>new Element()};
  const calls=[],states=[],liveViews=[];let notify;
  let state={playback:'stopped',loading:false,busy:false,hasSource:false,playing:false,paused:false,positionFrames:0,positionSeconds:0,durationSeconds:1,liveEnabled:true,liveVoice:0,liveState:null};
  const emit=patch=>{state={...state,...patch};notify?.(state);};
  const preview={read:()=>({...state}),setLiveEnabled:value=>emit({liveEnabled:value}),setLiveVoice:value=>emit({liveVoice:value}),
    async load(bytes,name){calls.push(['load',name,bytes.slice()]);emit({loading:true});if(load)await load(bytes,name);emit({loading:false,hasSource:true,name,playback:'stopped',playing:false,paused:false});return true;},
    clear(){calls.push(['clear']);emit({hasSource:false,liveState:null,playback:'stopped'});},
    async play(){calls.push(['play']);emit({playback:'playing',playing:true,paused:false,liveActive:true,liveState:{channels:[{id:1},{id:2},{id:3},{id:4}]}});},
    pause(){calls.push(['pause']);emit({playback:'paused',playing:false,paused:true});},async resume(){calls.push(['resume']);emit({playback:'playing',playing:true,paused:false});},
    stop(){calls.push(['stop']);emit({playback:'stopped',playing:false,paused:false,loading:false,liveActive:false,liveState:null});},dispose(){calls.push(['dispose']);}};
  const controls=setupGameboySongControls({project,document:doc,getAudio:()=>assert.fail('Passive controls must not acquire audio'),beforePlay:()=>assert.fail('Mock owns explicit Play'),
    onState:value=>states.push(value),onLiveView:value=>liveViews.push(value),createPreview:options=>{notify=options.onState;return preview;}});
  t.after(()=>controls.dispose());return{controls,project,nodes,calls,states,liveViews,emit};
}

test('DMG song list validates raw Files without audio, Code-mode changes or repeated binary reads',async t=>{
  const project=createGameboyCodeProject({starterCode:'kept'});project.setCodeState({mode:'code',path:'/index.js'});
  project.importSongSources([{name:'one.VGZ',bytes:Uint8Array.of(1,2,255)}]);
  const f=fixture(t,{project});await tick();assert.deepEqual(f.calls,[['load','one.VGZ',Uint8Array.of(1,2,255)]]);
  assert.equal(f.nodes.PlayButton.textContent,'Play');assert.equal(f.controls.getState().selectedPath,'/vgm/one.VGZ');
  let reads=0;const get=project.fs.get.bind(project.fs);project.fs.get=path=>{if(path.startsWith('/vgm/'))reads++;return get(path);};
  project.select('/index.js');project.setCodeState({mode:'keyboard',path:'/index.js'});await tick();assert.equal(reads,0);
  assert.equal(f.calls.length,1);assert.equal(project.fs.get('/index.js').data,'kept');
});

test('DMG explicit Play/Pause/Resume and frozen Live channel selection retain the same source',async t=>{
  const f=fixture(t);f.project.importSongSources([{name:'song.vgm',bytes:Uint8Array.of(1)}]);await tick();
  await f.nodes.PlayButton.fire('click');assert.equal(f.nodes.PlayButton.textContent,'Pause');assert(f.controls.isPlaying());
  const frozen=f.controls.getState().liveState;f.nodes.LiveEnabled.checked=false;f.nodes.LiveEnabled.fire('change');
  f.nodes.ChannelSelect.value='3';f.nodes.ChannelSelect.fire('change');assert.equal(f.controls.getState().liveVoice,3);assert.equal(f.controls.getState().liveState,frozen);
  assert.match(f.nodes.LiveStatus.textContent,/Frozen CH4.*read-only/);
  f.nodes.PlayButton.fire('click');assert.equal(f.nodes.PlayButton.textContent,'Resume');assert(f.controls.isActive());
  await f.nodes.PlayButton.fire('click');assert.equal(f.nodes.PlayButton.textContent,'Pause');
  f.nodes.StopButton.fire('click');assert.equal(f.controls.getState().liveState,null);assert(!f.controls.isActive());
  assert.deepEqual(f.calls.filter(call=>call[0]!=='load'),[['play'],['pause'],['resume'],['stop']]);
});

test('DMG invalid source selection keeps the prior song and later valid revision is selectable',async t=>{
  const f=fixture(t,{load:async bytes=>{if(bytes[0]===0)throw Error('Unsupported source. Current song kept.');}});
  f.project.importSongSources([{name:'good.vgm',bytes:Uint8Array.of(1)}]);await tick();
  f.project.importSongSources([{name:'bad.vgm',bytes:Uint8Array.of(0)}]);
  assert.equal(await f.controls.selectPath('/vgm/bad.vgm'),false);assert.equal(f.controls.getState().selectedPath,'/vgm/good.vgm');
  assert.equal(f.nodes.Select.value,'/vgm/good.vgm');assert.match(f.nodes.Status.textContent,/Unsupported/);
  const attempts=f.calls.length;f.project.select(null);await tick();assert.equal(f.calls.length,attempts);
  f.project.importFiles([{path:'/vgm/bad.vgm',type:'binary',data:Uint8Array.of(2)}]);
  assert.equal(await f.controls.selectPath('/vgm/bad.vgm'),true);assert.equal(f.controls.getState().selectedPath,'/vgm/bad.vgm');
});

test('DMG late selection/disposal cannot publish a superseded song selection',async t=>{
  let resolve;const gate=new Promise(r=>resolve=r),f=fixture(t,{load:async bytes=>{if(bytes[0]===1)await gate;}});
  f.project.importSongSources([{name:'slow.vgm',bytes:Uint8Array.of(1)},{name:'fast.vgm',bytes:Uint8Array.of(2)}]);
  const slow=f.controls.selectPath('/vgm/slow.vgm');await Promise.resolve();assert.equal(await f.controls.selectPath('/vgm/fast.vgm'),true);
  resolve();await slow;assert.equal(f.controls.getState().selectedPath,'/vgm/fast.vgm');
  f.controls.dispose();const count=f.states.length;f.emit({playback:'playing'});assert.equal(f.states.length,count);
});

test('DMG Stop cancels a validating source without an error or a late selector commit',async t=>{
  let reject;const gate=new Promise((_resolve,rejecter)=>reject=rejecter),f=fixture(t,{load:()=>gate});
  f.project.importSongSources([{name:'slow.vgm',bytes:Uint8Array.of(1)}]);await Promise.resolve();
  assert.equal(f.nodes.StopButton.disabled,false);f.nodes.StopButton.fire('click');
  reject(new DOMException('Cancelled','AbortError'));await tick();
  assert.equal(f.controls.getState().selectedPath,null);assert.equal(f.nodes.Select.value,'');assert.equal(f.nodes.Status.dataset.error,'false');
  assert(!f.nodes.Status.textContent.includes('Cancelled'));
});

test('DMG ended view returns to the author even if the preview retains its final snapshot',async t=>{
  const f=fixture(t);f.project.importSongSources([{name:'end.vgm',bytes:Uint8Array.of(1)}]);await tick();
  await f.nodes.PlayButton.fire('click');f.emit({playback:'ended',playing:false,liveActive:false});
  assert.equal(f.nodes.Player.dataset.live,'false');assert.equal(f.nodes.Status.textContent,'Finished.');
  assert(!f.nodes.LiveStatus.textContent.includes('Stop VGM'));
});
