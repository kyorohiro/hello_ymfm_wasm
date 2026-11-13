// All routes and devices below are fake. No AudioContext or speaker is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthCodeAudio} from './synth_code_audio.js';
import {createPcmBuiltinPreset,PCM_NATIVE_RATE} from './synth_pcm.js';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js';
import {YM2612Synth} from '../js/ym2612synth.js';
import {createSegaPsgApi} from '../js/segapsg_api.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>Promise.resolve();
function fixture({pendingFx=false,pendingPwm=false,ensureChip=async()=>{},fmChip=null,psgChip=null,getFmVoice=()=>null}={}) {
  const events=[],gains=[],fxRequests=[],pwmRequests=[],nodes=[];
  const context={state:'running',currentTime:0,sampleRate:48000,closeCalls:0,close(){this.closeCalls++;},
    createChannelSplitter(count){const value=node('splitter');value.outputs=count;return value;},
    createChannelMerger(count){const value=node('merger');value.inputs=count;return value;},
    createGain(){const gain=node('gain');gain.gain={value:1};gains.push(gain);return gain;}};
  function node(name) {const value={name,context,edges:new Set(),connections:[],disconnects:0,connect(target,output=0,input=0){this.edges.add(target);this.connections.push({target,output,input});events.push(['connect',name,target.name]);return target;},disconnect(target){
    if(target){if(!this.edges.delete(target))throw Error('Missing edge');this.connections=this.connections.filter(edge=>edge.target!==target);}else {this.edges.clear();this.connections=[];}this.disconnects++;events.push(['disconnect',name,target?.name??'*']);
  }};nodes.push(value);return value;
  }
  const input=node('performance'),output=node('final');input.connect(output);
  const fm=fmChip??{clock:7670454,noteOn:(...args)=>events.push(['fm-on',...args]),keyOff:ch=>events.push(['fm-off',ch]),noteOff:ch=>events.push(['fm-off',ch]),dispose(){throw Error('Cannot dispose borrowed FM');}};
  let psgSettings={source:'tone',attenuation:6,noiseType:'white',noiseRate:'medium',envelope:{enabled:false,attack:0,decay:0,sustain:100,release:0}};
  const psg=psgChip??{tone:(ch,options)=>{if(ch<0||ch>2)throw RangeError('tone channel');events.push(['psg-tone',ch,options]);return 99;},
    setAttenuation:(...args)=>events.push(['psg-attenuation',...args]),keyOff:ch=>events.push(['psg-off',ch]),
    allNotesOff:()=>events.push(['psg-stop']),noiseOff:()=>events.push(['noise-off']),setNoise:options=>events.push(['noise-settings',options]),
    noise:options=>{events.push(['noise-on',options]);return 4;},envelopeNoteOn:(...args)=>events.push(['env-on',...args]),
    envelopeNoteOff:ch=>events.push(['env-off',ch]),setEnvelopeAttenuation:a=>events.push(['env-base',a]),write:value=>events.push(['psg-write',value])};
  let preset=createPcmBuiltinPreset('sine');
  const pcm={setChannel:(ch,settings)=>{if(ch<0||ch>7)throw RangeError('channel');if(settings.step!==undefined&&(!Number.isInteger(settings.step)||settings.step<0||settings.step>65535))throw RangeError('step');events.push(['pcm-channel',ch,structuredClone(settings)]);},
    keyOn:ch=>events.push(['pcm-on',ch]),keyOff:ch=>events.push(['pcm-off',ch]),releaseNote:ch=>events.push(['pcm-release',ch]),
    loadMemory:(bytes,address)=>{if(!Number.isInteger(address)||address<0||address+bytes.length>65536)throw RangeError('RAM');events.push(['pcm-memory',bytes.slice(),address]);return Promise.resolve();},
    writeRegister:(r,v)=>{if(!Number.isInteger(r)||r<0||r>8||!Number.isInteger(v)||v<0||v>255)throw RangeError('register');events.push(['pcm-register',r,v]);},reset:()=>events.push(['pcm-reset'])};
  const pcmVoice={getPreset:()=>structuredClone(preset),getSettings:()=>structuredClone(preset.settings),setPreset:value=>{preset=structuredClone(value);events.push(['restore-preset']);},install:api=>{assert.equal(api,pcm);events.push(['restore-memory']);return Promise.resolve(true);}};
  const options={ensureChip:async name=>{events.push(['ensure',name]);await ensureChip(name);},getContext:()=>context,getInput:()=>input,getOutput:()=>output,getFm:()=>fm,getFmVoice,
    getPsg:()=>psg,getPsgVoice:()=>({getSettings:()=>structuredClone(psgSettings)}),getPcm:()=>pcm,getPcmVoice:()=>pcmVoice,getMaster:()=>.5,
    createFxRack:()=>{
      const task=deferred(),rack={node:node('fx'),stops:0,disposals:0,chain:[],controller:{
        liveFx(name,{process}={}){if(typeof name!=='string'||!name||typeof process!=='function')throw TypeError('Invalid liveFx');events.push(['fx-register',name]);},
        removeLiveFx:name=>events.push(['fx-remove',name]),updateContext:(...args)=>events.push(['fx-context',...args]),
        getChain:()=>rack.chain.slice(),setChain:items=>{rack.chain=items.slice();return items;},clear:()=>{rack.chain=[];},dispose:()=>{rack.chain=[];events.push(['fx-controller-dispose']);},
      },stop(){this.stops++;},dispose(){this.disposals++;this.node.disconnect();}};
      fxRequests.push({task,rack});if(!pendingFx)task.resolve(rack);return task.promise;
    },
    createPwmDevice:(ctx,gain,config)=>{
      const task=deferred(),device={port:{},disposals:0,dispose(){this.disposals++;}};
      pwmRequests.push({ctx,gain,config,task,device});if(!pendingPwm)task.resolve(device);return task.promise;
    },
    createPwmClient:()=>({writes:[],disposeCalls:0,write(register,value){this.writes.push([register,value]);},dispose(){this.disposeCalls++;}}),
  };
  const audio=createSynthCodeAudio(options);
  return {audio,options,events,context,input,output,fm,psg,pcm,gains,fxRequests,pwmRequests,nodes,
    setPsg:value=>{psgSettings={...psgSettings,...value};},getPsg:()=>structuredClone(psgSettings),
    setPcm:value=>{preset={...preset,settings:{...preset.settings,...value}};},getPreset:()=>structuredClone(preset)};
}

