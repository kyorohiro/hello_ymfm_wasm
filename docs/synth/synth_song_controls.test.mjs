import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSynthSongControls} from './synth_song_controls.js';
import {createYm2612RegisterState} from './synth_song_state.js';
import {createPsgRegisterState} from './synth_song_psg_state.js';
import {createPcmRegisterState} from './synth_song_pcm_state.js';
import {createPcmBuiltinPreset,pcmSampleBytes} from './synth_pcm.js';

class Element {
  constructor(){this.dataset={};this.children=[];this.listeners=new Map();this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.checked=false;}
  get options(){return this.children;}
  replaceChildren(...children){this.children=children;this.value=children[0]?.value??'';}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback);}
  async fire(name){for(const callback of this.listeners.get(name)??[])await callback({preventDefault(){},stopPropagation(){}});}
  blur(){this.blurred=true;}
}
function snapshots(frame,attenuation=6,volume=64) {
  const fm=createYm2612RegisterState();fm.write(0,0xa4,0x22);fm.write(0,0xa0,0x40);fm.write(0,0x28,0xf0);
  const psg=createPsgRegisterState();
  for(let channel=0;channel<3;channel++){psg.write(0x80|(channel<<5)|4);psg.write(12+channel);psg.write(0x90|(channel<<5)|attenuation);}
  psg.write(0xe4);psg.write(0xf0|attenuation);
  const pcm=createPcmRegisterState(),sample=pcmSampleBytes(createPcmBuiltinPreset('sine').sample);
  const bytes=new Uint8Array(sample.length+33).fill(255);bytes.set(sample);
  pcm.write(7,0x80);pcm.loadBankedMemory(bytes,0);
  for(let channel=0;channel<8;channel++) {
    pcm.write(7,0xc0|channel);pcm.write(0,volume+channel);pcm.write(1,0xef);
    pcm.write(2,channel);pcm.write(3,8);pcm.write(4,0);pcm.write(5,0);pcm.write(6,0);
  }
  pcm.write(8,0);
  return {liveState:fm.snapshot(frame),psgLiveState:psg.snapshot(frame),pcmLiveState:pcm.snapshot(frame)};
}
function fixture(copyResult=true,{empty=false,mix}={}) {
  const old=Object.getOwnPropertyDescriptor(globalThis,'document'),elements=new Map();
  const byId=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const format=new Element();globalThis.document={getElementById:byId,querySelector:()=>format,createElement:()=>new Element()};
  const channel=byId('synthSongChannelSelect');channel.children=['synth','0','1','2','3','4','5'].map(value=>Object.assign(new Element(),{value}));channel.value='0';
  byId('synthSongLiveToggle').checked=true;
  let state={playback:'stopped',name:'tune.vgm',consumedFrames:0,...snapshots(0)},emit,previewOptions;
  const views=[],targets=[],copies=[],messages=[],mixUpdates=[],mixCloses=[];
  const project={selectedPath:empty?null:'/vgm/tune.vgm',listEntries:()=>empty?[]:[{path:'/vgm/tune.vgm',type:'file',revision:1}],
    fs:{getRevision:()=>1,get:()=>({type:'binary',data:new Uint8Array()})},onDidChange:()=>()=>{}};
  const controls=setupSynthSongControls({project,getAudio:()=>{},getVolume:()=>1,mix,onLiveView:view=>views.push(view),onTargetState:target=>targets.push(target),
    onCopyToSynth:async(preset,name)=>{copies.push({preset,name});return copyResult;},onStatus:message=>messages.push(message),
    createPreview:options=>{
      previewOptions=options;const {onState}=options;
      emit=patch=>{state={...state,...patch};onState(state);};
      return {getState:()=>state,load(){},clear(){},setVolume(){},stop:()=>emit({playback:'stopped'}),pause:()=>emit({playback:'paused'}),
        play:async()=>emit({playback:'playing'}),resume:async()=>emit({playback:'playing'}),dispose(){}};
    },setupSeek:()=>({update(){},cancelDraft(){},dispose(){}}),setupMix:()=>({update:value=>mixUpdates.push(value),close:()=>mixCloses.push(true),dispose(){}}),
  });
  return {controls,emit,views,targets,copies,messages,mixUpdates,mixCloses,byId,channel,get previewOptions(){return previewOptions;},
    cleanup(){controls.dispose();old?Object.defineProperty(globalThis,'document',old):delete globalThis.document;}};
}

