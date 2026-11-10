// All routes and devices below are fake. No AudioContext or speaker is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthCodeAudio} from './synth_code_audio.js';
import {createPcmBuiltinPreset} from './synth_pcm.js';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js';
import {YM2612Synth} from '../js/ym2612synth.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>Promise.resolve();
function fixture({pendingFx=false,pendingPwm=false,ensureChip=async()=>{},fmChip=null,getFmVoice=()=>null}={}) {
  const events=[],gains=[],fxRequests=[],pwmRequests=[];
  const context={state:'running',currentTime:0,sampleRate:48000,closeCalls:0,close(){this.closeCalls++;},createGain(){const gain=node('gain');gain.gain={value:1};gains.push(gain);return gain;}};
  function node(name) {return {name,context,edges:new Set(),connect(target){this.edges.add(target);events.push(['connect',name,target.name]);return target;},disconnect(target){
    if(target){if(!this.edges.delete(target))throw Error('Missing edge');}else this.edges.clear();events.push(['disconnect',name,target?.name??'*']);
  }};}
  const input=node('performance'),output=node('final');input.connect(output);
  const fm=fmChip??{clock:7670454,noteOn:(...args)=>events.push(['fm-on',...args]),keyOff:ch=>events.push(['fm-off',ch]),noteOff:ch=>events.push(['fm-off',ch]),dispose(){throw Error('Cannot dispose borrowed FM');}};
  let psgSettings={source:'tone',attenuation:6,noiseType:'white',noiseRate:'medium',envelope:{enabled:false,attack:0,decay:0,sustain:100,release:0}};
  const psg={tone:(ch,options)=>{if(ch<0||ch>2)throw RangeError('tone channel');events.push(['psg-tone',ch,options]);return 99;},
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
  return {audio,options,events,context,input,output,fm,psg,pcm,gains,fxRequests,pwmRequests,
    setPsg:value=>{psgSettings={...psgSettings,...value};},getPsg:()=>structuredClone(psgSettings),
    setPcm:value=>{preset={...preset,settings:{...preset.settings,...value}};},getPreset:()=>structuredClone(preset)};
}

test('borrowed FM stays shared with its editor and Code disposal never closes that chip or the context',async()=>{
  const f=fixture(),fm=f.audio.getFm();assert.equal(fm,await f.audio.useSoundChip('ym2612'));
  assert.equal(fm.clock,7670454);fm.noteOn(0,4,644);assert(f.events.some(e=>e[0]==='fm-on'&&e[3]===644));
  fm.dispose();assert.equal(f.events.filter(e=>e[0]==='fm-off').length,6);
  await f.audio.stop();assert.equal(f.context.closeCalls,0);assert(f.input.edges.has(f.output));await f.audio.dispose();
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