test('borrowed FM stays shared with its editor and Code disposal never closes that chip or the context',async()=>{
  const f=fixture(),fm=f.audio.getFm();assert.equal(fm,await f.audio.useSoundChip('ym2612'));
  assert.equal(fm.clock,7670454);fm.noteOn(0,4,644);assert(f.events.some(e=>e[0]==='fm-on'&&e[3]===644));
  fm.dispose();assert.equal(f.events.filter(e=>e[0]==='fm-off').length,6);
  await f.audio.stop();assert.equal(f.context.closeCalls,0);assert(f.input.edges.has(f.output));await f.audio.dispose();
});

test('FM, PSG and PCM Code share keyboard channels with last-KeyOn ownership, while explicit allNotesOff remains physical',async()=>{
  const f=fixture();
  for(const [name,count]of [['ym2612',6],['segapsg',4],['rf5c164',8]]){
    const code=await f.audio.useSoundChip(name),calls=[];
    const keyboard=f.audio.keyboardTarget(name,{noteOn:(...args)=>calls.push(['on',...args]),noteOff:(...args)=>calls.push(['off',...args]),setFrequency:(...args)=>calls.push(['frequency',...args])});
    const channel=name==='segapsg'?1:2;
    if(name==='ym2612')code.noteOn(channel,4,644);else if(name==='segapsg')code.noteOn(channel,'C4');else code.noteOn(channel,'C4');
    if(name==='ym2612'){
      const start=f.events.length;assert.throws(()=>keyboard.noteOn(channel,4,9999),RangeError);assert.equal(f.events.length,start,'invalid keyboard pitch does not release the Code owner');
    }
    keyboard.noteOn(channel,4,700);const before=f.events.length;
    if(name==='ym2612')assert.deepEqual(f.events.at(-1),['fm-off',channel],'keyboard retrigger releases the previous Code envelope first');
    assert.equal(code.noteOff(channel),false,`${name} old Code Off cannot release keyboard`);assert.equal(f.events.length,before);
    if(name==='ym2612')code.noteOn(channel,4,800);else code.noteOn(channel,'E4');
    const previous=calls.length;assert.equal(keyboard.noteOff(channel),false);assert.equal(keyboard.setFrequency(channel,3,100),false);
    assert.equal(calls.length,previous,`${name} old keyboard release/bend cannot change the Code owner`);
    keyboard.noteOn(channel,4,700);code.allNotesOff();assert.equal(keyboard.noteOff(channel),false);
    assert.equal(f.context.closeCalls,0);assert.equal(await f.audio.useSoundChip(name),code);
    assert(count>channel);
  }
  await f.audio.dispose();
});

test('PSG Code notes inherit the current UI level and envelope; knob changes affect held Code channels',async()=>{
  const f=fixture(),psg=await f.audio.useSoundChip('segapsg');
  psg.tone(1,{note:'C4'});assert.deepEqual(f.events.at(-1),['psg-tone',1,{note:'C4',attenuation:6}]);
  const before=f.getPsg();f.setPsg({attenuation:9});f.audio.syncPsgSettings(before);
  assert.deepEqual(f.events.at(-1),['psg-attenuation',1,9]);assert(!f.events.some(e=>e[0]==='fm-on'));
  psg.keyOff(1);assert.deepEqual(f.audio.getState().psgChannels,[]);
  f.setPsg({envelope:{...before.envelope,enabled:true,release:80}});psg.noteOn(0,'A3');assert.equal(f.events.at(-1)[0],'env-on');
  psg.noteOff(0);assert.deepEqual(f.events.at(-1),['env-off',0]);
  psg.noise();assert(f.audio.getState().psgChannels.includes(3));const noiseBefore=f.getPsg();f.setPsg({noiseType:'periodic',noiseRate:'low'});f.audio.syncPsgSettings(noiseBefore);
  assert.deepEqual(f.events.at(-1),['noise-settings',{type:'periodic',rate:'low'}]);await f.audio.dispose();
});

test('PSG noise UI edits preserve Code companions and explicit Code level, including a repeated client lookup',async()=>{
  const writes=[],api=createSegaPsgApi({write:value=>writes.push(value)}),f=fixture({psgChip:api}),psg=await f.audio.useSoundChip('segapsg');
  try {
    psg.noise({type:'periodic',rate:'tone3',attenuation:3});
    let previous=f.getPsg(),from=writes.length;
    f.setPsg({noiseType:'white'});f.audio.syncPsgSettings(previous,{noiseType:'white'});
    assert.deepEqual(writes.slice(from),[0xe7],'one type edit keeps Code Tone 3 clock and its explicit attenuation');
    assert.equal(await f.audio.useSoundChip('segapsg'),psg);
    previous=f.getPsg();from=writes.length;
    f.setPsg({noiseRate:'high'});f.audio.syncPsgSettings(previous,{noiseRate:'high'});
    assert.deepEqual(writes.slice(from),[0xe6],'client reuse does not replace Code noise settings with author defaults');
    previous=f.getPsg();from=writes.length;
    f.setPsg({noiseType:'periodic',noiseRate:'low',attenuation:9});
    f.audio.syncPsgSettings(previous,f.getPsg());
    assert.deepEqual(writes.slice(from),[0xf9,0xe0],'an explicit full preset replaces both fields and level');
  } finally {await f.audio.dispose();}
});

test('PSG raw continuation tracking reads the physical latch after high-level calls',async()=>{
  const writes=[],api=createSegaPsgApi({write:value=>writes.push(value)}),f=fixture({psgChip:api}),psg=await f.audio.useSoundChip('segapsg');
  try {
    psg.setNoise({type:'periodic',rate:'tone3'});psg.write(4);
    let previous=f.getPsg();f.setPsg({noiseRate:'high'});f.audio.syncPsgSettings(previous,{noiseRate:'high'});
    assert.equal(writes.at(-1),0xe6,'unlatched Noise control data sets white / low before the rate-only edit');
    psg.setNoise({type:'periodic',rate:'tone3'});psg.setPeriod(0,123);psg.write(3);
    previous=f.getPsg();f.setPsg({noiseRate:'low'});f.audio.syncPsgSettings(previous,{noiseRate:'low'});
    assert.equal(writes.at(-1),0xe0,'a raw tone continuation must not be mistaken for a Noise setting');
  } finally {await f.audio.dispose();}
});