test('the optional common mix reaches preview and remains available with no VGM or during a seek',()=>{
  const commonMix={marker:'shared instance'},h=fixture(true,{empty:true,mix:commonMix});
  try {
    assert.equal(h.previewOptions.mix,commonMix);
    assert.equal(h.byId('synthSongPlayer').hidden,true,'only the reference transport needs a file');
    assert.equal(h.byId('synthSongMixButton').disabled,false);
    const state={groups:[{id:'ym2612',volume:0.9},{id:'psg',volume:0.5},{id:'pcm',volume:1},{id:'pwm',volume:1}],channels:[]};
    h.emit({mix:state});assert.equal(h.mixUpdates.at(-1),state);
    const closed=h.mixCloses.length;
    h.emit({playback:'seeking',seekProgress:0.5,mix:state});
    assert.equal(h.byId('synthSongMixButton').disabled,false,'shared volumes remain available while reference playback seeks');
    assert.equal(h.mixCloses.length,closed,'seeking does not close a shared Mixer');
    h.controls.selectTarget('synth');assert.equal(h.mixUpdates.at(-1),state);
  }finally{h.cleanup();}
  const standalone=fixture();
  try{assert.equal(Object.hasOwn(standalone.previewOptions,'mix'),false,'the default preview keeps its normal options');}
  finally{standalone.cleanup();}
});

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
    h.controls.selectChip('pcm');assert.equal(h.targets.at(-1).target,'pcm:0');assert.equal(h.views.at(-1).chip,'pcm');
    assert.deepEqual(h.channel.options.map(item=>item.textContent),['Synth','CH1','CH2','CH3','CH4','CH5','CH6','CH7','CH8']);
    h.controls.selectTarget('pcm:7');assert.match(h.byId('synthSongLiveStatus').textContent,/PCM CH8.*Step 2055.*Volume 71.*Pan L15 \/ R14.*Start \$0000.*Loop \$0000/);
    assert(!h.byId('synthSongLiveStatus').textContent.includes('Gate'),'PCM speed is not invented as a musical note');
    h.controls.selectChip('psg');assert.equal(h.targets.at(-1).target,'psg:3');
    h.controls.selectChip('pcm');assert.equal(h.targets.at(-1).target,'pcm:7');
    h.controls.selectChip('psg');
    const count=h.targets.length;assert(h.controls.selectChip('psg'));assert.equal(h.targets.length,count,'same-chip selection cannot recurse through callbacks');
    h.controls.selectTarget('synth');h.controls.selectChip('ym2612');assert.equal(h.targets.at(-1).target,'synth');
    h.controls.selectChip('psg');assert.equal(h.targets.at(-1).target,'synth','an explicitly selected editor remains the editor');
    h.controls.selectChip('pcm');assert.equal(h.targets.at(-1).target,'synth');
    assert.equal(h.controls.selectTarget('psg:4'),false);assert.equal(h.controls.selectTarget('6'),false);assert.equal(h.controls.selectTarget('pcm:8'),false);assert.equal(h.controls.selectTarget('pcm:-1'),false);
  } finally {h.cleanup();}
});

