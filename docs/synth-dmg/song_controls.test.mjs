import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGameboySongControls} from './song_controls.js';
import {createGameboyCodeProject} from './code_project.js';

class Element {
  constructor(){this.listeners=new Map();this.children=[];this.dataset={};this.attributes={};this.value='';this.checked=true;this.textContent='';}
  addEventListener(type,fn){this.listeners.set(type,fn);} removeEventListener(type){this.listeners.delete(type);}
  replaceChildren(...nodes){this.children=nodes;} blur(){this.blurred=true;}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  fire(type,event={}){return this.listeners.get(type)?.(event);}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{project=createGameboyCodeProject(),load,onCapture,controlsOptions={},omit=[]}={}){
  const ids=['Player','Select','PlayButton','StopButton','Status','LiveEnabled','ChannelSelect','LiveStatus','Position','CaptureButton','Seek','SeekPosition','Channel1Toggle','Channel2Toggle','Channel3Toggle','Channel4Toggle'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));nodes.ChannelSelect.value='0';
  for(const id of omit)delete nodes[id];
  const doc={getElementById:id=>nodes[id.slice('dmgSong'.length)],createElement:()=>new Element()};
  const calls=[],states=[],liveViews=[];let notify;
  let state={playback:'stopped',loading:false,busy:false,hasSource:false,playing:false,paused:false,positionFrames:0,positionSeconds:0,durationSeconds:1,liveEnabled:true,liveVoice:0,liveState:null,channelEnabled:[true,true,true,true]};
  const emit=patch=>{state={...state,...patch};notify?.(state);};
  const preview={read:()=>({...state,channelEnabled:state.channelEnabled.slice()}),setLiveEnabled:value=>emit({liveEnabled:value}),setLiveVoice:value=>{if(value!==state.liveVoice)emit({liveVoice:value});return state;},
    setChannelEnabled(channel,enabled){calls.push(['channel',channel,enabled]);const channels=state.channelEnabled.slice();channels[channel]=enabled;emit({channelEnabled:channels});},
    async load(bytes,name){calls.push(['load',name,bytes.slice()]);emit({loading:true});if(load)await load(bytes,name);emit({loading:false,hasSource:true,name,playback:'stopped',playing:false,paused:false});return true;},
    clear(){calls.push(['clear']);emit({hasSource:false,liveState:null,playback:'stopped'});},
    async play(){calls.push(['play']);emit({playback:'playing',playing:true,paused:false,liveActive:true,liveState:{channels:[{id:1},{id:2},{id:3},{id:4}]}});},
    pause(){calls.push(['pause']);emit({playback:'paused',playing:false,paused:true});},async resume(){calls.push(['resume']);emit({playback:'playing',playing:true,paused:false});},
    async seek(seconds){calls.push(['seek',seconds]);emit({positionSeconds:seconds,positionFrames:Math.round(seconds*44100),playback:state.playing?'playing':'paused',paused:!state.playing,seeking:false});return true;},
    async cancelSeek(){calls.push(['cancelSeek']);emit({seeking:false,busy:false,playback:'paused',paused:true});return true;},
    whenIdle:async()=>{calls.push(['whenIdle']);},
    stop(){calls.push(['stop']);emit({playback:'stopped',playing:false,paused:false,loading:false,liveActive:false,liveState:null});},dispose(){calls.push(['dispose']);}};
  const controls=setupGameboySongControls({project,document:doc,getAudio:()=>assert.fail('Passive controls must not acquire audio'),beforePlay:()=>assert.fail('Mock owns explicit Play'),
    onState:value=>states.push(value),onLiveView:value=>liveViews.push(value),onCapture,createPreview:options=>{notify=options.onState;return preview;},...controlsOptions});
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