test('PSG noise tracking has a fake-endpoint latch fallback and new sessions seed the current author sound',async()=>{
  const f=fixture(),psg=await f.audio.useSoundChip('segapsg');
  try {
    psg.setNoise({type:'periodic',rate:'tone3'});psg.write(4);
    let previous=f.getPsg();f.setPsg({noiseRate:'high'});f.audio.syncPsgSettings(previous,{noiseRate:'high'});
    assert.deepEqual(f.events.at(-1),['noise-settings',{type:'white',rate:'high'}]);
    await f.audio.stop();f.setPsg({noiseType:'periodic',noiseRate:'tone3'});await f.audio.useSoundChip('segapsg');
    previous=f.getPsg();f.setPsg({noiseRate:'low'});f.audio.syncPsgSettings(previous,{noiseRate:'low'});
    assert.deepEqual(f.events.at(-1),['noise-settings',{type:'periodic',rate:'low'}],'stopped session does not leak its old white mode');
    await f.audio.stop();previous=f.getPsg();f.setPsg({source:'noise',noiseType:'periodic',noiseRate:'tone3'});f.audio.syncPsgSettings(previous);
    f.setPsg({noiseType:'white',noiseRate:'medium'});await f.audio.useSoundChip('segapsg');
    previous=f.getPsg();f.setPsg({noiseRate:'high'});f.audio.syncPsgSettings(previous,{noiseRate:'high'});
    assert.deepEqual(f.events.at(-1),['noise-settings',{type:'white',rate:'high'}],'idle author restoration cannot suppress a fresh session baseline');
  } finally {await f.audio.dispose();}
});

test('PCM Code shares the author sample, follows live level/pan/loop/root edits without retrigger, and uses releaseNote',async()=>{
  const f=fixture(),original=f.getPreset(),pcm=await f.audio.useSoundChip('rf5c164');
  assert.equal(f.events.filter(e=>e[0]==='pcm-channel').length,8);assert(!f.events.some(e=>e[0]==='pcm-memory'));
  pcm.setPitch(3,4096);pcm.keyOn(3);const previous=f.getPreset().settings,from=f.events.length;
  f.setPcm({rootNote:72,volume:32,panLeft:0,panRight:15,loopStart:16});f.audio.syncPcmSettings(previous);
  assert.deepEqual(f.events.slice(from).filter(e=>e[0]==='pcm-channel'&&e[1]===3),[['pcm-channel',3,{volume:32,pan:{left:0,right:15},loopStart:16,step:2048}]]);
  assert.equal(f.events.slice(from).filter(e=>e[0]==='pcm-channel').length,8,'idle Code channels also inherit the next authored note settings');
  assert(!f.events.slice(from).some(e=>['pcm-on','pcm-off','pcm-release'].includes(e[0])));
  pcm.keyOff(3);assert.deepEqual(f.events.at(-1),['pcm-release',3]);assert.deepEqual(f.audio.getState().pcmChannels,[]);
  await f.audio.stop();assert(!f.events.some(e=>e[0]==='restore-memory'),'ordinary code notes do not replace the shared sample bank');
  assert.equal(f.getPreset().sample.data,original.sample.data);await f.audio.dispose();
});

test('PCM musical notes use the author sample rate and declared Root, without assuming one cycle or touching the other settings',async()=>{
  const f=fixture(),author=createPcmBuiltinPreset('triangle');
  author.sample.data=btoa(String.fromCharCode(...new Uint8Array(97).fill(128)));
  author.sample.sampleRate=PCM_NATIVE_RATE;
  author.settings={...author.settings,rootNote:69,loopStart:17,loopEnd:97,volume:41,panLeft:3,panRight:12};
  f.options.getPcmVoice().setPreset(author);
  const pcm=await f.audio.useSoundChip('rf5c164'),from=f.events.length;
  assert.equal(pcm.setNote(7,'A4'),2048,'Root plays at the original sample rate, regardless of sample length');
  assert.equal(pcm.setNote(7,81),4096,'MIDI Root + 12 doubles playback speed');
  assert.equal(pcm.setNote(7,'A3'),1024);
  assert.deepEqual(f.events.slice(from),[
    ['pcm-channel',7,{step:2048}],['pcm-channel',7,{step:4096}],['pcm-channel',7,{step:1024}],
  ],'setNote writes only the selected channel pitch, without a trigger or RAM edit');
  assert.equal(pcm.noteOn(7,'A4'),undefined,'a ready musical note starts synchronously');
  assert.deepEqual(f.events.slice(-2),[['pcm-channel',7,{step:2048}],['pcm-on',7]]);
  assert.deepEqual(f.audio.getState().pcmChannels,[7]);
  const previous=f.getPreset().settings;f.setPcm({rootNote:81});f.audio.syncPcmSettings(previous);
  assert.equal(pcm.setNote(7,69),1024,'new calls read the current editor Root');
  pcm.noteOff(7);assert.deepEqual(f.events.at(-1),['pcm-release',7]);
  assert.deepEqual(f.getPreset().sample,author.sample,'tuning neither rewrites nor analyzes the sample');
  const next=createPcmBuiltinPreset('square');next.sample.sampleRate=PCM_NATIVE_RATE*2;next.settings.rootNote=72;
  f.options.getPcmVoice().setPreset(next);f.audio.pcmSourceChanged();pcm.noteOn(0,'C5');
  const seeded=f.events.filter(e=>e[0]==='pcm-channel'&&e[1]===0).at(-1)[2];
  assert.equal(seeded.step,4096,'source replacement uses the new rate and Root');
  await f.audio.dispose();
});

test('PCM Code Root applies to future musical calls without editing the author or retuning a configured voice',async()=>{
  const f=fixture(),author=createPcmBuiltinPreset('sine');author.sample.sampleRate=PCM_NATIVE_RATE;
  f.options.getPcmVoice().setPreset(author);
  const pcm=await f.audio.useSoundChip('rf5c164');pcm.noteOn(0,'C4');
  const before=f.getPreset(),from=f.events.length;
  assert.equal(pcm.setRootNote('A4'),69);
  assert.deepEqual(f.events.slice(from),[],'declaring the sample Root does not write or restart any channel');
  assert.deepEqual(f.getPreset(),before,'Code tuning never changes the editor or saved instrument');
  assert.equal(pcm.setNote(0,'A5'),4096,'Root + 12 doubles the original sample rate');
  pcm.setPitch(1,4096);
  const previous=f.getPreset().settings;f.setPcm({rootNote:72,volume:48,panLeft:2,loopStart:16});
  const start=f.events.length;f.audio.syncPcmSettings(previous);
  const updates=f.events.slice(start).filter(e=>e[0]==='pcm-channel');
  assert.equal(updates.find(e=>e[1]===0)[2].step,4096,'Code-tuned channel ignores the unrelated UI Root change');
  assert.equal(updates.find(e=>e[1]===1)[2].step,2048,'raw step retains its existing UI Root behavior');
  assert.equal(updates.find(e=>e[1]===2)[2].step,1024,'unconfigured channels continue following the editor Root');
  assert.deepEqual(updates.find(e=>e[1]===0)[2],{volume:48,pan:{left:2,right:15},loopStart:16,step:4096});
  assert(!f.events.slice(start).some(e=>e[0]==='pcm-on'),'UI controls do not retrigger Code notes');
  const clear=f.events.length;assert.equal(pcm.setRootNote(null),72);assert.deepEqual(f.events.slice(clear),[]);
  assert.equal(pcm.setNote(0,'C5'),2048,'null resumes the current editor Root on the next note helper call');
  assert.equal(pcm.setRootNote(0),0,'MIDI zero is an explicit Root, never treated as inheritance');
  assert.equal(pcm.setRootNote(127),127);
  pcm.setRootNote(69);const invalid=f.events.length;
  for(const note of [undefined,true,{},'', 'H4','C20',-1,128,69.5,NaN,Infinity])assert.throws(()=>pcm.setRootNote(note),RangeError);
  assert.deepEqual(f.events.slice(invalid),[]);assert.equal(pcm.setNote(0,69),2048,'invalid Root leaves the previous override intact');
  await pcm.loadMemory(Uint8Array.of(128,255));pcm.setRootNote('A4');
  assert.throws(()=>pcm.noteOn(0,'A4'),/editor sample tuning/,'Root alone cannot supply the rate of an unknown Code sample');
  await f.audio.dispose();
});

