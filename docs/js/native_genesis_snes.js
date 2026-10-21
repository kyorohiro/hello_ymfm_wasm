/** SNES instruments use JS for register generation; DSP and RAM live natively. */
import {SnesSynth} from './snessynth.js?v=spc-song-js-1';
import {prepareSpcTimeline} from './spc.js?v=spc-events-1';
import {SnesVoiceInspector} from './playground_snes_inspector.js?v=audio-numeric-bindings-1';

const abort=()=>new DOMException('Native SNES playback stopped','AbortError');
const controls=new Set(['setPreset','setChannel','setPitch','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','allNotesOff','reset','writeDsp']);
function shadow(){
  const registers=new Uint8Array(128);let capture=null;
  const core={nativeFrames:0,reset(){registers.fill(0);capture?.push({method:'reset'});},
    writeDsp(register,value){registers[register]=value;capture?.push({method:'write',register,value});},
    readDsp:register=>registers[register],loadRam(data,address=0){capture?.push({method:'load-memory',address,data:Array.from(data)});},dispose(){}};
  const synth=new SnesSynth({core});
  return {synth,registers,collect(method,args=[]){const commands=[];capture=commands;try{synth[method](...args);}finally{capture=null;}return commands;}};
}

export function createNativeGenesisSnes(owner){
  const projected=shadow(),applied=shadow(),held=new Map(),pending=new Set();
  let nextVoice=0,nextCommand=0,collecting=null,uiSerial=Promise.resolve(),timeline=null,timelineRevision=0;
  const check=()=>{if(!owner.isReady())throw new Error('Native SNES audio is not ready');if(owner.stopping||owner.closing)throw abort();};
  const capture=()=>{check();return {session:owner.session,generation:owner.generation};};
  const current=token=>{check();if(token.session!==owner.session||token.generation!==owner.generation)throw abort();};
  const timed=(message,timing={})=>({type:'snes',message,frame:timing.time===undefined?0:owner.frameAt(timing.time),
    ...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  const send=(messages,timing={})=>{check();owner.enqueueMany(messages.map(message=>timed(message,message.method==='load-memory'||message.method==='prepare-timeline'?{}:timing)));};
  const identify=message=>{if(nextCommand>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native SNES command identity limit reached');return {...message,id:++nextCommand};};
  function operations(target,method,args){
    if(!controls.has(method)&&method!=='loadBRR')throw new Error(`Unsupported Native SNES operation: ${method}`);
    let messages=target.collect(method,args);
    // KON/KOFF shadow masks cannot describe future notes on independent voices.
    // Native applies each key action at its actual DSP frame instead.
    if(['keyOn','noteOn','keyOff','noteOff'].includes(method)){
      messages=messages.filter(message=>message.register!==0x4c&&message.register!==0x5c);
      messages.push({method:method==='keyOn'||method==='noteOn'?'key-on':'key-off',channel:args[0]});
    }
    return messages;
  }
  function instrumentOnly(){if(timeline)throw new Error('SNES timeline mode is exclusive; reset() before editing instruments');}
  function control(method,args=[]){check();if(method!=='reset')instrumentOnly();const messages=operations(projected,method,args);send(messages);if(method==='reset'){timelineRevision++;cancelCompletion();timeline=null;projected.synth.timeline=null;}}
  projected.synth.getTimelineState=()=>timeline?{...timeline}:{loaded:false,playing:false,positionFrames:0,totalFrames:0,ended:false};
  const client={id:'snes',sampleRate:48000,nativeSampleRate:32000,
    _getState:()=>projected.synth.getState(),
    _adoptState(state){if(!state)return;projected.synth.samples=structuredClone(state.samples??[]);projected.synth.channels=structuredClone(state.channels??projected.synth.channels);projected.synth.nextAddress=state.nextAddress??0x400;if(state.timeline){timeline={...state.timeline};projected.synth.timeline={...timeline};}},
    _stopVoices:()=>dispatch({method:'stopVoices'}),dispose(){},
    async loadBRR(input,options){const token=capture();instrumentOnly();const messages=operations(projected,'loadBRR',[input,options]);const sample={...projected.synth.samples.at(-1)};send(messages);await owner.flush();current(token);return sample;},
    async readDsp(register){if(!Number.isInteger(register)||register<0||register>127)throw new RangeError('DSP register must be0..127');return (await snapshot()).registers[register];},
    async getState(){await read();return applied.synth.getState();},
    async getPreset(channel){instrumentOnly();projected.synth.getPreset(channel);await read();return applied.synth.getPreset(channel);},
    async snapshot(){const data=await snapshot({ram:true});return {ram:Uint8Array.from(data.ram),dsp:Uint8Array.from(data.registers),nativeFrames:data.nativeFrames};},
    prepareTimeline:trace=>prepareTimeline(trace),playTimeline:()=>playTimeline(),stopTimeline:()=>stopTimeline(),
    async getTimelineState(){return (await snapshot()).timeline;},
  };
  for(const method of controls)client[method]=(...args)=>control(method,args);
  const inspector=new SnesVoiceInspector(applied.synth,{sampleRate:48000,
    dispatch:(command,manualOwner)=>{if(!collecting)throw new Error('Native SNES inspector command outside an edit');collecting.push({command,owner:manualOwner});},
    beginAudition:(channel,manualOwner)=>{if(nextVoice>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native SNES audition identity limit reached');held.set(channel,{owner:manualOwner,voice:++nextVoice});},endAudition(){},
  });
  function adopt(data,{adoptClient=false}={}){
    if(!Array.isArray(data?.registers)||data.registers.length!==128||data.registers.some(v=>!Number.isInteger(v)||v<0||v>255)||!Number.isSafeInteger(data.nativeFrames)||data.nativeFrames<0||!Number.isInteger(data.enabled)||data.enabled<0||data.enabled>255)throw new Error('Native SNES returned an invalid snapshot');
    applied.registers.set(data.registers);applied.synth.core.nativeFrames=data.nativeFrames;
    applied.synth.samples=structuredClone(projected.synth.samples);applied.synth.nextAddress=projected.synth.nextAddress;
    applied.synth.timeline=data.timeline?.loaded?{...data.timeline}:null;
    applied.synth.getTimelineState=()=>data.timeline;
    inspector.sampleRate=owner.clock.sampleRate;client.sampleRate=owner.clock.sampleRate;inspector.gates=data.enabled;
    for(let channel=0;channel<8;channel++){
      inspector.assignedSamples.set(channel,data.registers[channel*16+4]);
      applied.synth.channels[channel]=inspector.voice(channel);
    }
    if(adoptClient){client._adoptState(applied.synth.getState());projected.registers.set(data.registers);projected.synth.koff=255;projected.synth.pendingKon=0;projected.synth.konFrame=-1;}
    return inspector.read();
  }
  async function snapshot(args={}){const token=capture(),data=await owner.nativeRequest('native_genesis_snes_status',args);current(token);adopt(data);return data;}
  async function read(args={}){await snapshot(args);return inspector.read();}
  function cancelCompletion(){for(const wait of pending){clearTimeout(wait.timer);wait.reject(abort());}pending.clear();}
  async function prepareTimeline(trace){
    const token=capture(),data=prepareSpcTimeline(trace),revision=++timelineRevision;cancelCompletion();
    const command=identify({method:'prepare-timeline',ram:Array.from(data.initialState.ram),dsp:Array.from(data.initialState.dsp),events:Array.from(data.events),durationClocks:data.durationClocks});send([command]);
    await owner.flush();current(token);if(revision!==timelineRevision)throw abort();
    const state=(await snapshot({after:command.id})).timeline;current(token);if(revision!==timelineRevision)throw abort();
    if(!state?.loaded)throw new Error('Native SNES timeline could not replace a held Keyboard instrument');
    timeline={...state};
    projected.synth.timeline={...timeline};return {...timeline};
  }
  async function playTimeline(timing={}){
    const token=capture();if(!timeline)throw new Error('Prepare an SNES timeline before playback');const revision=++timelineRevision;cancelCompletion();
    const command=identify({method:'play-timeline'});send([command],timing);await owner.flush();current(token);if(revision!==timelineRevision)throw abort();timeline.playing=true;
    return new Promise((resolve,reject)=>{
      const wait={reject,timer:null};pending.add(wait);
      const finish=async()=>{try{current(token);if(revision!==timelineRevision)throw abort();const data=await snapshot(),state=data.timeline;if(!pending.has(wait))return;
        if(data.pendingCommands?.includes(command.id)){wait.timer=setTimeout(finish,10);return;}
        if(state.ended&&!state.playing){pending.delete(wait);timeline={...state};resolve(state);}
        else if(!state.playing){pending.delete(wait);reject(abort());}
        else wait.timer=setTimeout(finish,Math.max(5,Math.min(1000,(state.totalFrames-state.positionFrames)/32)));
      }catch(error){pending.delete(wait);reject(error);}};
      wait.timer=setTimeout(finish,Math.max(1,Math.max(0,(timing.time??owner.clock.currentTime)-owner.clock.currentTime)*1000+timeline.totalFrames/32));
    });
  }
  async function stopTimeline(timing={}){const token=capture(),revision=++timelineRevision;cancelCompletion();send([identify({method:'stop-timeline'})],timing);await owner.flush();current(token);if(revision!==timelineRevision)throw abort();if(timeline)timeline.playing=false;return {...timeline};}
  async function dispatch(message,timing={}){
    const token=capture(),{method,args=[],id}=message;let value=true;
    if(method==='dispose')return id===undefined?undefined:{id,value};
    if(method==='playTimeline')return {deferred:playTimeline(timing).then(value=>({id,value}),error=>({id,error:String(error.message??error),name:error.name}))};
    if(method==='loadBRR')value=await client.loadBRR(...args);
    else if(method==='prepareTimeline')value=await prepareTimeline(...args);
    else if(method==='stopTimeline')value=await stopTimeline(timing);
    else if(['getTimelineState','readDsp','getState','getPreset','snapshot'].includes(method))value=await client[method](...args);
    else if(method==='stopVoices'){timelineRevision++;cancelCompletion();send([{method:'stop-voices'}],timing);}
    else {if(method!=='reset')instrumentOnly();send(operations(projected,method,args),timing);if(method==='reset'){timelineRevision++;cancelCompletion();timeline=null;projected.synth.timeline=null;}}
    await owner.flush();current(token);return id===undefined?undefined:{id,value};
  }
  async function invoke(method,args){
    const token=capture();await read();current(token);const commands=[],oldHeld=new Map(held);collecting=commands;let result;
    try{result=inspector.invoke(method,args);}finally{collecting=null;}
    const groups=[];
    for(const entry of commands){const channel=entry.command.args[0],lease=held.get(channel)??oldHeld.get(channel),action=method==='auditionOn'?'on':'off';
      let group=groups.at(-1);if(!group||group.channel!==channel){group={method:'batch',channel,voice:lease.voice,audition:true,action,commands:[]};groups.push(group);}
      group.commands.push(...operations(applied,entry.command.method,entry.command.args));
    }
    for(let index=0;index<groups.length;index++)groups[index]=identify(groups[index]);
    send(groups);await owner.flush();current(token);
    if(method==='auditionOff'&&result)held.delete(args[0]);if(method==='auditionAllOff')held.clear();
    if(groups.length)await read({after:groups.at(-1).id});
    // Audition only updates the selected voice; other projected future voices survive.
    for(const group of groups){const ch=group.channel;projected.synth.channels[ch]={...applied.synth.channels[ch]};for(let offset=0;offset<8;offset++)projected.registers[ch*16+offset]=applied.registers[ch*16+offset];}
    return result;
  }
  return {client,dispatch,read,
    async invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=uiSerial.then(()=>{current(token);return invoke(method,copy);});uiSerial=result.catch(()=>{});return result;},
    initialize(){control('reset');},mix(volume,pan){send([{method:'mix',volume,pan}]);return owner.flush();},
    stopped(){held.clear();inspector.resetAuditions();timelineRevision++;if(timeline)timeline.playing=false;cancelCompletion();},
    adoptStopped(data){this.stopped();return adopt(data,{adoptClient:true});},
    reset(){this.stopped();timeline=null;projected.synth.samples=[];projected.synth.sampleBytes=[];projected.synth.nextAddress=0x400;projected.synth.reset();},
  };
}