test('DMG seek previews a drag without moving playback and commits only its change event',async t=>{
  const f=fixture(t);assert(f.nodes.Seek.disabled);
  f.project.importSongSources([{name:'song.vgm',bytes:Uint8Array.of(1)}]);await tick();
  assert.equal(f.nodes.Seek.disabled,false);assert.equal(f.nodes.Seek.max,'1');
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='0.75';f.nodes.Seek.fire('input');
  assert.equal(f.nodes.SeekPosition.textContent,'0:00.75');assert(!f.calls.some(call=>call[0]==='seek'));
  f.emit({positionSeconds:.2,positionFrames:8820});assert.equal(f.nodes.Seek.value,'0.75','transport updates cannot move a held draft');
  f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');await tick();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',.75]]);
  assert.equal(f.controls.getState().positionFrames,33075);assert(f.controls.getState().paused);
  assert(f.nodes.Seek.blurred);assert.equal(f.nodes.SeekPosition.textContent,'0:00.75');
});

test('DMG seek state exposes progress, prevents trial/Capture, and keeps Stop and a newer seek available',async t=>{
  const f=fixture(t);f.project.importSongSources([{name:'song.vgm',bytes:Uint8Array.of(1)}]);await tick();
  f.emit({playback:'seeking',seeking:true,busy:true,canSeek:true,seekTargetSeconds:.8,seekProgressSeconds:.3,positionSeconds:.1,positionFrames:4410});
  assert.equal(f.nodes.Player.dataset.seeking,'true');assert.equal(f.nodes.Player.dataset.positionFrames,'4410');
  assert.equal(f.nodes.Seek.value,'0.8');assert.equal(f.nodes.Seek.disabled,false);assert.equal(f.nodes.PlayButton.disabled,true);
  assert.equal(f.nodes.StopButton.disabled,false);assert.equal(f.nodes.CaptureButton.disabled,true);
  assert.equal(f.nodes.ChannelSelect.disabled,true);assert.match(f.nodes.Status.textContent,/0:00.80.*0:00.30/);
  f.nodes.Seek.value='0.4';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');await tick();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',.4]]);
  f.emit({seekPreparing:true,busy:true});assert(f.nodes.Seek.disabled);assert.equal(await f.controls.seek(.6),false);
  f.controls.stop();assert.equal(f.nodes.Player.dataset.seekPreparing,'true','Stop keeps the host cleanup fence visible');
  await f.controls.whenIdle();assert(f.calls.some(call=>call[0]==='whenIdle'));
});