test('raw PCM step writes reclaim UI tuning while non-pitch channel edits preserve the Code Root basis',async()=>{
  for(const mode of ['setPitch','setChannel','writeRegister','volume']) {
    const f=fixture(),author=createPcmBuiltinPreset('sine');author.sample.sampleRate=PCM_NATIVE_RATE;
    f.options.getPcmVoice().setPreset(author);
    const pcm=await f.audio.useSoundChip('rf5c164');pcm.setRootNote('A4');pcm.noteOn(0,'A5');
    if(mode==='setPitch')pcm.setPitch(0,4096);
    else if(mode==='setChannel')pcm.setChannel(0,{step:4096});
    else if(mode==='writeRegister'){pcm.writeRegister(7,0xc0);pcm.writeRegister(2,0);pcm.writeRegister(3,16);}
    else pcm.setChannel(0,{volume:32});
    const previous=f.getPreset().settings;f.setPcm({rootNote:72});f.audio.syncPcmSettings(previous);
    const update=f.events.filter(e=>e[0]==='pcm-channel'&&e[1]===0).at(-1)[2];
    assert.equal(update.step,mode==='volume'?4096:2048,mode+' preserves the appropriate tuning basis');
    await f.audio.dispose();
  }
});

test('PCM Root metadata survives raw reset and pending starts, then clears on Stop or new author source',async()=>{
  let gate=null,ready=true;const f=fixture({ensureChip:()=>gate?.promise}),author=createPcmBuiltinPreset('sine');
  author.sample.sampleRate=PCM_NATIVE_RATE;f.options.getPcmVoice().setPreset(author);
  const pcm=await f.audio.useSoundChip('rf5c164');pcm.setRootNote('A4');pcm.reset();
  assert.equal(pcm.setNote(0,'A4'),2048,'a hardware register reset keeps the Code tuning declaration');
  f.options.getPcmVoice().isReady=()=>ready;ready=false;gate=deferred();
  const first=pcm.noteOn(4,'A4');await turn();await turn();
  pcm.setRootNote('A5');const second=pcm.noteOn(5,'A4');await turn();await turn();
  assert.equal(f.events.filter(e=>e[0]==='pcm-on').length,0);
  ready=true;gate.resolve();await Promise.all([first,second]);
  const pitch=ch=>f.events.filter(e=>e[0]==='pcm-channel'&&e[1]===ch).at(-1)[2].step;
  assert.equal(pitch(4),2048,'an earlier pending note keeps the basis used by its call');
  assert.equal(pitch(5),1024,'only subsequent note calls use the new Root');
  const previous=f.getPreset().settings;f.setPcm({rootNote:72});f.audio.syncPcmSettings(previous);
  assert.equal(pitch(4),2048);assert.equal(pitch(5),1024);
  await f.audio.stop();await f.audio.useSoundChip('rf5c164');pcm.noteOn(0,'C5');
  assert.equal(pitch(0),2048,'Stop resumes the current UI Root');
  pcm.setRootNote('A4');f.audio.pcmSourceChanged();pcm.noteOn(0,'C5');
  assert.equal(pitch(0),2048,'a new author source also resumes its UI Root');
  await f.audio.dispose();
});

test('PCM note helpers validate before mutation and clamp the native step at both hardware limits',async()=>{
  const f=fixture(),pcm=await f.audio.useSoundChip('rf5c164'),from=f.events.length;
  for(const method of ['setNote','noteOn']) {
    for(const note of [undefined,null,true,{},'', 'H4','C20',-1,128,69.5,NaN,Infinity])assert.throws(()=>pcm[method](0,note),RangeError);
    for(const channel of [-1,8,.5,NaN,'0'])assert.throws(()=>pcm[method](channel,'C4'),RangeError);
  }
  assert.deepEqual(f.events.slice(from),[],'invalid calls change neither pitch nor keys');
  assert.deepEqual(f.audio.getState().pcmChannels,[]);
  const low=createPcmBuiltinPreset('sine');low.sample.sampleRate=PCM_NATIVE_RATE/2048;low.settings.rootNote=127;
  f.options.getPcmVoice().setPreset(low);f.audio.pcmSourceChanged();assert.equal(pcm.setNote(0,0),1);
  const high=createPcmBuiltinPreset('sine');high.sample.sampleRate=384000;high.settings.rootNote=0;
  f.options.getPcmVoice().setPreset(high);f.audio.pcmSourceChanged();assert.equal(pcm.setNote(0,127),65535);
  await f.audio.dispose();
});

test('PCM note helpers reject unknown Code RAM tuning until the author sample returns, while raw controls keep working',async()=>{
  const f=fixture(),pcm=await f.audio.useSoundChip('rf5c164');
  for(const write of [()=>pcm.loadMemory(Uint8Array.of(128,255)),()=>pcm.loadSample({sampleRate:48000,channels:[Float32Array.of(0,.5,0)]})]) {
    await write();pcm.reset();const from=f.events.length;
    for(const method of ['setNote','noteOn'])assert.throws(()=>pcm[method](0,'C4'),/editor sample tuning.*setPitch\(\).*keyOn\(\)/);
    assert.deepEqual(f.events.slice(from),[],'a register reset keeps RAM and cannot restore tuning metadata');
    pcm.setPitch(0,2048);pcm.keyOn(0);assert.deepEqual(f.events.at(-1),['pcm-on',0]);
    await f.audio.stop();assert.equal(await f.audio.useSoundChip('rf5c164'),pcm);pcm.noteOn(0,'C4');
    assert.deepEqual(f.events.at(-1),['pcm-on',0]);
  }
  await pcm.loadMemory(Uint8Array.of(128,255));f.audio.pcmSourceChanged();
  assert.doesNotThrow(()=>pcm.noteOn(0,'C4'),'an explicit author sample change restores the metadata basis');
  await f.audio.dispose();
});

