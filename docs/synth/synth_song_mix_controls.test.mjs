import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSynthSongMixControls} from './synth_song_mix_controls.js';
import {createSynthSongMix} from './synth_song_mix.js';

class Events {
  constructor(){this.listeners=new Map();}
  addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  fire(type,extra={}){const event={type,target:this,key:'',prevented:false,stopped:false,
    preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};
    for(const callback of this.listeners.get(type)??[])callback(event);return event;}
  listenerCount(){return [...this.listeners.values()].reduce((count,values)=>count+values.size,0);}
}
class Element extends Events {
  constructor(tag='div'){super();this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.hidden=false;this.disabled=false;this.value='';this.bounds={left:200,bottom:70};
    this.style={setProperty:(name,value)=>{this.style[name]=value;}};
    const names=new Set();this.classList={toggle:(name,on)=>{on?names.add(name):names.delete(name);},contains:name=>names.has(name)};}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.textContent='';this.append(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  getBoundingClientRect(){return this.bounds;}
  matches(selector){return selector==='input[type="range"]'&&this.tag==='input'&&this.type==='range';}
  dispatchEvent(event){this.fire(event.type);return true;}
  click(){this.fire('click');}scrollIntoView(){this.scrolled=true;}
  focus(){this.focused=true;}blur(){this.blurred=true;}
}
const walk=node=>[node,...node.children.flatMap(walk)];
const groups=['ym2612','psg','pcm','pwm'];
function fixture(){
  const old=new Map(['document','window','innerWidth','innerHeight'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const elements=new Map(),document=new Events(),window=new Events();
  document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  document.createElement=tag=>new Element(tag);
  globalThis.document=document;globalThis.window=window;globalThis.innerWidth=1240;globalThis.innerHeight=900;
  const byId=id=>document.getElementById(id);
  byId('synthChipMixer').hidden=true;byId('synthSongMixButton').textContent='Mixer';
  const model=createSynthSongMix();let controls;
  const calls={volumes:[],muted:[],resets:0,views:[]};
  const preview={getState:()=>({mix:model.getState()}),
    setGroupVolume(id,volume){calls.volumes.push([id,volume]);model.setGroupVolume(id,volume);},
    setChannelMuted(id,muted){calls.muted.push([id,muted]);model.setChannelMuted(id,muted);},
    resetMix(){calls.resets++;model.reset();},
  };
  controls=setupSynthSongMixControls({preview});controls.update(model.getState());
  const unsubscribe=model.onDidChange(state=>controls.update(state));
  // The real chip-view controller, not the Mixer renderer, owns tab selection.
  const selectTab=()=>{calls.views.push('mixer');byId('synthChipMixer').hidden=false;byId('synthSongMixButton').setAttribute('aria-selected','true');byId('synthSongMixButton').classList.toggle('is-selected',true);};
  const restore=()=>{calls.views.push('restore');byId('synthCodeExpandButton').setAttribute('aria-pressed','false');};
  byId('synthSongMixButton').addEventListener('click',selectTab);byId('synthCodeExpandButton').addEventListener('click',restore);
  const volume=id=>walk(byId('synthSongMixChannels')).find(node=>node.dataset.songGroupVolume===id);
  const mute=id=>walk(byId('synthSongMixChannels')).find(node=>node.dataset.songMute===id);
  return{byId,document,window,controls,calls,model,volume,mute,
    cleanup(){unsubscribe();controls.dispose();for(const[name,descriptor]of old)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];}};
}

test('the Mixer tab renders all four volumes and twenty On / Off switches before a VGM exists',()=>{
  const f=fixture();
  try {
    for(const id of groups)assert(f.volume(id),id);
    const switches=walk(f.byId('synthSongMixChannels')).filter(node=>node.dataset.songMute);
    assert.equal(switches.length,20);
    for(const control of switches){assert.equal(control.textContent,'On');assert.equal(control.attributes['aria-pressed'],'true');}
    assert.equal(f.byId('synthSongMixReferenceOptions').hidden,true);
    assert.equal(f.byId('synthSongMixReset').disabled,true);
    f.byId('synthSongMixButton').fire('click');
    assert.equal(f.byId('synthChipMixer').hidden,false);
    assert.equal(f.byId('synthSongMixButton').attributes['aria-selected'],'true');
    assert.equal(f.byId('synthSongMixChannelStatus').textContent,'20 channels on');
    assert.deepEqual(f.calls,{volumes:[],muted:[],resets:0,views:['mixer']},'selecting the tab changes only the view');
  }finally{f.cleanup();}
});

test('maximized Code restores its view and opens the same Mixer tab without rebuilding its controls',()=>{
  const f=fixture();
  try {
    const slider=f.volume('psg');
    const original=slider.value;
    f.byId('synthCodeExpandButton').setAttribute('aria-pressed','true');
    f.byId('synthCodeMixerButton').fire('click');
    assert.deepEqual(f.calls.views,['restore','mixer']);
    assert.equal(f.byId('synthChipMixer').hidden,false);
    assert.equal(f.volume('psg'),slider,'opening from Code does not duplicate or rebuild the controls');
    slider.value='250';slider.fire('input');assert.deepEqual(f.calls.volumes,[['psg',2.5]]);
    assert.equal(slider.dataset.boosted,'true');
    assert.equal(f.byId('synthSongMixButton').dataset.mixChanged,'true');
    assert(f.byId('synthSongMixButton').classList.contains('is-selected'),'mix edits cannot overwrite tab selection');
    assert.equal(f.byId('synthSongMixReset').disabled,false);
    f.byId('synthSongMixReset').fire('click');assert.equal(f.calls.resets,1);assert.equal(slider.value,original);
    f.model.setGroupVolume('ym2612',0.898989);
    const exact=f.volume('ym2612');exact.fire('keydown',{key:'ArrowRight'});
    assert.deepEqual(f.calls.volumes.at(-1),['ym2612',0.908989],'keyboard steps preserve fractional calibrated gains');
    f.controls.close();assert.equal(f.byId('synthChipMixer').hidden,false,'transport reset cannot close an inline tab');
  }finally{f.cleanup();}
});

test('channel On / Off is shared and persists while VGM-only display options follow referenceActive',()=>{
  const f=fixture();
  try {
    f.model.configure({ym2612Clock:7670454});
    assert.equal(f.byId('synthSongMixReferenceOptions').hidden,false);assert(f.mute('ym2612:0'));
    f.mute('ym2612:0').fire('click');assert.deepEqual(f.calls.muted,[['ym2612:0',true]]);
    assert.equal(f.mute('ym2612:0').textContent,'Off');
    assert.equal(f.mute('ym2612:0').attributes['aria-pressed'],'false');
    assert.equal(f.mute('ym2612:0').attributes['aria-label'],'Turn on YM2612 CH1');
    assert.equal(f.byId('synthSongMixChannelStatus').textContent,'1 of 20 channels off');
    f.model.clear();
    assert.equal(f.byId('synthSongMixReferenceOptions').hidden,true);assert(f.mute('ym2612:0'));
    assert.equal(f.mute('ym2612:0').textContent,'Off','removing a VGM keeps shared channel settings');
    assert(f.mute('pwm:1'),'PWM output switches remain available without a VGM');
    for(const id of groups)assert(f.volume(id));
    assert.equal(f.byId('synthSongMixButton').textContent,'Mixer');
  }finally{f.cleanup();}
});

test('inline controls preserve performance-key behavior and dispose only their own listeners',()=>{
  const f=fixture();
  try {
    const panel=f.byId('synthSongMixPanel'),slider=f.volume('pwm');
    assert(panel.fire('keydown',{key:'ArrowLeft',target:slider}).stopped);
    assert(panel.fire('keydown',{key:' '}).stopped);
    assert.equal(panel.fire('keydown',{key:'a',target:slider}).stopped,false,'performance letters remain available');
    f.controls.dispose();
    for(const target of [f.document,f.window,panel,f.byId('synthCodeMixerButton'),f.byId('synthSongMixReset')])assert.equal(target.listenerCount(),0);
    assert.equal(f.byId('synthSongMixButton').listenerCount(),1,'the chip-view tab handler belongs to the parent');
    slider.value='0';slider.fire('input');f.byId('synthSongMixReset').fire('click');
    assert.deepEqual(f.calls,{volumes:[],muted:[],resets:0,views:[]},'a disposed panel cannot change the common mix');
  }finally{f.cleanup();}
});