test('DMG Escape/pointer cancellation discard a draft; keyboard changes remain usable afterwards',async t=>{
  const f=fixture(t);f.project.importSongSources([{name:'song.vgm',bytes:Uint8Array.of(1)}]);await tick();
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='.9';f.nodes.Seek.fire('input');
  let prevented=false,stopped=false;
  f.nodes.Seek.fire('keydown',{key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  f.nodes.Seek.fire('change');f.nodes.Seek.fire('pointerup');
  assert(prevented&&stopped);assert.equal(f.nodes.Seek.value,'0');assert(!f.calls.some(call=>call[0]==='seek'));
  f.nodes.Seek.value='.25';f.nodes.Seek.fire('input');f.nodes.Seek.fire('change');await tick();
  assert.deepEqual(f.calls.filter(call=>call[0]==='seek'),[['seek',.25]]);
  f.nodes.Seek.fire('pointerdown');f.nodes.Seek.value='.9';f.nodes.Seek.fire('input');f.nodes.Seek.fire('pointercancel');f.nodes.Seek.fire('change');
  assert.equal(f.nodes.Seek.value,'0.25');assert.equal(f.calls.filter(call=>call[0]==='seek').length,1);
  f.emit({playback:'seeking',seeking:true,paused:false,canSeek:true,busy:true});
  f.nodes.Seek.fire('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});await tick();
  assert(f.calls.some(call=>call[0]==='cancelSeek'));assert.equal(f.nodes.Player.dataset.seeking,'false');
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

function pausedSnapshot(frame=4410){
  const registers=Array(48).fill(0),voice=Array(48).fill(0);registers[22]=128;registers[21]=255;
  voice[2]=0x93;voice[7]=0xb2;voice[10]=128;voice[12]=0x20;voice[17]=0x91;voice[18]=0x5d;
  return {clock:4194304,positionFrames:frame,registers,voice};
}

test('DMG song channel switches are passive before loading and expose readable On/Off and keyboard state',async t=>{
  const f=fixture(t);
  for(let ch=1;ch<=4;ch++){
    const button=f.nodes[`Channel${ch}Toggle`];assert.equal(button.getAttribute('aria-pressed'),'true');assert.match(button.textContent,/On$/);
  }
  let prevented=false;f.nodes.Channel3Toggle.fire('pointerdown',{button:0,preventDefault(){prevented=true;}});assert(prevented);
  f.nodes.Channel3Toggle.fire('click',{detail:0});
  assert.equal(f.nodes.Channel3Toggle.getAttribute('aria-pressed'),'false');assert.match(f.nodes.Channel3Toggle.textContent,/CH3.*Wave.*Off$/);
  assert.equal(f.nodes.Channel3Toggle.blurred,undefined,'keyboard activation keeps the switch focus for another toggle');
  assert.equal(f.nodes.Player.dataset.channelMuteMask,'4');
  f.nodes.Channel3Toggle.fire('click',{detail:1});assert.equal(f.nodes.Player.dataset.channelMuteMask,'0');assert(f.nodes.Channel3Toggle.blurred);
  assert.deepEqual(f.calls,[['channel',2,false],['channel',2,true]]);assert.equal(f.controls.getState().hasSource,false);
});

test('DMG playback channel switches preserve transport and frozen CH selection across Stop/source changes',async t=>{
  const f=fixture(t);f.project.importSongSources([{name:'one.vgm',bytes:Uint8Array.of(1)}]);await tick();
  const snapshot=pausedSnapshot(8820);f.emit({playback:'playing',playing:true,paused:false,liveActive:true,liveState:snapshot,liveEnabled:false,liveVoice:2,positionFrames:8820,positionSeconds:.2});
  f.nodes.Channel1Toggle.fire('click');f.nodes.Channel4Toggle.fire('click');
  let state=f.controls.getState();assert.equal(state.playback,'playing');assert.equal(state.positionFrames,8820);assert.equal(state.liveState,snapshot);assert.equal(state.liveEnabled,false);assert.equal(state.liveVoice,2);
  assert.deepEqual(state.channelEnabled,[false,true,true,false]);assert.equal(f.nodes.ChannelSelect.value,'2');
  f.controls.stop();f.project.importSongSources([{name:'two.vgm',bytes:Uint8Array.of(2)}]);await tick();
  state=f.controls.getState();assert.equal(state.playback,'stopped');assert.deepEqual(state.channelEnabled,[false,true,true,false]);assert.equal(f.nodes.Player.dataset.channelMuteMask,'9');
  assert(!f.calls.some(call=>['seek','play','pause','resume'].includes(call[0])));
});

test('DMG software-muted channels remain capturable and mute does not cancel an in-flight Capture',async t=>{
  let finish,guard,captured;const wait=new Promise(resolve=>finish=resolve);
  const f=fixture(t,{onCapture:async(value,{isCurrent})=>{captured=value;guard=isCurrent;await wait;return true;}});
  f.project.importSongSources([{name:'capture.vgm',bytes:Uint8Array.of(1)}]);await tick();
  const snapshot=pausedSnapshot();f.emit({playback:'paused',paused:true,playing:false,liveActive:true,liveState:snapshot,liveVoice:2,positionFrames:4410});
  const original=f.controls.getCapturePayload();assert(original.playable);
  f.nodes.Channel3Toggle.fire('click');assert.equal(f.nodes.CaptureButton.disabled,false);
  assert.deepEqual(f.controls.getCapturePayload(),original,'software mute is not written into the captured registers/preset');
  const pending=f.controls.capture();assert(guard());f.nodes.Channel1Toggle.fire('click');assert(guard());
  finish();assert.equal(await pending,true);assert.deepEqual(captured,original);
  assert.equal(f.controls.getState().view,'synth');assert.deepEqual(f.controls.getState().channelEnabled,[false,true,false,true]);assert.equal(f.controls.getState().positionFrames,4410);
});

test('DMG Capture changes only the view, preserving paused frame, all channels, Live Off and selected physical CH',async t=>{
  const calls=[],f=fixture(t,{onCapture:async(payload,{isCurrent})=>{assert(isCurrent());calls.push(payload);return {path:'/presets/captured.dmg.json'};}});
  f.project.importSongSources([{name:'capture.vgm',bytes:Uint8Array.of(1)}]);await tick();
  const snapshot=pausedSnapshot();f.emit({playback:'paused',paused:true,playing:false,liveActive:true,liveState:snapshot,liveVoice:2,liveEnabled:false,positionFrames:4410,positionSeconds:.1});
  assert.equal(f.nodes.CaptureButton.disabled,false);assert.equal(await f.controls.capture(),true);
  const state=f.controls.getState();assert.equal(state.view,'synth');assert.equal(state.viewTarget,'synth');assert.equal(state.liveVoice,2);assert.equal(state.liveEnabled,false);assert.equal(state.positionFrames,4410);assert.equal(state.liveState,snapshot);
  assert.equal(calls[0].preset.source,'wave');assert.equal(calls[0].source.path,'/vgm/capture.vgm');
  assert.equal(calls[0].snapshot.positionFrames,4410);assert.notEqual(calls[0].snapshot,snapshot);
  assert.equal(f.nodes.ChannelSelect.value,'synth');assert.equal(f.nodes.CaptureButton.disabled,true);
  f.controls.setView(1);assert.equal(f.controls.getState().view,'song');assert.equal(f.controls.getState().liveVoice,1);assert.equal(f.controls.getState().liveState,snapshot);
  assert.equal(f.controls.getCapturePayload().preset.source,'pulse');assert.equal(f.controls.getCapturePayload().preset.pulse.sweep.enabled,false);
  assert(!f.calls.some(call=>['stop','play','pause','resume'].includes(call[0])));
});

test('DMG Capture requires the exact Pause snapshot and late completion cannot change a new CH/view',async t=>{
  let finish,valid;const pending=new Promise(resolve=>finish=resolve),f=fixture(t,{onCapture:async(_payload,{isCurrent})=>{valid=isCurrent;await pending;return true;}});
  f.project.importSongSources([{name:'capture.vgm',bytes:Uint8Array.of(1)}]);await tick();
  f.emit({playback:'paused',paused:true,liveActive:true,liveState:pausedSnapshot(0),positionFrames:4410});assert.equal(f.controls.getCapturePayload(),null);assert.equal(f.nodes.CaptureButton.disabled,true);
  f.emit({liveState:pausedSnapshot(4410)});const capture=f.controls.capture();assert.equal(f.controls.getState().capturing,true);
  f.controls.setView(3);assert.equal(valid(),false);finish();assert.equal(await capture,false);
  assert.equal(f.controls.getState().view,'song');assert.equal(f.controls.getState().liveVoice,3);assert.equal(f.controls.getState().capturing,false);
});

test('DMG Capture → Synth → same physical CH repaints the song view even without a transport emission',async t=>{
  const f=fixture(t,{onCapture:async()=>true});f.project.importSongSources([{name:'same.vgm',bytes:Uint8Array.of(1)}]);await tick();
  f.emit({playback:'paused',paused:true,liveActive:true,liveVoice:2,liveState:pausedSnapshot(),positionFrames:4410});
  assert.equal(await f.controls.capture(),true);assert.equal(f.nodes.Player.dataset.view,'synth');
  const notifications=f.liveViews.length;f.controls.setView('2');
  assert.equal(f.nodes.Player.dataset.view,'song');assert.equal(f.nodes.ChannelSelect.value,'2');
  assert.equal(f.liveViews.length,notifications+1);assert.equal(f.liveViews.at(-1).view,'song');assert.equal(f.liveViews.at(-1).liveVoice,2);
  assert.equal(f.liveViews.at(-1).positionFrames,4410);assert.equal(f.nodes.CaptureButton.disabled,false);
});

test('API-only VGM view/Live integration needs no legacy selector mounts and cannot move the song or change Code settings',async t=>{
  const changes=[],project=createGameboyCodeProject({starterCode:'const retained = context;'});project.setCodeState({mode:'code',path:'/index.js'});
  const f=fixture(t,{project,omit:['ChannelSelect','LiveEnabled','LiveStatus'],controlsOptions:{channelElement:null,liveElement:null,initialView:'synth',initialLiveEnabled:false,onViewChange:(target,meta)=>changes.push([target,meta.reason])}});
  assert.equal(f.controls.getState().viewTarget,'synth');assert.equal(f.controls.getState().liveEnabled,false);assert.deepEqual(f.calls,[]);
  project.importSongSources([{name:'unified.vgm',bytes:Uint8Array.of(1,2,3)}]);await tick();
  const source=project.fs.get('/vgm/unified.vgm').data.slice(),code=project.getCodeState(),snapshot=pausedSnapshot(8820);
  f.emit({playback:'paused',paused:true,playing:false,liveActive:true,liveState:snapshot,positionFrames:8820,positionSeconds:.2});
  f.controls.setView(2,{notify:false});f.controls.setLiveEnabled(true);f.controls.setView('synth',{notify:false});f.controls.setLiveEnabled(false);f.controls.setView(2,{notify:false});
  const state=f.controls.getState();assert.equal(state.viewTarget,2);assert.equal(state.liveVoice,2);assert.equal(state.liveState,snapshot);assert.equal(state.positionFrames,8820);assert.equal(state.playback,'paused');
  assert.deepEqual(changes,[],'root-driven synchronization cannot loop through view callbacks');assert.deepEqual(project.getCodeState(),code);assert.deepEqual(project.fs.get('/vgm/unified.vgm').data,source);
  assert(!f.calls.some(([method])=>['play','pause','resume','stop','seek'].includes(method)));
  f.controls.setView(3);assert.deepEqual(changes,[[3,'api']]);f.emit({positionFrames:8820});assert.equal(changes.length,1,'ordinary renderer state updates do not change the application target');
});

test('Capture notifies the shared selector once after publishing Synth, retaining exact Pause, Live and remembered CH',async t=>{
  let f;const changes=[];
  f=fixture(t,{omit:['ChannelSelect','LiveEnabled'],onCapture:async()=>true,controlsOptions:{channelElement:null,liveElement:null,initialView:2,initialLiveEnabled:false,
    onViewChange:(target,meta)=>changes.push({target,reason:meta.reason,view:f.controls.getState().viewTarget,capturing:f.controls.getState().capturing})}});
  f.project.importSongSources([{name:'capture.vgm',bytes:Uint8Array.of(1)}]);await tick();
  const snapshot=pausedSnapshot();f.emit({playback:'paused',paused:true,playing:false,liveActive:true,liveState:snapshot,positionFrames:4410,positionSeconds:.1});
  assert.equal(await f.controls.capture(),true);
  assert.deepEqual(changes,[{target:'synth',reason:'capture',view:'synth',capturing:false}]);
  let state=f.controls.getState();assert.equal(state.positionFrames,4410);assert.equal(state.liveVoice,2);assert.equal(state.liveState,snapshot);assert.equal(state.liveEnabled,false);
  f.controls.setView(2,{notify:false});assert.equal(f.controls.getState().view,'song');assert.equal(f.controls.getCapturePayload().channel,2);assert.equal(changes.length,1);
  assert(!f.calls.some(([method])=>['play','pause','resume','stop','seek'].includes(method)));
});

test('external control elements stay separate from old mounts and validate selection before cancelling a pending Capture',async t=>{
  const channel=new Element(),live=new Element(),changes=[];channel.value='3';live.checked=false;
  let finish,guard;const pending=new Promise(resolve=>finish=resolve);
  const f=fixture(t,{onCapture:async(_payload,{isCurrent})=>{guard=isCurrent;await pending;return true;},controlsOptions:{channelElement:channel,liveElement:live,onViewChange:(target,meta)=>changes.push([target,meta.reason])}});
  assert.equal(f.controls.getState().liveVoice,3);assert.equal(f.controls.getState().liveEnabled,false);
  assert.equal(f.nodes.ChannelSelect.value,'0');assert.equal(f.nodes.LiveEnabled.checked,true);assert.equal(f.nodes.ChannelSelect.listeners.size,0);assert.equal(f.nodes.LiveEnabled.listeners.size,0);
  f.project.importSongSources([{name:'external.vgm',bytes:Uint8Array.of(1)}]);await tick();
  f.emit({playback:'paused',paused:true,playing:false,liveActive:true,liveState:pausedSnapshot(),positionFrames:4410});
  const capturing=f.controls.capture();assert(guard());
  for(const value of [-1,4,NaN,null,undefined,'','bogus'])assert.throws(()=>f.controls.setView(value),/Song view/);
  assert.throws(()=>f.controls.setLiveEnabled(1),/boolean/);assert(guard(),'invalid shared input cannot cancel or mutate the current Capture');
  f.controls.setView(3,{notify:false});f.controls.setLiveEnabled(false);assert(guard(),'idempotent shared state synchronization is passive');
  finish();assert.equal(await capturing,true);assert.deepEqual(changes,[['synth','capture']]);assert.equal(channel.value,'synth');assert.equal(live.checked,false);
  channel.value='1';channel.fire('change');assert.equal(channel.blurred,true);assert.equal(f.controls.getState().viewTarget,1);assert.deepEqual(changes.at(-1),[1,'selector']);
  live.checked=true;live.fire('change');assert.equal(f.controls.getState().liveEnabled,true);assert.equal(live.blurred,true);
  f.controls.dispose();assert.equal(f.controls.setView(0),false);assert.equal(f.controls.setLiveEnabled(false),false);assert.equal(channel.listeners.size,0);assert.equal(live.listeners.size,0);
});

test('headless VGM controls retain Play/Pause/Seek/Capture/Resume/Stop without channel or Live elements',async t=>{
  const f=fixture(t,{omit:['ChannelSelect','LiveEnabled','LiveStatus'],onCapture:async()=>true,controlsOptions:{channelElement:null,liveElement:null,initialView:2}});
  f.project.importSongSources([{name:'transport.vgm',bytes:Uint8Array.of(1)}]);await tick();
  f.nodes.PlayButton.fire('click');await tick();assert(f.controls.isPlaying());f.nodes.PlayButton.fire('click');assert(f.controls.getState().paused);
  assert.equal(await f.controls.seek(.1),true);f.emit({liveState:pausedSnapshot(),positionFrames:4410});assert.equal(await f.controls.capture(),true);
  assert.equal(f.controls.getState().viewTarget,'synth');f.controls.setView(2);assert.equal(f.controls.getCapturePayload().channel,2);
  f.nodes.PlayButton.fire('click');await tick();assert(f.controls.isPlaying());f.nodes.StopButton.fire('click');assert.equal(f.controls.getState().playback,'stopped');
  assert.deepEqual(f.calls.filter(([method])=>method!=='load'),[['play'],['pause'],['seek',.1],['resume'],['stop']]);
});