test('PCM musical pending notes cancel safely and keep explicit later raw pitch edits',async()=>{
  for(const action of ['noteOff','source','stop','newer','pitch','memory']) {
    let gate=null,ready=true;const f=fixture({ensureChip:()=>gate?.promise}),pcm=await f.audio.useSoundChip('rf5c164');
    const voice=f.options.getPcmVoice();voice.isReady=()=>ready;ready=false;gate=deferred();
    const from=f.events.length,first=pcm.noteOn(4,'C4');assert(first instanceof Promise);await turn();await turn();
    assert(!f.events.slice(from).some(e=>e[0]==='pcm-on'));
    let replacement,rejected;
    if(action==='noteOff')pcm.noteOff(4);
    else if(action==='source')f.audio.pcmSourceChanged();
    else if(action==='stop')await f.audio.stop();
    else if(action==='newer')replacement=pcm.noteOn(4,'C5');
    else if(action==='pitch')pcm.setPitch(4,4321);
    else {rejected=assert.rejects(first,/editor sample tuning/);await pcm.loadMemory(Uint8Array.of(128,255));}
    ready=true;gate.resolve();
    if(rejected)await rejected;else assert.equal(await first,undefined);
    if(replacement)await replacement;
    const starts=f.events.slice(from).filter(e=>e[0]==='pcm-on');
    assert.equal(starts.length,['newer','pitch'].includes(action)?1:0,action+' cannot revive an obsolete note');
    if(action==='pitch')assert.equal(f.events.filter(e=>e[0]==='pcm-channel'&&e[1]===4).at(-1)[2].step,4321);
    if(action==='newer')assert.equal(f.events.filter(e=>e[0]==='pcm-channel'&&e[1]===4).at(-1)[2].step,8428);
    await f.audio.dispose();
  }
});

test('Code sample-memory writes restore the untouched author sample at Stop',async()=>{
  const f=fixture(),before=f.getPreset(),pcm=await f.audio.useSoundChip('rf5c164');
  const sample=await pcm.loadSample({sampleRate:48000,channels:[Float32Array.from([1,0,-1])]}, {address:256,endGuardBytes:33,loopStart:0});
  assert.equal(sample.start,256);assert.equal(sample.loopStart,256);assert.equal(sample.step,Math.round(48000*384/12500000*2048));
  const write=f.events.find(e=>e[0]==='pcm-memory');assert.equal(write[1].length,36);assert(write[1].subarray(3).every(v=>v===255));
  await f.audio.stop();assert.deepEqual(f.getPreset(),before);assert.deepEqual(f.events.slice(-2),[['restore-preset'],['restore-memory']]);await f.audio.dispose();
});

test('PWM has one calibrated Master gain and a pending creation cannot revive a stopped Code session',async()=>{
  const f=fixture(),pwm=await f.audio.useSoundChip('pwm'),request=f.pwmRequests[0];
  assert.equal(request.gain.gain.value,.5*SYNTH_SONG_MIX_DEFAULTS.pwm);assert.equal(request.config.gain,1);assert.equal(request.config.outputMode,'duty');
  f.audio.setMaster(2);assert.equal(request.gain.gain.value,2*SYNTH_SONG_MIX_DEFAULTS.pwm);pwm.write(0,5);
  await f.audio.stop();assert.equal(request.gain.gain.value,0);assert.equal(request.device.disposals,1);assert.equal(f.context.closeCalls,0);
  const delayed=fixture({pendingPwm:true}),creating=delayed.audio.useSoundChip('pwm'),rejected=assert.rejects(creating,{name:'AbortError'});
  await turn();await turn();await delayed.audio.stop();const pending=delayed.pwmRequests[0];pending.task.resolve(pending.device);await rejected;
  assert.equal(pending.device.disposals,1);assert.equal(pending.gain.gain.value,0);await delayed.audio.dispose();await f.audio.dispose();
});

test('PWM source volume is absolute and independent from Master across pending creation and Stop/restart',async()=>{
  const f=fixture({pendingPwm:true});f.audio.setPwmSourceVolume(1.6);f.audio.setMaster(2);
  const preparing=f.audio.useSoundChip('pwm');await new Promise(resolve=>setImmediate(resolve));
  const first=f.pwmRequests[0];assert.equal(first.gain.gain.value,3.2,'updates made before allocation survive lazy creation');
  f.audio.setPwmSourceVolume(.25);f.audio.setMaster(3.8);assert.equal(first.gain.gain.value,.25*3.8);
  first.task.resolve(first.device);const pwm=await preparing;
  assert.equal(first.gain.gain.value,.25*3.8);assert.equal(first.config.gain,1,'endpoint has no second source or Master gain');
  pwm.write(0,5);const writes=pwm.writes.length;
  f.audio.setPwmSourceVolume(3.8);assert.equal(first.gain.gain.value,3.8*3.8);
  f.audio.setPwmSourceVolume(0);assert.equal(first.gain.gain.value,0);
  assert.equal(pwm.writes.length,writes,'source gain never writes PWM audio state');
  for(const value of [-1,3.81,NaN,Infinity,'1',null])assert.throws(()=>f.audio.setPwmSourceVolume(value),/0\.\.3\.8/);
  assert.equal(first.gain.gain.value,0);
  await f.audio.stop();f.audio.setPwmSourceVolume(.75);f.audio.setMaster(2);assert.equal(first.gain.gain.value,0,'retired endpoints stay muted');
  const next=f.audio.useSoundChip('pwm');await new Promise(resolve=>setImmediate(resolve));const second=f.pwmRequests[1];
  assert.equal(second.gain.gain.value,1.5);second.task.resolve(second.device);await next;
  assert.equal(second.gain.gain.value,1.5);await f.audio.dispose();
});