test('Live Off freezes all three chips together; Pause and Seek refresh the exact destination without crossing chip snapshots',()=>{
  const h=fixture();
  try {
    h.emit({playback:'playing',...snapshots(100,4)});h.controls.selectChip('psg');
    h.byId('synthSongLiveToggle').checked=false;
    h.emit({playback:'playing',...snapshots(200,10)});
    assert.equal(h.views.at(-1).snapshot.frame,100);assert.equal(h.views.at(-1).snapshot.channels[0].attenuation,4);
    h.controls.selectChip('ym2612');assert.equal(h.views.at(-1).snapshot.frame,100);
    h.controls.selectChip('pcm');assert.equal(h.views.at(-1).snapshot.frame,100);assert.equal(h.views.at(-1).snapshot.channels[0].volume,64);
    h.emit({playback:'playing',...snapshots(225,11,96)});assert.equal(h.views.at(-1).snapshot.frame,100);assert.match(h.byId('synthSongLiveStatus').textContent,/Frozen PCM CH1/);
    h.controls.selectChip('psg');h.emit({playback:'paused',...snapshots(250,9)});
    assert.equal(h.views.at(-1).snapshot.frame,250);assert.equal(h.views.at(-1).snapshot.channels[0].attenuation,9);
    assert(h.views.at(-1).paused);assert.match(h.byId('synthSongLiveStatus').textContent,/Keyboard: this CH/);
    h.controls.selectChip('pcm');assert.equal(h.views.at(-1).snapshot.frame,250);
    h.emit({playback:'seeking',psgLiveState:null,pcmLiveState:null,liveState:null});assert.equal(h.views.at(-1),null);assert(h.channel.disabled);
    h.emit({playback:'paused',...snapshots(600,7,80)});assert.equal(h.views.at(-1).snapshot.frame,600);assert.equal(h.views.at(-1).snapshot.channels[0].volume,80);assert(!h.channel.disabled);
    h.controls.selectChip('psg');assert.equal(h.views.at(-1).snapshot.frame,600);
    h.emit({playback:'stopped'});assert.equal(h.views.at(-1),null);assert.equal(h.targets.at(-1).target,'psg:0');
  } finally {h.cleanup();}
});

test('PCM Copy creates a detached sample instrument and chooses Synth only after a successful save',async()=>{
  for(const success of [false,true]) {
    const h=fixture(success);
    try {
      const source=snapshots(500,8,72);
      const sampleBefore=[...source.pcmLiveState.ram];
      h.emit({playback:'playing',...source});h.controls.selectTarget('pcm:7');assert(h.byId('synthSongCopyButton').disabled);
      h.emit({playback:'paused'});assert(!h.byId('synthSongCopyButton').disabled);assert.match(h.byId('synthSongLiveStatus').textContent,/Paused PCM CH8.*Keyboard: this CH/);
      await h.byId('synthSongCopyButton').fire('click');assert.equal(h.copies.length,1);
      const {preset,name}=h.copies[0];assert.equal(preset.kind,'tetorica-rf5c164');assert.equal(preset.settings.volume,79);
      assert.equal(preset.settings.panLeft,15);assert.equal(preset.settings.panRight,14);assert.equal(preset.settings.rootNote,60);
      assert.equal(preset.settings.loopEnabled,true);assert.equal(preset.settings.loopStart,0);assert.equal(preset.settings.loopEnd,256);
      assert.equal(preset.sample.sampleRate,12500000/384*2055/2048);assert.match(name,/-PCM-CH8$/);
      assert.deepEqual([...source.pcmLiveState.ram],sampleBefore,'Copy never changes source RAM');
      assert.equal(h.targets.at(-1).target,success?'synth':'pcm:7');assert.equal(h.views.at(-1)?.chip,success?undefined:'pcm');
    } finally {h.cleanup();}
  }
});

test('PCM missing/unsupported snapshots retain the selected target and explain why Copy is unavailable',()=>{
  const h=fixture();
  try {
    h.emit({playback:'playing',pcmLiveState:null});h.controls.selectTarget('pcm:6');
    assert.equal(h.targets.at(-1).target,'pcm:6');assert.equal(h.views.at(-1),null);
    assert.match(h.byId('synthSongLiveStatus').textContent,/No Mega CD PCM in this VGM/);assert(h.byId('synthSongCopyButton').disabled);
    const source=snapshots(350),voice=source.pcmLiveState.channels[6];
    const channels=source.pcmLiveState.channels.map(item=>item.channel===6?{...voice,step:0}:item);
    h.emit({playback:'paused',pcmLiveState:{...source.pcmLiveState,channels}});
    assert.equal(h.views.at(-1).channel,6);assert(h.byId('synthSongCopyButton').disabled);
    assert.match(h.byId('synthSongLiveStatus').textContent,/Step 0/);assert.match(h.byId('synthSongCopyButton').title,/step|speed|rate/i);
    assert.equal(h.targets.at(-1).target,'pcm:6');
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
