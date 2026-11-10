import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSynthSongControls} from './synth_song_controls.js';
import {createYm2612RegisterState} from './synth_song_state.js';
import {createPsgRegisterState} from './synth_song_psg_state.js';

class Element {
  constructor(){this.dataset={};this.children=[];this.listeners=new Map();this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.checked=false;}
  get options(){return this.children;}
  replaceChildren(...children){this.children=children;this.value=children[0]?.value??'';}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback);}
  async fire(name){for(const callback of this.listeners.get(name)??[])await callback({preventDefault(){},stopPropagation(){}});}
  blur(){this.blurred=true;}
}
function snapshots(frame,attenuation=6) {
  const fm=createYm2612RegisterState();fm.write(0,0xa4,0x22);fm.write(0,0xa0,0x40);fm.write(0,0x28,0xf0);
  const psg=createPsgRegisterState();
  for(let channel=0;channel<3;channel++){psg.write(0x80|(channel<<5)|4);psg.write(12+channel);psg.write(0x90|(channel<<5)|attenuation);}
  psg.write(0xe4);psg.write(0xf0|attenuation);
  return {liveState:fm.snapshot(frame),psgLiveState:psg.snapshot(frame)};
}
function fixture(copyResult=true) {
  const old=Object.getOwnPropertyDescriptor(globalThis,'document'),elements=new Map();
  const byId=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const format=new Element();globalThis.document={getElementById:byId,querySelector:()=>format,createElement:()=>new Element()};
  const channel=byId('synthSongChannelSelect');channel.children=['synth','0','1','2','3','4','5'].map(value=>Object.assign(new Element(),{value}));channel.value='0';
  byId('synthSongLiveToggle').checked=true;
  let state={playback:'stopped',name:'tune.vgm',consumedFrames:0,...snapshots(0)},emit;
  const views=[],targets=[],copies=[],messages=[];
  const project={selectedPath:'/vgm/tune.vgm',listEntries:()=>[{path:'/vgm/tune.vgm',type:'file',revision:1}],
    fs:{getRevision:()=>1,get:()=>({type:'binary',data:new Uint8Array()})},onDidChange:()=>()=>{}};
  const controls=setupSynthSongControls({project,getAudio:()=>{},getVolume:()=>1,onLiveView:view=>views.push(view),onTargetState:target=>targets.push(target),
    onCopyToSynth:async(preset,name)=>{copies.push({preset,name});return copyResult;},onStatus:message=>messages.push(message),
    createPreview:({onState})=>{
      emit=patch=>{state={...state,...patch};onState(state);};
      return {getState:()=>state,load(){},clear(){},setVolume(){},stop:()=>emit({playback:'stopped'}),pause:()=>emit({playback:'paused'}),
        play:async()=>emit({playback:'playing'}),resume:async()=>emit({playback:'playing'}),dispose(){}};
    },setupSeek:()=>({update(){},cancelDraft(){},dispose(){}}),setupMix:()=>({update(){},close(){},dispose(){}}),
  });
  return {controls,emit,views,targets,copies,messages,byId,channel,
    cleanup(){controls.dispose();old?Object.defineProperty(globalThis,'document',old):delete globalThis.document;}};
}

test('playing chip selection keeps reference targets and remembers each chip channel without choosing Synth',async()=>{
  const h=fixture();
  try {
    h.emit({playback:'playing',...snapshots(100)});h.controls.selectTarget('4');
    assert.equal(h.targets.at(-1).target,4);
    assert(h.controls.selectChip('psg'));assert.equal(h.targets.at(-1).target,'psg:0');assert.equal(h.views.at(-1).chip,'psg');
    assert.deepEqual(h.channel.options.map(item=>item.textContent),['Synth','Tone 1','Tone 2','Tone 3','Noise']);
    h.controls.selectTarget('psg:3');assert.match(h.byId('synthSongLiveStatus').textContent,/PSG Noise.*Attenuation 6/);
    assert(!h.byId('synthSongLiveStatus').textContent.includes('Gate'));
    h.controls.selectChip('ym2612');assert.equal(h.targets.at(-1).target,4);
    h.controls.selectChip('psg');assert.equal(h.targets.at(-1).target,'psg:3');
    const count=h.targets.length;assert(h.controls.selectChip('psg'));assert.equal(h.targets.length,count,'same-chip selection cannot recurse through callbacks');
    h.controls.selectTarget('synth');h.controls.selectChip('ym2612');assert.equal(h.targets.at(-1).target,'synth');
    h.controls.selectChip('psg');assert.equal(h.targets.at(-1).target,'synth','an explicitly selected editor remains the editor');
    assert.equal(h.controls.selectTarget('psg:4'),false);assert.equal(h.controls.selectTarget('6'),false);
  } finally {h.cleanup();}
});