test('PWM side output gates preserve stereo wiring and source/Master gains through pending readiness and recreation',async()=>{
  const f=fixture({pendingPwm:true});f.audio.setPwmChannelMuted(0,true);f.audio.setPwmSourceVolume(.75);f.audio.setMaster(2);
  const preparing=f.audio.useSoundChip('pwm');await new Promise(resolve=>setImmediate(resolve));
  const first=f.pwmRequests[0],split=[...first.gain.edges][0],sides=split.connections.map(edge=>edge.target),merger=[...sides[0].edges][0];
  assert.equal(first.gain.gain.value,1.5);assert.equal(first.config.gain,1);
  assert.equal(first.gain.edges.size,1);assert.equal(first.gain.edges.has(f.input),false,'there is no parallel unmuted route');
  assert.equal(split.name,'splitter');assert.equal(split.outputs,2);
  assert.deepEqual(split.connections.map(({output,input})=>[output,input]),[[0,0],[1,0]]);
  assert.equal(merger.name,'merger');assert.equal(merger.inputs,2);assert.deepEqual([...merger.edges],[f.input]);
  assert.deepEqual(sides.map(side=>side.connections.map(({target,output,input})=>[target===merger,output,input])),[[[true,0,0]],[[true,0,1]]]);
  assert.deepEqual(sides.map(side=>side.gain.value),[0,1]);
  f.audio.setPwmChannelMuted(1,true);f.audio.setPwmChannelMuted(0,false);
  assert.deepEqual(sides.map(side=>side.gain.value),[1,0]);assert.equal(first.gain.gain.value,1.5,'pending side updates never overwrite the common source gain');
  first.task.resolve(first.device);const pwm=await preparing;pwm.write(0,5);const writes=pwm.writes.length;
  f.audio.setPwmSourceVolume(.25);f.audio.setMaster(3.8);assert.equal(first.gain.gain.value,.25*3.8);
  f.audio.setPwmChannelMuted(0,true);f.audio.setPwmChannelMuted(0,true);assert.deepEqual(sides.map(side=>side.gain.value),[0,0]);
  f.audio.setPwmChannelMuted(1,false);assert.deepEqual(sides.map(side=>side.gain.value),[0,1]);assert.equal(pwm.writes.length,writes,'mute never writes or refills the PWM FIFO');
  for(const side of [-1,2,.5,'0'])assert.throws(()=>f.audio.setPwmChannelMuted(side,true));
  for(const value of [0,1,'false',null])assert.throws(()=>f.audio.setPwmChannelMuted(0,value));
  assert.deepEqual(f.audio.getState().pwmChannelMutes,[true,false]);
  await f.audio.stop();assert.equal(first.gain.gain.value,0);
  for(const node of [first.gain,split,...sides,merger])assert.equal(node.edges.size,0,'all owned routing nodes are retired');
  const next=f.audio.useSoundChip('pwm');await new Promise(resolve=>setImmediate(resolve));const second=f.pwmRequests[1];
  const nextSplit=[...second.gain.edges][0],nextSides=nextSplit.connections.map(edge=>edge.target);
  assert.deepEqual(nextSides.map(side=>side.gain.value),[0,1],'side preferences survive the retired physical endpoint');
  assert.equal(second.gain.gain.value,.25*3.8);second.task.resolve(second.device);await next;await f.audio.dispose();
});

test('a late retired PWM endpoint cannot reconnect its stereo gate or alter the newer owner masks',async()=>{
  const f=fixture({pendingPwm:true}),obsolete=f.audio.useSoundChip('pwm'),rejected=assert.rejects(obsolete,{name:'AbortError'});
  await new Promise(resolve=>setImmediate(resolve));const old=f.pwmRequests[0],oldNodes=f.nodes.slice(2);
  await f.audio.stop();f.audio.setPwmChannelMuted(1,true);
  const fresh=f.audio.useSoundChip('pwm');await new Promise(resolve=>setImmediate(resolve));const next=f.pwmRequests[1];
  const split=[...next.gain.edges][0],sides=split.connections.map(edge=>edge.target);assert.deepEqual(sides.map(side=>side.gain.value),[1,0]);
  old.task.resolve(old.device);await rejected;assert.equal(old.device.disposals,1);
  assert(oldNodes.every(node=>node.edges.size===0));assert.deepEqual(sides.map(side=>side.gain.value),[1,0]);
  next.task.resolve(next.device);await fresh;assert.equal(next.gain.edges.size,1);assert.equal(next.device.disposals,0);await f.audio.dispose();
});

test('an incomplete PWM stereo graph is disconnected before its construction error escapes',async()=>{
  const f=fixture();f.context.createChannelMerger=()=>{throw Error('no merger');};
  await assert.rejects(f.audio.useSoundChip('pwm'),/no merger/);assert.equal(f.pwmRequests.length,0);
  assert(f.nodes.slice(2).every(node=>node.edges.size===0));await f.audio.dispose();
});

test('liveFx replaces only the performance direct edge once and Stop restores dry routing and retires state',async()=>{
  const f=fixture();await f.audio.prepare();assert(f.input.edges.has(f.output));
  assert.throws(()=>f.audio.fx.liveFx('',{process(){}}));assert(f.input.edges.has(f.output));
  f.audio.fx.liveFx('gain',{process(input,output){output[0].set(input[0]);}});
  const rack=f.fxRequests[0].rack;assert(!f.input.edges.has(f.output));assert(f.input.edges.has(rack.node));assert(rack.node.edges.has(f.output));
  f.audio.fx.liveFx('gain',{process(){}});assert.equal(f.events.filter(e=>e[0]==='disconnect'&&e[1]==='performance'&&e[2]==='final').length,1);
  f.audio.fx.removeLiveFx('gain');assert(f.input.edges.has(f.output));assert(!f.input.edges.has(rack.node));
  f.audio.fx.liveFx('next',{process(){}});await f.audio.stop();assert(f.input.edges.has(f.output));assert(!rack.node.edges.has(f.output));assert(f.events.some(e=>e[0]==='fx-controller-dispose'));
  assert.equal(f.context.closeCalls,0);await f.audio.dispose();
});

test('late FX preparation cannot reconnect an old route after Stop',async()=>{
  const f=fixture({pendingFx:true}),preparing=f.audio.prepare(),rejected=assert.rejects(preparing,{name:'AbortError'});
  await turn();await f.audio.stop();const request=f.fxRequests[0];request.task.resolve(request.rack);await rejected;
  assert.equal(request.rack.disposals,1);assert(f.input.edges.has(f.output));assert.equal(f.audio.getState().fxRouted,false);await f.audio.dispose();
});

test('Stop cancels delayed sample decoding before it writes the shared PCM bank',async()=>{
  const f=fixture(),decode=deferred();f.context.decodeAudioData=()=>decode.promise;
  const pcm=await f.audio.useSoundChip('rf5c164'),loading=pcm.loadSample(new ArrayBuffer(8)),rejected=assert.rejects(loading,{name:'AbortError'});
  await f.audio.stop();decode.resolve({sampleRate:48000,numberOfChannels:1,getChannelData:()=>new Float32Array([0,.5])});await rejected;
  assert(!f.events.some(e=>e[0]==='pcm-memory'));await f.audio.dispose();
});

