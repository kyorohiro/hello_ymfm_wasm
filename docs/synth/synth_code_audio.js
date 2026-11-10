// Connect Code performances to the Synth's existing instruments. These clients
// borrow the editor chips; only the PWM device and the common FX rack are owned.
import {createNativeFXRack} from '../js/native_fx_rack.js?v=prepared-fx-rerun-2';
import {createPWM32XAudio} from '../js/playground_pwm_audio.js';
import {createPWM32XClient} from '../js/pwm32x_playback.js';
import {encodeRf5c164,sampleBytes} from '../js/rf5c164_pcm.js';
import {decodeAudioBuffer} from '../js/audio_decode.js';
import {SEGAPSG_CLOCK} from '../js/segapsg.js';
import {noteToHz,opnPitchFromHz} from '../js/soundchip_pitch.js';
import {rf5c164MidiNote,rf5c164NoteStep} from '../js/rf5c164_notes.js?v=shared-notes-1';
import {PCM_NATIVE_RATE} from './synth_pcm.js?v=pcm-release-1';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';
import {createSynthPerformanceTarget,normalizeCapturedVoice} from './synth_performance.js?v=op-gates-1';

const names=new Set(['ym2612','segapsg','rf5c164','pwm']);
const cancelled=()=>new DOMException('Code audio stopped','AbortError');
const integer=(value,max,label)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw RangeError(`Invalid ${label}`);
  return value;
};
const clampStep=value=>Math.max(1,Math.min(65535,Math.round(value)));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

// App-only stereo output policy. PWM FIFO timing and register state remain
// untouched: muted sides still render and advance behind their output gains.
function createPwmStereoGate(context,output,{muted}) {
  const nodes=[];let closed=false;
  const dispose=()=>{if(closed)return;closed=true;for(const node of nodes)node.disconnect();};
  try {
    const input=context.createChannelSplitter(2);nodes.push(input);
    const sides=[context.createGain(),context.createGain()];nodes.push(...sides);
    const merger=context.createChannelMerger(2);nodes.push(merger);
    sides.forEach((side,ch)=>{
      side.gain.value=muted[ch]?0:1;input.connect(side,ch,0);side.connect(merger,0,ch);
    });
    merger.connect(output);
    return {input,setChannelMuted(ch,value){if(!closed)sides[ch].gain.value=value?0:1;},dispose};
  } catch(error){dispose();throw error;}
}

/**
 * getInput is the performance bus, initially connected directly to getOutput.
 * Editor Master/System gains are already applied before that bus. This host
 * inserts FX exactly once and restores that same direct edge when stopped.
 */