test('Live Off freezes both chips together; Pause and Seek refresh the exact destination without crossing chip snapshots',()=>{
  const h=fixture();
  try {
    h.emit({playback:'playing',...snapshots(100,4)});h.controls.selectChip('psg');
    h.byId('synthSongLiveToggle').checked=false;
    h.emit({playback:'playing',...snapshots(200,10)});
    assert.equal(h.views.at(-1).snapshot.frame,100);assert.equal(h.views.at(-1).snapshot.channels[0].attenuation,4);
    h.controls.selectChip('ym2612');assert.equal(h.views.at(-1).snapshot.frame,100);
    h.controls.selectChip('psg');h.emit({playback:'paused',...snapshots(250,9)});
    assert.equal(h.views.at(-1).snapshot.frame,250);assert.equal(h.views.at(-1).snapshot.channels[0].attenuation,9);
    assert(h.views.at(-1).paused);assert.match(h.byId('synthSongLiveStatus').textContent,/Keyboard: this CH/);
    h.emit({playback:'seeking',psgLiveState:null,liveState:null});assert.equal(h.views.at(-1),null);assert(h.channel.disabled);
    h.emit({playback:'paused',...snapshots(600,7)});assert.equal(h.views.at(-1).snapshot.frame,600);assert(!h.channel.disabled);
    h.emit({playback:'stopped'});assert.equal(h.views.at(-1),null);assert.equal(h.targets.at(-1).target,'psg:0');
  } finally {h.cleanup();}
});

test('PSG Copy creates an editable software-envelope-Off instrument and selects Synth only after success',async()=>{
  for(const success of [false,true]) {
    const h=fixture(success);
    try {
      h.emit({playback:'paused',...snapshots(500,8)});h.controls.selectTarget('psg:3');assert(!h.byId('synthSongCopyButton').disabled);
      await h.byId('synthSongCopyButton').fire('click');assert.equal(h.copies.length,1);
      const {preset,name}=h.copies[0];assert.equal(preset.kind,'tetorica-sega-psg');assert.equal(preset.settings.source,'noise');
      assert.equal(preset.settings.attenuation,8);assert.equal(preset.settings.envelope.enabled,false);assert.match(name,/-PSG-Noise$/);
      assert.equal(h.targets.at(-1).target,success?'synth':'psg:3');assert.equal(h.views.at(-1)?.chip,success?undefined:'psg');
    } finally {h.cleanup();}
  }
});

test('a missing chip never fabricates Live settings or silently changes the selected reference target',()=>{
  const h=fixture();
  try {
    h.emit({playback:'playing',...snapshots(100),psgLiveState:null});h.controls.selectChip('psg');
    assert.equal(h.targets.at(-1).target,'psg:0');assert.equal(h.views.at(-1),null);
    assert.match(h.byId('synthSongLiveStatus').textContent,/No PSG in this VGM/);assert(h.byId('synthSongCopyButton').disabled);
    h.emit({playback:'loading',liveState:null,psgLiveState:null});
    h.emit({playback:'playing',...snapshots(200),liveState:null});assert.equal(h.views.at(-1).snapshot.kind,'segapsg');
    h.controls.selectChip('ym2612');assert.equal(h.targets.at(-1).target,0);
    assert.equal(h.views.at(-1),null);assert.match(h.byId('synthSongLiveStatus').textContent,/No YM2612 in this VGM/);
  } finally {h.cleanup();}
});