test('repeated Stop shares the bank-restoration fence and a fresh PCM client waits for the old RAM transfer',async()=>{
  const f=fixture(),pcm=await f.audio.useSoundChip('rf5c164'),restored=deferred();
  await pcm.loadMemory(Uint8Array.of(128,255));f.options.getPcmVoice().install=()=>restored.promise;
  const stop=f.audio.stop();assert.equal(f.audio.stop(),stop);let ready=false;
  const next=f.audio.useSoundChip('rf5c164').then(value=>{ready=true;return value;});
  await turn();await turn();assert.equal(ready,false);
  restored.resolve(true);await stop;assert.equal(await next,pcm);await f.audio.dispose();
});

test('an author PCM source change reseeds current sample speed, root and loop while other chips and FX keep running',async()=>{
  const f=fixture(),pcm=await f.audio.useSoundChip('rf5c164');await f.audio.prepare();
  f.audio.fx.liveFx('held',{process(){}});const fm=await f.audio.useSoundChip('ym2612');fm.noteOn(0,4,644);pcm.setPitch(2,65535);pcm.keyOn(2);
  const author=createPcmBuiltinPreset('triangle');author.sample.sampleRate=32000;author.settings={...author.settings,rootNote:72,loopStart:24,loopEnd:180,volume:40,panLeft:2,panRight:11};
  f.options.getPcmVoice().setPreset(author);const from=f.events.length;f.audio.pcmSourceChanged();
  assert(!f.events.slice(from).some(e=>['fm-off','psg-stop','fx-controller-dispose'].includes(e[0])));assert(f.audio.getState().fxRouted);
  pcm.keyOn(2);const settings=f.events.filter(e=>e[0]==='pcm-channel'&&e[1]===2).at(-1)[2];
  assert.deepEqual(settings,{start:0,loopStart:24,volume:40,pan:{left:2,right:11},step:Math.round(32000/(12500000/384)*2048*.5)});
  assert.deepEqual(f.events.at(-1),['pcm-on',2]);await f.audio.dispose();
});

test('PCM Note On waits for author RAM and is cancelled by key-up, source replacement, Stop or a newer same-channel note',async()=>{
  for(const action of ['keyOff','source','stop','newer']) {
    let gate=null,ready=true;const f=fixture({ensureChip:()=>gate?.promise}),pcm=await f.audio.useSoundChip('rf5c164');
    f.options.getPcmVoice().isReady=()=>ready;gate=deferred();ready=false;
    const from=f.events.length,first=pcm.keyOn(4);assert(first instanceof Promise);await turn();await turn();
    assert(!f.events.slice(from).some(e=>e[0]==='pcm-on'));
    let replacement;
    if(action==='keyOff')pcm.keyOff(4);
    else if(action==='source')f.audio.pcmSourceChanged();
    else if(action==='stop')await f.audio.stop();
    else replacement=pcm.keyOn(4);
    ready=true;gate.resolve();assert.equal(await first,false,action+' cancels the old pending note');
    if(replacement)await replacement;
    assert.equal(f.events.slice(from).filter(e=>e[0]==='pcm-on').length,action==='newer'?1:0,'only the latest wanted note may start');
    await f.audio.dispose();
  }
});

test('a pending PCM Note On seeds the new author bank while retaining explicit channel pitch written during preparation',async()=>{
  let gate=null,ready=true;const f=fixture({ensureChip:()=>gate?.promise}),pcm=await f.audio.useSoundChip('rf5c164');
  const voice=f.options.getPcmVoice();voice.isReady=()=>ready;
  const next=createPcmBuiltinPreset('triangle');next.settings.loopStart=20;next.settings.loopEnd=128;next.settings.volume=50;
  voice.setPreset(next);f.audio.pcmSourceChanged();ready=false;gate=deferred();pcm.setPitch(5,4096);
  const from=f.events.length,on=pcm.keyOn(5);await turn();await turn();assert(!f.events.slice(from).some(e=>e[0]==='pcm-on'));
  ready=true;gate.resolve();await on;
  const channel=f.events.filter(e=>e[0]==='pcm-channel'&&e[1]===5).at(-1)[2];
  assert.equal(channel.step,4096);assert.equal(channel.loopStart,20);assert.equal(channel.volume,50);assert.deepEqual(f.events.at(-1),['pcm-on',5]);
  const immediate=pcm.keyOn(6);assert(!(immediate instanceof Promise),'ready notes keep the synchronous FIFO path');assert.deepEqual(f.events.at(-1),['pcm-on',6]);await f.audio.dispose();
});

test('a new author PCM source cancels an older sample decode without stopping other chips or its FX',async()=>{
  const f=fixture(),decode=deferred();f.context.decodeAudioData=()=>decode.promise;
  await f.audio.prepare();f.audio.fx.liveFx('held',{process(){}});
  const fm=await f.audio.useSoundChip('ym2612');fm.noteOn(0,4,644);
  const pcm=await f.audio.useSoundChip('rf5c164'),loading=pcm.loadSample(new ArrayBuffer(8)),rejected=assert.rejects(loading,{name:'AbortError'});
  const author=createPcmBuiltinPreset('triangle');f.options.getPcmVoice().setPreset(author);const from=f.events.length;f.audio.pcmSourceChanged();
  decode.resolve({sampleRate:48000,numberOfChannels:1,getChannelData:()=>new Float32Array([0,.5])});await rejected;
  assert(!f.events.slice(from).some(e=>['pcm-memory','fm-off','psg-stop','fx-controller-dispose'].includes(e[0])));assert(f.audio.getState().fxRouted);
  await pcm.loadMemory(Uint8Array.of(128,255));assert(f.events.some(e=>e[0]==='pcm-memory'),'a new explicit Code write after the author choice remains available');await f.audio.dispose();
});

test('drawing the shared author sample preserves Code notes, channel settings and the Code Root override',async()=>{
  const f=fixture(),pcm=await f.audio.useSoundChip('rf5c164');pcm.setRootNote('A4');pcm.noteOn(7,'C5');
  const step=f.events.filter(event=>event[0]==='pcm-channel'&&event[1]===7).at(-1)[2].step;
  const state=f.audio.getState(),from=f.events.length;f.audio.beforePcmSampleEdit();
  assert.deepEqual(f.events.slice(from),[],'draw preparation does not write registers or release voices');
  const next=f.getPreset();next.sample.data=createPcmBuiltinPreset('triangle').sample.data;
  f.options.getPcmVoice().setPreset(next);
  assert.deepEqual(f.audio.getState(),state);
  assert.equal(pcm.setNote(7,'C5'),step,'draw preserves the explicit Code Root rather than restoring UI Root');
  pcm.noteOff(7);assert.deepEqual(f.events.at(-1),['pcm-release',7]);assert.deepEqual(f.audio.getState().pcmChannels,[]);
  await f.audio.dispose();
});

