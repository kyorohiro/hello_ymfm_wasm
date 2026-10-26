import {WonderSwan,WONDERSWAN_CLOCK} from './wonderswan.js?v=wonderswan-mode-2';
import factory from '../generated/wonderswan_wasm.js?v=wonderswan-mode-2';
import {ChipClockResampler,validateChipClock} from './playground_chip_clock.js?v=wonderswan-mode-2';
import {createProcessorPerformance} from './playground_performance_processor.js?v=wonderswan-mode-2';
import {WonderSwanVoiceInspector} from './playground_wonderswan_inspector.js?v=wonderswan-mode-2';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=wonderswan-mode-2';

class Processor extends AudioWorkletProcessor {
  constructor({processorOptions:{clock=WONDERSWAN_CLOCK,wasmBinary}}){
    super();this.baseClock=this.clock=validateChipClock(clock);this.dead=false;this.chip=null;this.authorGates=0;this.resampler=new ChipClockResampler();this.pendingClocks=new Set();this.clockSequence=0;
    this.speakerPhase=0;this.speakerLeft=this.speakerRight=this.targetLeft=this.targetRight=0;this.engineRate=Math.floor(clock/128);
    this.targetChannelLeft=new Float64Array(4);this.targetChannelRight=new Float64Array(4);this.waveReady=new Uint8Array(4);this.coldWavePosition=new Uint16Array(4);
    this.performance=createProcessorPerformance({chip:'wonderswan',getWonderSwanRegisters:()=>this.inspector?.registers,releaseNote:key=>({method:'keyOff',args:[key]}),
      prepare:(data,port)=>{
        if(data.method==='stopVoices'){this.apply(data,port);return null;}
        if(data.method==='clock'||data.type==='chip-clock'){
          let reservation;
          try{
            if(!this.chip)throw new Error('WonderSwan not ready');if(this.inspector?.auditions.size)throw new Error('WonderSwan is held by a manual audition');validateChipClock(data.clock??data.args[0]);
            reservation=++this.clockSequence;this.pendingClocks.add(reservation);
            if(data.id!==undefined)port.postMessage(data.type==='chip-clock'?{type:'chip-clock-result',id:data.id}:{id:data.id,value:true});
            return {...data,id:undefined,performanceAcknowledged:true,clockReservation:reservation};
          }catch(error){this.pendingClocks.delete(reservation);if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message});return null;}
        }
        if(data.id===undefined)return data;const {id,...command}=data;port.postMessage({id,value:true});return command;
      },onDiscard:data=>this.pendingClocks.delete(data.clockReservation),onBlocked:(data,port)=>{this.pendingClocks.delete(data.clockReservation);if(data.id!==undefined)port.postMessage({id:data.id,value:true});},apply:(...args)=>this.apply(...args)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage=({data})=>{
      if(data.primaryWorker){this.workerRemote?.close();this.workerRemote=null;if(data.port){if(this.dead){data.port.close();return;}const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();}return;}
      if(data.type==='detach-chip-port'){this.retireRemote();return;}
      if(data.port){this.retireRemote();if(this.dead){data.port.close();return;}const remote=this.remote=data.port;remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();}
      else this.receive(data,this.port);
    };
    WonderSwan.create({moduleFactory:factory,moduleOptions:{wasmBinary},clock,sampleRate}).then(chip=>{
      if(this.dead){chip.dispose();return;}this.chip=chip;
      // Reserve the full allowed external clock ratio for a 128-frame quantum.
      chip.reserveFrames(Math.ceil(128*100000000/this.baseClock));
      this.inspector=new WonderSwanVoiceInspector({clock:()=>this.clock,sampleRate,dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),beginAudition:(ch,owner)=>{if(this.pendingClocks.size)throw new Error('WonderSwan clock change is scheduled; audition after it is applied');this.performance.beginAudition(ch,owner);},endAudition:(ch,owner)=>this.performance.endAudition(ch,owner)});
      this.port.postMessage({ready:true});
    }).catch(error=>{this.dispose();this.port.postMessage({error:error.message});});
  }
  dispose(){if(this.dead)return;this.inspector?.resetAuditions();this.performance.clear();this.dead=true;this.chip?.dispose();this.chip=null;this.remote?.close();this.workerRemote?.close();}
  retireRemote(){this.remote?.close();this.remote=null;const session=this.performance.getStats().activeSession;if(session)this.receive({type:'performance-stop',session});else{this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();}}
  publishState(){const registers=Array.from(this.inspector.registers);registers[16]=(registers[16]&240)|this.authorGates;this.port.postMessage({type:'wonderswan-state',state:{clock:this.clock,initialized:true,registers,memory:Array.from(this.inspector.memory)}});}
  receive(data,port=this.port){
    if(Array.isArray(data)){for(const command of data)this.receive(command,port);return;}
    if(data?.type==='chip-inspector'){receiveChipInspector(data,port,this.inspector?(action,method,args)=>{const value=action==='read'?this.inspector.read():this.inspector.invoke(method,args);if(action!=='read'&&!method.startsWith('audition'))this.publishState();return value;}:null);return;}
    if((data?.method==='clock'||data?.type==='chip-clock')&&this.inspector?.auditions.size){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:'WonderSwan is held by a manual audition'});return;}
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(stopping||data?.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port)){if(stopping){this.stopVoices();this.performance.clear();}return;}this.apply(data,port);
  }
  writeRegister(address,value,controlMask,metadata){
    if(address===0x90&&controlMask!==undefined){if(!Number.isInteger(controlMask)||controlMask<0||controlMask>255)throw new RangeError('WonderSwan control mask must be 0..255');value=(this.inspector.registers[16]&~controlMask)|(value&controlMask);}
    this.chip.writeRegister(address,value);this.inspector.observeWrite(address,value);
    if(address===0x90&&!metadata?.owner?.startsWith('voice-editor:')){
      let mask=(controlMask??255)&15;
      // An applied byte also contains untouched/manual gates. Adopt only the
      // author's intended gate fields, never a temporary editor lease mixed in
      // by another channel's stale control snapshot.
      for(const [ch,id] of this.inspector.auditions)if(metadata?.owner!==`voice-editor:${id}`)mask&=~(1<<ch);
      this.authorGates=(this.authorGates&~mask)|(value&mask);
    }
    this.updateSpeakerCenter();
  }
  updateSpeakerCenter(){
    const r=this.inspector.registers,memory=this.inspector.memory,control=r[16];let left=0,right=0;this.targetChannelLeft.fill(0);this.targetChannelRight.fill(0);
    if(r[17]&8)for(let ch=0;ch<4;ch++)if(control&(1<<ch)){
      let channelLeft=0,channelRight=0;
      if(ch===1&&(control&32)){const volume=r[20];if(volume&12)channelLeft=(volume&8)?127.5:63.5;if(volume&3)channelRight=(volume&2)?127.5:63.5;}
      else{let midpoint=0;if(ch===3&&(control&128)){if(r[14]&16)midpoint=7.5;}else{const address=((r[15]<<6)+ch*16)&0x3fff;for(let i=0;i<16;i++){const value=memory[(address+i)&0x3fff];midpoint+=(value&15)+(value>>4);}midpoint/=32;}channelLeft=midpoint*(r[8+ch]>>4);channelRight=midpoint*(r[8+ch]&15);}
      this.targetChannelLeft[ch]=channelLeft/1024;this.targetChannelRight[ch]=channelRight/1024;left+=channelLeft;right+=channelRight;
    }
    this.targetLeft=left/1024;this.targetRight=right/1024;
  }
  speakerTick(){
    const r=this.inspector.registers,control=r[16];let left=0,right=0;
    if(r[17]&8)for(let ch=0;ch<4;ch++)if(control&(1<<ch)){
      const pcm=ch===1&&!!(control&32);
      if(pcm||this.waveReady[ch]){left+=this.targetChannelLeft[ch];right+=this.targetChannelRight[ch];}
      // Cold-reset signal is zero until a wave fetch, and the core emits that
      // fetched sample on the following native tick. Subtracting the waveform
      // mean sooner would turn a silent startup into an artificial -DC pulse.
      // Counters/gates are retained on key-off, so this fence is needed only
      // until each channel's first fetch; ordinary note edges stay untouched.
      if(!pcm&&!this.waveReady[ch]){const period=2048-(r[ch*2]|((r[ch*2+1]&7)<<8));this.coldWavePosition[ch]+=128;if(this.coldWavePosition[ch]>=period)this.waveReady[ch]=1;}
    }
    this.speakerLeft=left;this.speakerRight=right;
  }
  stopVoices(){if(!this.chip)return;this.writeRegister(0x90,this.inspector.registers[16]&240);this.authorGates=0;this.resampler.left=this.resampler.right=0;}
  apply(data,port=this.port,frame,metadata){
    try{
      if(data.method==='dispose'){this.dispose();return;}if(!this.chip)throw new Error('WonderSwan not ready');
      if(data.method==='clock'||data.type==='chip-clock'){if(!data.performanceAcknowledged&&this.inspector.auditions.size)throw new Error('WonderSwan is held by a manual audition');this.clock=validateChipClock(data.clock??data.args[0]);this.resampler.setClock(this.clock,this.baseClock);}
      else if(data.method==='stopVoices'){this.inspector.invoke('auditionAllOff');this.performance.clear();this.stopVoices();}
      else if(data.method==='reset'){this.chip.reset();this.inspector.reset();this.authorGates=0;this.resampler.resetPhase();this.speakerPhase=0;this.speakerLeft=this.speakerRight=this.targetLeft=this.targetRight=0;this.targetChannelLeft.fill(0);this.targetChannelRight.fill(0);this.waveReady.fill(0);this.coldWavePosition.fill(0);}
      else if(data.method==='writeRegister')this.writeRegister(...data.args,data.controlMask,metadata);
      else if(data.method==='writeMemory'){this.chip.writeMemory(...data.args);this.inspector.observeMemory(...data.args);this.updateSpeakerCenter();}
      else if(data.method==='keyOff'){const ch=data.args[0];if(!Number.isInteger(ch)||ch<0||ch>3)throw new RangeError('WonderSwan channel must be 0..3');this.writeRegister(0x90,this.inspector.registers[16]&~(1<<ch),1<<ch,metadata);if(!(this.inspector.registers[16]&15))this.resampler.left=this.resampler.right=0;}
      else if(data.method==='allNotesOff')this.stopVoices();
      else if(data.type==='clear-scheduled-writes')this.performance.clear();
      else throw new Error(`Unsupported WonderSwan command: ${data.method??data.type}`);
      if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,value:true});
    }catch(error){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message});}
    finally{if(data.clockReservation!==undefined)this.pendingClocks.delete(data.clockReservation);}
  }
  generateStereoView(frames){
    const pcm=this.chip.generateStereoView(frames),silent=!(this.inspector.registers[16]&15)||!(this.inspector.registers[17]&8);
    // The raw core's headphone DAC is unipolar. Remove only its static wave
    // midpoint at this speaker boundary, preserving chip gain and raw PCM.
    // A native tick updates held PCM; its center must change on that same tick,
    // rather than immediately when a register is written between ticks.
    for(let i=0;i<frames;i++){
      this.speakerPhase+=this.engineRate;
      while(this.speakerPhase>=sampleRate){this.speakerPhase-=sampleRate;this.speakerTick();}
      pcm.left[i]=silent?0:pcm.left[i]-this.speakerLeft;pcm.right[i]=silent?0:pcm.right[i]-this.speakerRight;
    }
    return pcm;
  }
  renderSegment(left,right){if(this.chip)this.resampler.render(this,left,right);else{left.fill(0);right.fill(0);}}
  process(inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0];this.performance.render(left,right,this.renderSegment);return true;}
}
registerProcessor('tetorica-wonderswan',Processor);