export function createSynthCodeAudio({ensureChip=async()=>{},getContext,getInput,getOutput,getFm,getPsg,getPsgVoice,
  getPcm,getPcmVoice,getFmVoice=()=>null,getMaster=()=>1,onLog=()=>{},createFxRack=createNativeFXRack,
  createPwmDevice=createPWM32XAudio,createPwmClient=createPWM32XClient,createPwmGate=createPwmStereoGate}={}) {
  for(const value of [ensureChip,getContext,getInput,getOutput,getFm,getPsg,getPsgVoice,getPcm,getPcmVoice,getFmVoice,getMaster,onLog,createFxRack,createPwmDevice,createPwmClient,createPwmGate]) {
    if(typeof value!=='function')throw TypeError('Code audio requires host callbacks');
  }
  let epoch=0,disposed=false,fxOwner=null,pwmOwner=null,pcmSeeded=false,pcmMemoryChanged=false,pcmSelected=0,stopping=null;
  let lastPcmSettings=null,lastPsgSettings=null,psgLatched=0,pcmSourceGeneration=0,pcmRootNote=null;
  let pwmSourceVolume=SYNTH_SONG_MIX_DEFAULTS.pwm,pwmMaster=null;
  const pwmChannelMutes=[false,false];
  const clients=new Map(),fmActive=new Set(),psgActive=new Map(),pcmChannels=new Map(),pcmActive=new Set(),pcmPending=new Map(),fxNames=new Set();
  const pcmCodeRootChannels=new Set();
  const check=token=>{if(disposed||token!==epoch)throw cancelled();};
  const required=(get,label)=>{const api=get();if(!api)throw Error(`${label} audio is not ready`);return api;};
  const settingsPsg=()=>required(getPsgVoice,'PSG').getSettings();
  const settingsPcm=()=>required(getPcmVoice,'PCM').getSettings();
  const restoreDirect=owner=>{
    if(!owner?.routed)return;
    try{owner.input.disconnect(owner.rack.node);}catch{}
    try{owner.rack.node.disconnect(owner.output);}catch{}
    if(owner.context.state!=='closed'&&owner.input===getInput()&&owner.output===getOutput())owner.input.connect(owner.output);
    owner.routed=false;
  };
  function activateFx(owner) {
    if(owner!==fxOwner||!owner?.rack||owner.closed)throw Error('Code FX is not ready');
    if(owner.routed)return;
    owner.input.disconnect(owner.output);
    owner.input.connect(owner.rack.node);owner.rack.node.connect(owner.output);owner.routed=true;
  }
  function retireFx(owner) {
    if(!owner||owner.closed)return;
    restoreDirect(owner);owner.closed=true;
    owner.rack?.stop();owner.rack?.dispose();
    if(fxOwner===owner)fxOwner=null;
  }
  async function prepare() {
    const token=epoch;check(token);if(stopping)await stopping;check(token);
    const context=getContext(),input=getInput(),output=getOutput();
    if(!context||context.state==='closed'||input?.context!==context||output?.context!==context)throw TypeError('Code audio needs the host performance route');
    if(fxOwner?.context===context&&fxOwner.input===input&&fxOwner.output===output)return fxOwner.promise;
    retireFx(fxOwner);
    const owner=fxOwner={context,input,output,rack:null,routed:false,closed:false,promise:null};
    owner.promise=Promise.resolve().then(()=>createFxRack(context)).then(rack=>{
      if(owner.closed||owner!==fxOwner||token!==epoch||disposed){rack.dispose();throw cancelled();}
      owner.rack=rack;rack.onError=message=>onLog(`[liveFx] ${message}`);return owner;
    }).catch(error=>{if(fxOwner===owner)retireFx(owner);throw error;});
    return owner.promise;
  }
  const fx=new Proxy({}, {get(_target,key){
    if(key==='liveFx')return(name,options)=>{
      const owner=fxOwner;if(!owner?.rack)throw Error('Code FX is not ready');
      owner.rack.controller.liveFx(name,options);fxNames.add(name);activateFx(owner);
    };
    if(key==='removeLiveFx')return name=>{
      const owner=fxOwner;if(!owner?.rack)return;
      owner.rack.controller.removeLiveFx(name);fxNames.delete(name);
      if(!fxNames.size&&!owner.rack.controller.getChain().length)restoreDirect(owner);
    };
    const controller=fxOwner?.rack?.controller,value=controller?.[key];
    if(typeof value!=='function')return value;
    return(...args)=>{
      const result=value.apply(controller,args);
      if(key==='setChain'&&(args[0]?.length||fxNames.size))activateFx(fxOwner);
      if(key==='clear'&&!fxNames.size)restoreDirect(fxOwner);
      return result;
    };
  }});
  function retirePwm(owner) {
    if(!owner||owner.closed)return;
    owner.closed=true;owner.abort.abort(cancelled());owner.gain.gain.value=0;
    try {owner.api?.dispose();}
    finally {
      try {owner.device?.dispose();}
      finally {owner.gain.disconnect();owner.gate.dispose();if(pwmOwner===owner)pwmOwner=null;}
    }
  }
  async function preparePwm() {
    const context=getContext(),output=getInput();
    if(!context||context.state==='closed'||output?.context!==context)throw TypeError('PWM needs the host performance route');
    if(pwmOwner?.context===context&&pwmOwner.output===output)return pwmOwner.promise;
    retirePwm(pwmOwner);
    const token=epoch,gain=context.createGain();gain.gain.value=pwmSourceVolume*(pwmMaster??getMaster());
    let gate;
    try {gate=createPwmGate(context,output,{muted:[...pwmChannelMutes]});gain.connect(gate.input);}
    catch(error){gain.disconnect();gate?.dispose();throw error;}
    const owner=pwmOwner={context,output,gain,gate,abort:new AbortController(),device:null,api:null,closed:false,promise:null};
    owner.promise=Promise.resolve().then(()=>createPwmDevice(context,gain,{signal:owner.abort.signal,gain:1,outputMode:'duty',onError:error=>{
      if(pwmOwner!==owner)return;onLog(`PWM: ${error.message}`);retirePwm(owner);
    }})).then(device=>{
      if(owner.closed||owner!==pwmOwner||token!==epoch||disposed){device.dispose();throw cancelled();}
      owner.device=device;owner.api=createPwmClient(device.port??device.node?.port);return owner.api;
    }).catch(error=>{retirePwm(owner);throw error;});
    return owner.promise;
  }
  const delegate=(get,key,args)=>{
    const target=required(get,'Code sound chip'),value=target[key];
    if(typeof value!=='function')throw Error(`Unsupported sound chip method: ${String(key)}`);
    return value.apply(target,args);
  };
  function client(name,overrides,get) {
    if(!clients.has(name))clients.set(name,new Proxy({}, {get(_target,key){
      if(key==='id')return `${name}:synth`;
      if(key==='clock'&&name==='segapsg')return SEGAPSG_CLOCK;
      if(key==='clock'&&name==='rf5c164')return PCM_NATIVE_RATE*384;
      if(Object.hasOwn(overrides,key))return overrides[key];
      if(key==='then')return undefined;
      const value=get()?.[key];
      return typeof value==='function'?(...args)=>delegate(get,key,args):value;
    }}));
    return clients.get(name);
  }
  function psgTone(ch,options={}) {
    const settings=settingsPsg(),api=required(getPsg,'PSG');
    const level=options.attenuation===undefined&&options.volume===undefined?settings.attenuation:undefined;
    const period=api.tone(ch,{...options,...(level===undefined?{}:{attenuation:level})});
    psgActive.set(ch,{source:'tone'});
    if(settings.envelope.enabled)api.envelopeNoteOn?.(ch,settings.envelope,level??settings.attenuation);
    return period;
  }
  function psgOff(ch) {
    integer(ch,3,'PSG channel');const api=required(getPsg,'PSG'),settings=settingsPsg();
    if(settings.envelope.enabled&&psgActive.has(ch))api.envelopeNoteOff?.(ch);
    else if(ch===3)api.noiseOff();else api.keyOff(ch);
    psgActive.delete(ch);
  }
  function stopPsg() {getPsg()?.allNotesOff();psgActive.clear();}
  const psgOverrides={tone:psgTone,noteOn:(ch,note)=>psgTone(ch,{note}),
    keyOn:ch=>{
      integer(ch,3,'PSG channel');const api=required(getPsg,'PSG'),settings=settingsPsg();
      if(ch===3)api.setNoise({type:settings.noiseType,rate:settings.noiseRate});
      if(settings.envelope.enabled)api.envelopeNoteOn?.(ch,settings.envelope,settings.attenuation);
      else api.setAttenuation(ch,settings.attenuation);
      psgActive.set(ch,{source:ch===3?'noise':'tone'});
    },
    off:psgOff,keyOff:psgOff,noteOff:psgOff,noiseOff:()=>psgOff(3),allNotesOff:stopPsg,dispose:stopPsg,
    noise(options={}) {
      const settings=settingsPsg(),api=required(getPsg,'PSG');
      const value=api.noise({type:settings.noiseType,rate:settings.noiseRate,attenuation:settings.attenuation,...options});
      psgActive.set(3,{source:'noise'});
      if(settings.envelope.enabled)api.envelopeNoteOn?.(3,settings.envelope,settings.attenuation);
      return value;
    },
    setAttenuation(ch,value) {
      const result=required(getPsg,'PSG').setAttenuation(ch,value);
      if(value<15)psgActive.set(ch,{source:ch===3?'noise':'tone'});else psgActive.delete(ch);
      return result;
    },
    write(value) {
      const result=required(getPsg,'PSG').write(value);
      if(value&128)psgLatched=value>>4&7;
      if(psgLatched&1){const ch=psgLatched>>1;if((value&15)<15)psgActive.set(ch,{source:ch===3?'noise':'tone'});else psgActive.delete(ch);}
      return result;
    },
    noiseVolume(value) {const result=required(getPsg,'PSG').noiseVolume(value);if(value>0)psgActive.set(3,{source:'noise'});else psgActive.delete(3);return result;},
    reset:()=>{psgActive.clear();return required(getPsg,'PSG').reset();},
    resetAll:()=>{psgActive.clear();return required(getPsg,'PSG').resetAll();},
  };
  function defaultPcmChannel() {
    const voice=required(getPcmVoice,'PCM'),preset=voice.getPreset(),s=preset.settings;
    return {start:0,loopStart:s.loopEnabled?s.loopStart:s.loopEnd+1,volume:s.volume,pan:{left:s.panLeft,right:s.panRight},
      step:clampStep(preset.sample.sampleRate/PCM_NATIVE_RATE*2048*2**((60-s.rootNote)/12))};
  }
  function writePcmChannel(ch,options) {
    integer(ch,7,'PCM channel');if(!object(options))throw TypeError('PCM channel settings must be an object');
    const api=required(getPcm,'PCM'),before=pcmChannels.get(ch)??defaultPcmChannel();
    api.setChannel(ch,options);
    pcmChannels.set(ch,{...before,...options,pan:options.pan?{...options.pan}:{...before.pan}});
  }
  function setPcmChannel(ch,options) {
    writePcmChannel(ch,options);
    if(options.step!==undefined)pcmCodeRootChannels.delete(ch);
  }
  function seedPcm() {
    if(pcmSeeded)return;
    const api=required(getPcm,'PCM'),settings=defaultPcmChannel();
    for(let ch=0;ch<8;ch++) {
      const configured=pcmChannels.get(ch),next={...settings,...configured,pan:{...(configured?.pan??settings.pan)}};
      api.setChannel(ch,next);pcmChannels.set(ch,next);
    }
    lastPcmSettings=settingsPcm();pcmSeeded=true;
  }
  function stopPcm() {pcmPending.clear();const pcm=getPcm();if(pcm)for(let ch=0;ch<8;ch++)pcm.keyOff(ch);pcmActive.clear();}
  function pcmSourceChanged() {
    // The author has already stopped these channels and selected a new bank.
    // Other Code chips and the shared effects keep their current performance.
    pcmSourceGeneration++;pcmPending.clear();pcmActive.clear();pcmChannels.clear();pcmCodeRootChannels.clear();pcmRootNote=null;
    pcmSeeded=false;pcmMemoryChanged=false;pcmSelected=0;
    lastPcmSettings=settingsPcm();
  }
  function startPcm(ch) {
    seedPcm();const value=required(getPcm,'PCM').keyOn(ch);pcmActive.add(ch);return value;
  }
  function keyOnPcm(ch,beforeStart) {
    integer(ch,7,'PCM channel');pcmPending.delete(ch);
    const voice=required(getPcmVoice,'PCM');
    if(typeof voice.isReady!=='function'||voice.isReady()!==false){beforeStart?.();return startPcm(ch);}
    const owner={epoch},wanted=()=>!disposed&&owner.epoch===epoch&&pcmPending.get(ch)===owner;
    pcmPending.set(ch,owner);
    return Promise.resolve().then(()=>{if(wanted())return ensureChip('rf5c164');}).then(()=>{
      if(!wanted())return false;
      pcmPending.delete(ch);
      if(typeof voice.isReady==='function'&&voice.isReady()===false)throw Error('PCM sample RAM is not ready');
      beforeStart?.();
      return startPcm(ch);
    },error=>{
      if(!wanted())return false;
      pcmPending.delete(ch);throw error;
    });
  }
  // Software tuning: Root note names the author's sample at its original
  // sample rate. It is not a detected fundamental or a one-cycle assumption.
  function checkPcmNoteTuning() {
    if(pcmMemoryChanged)throw Error('PCM note helpers use the editor sample tuning. After Code sample-memory writes, use setPitch() and keyOn().');
  }
  function setPcmRootNote(note) {
    // Code metadata affects subsequent note helpers, never the editor or an
    // already configured voice. null resumes following the editor Root note.
    const next=note===null?null:rf5c164MidiNote(note);
    const effective=next??settingsPcm().rootNote;
    pcmRootNote=next;
    return effective;
  }
  function setNotePcm(ch,note) {
    integer(ch,7,'PCM channel');
    const midi=rf5c164MidiNote(note);
    checkPcmNoteTuning();
    const preset=required(getPcmVoice,'PCM').getPreset();
    const step=rf5c164NoteStep(midi,{rootNote:pcmRootNote??preset.settings.rootNote,
      baseStep:preset.sample.sampleRate/PCM_NATIVE_RATE*2048});
    writePcmChannel(ch,{step});
    if(pcmRootNote===null)pcmCodeRootChannels.delete(ch);else pcmCodeRootChannels.add(ch);
    return step;
  }
  function noteOnPcm(ch,note) {
    setNotePcm(ch,note);
    const pending=keyOnPcm(ch,checkPcmNoteTuning);
    if(pending&&typeof pending.then==='function')return pending.then(()=>{});
  }
  const pcmOverrides={setChannel:setPcmChannel,setPitch:(ch,step)=>setPcmChannel(ch,{step}),
    setRootNote:setPcmRootNote,setNote:setNotePcm,noteOn:noteOnPcm,
    keyOn:keyOnPcm,
    keyOff:ch=>{integer(ch,7,'PCM channel');pcmPending.delete(ch);const api=required(getPcm,'PCM');if(typeof api.releaseNote==='function')api.releaseNote(ch);else api.keyOff(ch);pcmActive.delete(ch);},
    noteOff:ch=>pcmOverrides.keyOff(ch),allNotesOff:stopPcm,dispose:stopPcm,
    async loadMemory(bytes,address=0) {const pending=required(getPcm,'PCM').loadMemory(sampleBytes(bytes),address);pcmMemoryChanged=true;return pending;},
    async loadSample(source,{address=0,loopStart,endGuardBytes=0}={}) {
      const token=epoch,sourceGeneration=pcmSourceGeneration;
      const checkSource=()=>{check(token);if(sourceGeneration!==pcmSourceGeneration)throw cancelled();};
      integer(address,65535,'PCM address');integer(endGuardBytes,65536,'PCM guard');
      if(address%256)throw RangeError('PCM start must be 256-byte aligned');
      let pcm=source;
      if(!source?.channels||!source.sampleRate) {
        const bytes=source instanceof ArrayBuffer?source:ArrayBuffer.isView(source)?source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength):null;
        if(!bytes)throw TypeError('PCM sample requires local audio bytes or decoded channels');
        const decoded=await decodeAudioBuffer(getContext(),bytes);checkSource();
        pcm={sampleRate:decoded.sampleRate,channels:Array.from({length:decoded.numberOfChannels},(_,ch)=>decoded.getChannelData(ch))};
      }
      const encoded=encodeRf5c164(pcm),length=encoded.frames+Math.max(3,endGuardBytes);
      if(address+length>65536)throw RangeError('PCM sample exceeds RAM');
      const loop=loopStart===undefined?address+encoded.frames+1:address+integer(loopStart,encoded.frames-1,'PCM loop');
      const bytes=new Uint8Array(length);bytes.set(encoded.bytes);if(endGuardBytes)bytes.fill(255,encoded.frames);
      checkSource();await pcmOverrides.loadMemory(bytes,address);checkSource();
      return {start:address,loopStart:loop,step:encoded.step};
    },
    writeRegister(register,value) {
      const api=required(getPcm,'PCM');api.writeRegister(register,value);
      if(register===7&&value&64)pcmSelected=value&7;
      const state=pcmChannels.get(pcmSelected)??defaultPcmChannel();
      if(register===0)state.volume=value;
      if(register===1)state.pan={left:value&15,right:value>>4};
      if(register===2)state.step=(state.step&65280)|value;
      if(register===3)state.step=(state.step&255)|(value<<8);
      if(register===2||register===3)pcmCodeRootChannels.delete(pcmSelected);
      pcmChannels.set(pcmSelected,state);
      if(register===8)for(let ch=0;ch<8;ch++){if(value&(1<<ch))pcmActive.delete(ch);else pcmActive.add(ch);}
    },
    reset() {stopPcm();pcmChannels.clear();pcmCodeRootChannels.clear();pcmSeeded=false;return required(getPcm,'PCM').reset();},
  };
  function syncPsgSettings(previous=lastPsgSettings) {
    const next=settingsPsg(),api=getPsg();lastPsgSettings=next;
    if(!api)return;
    if(previous&&(previous.source!==next.source||previous.envelope.enabled!==next.envelope.enabled)){psgActive.clear();return;}
    if(next.envelope.enabled)api.setEnvelopeAttenuation?.(next.attenuation);
    else for(const ch of psgActive.keys())api.setAttenuation(ch,next.attenuation);
    if(psgActive.has(3)&&(!previous||previous.noiseType!==next.noiseType||previous.noiseRate!==next.noiseRate))api.setNoise({type:next.noiseType,rate:next.noiseRate});
  }
  function syncPcmSettings(previous=lastPcmSettings) {
    const next=settingsPcm(),api=getPcm();lastPcmSettings=next;
    if(!api||!pcmChannels.size)return;
    for(const ch of pcmChannels.keys()) {
      const current=pcmChannels.get(ch)??defaultPcmChannel();
      writePcmChannel(ch,{volume:next.volume,pan:{left:next.panLeft,right:next.panRight},
        loopStart:next.loopEnabled?next.loopStart:next.loopEnd+1,
        step:previous&&!pcmCodeRootChannels.has(ch)?clampStep(current.step*2**((previous.rootNote-next.rootNote)/12)):current.step});
    }
  }
  function fmVoice(ch) {
    integer(ch,5,'FM channel');const voice=normalizeCapturedVoice(getFmVoice());
    return voice?.specialMode&&ch!==2?{...voice,specialMode:false,specialFrequencies:[]}:voice;
  }
  const fmTarget=createSynthPerformanceTarget({getSynth:getFm});
  function stopFm() {const fm=getFm();if(fm)for(let ch=0;ch<6;ch++)fm.keyOff(ch);fmActive.clear();}
  function noteOnFm(ch,noteOrBlock,fnum) {
    const voice=fmVoice(ch),raw=required(getFm,'FM');
    const pitch=fnum===undefined?opnPitchFromHz(noteToHz(noteOrBlock),raw.clock??7670454,144,{clamp:true}):{block:noteOrBlock,fnum};
    const value=fmTarget.noteOn(ch,pitch.block,pitch.fnum,voice);fmActive.add(ch);return value;
  }
  const fmOverrides={
    noteOn:noteOnFm,noteOnRaw:noteOnFm,
    noteOff(ch) {const value=fmTarget.noteOff(ch,fmVoice(ch));fmActive.delete(ch);return value;},
    keyOn(ch,operators) {
      const voice=fmVoice(ch),raw=required(getFm,'FM');
      const value=operators===undefined?fmTarget.setKeyMask(ch,voice):raw.keyOn(ch,operators);
      fmActive.add(ch);return value;
    },
    keyOff(ch,operators) {
      integer(ch,5,'FM channel');const raw=required(getFm,'FM'),value=raw.keyOff(ch,operators);
      if(operators===undefined||!operators.length)fmActive.delete(ch);return value;
    },
    setFrequency(ch,block,fnum) {return fmTarget.setFrequency(ch,block,fnum,fmVoice(ch));},
    allNotesOff:stopFm,dispose:stopFm,
    reset() {fmActive.clear();return required(getFm,'FM').reset();},
  };
  function syncFmVoice() {for(const ch of fmActive)fmTarget.setKeyMask(ch,fmVoice(ch));}
  async function useSoundChip(name) {
    if(!names.has(name))throw Error(`Synth Code supports ym2612, segapsg, rf5c164 and pwm; got ${String(name)}`);
    const token=epoch;check(token);if(stopping)await stopping;check(token);await ensureChip(name);check(token);
    if(name==='ym2612')return client(name,fmOverrides,getFm);
    if(name==='segapsg'){lastPsgSettings=settingsPsg();return client(name,psgOverrides,getPsg);}
    if(name==='rf5c164'){seedPcm();return client(name,pcmOverrides,getPcm);}
    await preparePwm();check(token);return client(name,{dispose:()=>retirePwm(pwmOwner)},()=>pwmOwner?.api);
  }
  function stop() {
    if(stopping)return stopping;
    ++epoch;stopFm();
    stopPsg();stopPcm();retirePwm(pwmOwner);
    fxNames.clear();
    if(fxOwner?.rack){fxOwner.rack.stop();fxOwner.rack.controller.dispose();restoreDirect(fxOwner);}
    else retireFx(fxOwner);
    pcmSeeded=false;pcmChannels.clear();pcmCodeRootChannels.clear();pcmRootNote=null;
    const restore=pcmMemoryChanged;pcmMemoryChanged=false;
    const task=Promise.resolve().then(async()=>{
      if(restore){const voice=getPcmVoice(),api=getPcm();if(voice&&api){voice.setPreset(voice.getPreset());await voice.install(api);}}
    }).finally(()=>{if(stopping===task)stopping=null;});
    stopping=task;return task;
  }
  return {prepare,useSoundChip,fx,getFm:()=>client('ym2612',fmOverrides,getFm),syncFmVoice,syncPsgSettings,syncPcmSettings,pcmSourceChanged,
    setMaster(value){
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3.8)throw RangeError('Code Master must be 0..3.8');
      pwmMaster=value;if(pwmOwner)pwmOwner.gain.gain.value=value*pwmSourceVolume;
    },
    setPwmSourceVolume(value){
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3.8)throw RangeError('PWM source volume must be 0..3.8');
      pwmSourceVolume=value;if(pwmOwner)pwmOwner.gain.gain.value=value*(pwmMaster??getMaster());
    },
    setPwmChannelMuted(side,value){
      integer(side,1,'PWM side');if(typeof value!=='boolean')throw TypeError('PWM muted must be a boolean');
      if(pwmChannelMutes[side]===value)return;
      pwmChannelMutes[side]=value;pwmOwner?.gate.setChannelMuted(side,value);
    },
    stop,async dispose(){if(disposed)return;disposed=true;await stop();retireFx(fxOwner);},
    getState:()=>({pwmReady:Boolean(pwmOwner?.api),pwmChannelMutes:[...pwmChannelMutes],fxRouted:Boolean(fxOwner?.routed),fxNames:[...fxNames],fmChannels:[...fmActive],psgChannels:[...psgActive.keys()],pcmChannels:[...pcmActive]})};
}