test('drawing rejects custom Code RAM and pending Stop restoration before mutating state; completed Stop releases the guard',async()=>{
  const f=fixture(),pcm=await f.audio.useSoundChip('rf5c164'),restored=deferred();pcm.setPitch(2,3011);pcm.keyOn(2);
  await pcm.loadMemory(Uint8Array.of(128,255));const state=f.audio.getState(),author=f.getPreset(),from=f.events.length;
  assert.throws(()=>f.audio.beforePcmSampleEdit(),/Stop Code.*different PCM RAM/);
  assert.deepEqual(f.audio.getState(),state);assert.deepEqual(f.getPreset(),author);assert.equal(f.events.length,from);
  f.options.getPcmVoice().install=()=>restored.promise;
  const stop=f.audio.stop();assert.throws(()=>f.audio.beforePcmSampleEdit(),/Wait for Code to stop/);
  restored.resolve();await stop;assert.doesNotThrow(()=>f.audio.beforePcmSampleEdit());
  await f.audio.dispose();
});

test('drawing keeps pending Code notes owned and an actual Key Up cancels them while RAM is updating',async()=>{
  for(const release of [false,true]) {
    let gate=null,ready=true;const f=fixture({ensureChip:()=>gate?.promise}),pcm=await f.audio.useSoundChip('rf5c164');
    pcm.setRootNote('A4');f.options.getPcmVoice().isReady=()=>ready;ready=false;gate=deferred();
    const from=f.events.length,on=pcm.noteOn(4,'E5');await turn();await turn();
    f.audio.beforePcmSampleEdit();f.audio.beforePcmSampleEdit();
    if(release)pcm.noteOff(4);
    ready=true;gate.resolve();await on;
    assert.equal(f.events.slice(from).filter(event=>event[0]==='pcm-on').length,release?0:1);
    assert.deepEqual(f.audio.getState().pcmChannels,release?[]:[4]);
    if(!release){pcm.noteOff(4);assert.deepEqual(f.events.at(-1),['pcm-release',4]);}
    await f.audio.dispose();
  }
});

test('drawing invalidates an older asynchronous Code sample decode without stopping the current performance',async()=>{
  const f=fixture(),decode=deferred();f.context.decodeAudioData=()=>decode.promise;
  const pcm=await f.audio.useSoundChip('rf5c164');pcm.noteOn(1,'C4');
  const loading=pcm.loadSample(new ArrayBuffer(8)),rejected=assert.rejects(loading,{name:'AbortError'}),from=f.events.length;
  f.audio.beforePcmSampleEdit();decode.resolve({sampleRate:48000,numberOfChannels:1,getChannelData:()=>new Float32Array([0,.5])});
  await rejected;assert.deepEqual(f.events.slice(from),[]);assert.deepEqual(f.audio.getState().pcmChannels,[1]);
  pcm.noteOff(1);assert.deepEqual(f.events.at(-1),['pcm-release',1]);await f.audio.dispose();
});

test('Code FM uses author OP masks and updates only held operators without retriggering pitch',async()=>{
  const writes=[],native=new YM2612Synth({transport:{write:(port,register,value)=>writes.push({port,register,value}),reset(){}}});
  let voice={keyMask:5,specialMode:false,specialFrequencies:[]};
  const f=fixture({fmChip:native,getFmVoice:()=>voice}),fm=await f.audio.useSoundChip('ym2612');
  fm.noteOn(0,4,644);assert.deepEqual(writes.filter(w=>w.register===0x28).map(w=>w.value),[0,0x50]);
  assert.deepEqual(f.audio.getState().fmChannels,[0]);writes.length=0;
  voice={...voice,keyMask:9};f.audio.syncFmVoice();assert.deepEqual(writes,[{port:0,register:0x28,value:0x90}],'live OP edit sends only one new key mask, with no pitch or unrelated channel writes');
  writes.length=0;voice={...voice,keyMask:0};f.audio.syncFmVoice();assert.deepEqual(writes,[{port:0,register:0x28,value:0}]);
  writes.length=0;fm.keyOn(1);assert.deepEqual(writes,[{port:0,register:0x28,value:1}],'omitted operator list honors the all-Off author mask');
  writes.length=0;fm.keyOn(1,[1]);assert.deepEqual(writes,[{port:0,register:0x28,value:0x21}],'an explicit operator list remains the raw physical API');
  fm.keyOff(1);fm.noteOff(0);assert.deepEqual(f.audio.getState().fmChannels,[]);writes.length=0;f.audio.syncFmVoice();assert.deepEqual(writes,[],'released channels are not re-keyed by later UI edits');
  fm.noteOn(5,'C4');assert(writes.some(w=>w.register===0x28&&w.value===6),'note-name overload also keeps the author mask');await f.audio.stop();assert.deepEqual(f.audio.getState().fmChannels,[]);await f.audio.dispose();
});

test('author CH3 tuning applies to physical CH3 only and Code CH1 never redirects or disables an independent CH3',async()=>{
  const writes=[],native=new YM2612Synth({transport:{write:(port,register,value)=>writes.push({port,register,value}),reset(){}}});
  const voice={keyMask:5,specialMode:true,specialFrequencies:[{block:4,fnum:256},{block:4,fnum:512},{block:4,fnum:768},{block:4,fnum:1024}]};
  const f=fixture({fmChip:native,getFmVoice:()=>voice}),fm=await f.audio.useSoundChip('ym2612');
  fm.noteOn(0,4,644);assert.deepEqual(writes.filter(w=>w.register===0x28).map(w=>w.value),[0,0x50]);
  assert(!writes.some(w=>w.register===0x27||w.register>=0xa8&&w.register<=0xae),'regular CH1 does not change CH3 mode or operator pitch');
  writes.length=0;fm.noteOn(2,4,1024);assert.deepEqual(writes.filter(w=>w.register===0x28).map(w=>w.value),[2,0x52]);
  assert(writes.some(w=>w.register===0x27&&(w.value&64)));assert(writes.some(w=>w.register===0xa9));assert(writes.some(w=>w.register===0xaa));assert(writes.some(w=>w.register===0xa8));
  writes.length=0;fm.setFrequency(0,4,700);assert(writes.some(w=>w.register===0xa0));assert(!writes.some(w=>w.register===0x27||w.register>=0xa8&&w.register<=0xae));
  writes.length=0;fm.noteOff(0);assert.deepEqual(writes,[{port:0,register:0x28,value:0}]);assert.deepEqual(f.audio.getState().fmChannels,[2]);await f.audio.dispose();
});
